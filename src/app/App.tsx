import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen } from "@/components/books-screen";
import { BuildStamp } from "@/components/build-stamp";
import { DatabasePanel } from "@/components/database-panel";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { SaveFailed } from "@/components/save-failed";
import {
  SegmentsScreen,
  type SegmentsScreenHandle,
} from "@/components/segments-screen";
import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { warmEncoder } from "@/hooks/mp3-codec";
import { useAudioSession } from "@/hooks/use-audio-session";
import { useDatabaseStatus } from "@/hooks/use-database-status";
import { useSaveTake } from "@/hooks/use-save-take";
import { navDirection, popAction, screenFor } from "@/lib/nav/navigation";
import { holdsUnsavedAudio } from "@/lib/takes/pending-take";
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

  const pushHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume, carrying
    // the monotonic index that tells Back from Forward. Routing reads live React
    // state for the screen, so the entry needs nothing more than its index.
    const index = ++nextIndex.current;
    window.history.pushState({ tc: true, index }, "");
    navIndex.current = index;
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
    //
    // This call is also the app's one SNAPSHOT window (#192, George R5 P3-1):
    // the same `warmEncoder` fetches that chunk and keeps a blob copy of it, so
    // every later rebuild — after an abort, a stall or a crash, possibly hours
    // after `cleanupOutdatedCaches` has deleted the hashed file — has bytes to
    // build from. Launch is the only moment that fetch is certain to succeed,
    // which is why it lives here and not at the first encode.
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

  // Whether giving up the database connection would strand work that exists
  // only in memory — asked by `lib/storage` from inside a `versionchange`
  // handler when another copy of this app wants to upgrade the database (#221).
  //
  // The rule itself lives in `lib/takes/pending-take.ts`, where it can be
  // tested: which of these arms count, and which kinds of unsaved work are
  // deliberately excluded, is stated and unit-tested there rather than inline in
  // a component this repo has no renderer to exercise. The CLIPBOARD arm is one
  // George found missing (R2 P2-2) — cut audio whose hole is already committed
  // is the only copy of that phrase.
  const holdsUnsavedWork = useCallback(
    () =>
      holdsUnsavedAudio({
        pendingTake,
        recorderOpen: recorder !== null,
        clipboard,
      }),
    [pendingTake, recorder, clipboard]
  );
  const databaseStatus = useDatabaseStatus(holdsUnsavedWork);

  // The condition above is reported as it happens; this is where it is allowed
  // to take the screen over. It waits until nothing is held, because the panel
  // unmounts everything under it — including the sheet holding a recording and
  // the recovery screen that could still save one. The wait is the whole reason
  // the hook reports rather than decides: a `blocked` arriving while a take is
  // in hand is remembered here, and shows the moment the take is let go, rather
  // than being dropped on the floor.
  const databasePanel =
    databaseStatus === "ok" || holdsUnsavedWork() ? null : databaseStatus;

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
        return;
      }
      const direction = navDirection(navIndex.current, toIndex);
      navIndex.current = toIndex;
      const screen = screenFor(chapterId !== null, recorder !== null);
      switch (popAction(direction, screen, committing.current, recovering)) {
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

  // The database panel below takes the screen over the same way, and for the
  // same reason needs the same call: the Segments list can be playing a segment
  // back when the panel replaces it, and `useAudioSession` lives up here, so the
  // sound would carry on under a screen with no stop on it. Keyed on the PANEL
  // and not on the status — `leave()` cancels an in-progress take, and the
  // status goes to `blocked` while one may still be held.
  useEffect(() => {
    if (databasePanel) leave();
  }, [databasePanel, leave]);

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

  // Behind the held take, never in front of it: this says the database cannot
  // be reached, and a held recording is the one thing that outranks that.
  // `databasePanel` is null while anything is held, so reaching here means the
  // screen is free to be taken over.
  if (databasePanel) {
    return (
      <main className="app-shell grid h-full place-items-center">
        <DatabasePanel status={databasePanel} />
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
          <BooksScreen onOpenChapter={openChapter} />
        ) : (
          <SegmentsScreen
            ref={segmentsRef}
            chapterId={chapterId}
            audio={audio}
            onBack={goBack}
            onOpenRecorder={openRecorder}
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
