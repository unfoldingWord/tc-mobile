import { useCallback, useEffect, useRef, useState } from "react";

import {
  playSamples,
  resumeAudioContext,
  type PlaybackHandle,
} from "./audio-io";
import { useRecorder, type RecorderState } from "./use-recorder";
import { createAudioSession, type SourceKind } from "@/lib/audio/session";
import { danglingReason, loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

export interface UseAudioSession {
  /** The segment whose take is sounding, or `null`. */
  readonly playingId: SegmentId | null;
  /**
   * Milliseconds into the sounding take, for the scrub dot / playhead. Zero
   * whenever nothing is playing.
   */
  readonly playbackElapsedMs: number;
  readonly recorderState: RecorderState;
  readonly elapsedMs: number;
  readonly supported: boolean;
  readonly error: string | null;
  /**
   * Play a segment's take, optionally from a scrub offset (seconds). Tapping
   * the segment that is already playing stops it.
   */
  playTake: (row: SegmentRow, offsetSeconds?: number) => void;
  startRecording: () => void;
  /** Pause the in-progress recording without ending the take. */
  pauseRecording: () => void;
  /** Resume a paused recording into the same take. */
  resumeRecording: () => void;
  /** Stop the microphone and return what it captured. Never rejects. */
  stopRecording: () => Promise<Int16Array | null>;
  /** End every sound this screen owns, synchronously. Call on every navigation. */
  leave: () => void;
}

/**
 * Everything on screen that can make or capture sound, under one owner.
 *
 * The arbitration lives in `lib/audio/session.ts`, which is pure; this is only
 * the wiring around it — the playback handle and the recorder, each reached
 * through `audio-io.ts`. Nothing above this layer holds an audio reference, so
 * "navigating away ends every sound" is a single `leave()` rather than a
 * checklist, and "only one row plays at a time" / "opening the recorder stops
 * playback" both fall out of the single floor for free.
 */
export function useAudioSession(): UseAudioSession {
  // Lazy `useState` rather than a ref: the arbiter must be created exactly once
  // and never during a render pass, and its identity is what every callback
  // below depends on. It is never set again, so it never re-renders.
  const [session] = useState(createAudioSession);

  const recorder = useRecorder();
  // `recorder` is a fresh object every render but its callbacks are stable, so
  // depending on the callbacks — not the object — keeps everything below from
  // churning its identity on every render.
  const {
    start: beginRecording,
    pause: pauseCapture,
    resume: resumeCapture,
    stop: endRecording,
    cancel: cancelRecording,
    state: recorderState,
    error: recorderError,
    elapsedMs,
    supported,
  } = recorder;

  const [playingId, setPlayingId] = useState<SegmentId | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState(0);

  // Mirrored in a ref because it is read from inside a tap handler to decide
  // whether the tap means "start" or "stop". A second tap can land before React
  // has re-rendered, and the render closure would answer for the previous frame
  // — which is the toggle half of issue #2.
  const playingIdRef = useRef<SegmentId | null>(null);
  /**
   * The live playback handle, held so the scrub-position timer can read its
   * `elapsed()` and so a stop can be immediate. Cleared whenever playback ends.
   */
  const playbackHandleRef = useRef<PlaybackHandle | null>(null);
  /**
   * The microphone's own claim, not merely the fact that a microphone holds the
   * floor. `session.live` is a *kind*: a newer recording is also "mic", so
   * matching on the kind lets a superseded stop release a floor it does not own.
   */
  const micTokenRef = useRef<number | null>(null);

  const setPlaying = useCallback((id: SegmentId | null) => {
    playingIdRef.current = id;
    setPlayingId(id);
    // The handle belongs to a single playing segment; when playback ends the
    // position resets so a resting scrub dot never reads a stale elapsed.
    if (id === null) {
      playbackHandleRef.current = null;
      setPlaybackElapsedMs(0);
    }
  }, []);

  /**
   * Take the floor and clear the outgoing source's UI state.
   *
   * The session stops the previous source directly, so that source will never
   * report an end of its own — whoever takes the floor is responsible for the
   * state the previous holder left behind.
   */
  const claimFloor = useCallback(
    (kind: SourceKind): number | null => {
      const token = session.claim(kind);
      if (token === null) return null;
      setPlaying(null);
      setPlaybackError(null);
      return token;
    },
    [session, setPlaying]
  );

  const playTake = useCallback(
    (row: SegmentRow, offsetSeconds = 0) => {
      if (playingIdRef.current === row.segmentId) {
        // Only our own floor is released: stopping playback must never stop a
        // recording that has taken the floor since.
        if (session.live === "take") session.stopAll();
        setPlaying(null);
        return;
      }

      const token = claimFloor("take");
      // Refused: the microphone holds the floor. Nothing renders a play control
      // while recording, so there is nothing to say — but if a future screen
      // does, this refusal needs a visible answer rather than silence.
      if (token === null) return;

      // Unlock Web Audio inside the tap, before the IndexedDB reads below: iOS
      // will not resume a suspended context once the activation is spent.
      void resumeAudioContext().catch((cause: unknown) => {
        console.error("Could not resume the audio context", cause);
      });

      // Optimistic, so the row responds to the tap rather than to the disk.
      setPlaying(row.segmentId);
      setPlaybackElapsedMs(offsetSeconds * 1000);

      void (async () => {
        try {
          const audio = await loadSegmentClip(row.segmentId);
          // Superseded while we read: whoever took the floor owns the UI state
          // now, so touching it here would undo their work.
          if (!session.isCurrent(token)) return;
          if (audio.kind !== "resolved") {
            // A segment nobody has recorded gives the floor back quietly. A
            // segment that points at audio the database does not have is a
            // different thing: the translator tapped play and heard nothing, so
            // it goes through the same channel as any other playback failure.
            const fault = danglingReason(audio);
            if (fault) {
              console.error("Nothing to play for this take:", fault);
              setPlaybackError("Could not play this recording.");
            }
            session.release(token);
            setPlaying(null);
            return;
          }

          const handle = await playSamples(audio.clip.samples, {
            offsetSeconds,
            onEnded: () => {
              if (!session.isCurrent(token)) return;
              session.release(token);
              setPlaying(null);
            },
          });
          // A `false` here means the handle was built for a claim that has since
          // been superseded; `settle` has already stopped it.
          if (session.settle(token, handle)) {
            playbackHandleRef.current = handle;
          }
        } catch (cause) {
          console.error("Playing a take failed", cause);
          // Inside the guard: a failure that belongs to a superseded claim is
          // not this screen's news. Tapping play on B while A is still loading
          // supersedes A, and A's rejection must not paint an alert over B.
          if (session.isCurrent(token)) {
            session.release(token);
            setPlaying(null);
            setPlaybackError("Could not play this recording.");
          }
        }
      })();
    },
    [claimFloor, session, setPlaying]
  );

  // Advance the scrub position while a take is sounding. The handle's own
  // `elapsed()` is the source of truth (it clamps to the clip duration), polled
  // rather than integrated so a pause or an end never leaves the dot drifting.
  useEffect(() => {
    if (playingId === null) return;
    const id = window.setInterval(() => {
      const handle = playbackHandleRef.current;
      if (handle) setPlaybackElapsedMs(handle.elapsed() * 1000);
    }, 60);
    return () => clearInterval(id);
  }, [playingId]);

  const startRecording = useCallback(() => {
    // A device that cannot record never takes the floor. `start()` only sets a
    // message there and leaves the recorder idle, so a claim would be one that
    // nothing ever hands back — and playback would be refused from then on.
    const token = supported ? claimFloor("mic") : null;
    if (supported) micTokenRef.current = token;
    // Nothing is awaited before `start()`: getUserMedia has to run in the same
    // task as the tap, or iOS treats the prompt as unprompted.
    void beginRecording()
      .then((started) => {
        if (started || token === null) return;
        // The floor is handed back HERE, on the completion path, rather than
        // left to the effect below. A denied permission takes the recorder
        // idle -> requesting -> idle, and nothing guarantees a consumer ever
        // observes the middle state; an imperative claim is released on a
        // completion, not on a render.
        if (micTokenRef.current === token) micTokenRef.current = null;
        if (session.isCurrent(token)) session.stopAll();
      })
      .catch((cause: unknown) => {
        console.error("Starting the recorder failed", cause);
      });
  }, [beginRecording, claimFloor, session, supported]);

  // Pause/resume keep the same take and the same floor: the microphone still
  // owns the floor while paused, so there is no claim to release or reclaim
  // here — only the capture is suspended.
  const pauseRecording = useCallback(() => pauseCapture(), [pauseCapture]);
  const resumeRecording = useCallback(() => resumeCapture(), [resumeCapture]);

  const stopRecording = useCallback(async (): Promise<Int16Array | null> => {
    // Snapshot BEFORE the await. `startRecording` writes every new claim into
    // the same ref, so reading it afterwards would hand us a *newer*
    // recording's token — releasing that is precisely the bug this token exists
    // to prevent, one level up.
    const token = micTokenRef.current;
    try {
      return await endRecording();
    } catch (cause) {
      console.error("Stopping the recorder failed", cause);
      setPlaybackError("Could not finish this recording.");
      return null;
    } finally {
      // The microphone gives the floor back whether or not it produced audio —
      // but only its own. `endRecording` awaits, so by the time this runs the
      // floor may have moved on to a *newer* recording, which is also "mic":
      // the token identifies the claim.
      if (token !== null && session.isCurrent(token)) {
        if (micTokenRef.current === token) micTokenRef.current = null;
        session.stopAll();
      }
    }
  }, [endRecording, session]);

  const leave = useCallback(() => {
    // Synchronous and total. Navigation is not a moment to be waiting on a
    // promise: the microphone has to be released in the same task as the tap.
    //
    // A take in progress is abandoned, not saved. `addTake` makes every new
    // take the active one, so committing a fragment here would quietly replace
    // a good recording with a truncated one. Losing an unconfirmed take is
    // recoverable by recording again; that is not.
    micTokenRef.current = null;
    session.stopAll();
    cancelRecording();
    setPlaying(null);
    setPlaybackError(null);
  }, [cancelRecording, session, setPlaying]);

  useEffect(() => {
    // Backstop only. `startRecording` releases a refused claim on the completion
    // path; this still covers a recorder that reaches idle by some route that
    // never resolved a `start()` at all. Paused is not idle, so it does not
    // trip this.
    if (recorderState === "idle" && session.live === "mic") session.stopAll();
  }, [recorderState, session]);

  useEffect(() => {
    // The page may be discarded without ever unmounting. A hot microphone on a
    // page that is going away is not arguable.
    const onPageHide = () => leave();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [leave]);

  useEffect(() => () => leave(), [leave]);

  return {
    playingId,
    playbackElapsedMs,
    recorderState,
    elapsedMs,
    supported,
    // One surface, newest cause first: a recorder failure is what the
    // translator just did, so it outranks a stale playback message.
    error: recorderError ?? playbackError,
    playTake,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    leave,
  };
}
