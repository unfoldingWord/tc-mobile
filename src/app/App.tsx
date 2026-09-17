import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen, type BooksScreenHandle } from "@/components/books-screen";
import { BuildStamp } from "@/components/build-stamp";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { SaveFailed } from "@/components/save-failed";
import {
  SegmentsScreen,
  type SegmentsScreenHandle,
} from "@/components/segments-screen";
import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { warmEncoder } from "@/hooks/mp3-codec";
import { useAudioSession } from "@/hooks/use-audio-session";
import { useSaveTake } from "@/hooks/use-save-take";
import { navDirection, popAction, screenFor } from "@/lib/nav/navigation";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The pivot app: Books → Segments → Recorder (a sheet over Segments).
 *
 *   Books      no chapter selected — the home screen (G2: empty on first run)
 *   Segments   a chapter selected
 *   Recorder   a segment being recorded — layered over the dimmed Segments list
 *
 * This screen holds no audio of its own. Every sound belongs to
 * `useAudioSession`, and every screen change goes through a handler that calls
 * `leave()` first, so "leaving ends what was sounding" is one call in one place
 * — which is also what makes "only one row plays" and "opening the recorder
 * stops playback" fall out for free rather than needing their own stop calls.
 *
 * The unsaved-take machinery (`useSaveTake`) is mounted here, above the sheet
 * that produces a take, so a finished recording survives the recorder closing
 * and the recovery screen has something to render when a save fails.
 */
export function App() {
  const [chapterId, setChapterId] = useState<ChapterId | null>(null);
  const [recorder, setRecorder] = useState<{
    segmentId: SegmentId;
    ordinal: number;
  } | null>(null);

  const segmentsRef = useRef<SegmentsScreenHandle>(null);
  // Books' own overlays (#374) — the hamburger Menu, New Book, the book ≡ menu,
  // the delete confirm — none of which push a history entry of their own.
  const booksRef = useRef<BooksScreenHandle>(null);
  // System-Back handling (#168). The recorder sheet, Segments and Books each
  // push one history entry, so a standalone-PWA Back gesture is a `popstate` we
  // route in-app instead of leaving the app — which on the recorder fired
  // `pagehide` → `leave()` and dropped the in-progress take (#58).
  const recorderRef = useRef<RecorderHandle>(null);
  // A recorder Back is running its async commit (stop → decode → save). While it
  // is, EVERY further popstate re-arms the protective entry instead of routing,
  // so a second Back cannot escape the recorder and drop the uncommitted take
  // (Frank R1 F1). Cleared when the commit settles.
  const committing = useRef(false);
  // George round 1 P2-1 (#393): the SAME shape as `committing`, for the window
  // between `dismiss-screen-overlay` re-arming and Books'/Segments' own
  // overlay-close consume actually landing as a popstate. Without this, a
  // popstate arriving in that window — the resulting consume's own traversal,
  // OR a genuinely new system Back — had nothing marking it as "absorb, don't
  // route": the overlay could already read as closed in React state (`Menu`'s
  // scrim/Close cascade, or the row menu's multi-hop `onMenuOpenChange` before
  // this same PR's fix made it synchronous) while history had not yet caught
  // up, so `popAction` ran `to-books`/`exit-app` on a screen that was mid-
  // dismiss rather than actually left. OR'd into `committing` at the call
  // site below rather than given `popAction` a new parameter: the effect
  // (re-arm, absorb) is identical to an in-flight recorder commit, and the
  // existing `"rearm-during-commit"` row already covers it once this is true.
  // Cleared where `pendingPush`/`suppressPop` are (the consume's own popstate).
  const dismissingOverlay = useRef(false);
  // Ignore exactly one popstate: the one our own `history.back()` fires to
  // consume an entry (a programmatic close, or the forward-trap re-assertion).
  const suppressPop = useRef(false);
  // An in-app Back is in flight (its `history.back()` has not yet come back as a
  // popstate). A synchronous latch so a rapid double-tap on the on-screen Back
  // issues only ONE traversal — the tap-level guard `onClick={close}` used to get
  // from `closing.current` before Back was rerouted through history (George R2
  // G3). Cleared as each popstate lands.
  const backRequested = useRef(false);
  // A monotonic id stamped on every entry, so the handler can tell Back from
  // Forward by comparing the destination index to where we were (F2). Only ever
  // increments; the live stack is strictly increasing in it (see `navDirection`).
  const nextIndex = useRef(0);
  const navIndex = useRef(0);

  const pushRawHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume, carrying
    // the monotonic index that tells Back from Forward. Routing reads live React
    // state for the screen, so the entry needs nothing more than its index.
    const index = ++nextIndex.current;
    window.history.pushState({ tc: true, index }, "");
    navIndex.current = index;
  }, []);

  // George round 1 P2-2 (#393, widened from Frank round 1's overlay-only
  // version): `window.history.back()` is asynchronous — its `popstate` lands
  // on a LATER task, not synchronously. ANY push while a consume's `back()` is
  // still outstanding (`suppressPop`) lands while the browser's still-pending
  // traversal is no longer guaranteed to target the entry it was issued for —
  // not only an overlay reopening (Frank's original finding), but also
  // `openChapter`/`openRecorder`: closing a Books/Segments overlay and
  // immediately tapping a chapter/Edit, before that close's `back()` lands,
  // used to push the new screen's entry unguarded, leaving the UI on a screen
  // history did not agree it had reached. EVERY push now goes through this ONE
  // guard — held as a ref, not fired immediately, whenever a consume is still
  // outstanding; the suppressed-popstate branch below drains it once that
  // traversal lands, so a push and a pending consume never overlap. The
  // internal re-arm pushes in the popstate switch below (trap-recovery,
  // rearm-during-commit, commit-close-recorder, dismiss-screen-overlay) all
  // run AFTER the `suppressPop` early-return, so `suppressPop.current` is
  // always false there and this guard is a proven no-op for them.
  const pendingPush = useRef(false);
  const pushHistoryEntry = useCallback(() => {
    if (suppressPop.current) {
      pendingPush.current = true;
      return;
    }
    pushRawHistoryEntry();
  }, [pushRawHistoryEntry]);

  // The programmatic half of #393/#374's overlay-entry bookkeeping: consume the
  // entry `pushHistoryEntry` pushed for an open Books/Segments overlay, once it
  // closes by a NON-popstate path (a tap on Close/scrim, a successful rename).
  // `suppressPop` marks the resulting popstate as ours, same as `closeRecorder`
  // below already does for its own programmatic close.
  const consumeOverlayEntry = useCallback(() => {
    // Frank round 1 P2 (#393, second pass): a reopen (or any other deferred
    // push) already deferred ITS push (`pendingPush`, above) because the
    // previous close's `back()` was still in flight — so THIS close has
    // nothing real to consume; the entry it would be undoing was never
    // pushed. Cancel the deferred push and stop: issuing a second `back()`
    // here would race the still-pending first one, and the drain below would
    // then push an entry for an overlay that is already closed again. Chains
    // of further rapid toggles collapse the same way, one cancellation at a
    // time, until an actual push or consume runs.
    if (pendingPush.current) {
      pendingPush.current = false;
      return;
    }
    suppressPop.current = true;
    window.history.back();
  }, []);

  // Stamp the entry the app loaded on, so its index is known (0) and a Back from
  // Segments to it reads as a Back, not an untracked jump.
  useEffect(() => {
    window.history.replaceState({ tc: true, index: 0 }, "");
    navIndex.current = 0;
    nextIndex.current = 0;
  }, []);

  const goBack = useCallback(() => {
    // Every in-app Back — the Segments list's, the recorder's on-screen Back —
    // goes through the browser so there is ONE Back path (the popstate handler).
    // That is what gives the on-screen recorder Back the same commit-window
    // protection as the system gesture, and removes the state-transition effects
    // whose async re-arm desynced depth (Frank R1 F1).
    //
    // Latch so a same-frame double-tap issues one traversal, not two — the second
    // `history.back()` would otherwise be coalesced into a single 2→0 jump that
    // mis-shapes the stack (George R2 G3). The latch clears as the popstate lands.
    if (backRequested.current) return;
    backRequested.current = true;
    window.history.back();
  }, []);
  // Which segment a held take belongs to, for the recovery screen — captured
  // when the recorder opened, so it survives the sheet closing on a failed
  // save. State, not a ref, because the recovery screen reads it during render.
  const [recordingOrdinal, setRecordingOrdinal] = useState<number | null>(null);
  // The cut/paste clipboard (B5), held here so it survives the recorder sheet
  // remounting per segment — G3: it reaches across a chapter and is lost on
  // close. Cleared on every chapter change so it never carries audio from one
  // chapter into another; lost on page close naturally (never persisted).
  const [clipboard, setClipboard] = useState<Int16Array | null>(null);

  const audio = useAudioSession();
  const { leave, primeAudioContext } = audio;

  // Transcode on Finished (B8, D3) is a background sweep. Each Finished
  // transition asks for one; this catch-all at launch covers anything left over
  // — a sweep the page was discarded in the middle of, or every finished
  // segment on a device that just upgraded to the v4 schema. Idempotent, so
  // asking here costs nothing when there is nothing owed.
  useEffect(() => {
    // Keep the encoder worker warm from launch, while this build's precache
    // still holds its chunk — so a Finished transcode or a Share after a
    // service-worker update does not depend on a purged chunk URL (#182).
    warmEncoder();
    void requestTranscodeSweep();
  }, []);
  const {
    pendingTake,
    saveRecording,
    saveEditedSegment,
    retryPendingTake,
    discardPendingTake,
  } =
    // A landed save leaves the row reading as unrecorded until the screen
    // rebuilds, which is the window a second take is lost in — so reload then.
    useSaveTake({ onSaved: () => segmentsRef.current?.reload() });

  const openChapter = useCallback(
    (id: ChapterId) => {
      leave();
      pushHistoryEntry(); // Books → Segments: a Back now returns here
      setClipboard(null); // chapter-scoped (G3)
      setRecorder(null);
      setChapterId(id);
    },
    [leave, pushHistoryEntry]
  );

  const backToBooks = useCallback(() => {
    leave();
    setClipboard(null); // chapter-scoped (G3)
    setRecorder(null);
    setChapterId(null);
  }, [leave]);

  const openRecorder = useCallback(
    (segmentId: SegmentId, ordinal: number) => {
      // Opening the recorder stops any row that was playing — the same single
      // `leave()` every navigation makes.
      leave();
      pushHistoryEntry(); // Segments → Recorder: Back becomes the commit
      // Resume the audio context in THIS tap (#184): the sheet loads and decodes
      // the segment one commit later, after this gesture's activation is spent,
      // so an iOS `"interrupted"` context would otherwise meet the first decode
      // un-resumed — the very trip the #155/#137 recovery panel exists to soften.
      // Priming it here spares the common transient case that failed open.
      primeAudioContext();
      setRecordingOrdinal(ordinal);
      setRecorder({ segmentId, ordinal });
    },
    [leave, primeAudioContext, pushHistoryEntry]
  );

  const closeRecorder = useCallback(
    (dirty: boolean) => {
      // The recorder has already stopped and committed any take before this
      // fires; `leave()` here only releases the floor and ends playback. Reload
      // only when something actually changed — a take committed or the finished
      // flag toggled — so a look-and-close does not pay for peak recomputation.
      leave();
      if (dirty) segmentsRef.current?.reload();
      setRecorder(null);
      // Keep history in step. A popstate-driven close is `committing`: the
      // browser already popped the entry and the handler pops the protective
      // one it re-armed, so leave history alone. A programmatic close (erase,
      // which calls `onExit` directly with no popstate) still has its entry on
      // the stack — consume it, suppressing the popstate that `back()` fires.
      if (!committing.current) {
        suppressPop.current = true;
        window.history.back();
      }
    },
    [leave]
  );

  // A held take whose save has failed takes over the screen with retry/discard
  // (the `SaveFailed` early return below). Computed here so the popstate handler
  // can see it: that screen is a modal, NOT a navigation level, so Back must not
  // route `to-books` under it (George R2 G2).
  const recovery = pendingTake && pendingTake.attempts > 0 ? pendingTake : null;
  const recovering = recovery !== null;

  // Route the system Back gesture (#168), and its Forward sibling. Every screen
  // pushed one indexed history entry, so a gesture arrives as a `popstate` here
  // instead of exiting the app. The whole decision is the pure `popAction`, so
  // the two rules that matter are unit-tested: Back on the recorder runs the
  // COMMIT path (never a take-dropping unmount, #58), and a second Back during
  // that commit re-arms rather than escaping (Frank R1 F1).
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // A Back gesture landed, so the in-flight in-app Back (if any) is done —
      // release the double-tap latch (G3).
      backRequested.current = false;
      const state = event.state as { index?: number } | null;
      const toIndex = state?.index ?? 0;
      // Our own `history.back()` (a programmatic close, or the forward trap)
      // fired this; the move is already accounted for. Keep the index truthful.
      if (suppressPop.current) {
        suppressPop.current = false;
        navIndex.current = toIndex;
        // George round 1 P2-1: whatever popped just now is the overlay
        // dismiss's own expected consume — the window `dismissingOverlay`
        // exists to absorb further popstates through is over.
        dismissingOverlay.current = false;
        // A reopen (or any other deferred push, George round 1 P2-2) arrived
        // while THIS consume was still in flight (`pushHistoryEntry`, Frank
        // round 1 P2) — the traversal that just landed is now accounted for,
        // so it is safe to push the deferred entry for real. `suppressPop` is
        // already false here, so the guard inside `pushHistoryEntry` is a
        // pass-through; called through it (not `pushRawHistoryEntry`
        // directly) so this stays the one place a push happens.
        if (pendingPush.current) {
          pendingPush.current = false;
          pushHistoryEntry();
        }
        return;
      }
      const direction = navDirection(navIndex.current, toIndex);
      navIndex.current = toIndex;
      const screen = screenFor(chapterId !== null, recorder !== null);
      // Read the CURRENT screen's own overlay state (#393/#374) — Books' and
      // Segments' own React state, still whatever it was the instant BEFORE
      // this gesture, since nothing here has touched it yet. The recorder's
      // overlays are handled entirely inside `commit-close-recorder` below and
      // never reach this flag (`popAction` itself never checks it for that
      // screen either).
      const screenOverlayOpen =
        screen === "books"
          ? (booksRef.current?.hasOpenOverlay() ?? false)
          : screen === "segments"
            ? (segmentsRef.current?.hasOpenOverlay() ?? false)
            : false;
      switch (
        popAction(
          direction,
          screen,
          // George round 1 P2-1: `dismissingOverlay` OR'd in here, not given
          // `popAction` a new parameter — the effect it needs (re-arm,
          // absorb) is exactly what `"rearm-during-commit"` already does for
          // an in-flight recorder commit, and this is the identical shape for
          // an in-flight overlay-dismiss consume.
          committing.current || dismissingOverlay.current,
          recovering,
          screenOverlayOpen
        )
      ) {
        case "trap-recovery":
          // The `SaveFailed` recovery screen is a modal, not a navigation level
          // (George R2 G2), and the only in-memory copy of the held take lives in
          // React state behind it. RE-ARM to absorb the gesture — the same push
          // `rearm-during-commit` uses — never `history.back()`: the browser has
          // already popped one entry toward root, and a second back() walks toward
          // the document unload that drops the take (Frank R3 G-R3-1). Retry /
          // Discard on the panel are the only ways out.
          pushHistoryEntry();
          return;
        case "rearm-during-commit":
          // A commit owns the stack. The browser just popped the protective
          // entry; re-push it so the recorder stays trapped, and ignore the
          // gesture — the in-flight commit is the only thing that may leave.
          pushHistoryEntry();
          return;
        case "trap-forward":
          // Forward is not a navigation this app redoes; cancel it so the UI
          // stays put and history does not desync (F2).
          suppressPop.current = true;
          window.history.back();
          return;
        case "ignore":
          return;
        case "commit-close-recorder": {
          const handle = recorderRef.current;
          if (!handle) return;
          // The browser already popped the recorder's entry. Re-arm SYNCHRONOUSLY
          // — before the async commit — so the stop → decode → save window is
          // never a moment with no entry protecting the recorder (F1). Run the
          // same `close()` the on-screen Back runs; on exit consume the single
          // protective entry, on decline leave it (the sheet stays open).
          pushHistoryEntry();
          committing.current = true;
          void handle
            .requestClose()
            .then((exited) => {
              if (exited) {
                suppressPop.current = true;
                window.history.back();
              }
            })
            .catch((cause: unknown) => {
              // `close()` never rejects by contract (its own `.catch` still calls
              // `onExit`), but the synchronous prelude or an `onExit` throw could —
              // and if `committing` never cleared, EVERY later Back would re-arm and
              // the recorder would be trapped forever (George R2 G4). Surface it.
              console.error("Recorder close rejected", cause);
            })
            .finally(() => {
              committing.current = false;
            });
          return;
        }
        case "to-books":
          backToBooks();
          return;
        case "exit-app":
          // The Books shelf pushed no entry, so this popstate is the browser
          // already leaving. Nothing to do — and nothing is lost at the shelf.
          return;
        case "dismiss-screen-overlay": {
          // The browser already popped the entry Books'/Segments' own overlay
          // pushed when it opened (#393/#374). Re-arm SYNCHRONOUSLY, the same
          // shape `commit-close-recorder` uses above, so there is no moment
          // with no entry protecting the screen from a second Back — then let
          // the screen dismiss its own overlay exactly the way its scrim/
          // Close would. That state change flips `hasOpenOverlay()` false,
          // which the screen's own effect answers by consuming THIS re-armed
          // entry (`onOverlayClose` → `consumeOverlayEntry`), landing the
          // stack back where it was before the overlay opened.
          //
          // `suppressPop.current` is guaranteed false here (the early-return
          // above already caught it if true), so `pushHistoryEntry` always
          // pushes for real. `dismissingOverlay` (George round 1 P2-1) latches
          // on `dismissOverlay()`'s OWN return value, not unconditionally, so
          // ANY popstate landing before the resulting consume's own — the
          // consume's traversal itself, or a genuinely new system Back
          // arriving in that window — is absorbed as `rearm-during-commit`
          // above rather than routed against an overlay that may already read
          // as closed in React state ahead of history catching up. Cleared
          // where `suppressPop` is, once that consume's own popstate lands.
          //
          // The return value matters because a screen's own closer can refuse
          // (Books' `onCancelNewBook`, mid-create) — nothing then closes, so
          // no consume ever follows to clear the latch. Setting it true
          // regardless would strand every later Back on `rearm-during-commit`
          // forever, even once the refusal lifts (Frank, on 25faf3f, #393).
          // The re-armed entry from `pushHistoryEntry()` above still stands
          // guard either way — a refused dismissal just means the NEXT Back
          // re-reads `screenOverlayOpen` (still true) and retries this same
          // case, rather than this one silently trapping it.
          pushHistoryEntry();
          dismissingOverlay.current =
            screen === "books"
              ? (booksRef.current?.dismissOverlay() ?? false)
              : screen === "segments"
                ? (segmentsRef.current?.dismissOverlay() ?? false)
                : false;
          return;
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [chapterId, recorder, recovering, backToBooks, pushHistoryEntry]);

  // Ahead of everything: a held take whose save has failed keeps the microphone
  // and any sound off under the modal with no control to reach them. (`recovery`
  // and `recovering` are computed above, so the popstate handler can see them.)
  useEffect(() => {
    if (recovering) leave();
  }, [recovering, leave]);

  if (recovery) {
    return (
      <main className="app-shell grid h-full place-items-center">
        <SaveFailed
          state={recovery.state}
          kind={recovery.kind}
          editOnly={recovery.editOnly}
          ordinal={recordingOrdinal}
          attempts={recovery.attempts}
          onRetry={retryPendingTake}
          onDiscard={discardPendingTake}
        />
      </main>
    );
  }

  return (
    <main className="app-shell mx-auto h-full max-w-md">
      {/* The recorder sheet is aria-modal, but the screen behind it stays
          mounted so close can reload() it. `inert` takes that whole background
          out of the focus and pointer tree while the sheet is open, so an
          AT/keyboard/switch user cannot reach the list's Back or a row's Record
          — both call leave() → cancel(), which silently drops the in-progress
          take with no recovery screen (G8). `display: contents` (the `contents`
          utility) keeps this wrapper layout-transparent; inertness still
          propagates to its flat-tree descendants. */}
      <div className="contents" inert={recorder !== null || undefined}>
        {chapterId === null ? (
          <BooksScreen
            ref={booksRef}
            onOpenChapter={openChapter}
            onOverlayOpen={pushHistoryEntry}
            onOverlayClose={consumeOverlayEntry}
          />
        ) : (
          <SegmentsScreen
            ref={segmentsRef}
            chapterId={chapterId}
            audio={audio}
            onBack={goBack}
            onOpenRecorder={openRecorder}
            onOverlayOpen={pushHistoryEntry}
            onOverlayClose={consumeOverlayEntry}
          />
        )}
      </div>

      {recorder && (
        // Keyed on the segment: opening the sheet on a different segment (via a
        // list Record that was reachable before `inert`, or any future path)
        // must REMOUNT, not reuse the prior segment's loaded `view.samples` —
        // splicing those into the new segment's save would write one segment's
        // audio into another (G8).
        <Recorder
          key={recorder.segmentId}
          ref={recorderRef}
          segmentId={recorder.segmentId}
          audio={audio}
          saveRecording={saveRecording}
          saveEditedSegment={saveEditedSegment}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          onExit={closeRecorder}
          onRequestBack={goBack}
        />
      )}
      <BuildStamp />
    </main>
  );
}
