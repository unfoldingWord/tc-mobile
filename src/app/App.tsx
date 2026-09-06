import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen } from "@/components/books-screen";
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
import { backEffectFor, screenFor } from "@/lib/nav/navigation";
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
  // A popstate is driving the current close/back, so the transition effect that
  // keeps history in sync must NOT pop again — the browser already did.
  const popInFlight = useRef(false);
  // Ignore exactly one popstate: the one our own `history.back()` fires when a
  // programmatic close (an on-screen Back or an erase) consumes its entry.
  const suppressPop = useRef(false);
  const prevRecorder = useRef(recorder);
  const prevChapterId = useRef(chapterId);

  const pushHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume. The
    // value is unused — routing reads live React state, not the entry.
    window.history.pushState({ tc: true }, "");
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
      pushHistoryEntry(); // Books → Segments: a Back now returns here (#168)
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
      pushHistoryEntry(); // Segments → Recorder: Back becomes the commit (#168)
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
    },
    [leave]
  );

  // Route the system Back gesture (#168). Every screen pushed one history entry,
  // so Back arrives as a `popstate` here instead of exiting the app. The
  // decision is the pure `backEffectFor`, so the one rule that matters — Back on
  // the recorder runs the COMMIT path, never a take-dropping unmount (#58) — is
  // unit-tested.
  useEffect(() => {
    const onPopState = () => {
      // Our own `history.back()` from a programmatic close fired this; the entry
      // is already accounted for, so there is nothing to route.
      if (suppressPop.current) {
        suppressPop.current = false;
        return;
      }
      const screen = screenFor(chapterId !== null, recorder !== null);
      switch (backEffectFor(screen)) {
        case "commit-close-recorder": {
          const handle = recorderRef.current;
          if (!handle) return;
          // The browser already popped the recorder's entry. Run the same commit
          // the on-screen Back runs; if it DECLINES (a save failed, the sheet
          // stays open with an in-place error), re-arm the trap so the next Back
          // retries rather than escaping to Segments over an unsaved take.
          popInFlight.current = true;
          void handle.requestClose().then((exited) => {
            if (!exited) {
              popInFlight.current = false;
              pushHistoryEntry();
            }
            // On exit the transition effect below clears `popInFlight`; leaving
            // it set tells that effect the browser — not it — consumed the entry.
          });
          break;
        }
        case "to-books":
          popInFlight.current = true;
          backToBooks();
          break;
        case "exit-app":
          // The Books shelf pushed no entry, so this popstate is the browser
          // already leaving. Nothing to do — and nothing is lost at the shelf.
          break;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [chapterId, recorder, backToBooks, pushHistoryEntry]);

  // Keep history in step with a recorder close the browser did NOT drive — an
  // on-screen Back or an erase. The sheet went away without a popstate, so its
  // entry is still on the stack: consume it, suppressing the popstate that
  // `back()` fires. A popstate-driven close already popped it (flagged by
  // `popInFlight`), so there it only clears the flag.
  useEffect(() => {
    const closed = prevRecorder.current !== null && recorder === null;
    prevRecorder.current = recorder;
    if (!closed) return;
    if (popInFlight.current) {
      popInFlight.current = false;
      return;
    }
    suppressPop.current = true;
    window.history.back();
  }, [recorder]);

  // The same one level up: a programmatic return from Segments to the Books
  // shelf (the list's Back). A popstate-driven return already popped the entry.
  useEffect(() => {
    const closed = prevChapterId.current !== null && chapterId === null;
    prevChapterId.current = chapterId;
    if (!closed) return;
    if (popInFlight.current) {
      popInFlight.current = false;
      return;
    }
    suppressPop.current = true;
    window.history.back();
  }, [chapterId]);

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
          ref={recorderRef}
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
