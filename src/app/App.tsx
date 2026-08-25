import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen } from "@/components/books-screen";
import { Recorder } from "@/components/recorder";
import { SaveFailed } from "@/components/save-failed";
import {
  SegmentsScreen,
  type SegmentsScreenHandle,
} from "@/components/segments-screen";
import { useAudioSession } from "@/hooks/use-audio-session";
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

  const audio = useAudioSession();
  const { leave } = audio;
  const { pendingTake, saveRecording, retryPendingTake, discardPendingTake } =
    // A landed save leaves the row reading as unrecorded until the screen
    // rebuilds, which is the window a second take is lost in — so reload then.
    useSaveTake({ onSaved: () => segmentsRef.current?.reload() });

  const openChapter = useCallback(
    (id: ChapterId) => {
      leave();
      setRecorder(null);
      setChapterId(id);
    },
    [leave]
  );

  const backToBooks = useCallback(() => {
    leave();
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
          onExit={closeRecorder}
        />
      )}
    </main>
  );
}
