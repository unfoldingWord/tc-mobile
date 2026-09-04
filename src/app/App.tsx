import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen } from "@/components/books-screen";
import { BuildStamp } from "@/components/build-stamp";
import { DatabasePanel } from "@/components/database-panel";
import { Recorder } from "@/components/recorder";
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
  const { leave } = audio;

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

  // Whether giving up the database connection would strand work that exists
  // only in memory — asked by `lib/storage` from inside a `versionchange`
  // handler when another copy of this app wants to upgrade the database (#221).
  //
  // Deliberately coarse on the second half: an OPEN recorder counts, not a
  // running capture. The sheet is where a take is recorded, edited and
  // committed, and none of that is visible from here; refusing while it is open
  // costs the other copy a wait, and the tighter answer would cost a recording
  // the one time it was wrong.
  const holdsUnsavedWork = useCallback(
    () => pendingTake !== null || recorder !== null,
    [pendingTake, recorder]
  );
  const databaseStatus = useDatabaseStatus(holdsUnsavedWork);

  const openChapter = useCallback(
    (id: ChapterId) => {
      leave();
      setClipboard(null); // chapter-scoped (G3)
      setRecorder(null);
      setChapterId(id);
    },
    [leave]
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
      setRecordingOrdinal(ordinal);
      setRecorder({ segmentId, ordinal });
    },
    [leave]
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
    },
    [leave]
  );

  // Ahead of everything: a held take whose save has failed takes over the
  // screen with retry/discard, and nothing behind it may keep the microphone
  // or a sound alive under a modal with no control to reach them.
  const recovery = pendingTake && pendingTake.attempts > 0 ? pendingTake : null;
  const recovering = recovery !== null;

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

  // Behind the held take, never in front of it: this says the database cannot
  // be reached, and a held recording is the one thing that outranks that.
  // Reaching here means nothing is held — the guard above refuses to yield
  // while anything is, and the blocked state waits for the same answer.
  if (databaseStatus !== "ok") {
    return (
      <main className="app-shell grid h-full place-items-center">
        <DatabasePanel status={databaseStatus} />
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
            onBack={backToBooks}
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
          segmentId={recorder.segmentId}
          audio={audio}
          saveRecording={saveRecording}
          saveEditedSegment={saveEditedSegment}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          onExit={closeRecorder}
        />
      )}
      <BuildStamp />
    </main>
  );
}
