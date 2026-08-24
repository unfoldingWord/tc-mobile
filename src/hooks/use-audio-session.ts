import { useCallback, useEffect, useRef, useState } from "react";

import {
  playSamples,
  resetNarration,
  resumeAudioContext,
  startNarration,
  stopNarration,
} from "./audio-io";
import { useRecorder, type RecorderState } from "./use-recorder";
import { createAudioSession, type SourceKind } from "@/lib/audio/session";
import { danglingReason, loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SectionCard } from "@/types/view";

export interface UseAudioSession {
  /** The section whose take is sounding, or `null`. */
  readonly playingId: string | null;
  readonly referencePlaying: boolean;
  readonly recorderState: RecorderState;
  readonly elapsedMs: number;
  readonly supported: boolean;
  readonly error: string | null;
  playTake: (section: SectionCard) => void;
  toggleReference: (url: string | null) => void;
  startRecording: () => void;
  /** Stop the microphone and return what it captured. Never rejects. */
  stopRecording: () => Promise<Int16Array | null>;
  /**
   * End every sound this screen owns, synchronously. Call on every navigation.
   *
   * `rewindNarration` returns the reference audio to the start. Pass it when
   * leaving the *story*; stepping between sections of the same chapter must
   * not, or a two-minute narration restarts from the top on every step.
   */
  leave: (options?: { rewindNarration?: boolean }) => void;
}

/**
 * Everything on this screen that can make or capture sound, under one owner.
 *
 * The arbitration lives in `lib/audio/session.ts`, which is pure; this is only
 * the wiring around it — the playback handle, the narration, and the recorder,
 * each reached through `audio-io.ts`. Nothing above this layer holds an audio
 * reference any more, which is what makes "navigating away ends every sound"
 * a single call rather than a checklist.
 */
export function useAudioSession(): UseAudioSession {
  // Lazy `useState` rather than a ref: the arbiter must be created exactly
  // once and never during a render pass, and its identity is what every
  // callback below depends on. It is never set again, so it never re-renders.
  const [session] = useState(createAudioSession);

  const recorder = useRecorder();
  // `recorder` is a fresh object every render but its callbacks are stable, so
  // depending on the callbacks — not the object — keeps everything below from
  // churning its identity on every render.
  const {
    start: beginRecording,
    stop: endRecording,
    cancel: cancelRecording,
    state: recorderState,
    error: recorderError,
    elapsedMs,
    supported,
  } = recorder;

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [referencePlaying, setReferencePlayingState] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Mirrored in refs because both are read from inside a tap handler to decide
  // whether the tap means "start" or "stop". A second tap can land before
  // React has re-rendered, and the render closure would answer for the
  // previous frame — which is the toggle half of issue #2.
  const playingIdRef = useRef<string | null>(null);
  const referencePlayingRef = useRef(false);
  /**
   * The microphone's own claim, not merely the fact that a microphone holds
   * the floor. `session.live` is a *kind*: a newer recording is also "mic", so
   * matching on the kind lets a superseded stop release a floor it does not
   * own — and the newer recording keeps capturing while `session.live` is null.
   */
  const micTokenRef = useRef<number | null>(null);

  const setPlaying = useCallback((id: string | null) => {
    playingIdRef.current = id;
    setPlayingId(id);
  }, []);

  const setReference = useCallback((on: boolean) => {
    referencePlayingRef.current = on;
    setReferencePlayingState(on);
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
      setReference(false);
      setPlaybackError(null);
      return token;
    },
    [session, setPlaying, setReference]
  );

  const playTake = useCallback(
    (section: SectionCard) => {
      if (playingIdRef.current === section.sectionId) {
        // Only our own floor is released: stopping playback must never stop a
        // recording that has taken the floor since.
        if (session.live === "take") session.stopAll();
        setPlaying(null);
        return;
      }

      const token = claimFloor("take");
      // Refused: the microphone holds the floor. Nothing renders a play
      // control while recording, so there is nothing to say — but if a future
      // screen does, this refusal needs a visible answer rather than silence.
      if (token === null) return;

      // Unlock Web Audio inside the tap, before the IndexedDB reads below:
      // iOS will not resume a suspended context once the activation is spent.
      void resumeAudioContext().catch((cause: unknown) => {
        console.error("Could not resume the audio context", cause);
      });

      // Optimistic, so the row responds to the tap rather than to the disk.
      setPlaying(section.sectionId);

      void (async () => {
        try {
          const audio = await loadSegmentClip(section.segmentId);
          // Superseded while we read: whoever took the floor owns the UI state
          // now, so touching it here would undo their work.
          if (!session.isCurrent(token)) return;
          if (audio.kind !== "resolved") {
            // A segment nobody has recorded gives the floor back quietly —
            // that is the ordinary case, and no control offers play on it.
            // A segment that points at audio the database does not have is a
            // different thing: the translator tapped play and heard nothing,
            // so it goes through the same channel as any other playback
            // failure rather than only to the console. Silence is what let
            // three copies of this walk disagree about it in the first place.
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
            onEnded: () => {
              if (!session.isCurrent(token)) return;
              session.release(token);
              setPlaying(null);
            },
          });
          // A `false` here means the handle was built for a claim that has
          // since been superseded; `settle` has already stopped it.
          session.settle(token, handle);
        } catch (cause) {
          console.error("Playing a take failed", cause);
          // Inside the guard: a failure that belongs to a superseded claim is
          // not this screen's news. Tapping play on B while A is still loading
          // supersedes A, and A's rejection must not paint an alert over B —
          // still less over whatever screen a `leave()` has moved on to.
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

  const stopReference = useCallback(() => {
    if (session.live === "reference") session.stopAll();
    setReference(false);
  }, [session, setReference]);

  const toggleReference = useCallback(
    (url: string | null) => {
      if (!url) return;
      if (referencePlayingRef.current) {
        stopReference();
        return;
      }

      const token = claimFloor("reference");
      if (token === null) return;

      const narration = startNarration(url, {
        onEnded: () => {
          if (!session.isCurrent(token)) return;
          session.release(token);
          setReference(false);
        },
      });
      // Settled before `started` is awaited, so a second tap during a slow
      // load has something to stop. The arbiter silences the narration without
      // knowing it is a media element rather than a buffer source.
      session.settle(token, narration);

      setReference(true);
      void narration.started.catch((cause: unknown) => {
        console.error("Playing the reference narration failed", cause);
        // Inside the guard, and here it is not merely tidiness: stopping a
        // pending `play()` rejects it, so the common way to reach this catch
        // is the user tapping pause on a narration that had not loaded yet.
        // Outside the guard that tap raises a red alert about a failure that
        // did not happen.
        if (session.isCurrent(token)) {
          session.release(token);
          setReference(false);
          setPlaybackError("Could not play the story narration.");
        }
      });
    },
    [claimFloor, session, setReference, stopReference]
  );

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
        // observes the middle state; an effect keyed on a value that never
        // appears to change does not re-run, and the floor stays claimed with
        // no microphone open — refusing every later playback for the session.
        // An imperative claim is released on a completion, not on a render.
        if (micTokenRef.current === token) micTokenRef.current = null;
        if (session.isCurrent(token)) session.stopAll();
      })
      .catch((cause: unknown) => {
        console.error("Starting the recorder failed", cause);
      });
  }, [beginRecording, claimFloor, session, supported]);

  const stopRecording = useCallback(async (): Promise<Int16Array | null> => {
    // Snapshot BEFORE the await. `startRecording` writes every new claim into
    // the same ref, so reading it afterwards would hand us a *newer*
    // recording's token — and releasing that is precisely the bug this token
    // exists to prevent, one level up.
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
      // matching on the kind would release that one's claim and leave it
      // capturing with `session.live` null. The token identifies the claim.
      if (token !== null && session.isCurrent(token)) {
        // Clear only if the ref still names OUR claim: a newer recording that
        // has already written its own token must keep it.
        if (micTokenRef.current === token) micTokenRef.current = null;
        session.stopAll();
      }
    }
  }, [endRecording, session]);

  const leave = useCallback(
    (options: { rewindNarration?: boolean } = {}) => {
      // Synchronous and total. Navigation is not a moment to be waiting on a
      // promise: the microphone has to be released in the same task as the tap.
      //
      // A take in progress is abandoned, not saved. `addTake` makes every new
      // take the active one, so committing a fragment here would quietly
      // replace a good recording with a truncated one — and a fragment renders
      // a duration and a play button, so it *looks* finished. Losing an
      // unconfirmed take is recoverable by recording again; that is not.
      micTokenRef.current = null;
      session.stopAll();
      cancelRecording();
      // The narration is a chapter's, not a section's. Leaving the story
      // rewinds, so the next story's reference starts at the beginning rather
      // than mid-sentence; stepping between sections of this chapter only
      // silences it, because zeroing the playhead there restarts a two-minute
      // story on every step — the opposite of treating it as the chapter's.
      if (options.rewindNarration) resetNarration();
      else stopNarration();
      setPlaying(null);
      setReference(false);
      setPlaybackError(null);
    },
    [cancelRecording, session, setPlaying, setReference]
  );

  useEffect(() => {
    // Backstop only. `startRecording` releases a refused claim on the
    // completion path, which does not depend on this effect observing an
    // intermediate state; this still covers a recorder that reaches idle by
    // some route that never resolved a `start()` at all.
    if (recorderState === "idle" && session.live === "mic") session.stopAll();
  }, [recorderState, session]);

  useEffect(() => {
    // The page may be discarded without ever unmounting. Whatever else is
    // arguable about backgrounding, a hot microphone on a page that is going
    // away is not.
    const onPageHide = () => leave();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [leave]);

  useEffect(() => () => leave(), [leave]);

  return {
    playingId,
    referencePlaying,
    recorderState,
    elapsedMs,
    supported,
    // One surface, newest cause first: a recorder failure is what the
    // translator just did, so it outranks a stale playback message.
    error: recorderError ?? playbackError,
    playTake,
    toggleReference,
    startRecording,
    stopRecording,
    leave,
  };
}
