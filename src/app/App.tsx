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
import { useNavStack } from "@/hooks/use-nav-stack";
import { useSaveTake } from "@/hooks/use-save-take";
import {
  holdsUnsavedAudio,
  panelWouldLoseAudio,
} from "@/lib/takes/pending-take";
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
  // WHICH segment the sheet is open on, and nothing else. It used to carry an
  // `ordinal` alongside, written on every open and read by nobody (#160, L-11)
  // — the recovery screen reads `recordingOrdinal` below, which is a different
  // lifetime and cannot be folded into this one: this slot is cleared the
  // moment the sheet closes, and the ordinal has to outlive exactly that.
  const [recorder, setRecorder] = useState<SegmentId | null>(null);

  const segmentsRef = useRef<SegmentsScreenHandle>(null);
  // System-Back handling (#168) lives in the `useNavStack` adapter below:
  // opening a chapter (→ Segments) and opening the recorder sheet each push one
  // history entry, while Books pushes NOTHING — it is the floor, and a Back
  // there is `exit-app`. So a standalone-PWA Back is a `popstate` the adapter
  // routes in-app instead of leaving the app — which on the recorder fired
  // `pagehide` → `leave()` and dropped the in-progress take (#58). App keeps
  // only the recorder handle the adapter's commit-close path reaches.
  const recorderRef = useRef<RecorderHandle>(null);
  // Which segment a held take belongs to, for the recovery screen — captured
  // when the recorder opened, so it survives the sheet closing on a failed
  // save. State, not a ref, because the recovery screen reads it during render.
  //
  // This is the app's ONE ordinal (#160, L-11): the `recorder` slot above no
  // longer mirrors it. The two looked like duplicates — same argument, same
  // call — but they are not interchangeable, and collapsing them the other way
  // round is a data loss: a failed save closes the sheet, `setRecorder(null)`
  // runs, and `SaveFailed` would then render "your recording is still here"
  // with no segment number on it. Nothing clears this slot; the next open
  // overwrites it.
  const [recordingOrdinal, setRecordingOrdinal] = useState<number | null>(null);
  // The cut/paste clipboard (B5), held here so it survives the recorder sheet
  // remounting per segment — G3: it reaches across a chapter and is lost on
  // close. Cleared on every chapter change so it never carries audio from one
  // chapter into another; lost on page close naturally (never persisted).
  //
  // Just the samples. A `pasted` flag rode alongside them for two rounds so the
  // upgrade guard could stop holding a phrase that was on disk elsewhere, and it
  // was wrong in the losing direction both times the unchanged tree moved
  // underneath it (Frank R5 P1, George R4 P2). The guard now holds on the
  // samples until the chapter change that clears them — see
  // `holdsUnsavedAudio` for why nothing derived can be right here.
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
  // to take the screen over. The wait is the whole reason the hook reports
  // rather than decides: a `blocked` arriving while a take is in hand is
  // remembered here, and shows the moment the take is let go, rather than being
  // dropped on the floor.
  //
  // A DIFFERENT question from the one the connection asks, and the difference is
  // the clipboard (George R4 P1). This waits only for work the panel itself
  // would destroy — the sheet it unmounts, the recovery screen that could still
  // save. A cut phrase is not that: the slot is state up here and outlives the
  // panel, while WITHHOLDING the panel is what loses it, because the Back that
  // Segments offers as its recovery for a failed load is untrapped without a
  // panel up and runs `backToBooks`, which clears the slot.
  const databasePanel =
    databaseStatus === "ok" ||
    panelWouldLoseAudio({ pendingTake, recorderOpen: recorder !== null })
      ? null
      : databaseStatus;

  // Whether a restart would take a cut phrase with it. Read by BOTH screens that
  // offer one, because either can be the screen a translator is looking at when
  // they tap: `SaveFailed` outranks the panel while a take is held, so the
  // panel's own warning cannot mount then, and the take's screen has to carry it
  // instead (George R5 P2).
  const holdsCutAudio = (clipboard?.length ?? 0) > 0;

  // This copy has given up its connection and cannot open another: `getDb()` is
  // latched and rejects before it opens, for the rest of the page's life.
  //
  // Told to the recorder because the panel that says so is WITHHELD while the
  // sheet is up — rightly, since mounting it unmounts the sheet and `leave()`
  // cancels a live capture. The consequence was that every failure path inside
  // the sheet reported a permanent condition as a retryable one, with the honest
  // screen unreachable behind it (#450, then George R6 P2). `failureExit` in
  // `lib/takes` turns this one bit into that decision, in one place.
  //
  // `blocked` is deliberately NOT folded in here: it ends when the other copy
  // closes, and the app is told so, so a retry under it is exactly right.
  const databaseUnreachable = databaseStatus === "reloadNeeded";

  // A held take whose save has failed takes over the screen with retry/discard
  // (the `SaveFailed` early return below). Computed here so the nav adapter can
  // see it: that screen is a modal, NOT a navigation level, so Back must not
  // route `to-books` under it (George R2 G2).
  const recovery = pendingTake && pendingTake.attempts > 0 ? pendingTake : null;
  const recovering = recovery !== null;

  // The state-half of each screen transition — everything the old handlers did
  // EXCEPT the `window.history` push/back, which the `useNavStack` adapter now
  // owns. The adapter wraps these with the protective push (`openChapter`,
  // `openRecorder`) or the history tail (`commitCloseRecorder`); `backToBooks`
  // takes no push because the browser has already popped when it runs.
  const openChapterState = useCallback(
    (id: ChapterId) => {
      leave();
      setClipboard(null); // chapter-scoped (G3)
      setRecorder(null);
      setChapterId(id);
    },
    [leave, setClipboard]
  );

  const backToBooks = useCallback(() => {
    leave();
    setClipboard(null); // chapter-scoped (G3)
    setRecorder(null);
    setChapterId(null);
  }, [leave, setClipboard]);

  const openRecorderState = useCallback(
    (segmentId: SegmentId, ordinal: number) => {
      // Amendment C's other half (#452 PR4, the decision recorded on #452 and
      // beside the cleanup effect in `use-nav-stack.ts`). The adapter clears
      // the WHOLE layer stack when `screen` changes, but this transition is not
      // an unmount — `SegmentsScreen` stays mounted and `inert` under the sheet
      // (the wrapper below) — so its overlay STATE has to be taken down to
      // match, or it would outlive the `Layer`s protecting it. First, before
      // the flip, so state and stack never disagree even for a task.
      segmentsRef.current?.dismissOverlays();
      // Opening the recorder stops any row that was playing — the same single
      // `leave()` every navigation makes.
      leave();
      // Resume the audio context in THIS tap (#184): the sheet loads and decodes
      // the segment one commit later, after this gesture's activation is spent,
      // so an iOS `"interrupted"` context would otherwise meet the first decode
      // un-resumed — the very trip the #155/#137 recovery panel exists to soften.
      // Priming it here spares the common transient case that failed open.
      primeAudioContext();
      setRecordingOrdinal(ordinal);
      setRecorder(segmentId);
    },
    [leave, primeAudioContext]
  );

  // ── The finished flag's one reconciliation point (#160, L-10) ────────────
  //
  // Recorded here because this `reload()` is the whole of it, and the next
  // person to make the recorder non-modal has to find this first.
  //
  //   THREE writer paths, all landing in `lib/storage/books.ts`:
  //     - a take commit — `writeTakeInTx` stamps the status atomically with the
  //       take, so `addTake`/`saveTake` set it on every recording;
  //     - `clearSegmentTake`, which returns an erased segment to "not-started";
  //     - `setSegmentFinished`, the explicit toggle.
  //
  //   THREE in-memory mirrors, none of which observes the others:
  //     - `SegmentRow.finished`        (hooks/use-chapter-segments.ts)
  //     - `RecorderSegmentView.finished` (hooks/use-recorder-segment.ts)
  //     - the sheet's `displayedFinished`, which is `finishedIntent` over
  //       `pendingDemote` over the view's flag (components/recorder.tsx)
  //
  // Nothing subscribes to the store. The mirrors are reconciled by exactly one
  // event: this `reload()`, when the sheet closes having changed something.
  //
  // It is correct today for one reason — the sheet is MODAL. While it is open
  // the screens behind it are `inert` (the wrapper below), so the list's mirror
  // cannot be focused or activated during the window in which it is stale --
  // it is still PAINTED, which is why this is a modality argument and not a
  // visibility one; and the
  // list's own toggle patches its row in place only after a landed write, so it
  // never diverges from the store on its own.
  //
  // The moment any of that stops holding — a non-modal sheet, a second surface
  // showing the flag, a background write — a `reload()` on close is no longer
  // enough and this wants a store-change subscription instead. That is the
  // replacement L-10 names; it is not worth building while the premise holds.
  const recorderClosedState = useCallback(
    (dirty: boolean) => {
      // The recorder has already stopped and committed any take before this
      // fires; `leave()` here only releases the floor and ends playback. Reload
      // only when something actually changed — a take committed or the finished
      // flag toggled — so a look-and-close does not pay for peak recomputation.
      leave();
      if (dirty) segmentsRef.current?.reload();
      setRecorder(null);
    },
    [leave]
  );

  const {
    pushLayer,
    popLayer,
    openChapter,
    openRecorder,
    goBack,
    commitCloseRecorder,
  } = useNavStack({
    hasChapter: chapterId !== null,
    recorderOpen: recorder !== null,
    recovering,
    databasePanel: databasePanel !== null,
    getRecorderHandle: () => recorderRef.current,
    onOpenChapter: openChapterState,
    onOpenRecorder: openRecorderState,
    onLeaveToBooks: backToBooks,
    onRecorderClosed: recorderClosedState,
  });

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
          holdsCutAudio={holdsCutAudio}
          attempts={recovery.attempts}
          onRetry={retryPendingTake}
          onDiscard={discardPendingTake}
        />
      </main>
    );
  }

  // Behind the held take, never in front of it: this says the database cannot
  // be reached, and a held recording is the one thing that outranks that. The
  // `SaveFailed` return above is what enforces that ordering; `databasePanel`'s
  // `pendingTake` arm is the second line of defence, not the only one.
  //
  // The clipboard CAN be full here, which is the change George R4 P1 asked for,
  // and it is why the panel is told: its restart is the one control on screen,
  // and reloading drops the slot. It arms the same way `SaveFailed`'s does.
  if (databasePanel) {
    return (
      <main className="app-shell grid h-full place-items-center">
        <DatabasePanel status={databasePanel} holdsCutAudio={holdsCutAudio} />
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
          /* Both screens' overlays register as system-Back layers (Books #452
             PR3, Segments PR4; #374), so a Back over a menu, a dialog or a
             confirm dismisses it instead of leaving the screen. The recorder
             sheet keeps its own, older mechanism for now
             (`overlayBlocksClose`/`overlayDismissal`), which PR5 touches. */
          <BooksScreen
            onOpenChapter={openChapter}
            pushLayer={pushLayer}
            popLayer={popLayer}
          />
        ) : (
          <SegmentsScreen
            ref={segmentsRef}
            chapterId={chapterId}
            audio={audio}
            onBack={goBack}
            onOpenRecorder={openRecorder}
            pushLayer={pushLayer}
            popLayer={popLayer}
          />
        )}
      </div>

      {recorder !== null && (
        // Keyed on the segment: opening the sheet on a different segment (via a
        // list Record that was reachable before `inert`, or any future path)
        // must REMOUNT, not reuse the prior segment's loaded `view.samples` —
        // splicing those into the new segment's save would write one segment's
        // audio into another (G8).
        <Recorder
          key={recorder}
          ref={recorderRef}
          segmentId={recorder}
          audio={audio}
          saveRecording={saveRecording}
          saveEditedSegment={saveEditedSegment}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          databaseUnreachable={databaseUnreachable}
          onExit={commitCloseRecorder}
          onRequestBack={goBack}
        />
      )}
      <BuildStamp />
    </main>
  );
}
