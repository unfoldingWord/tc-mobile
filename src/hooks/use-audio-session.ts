import { useCallback, useEffect, useRef, useState } from "react";

import {
  decodeMp3ToCanonical,
  playSamples,
  resumeAudioContext,
  type PlaybackHandle,
} from "./audio-io";
import type { ProbeSource } from "./audio-probe";
import { reportFailure } from "./report-failure";
import {
  useRecorder,
  type RecorderState,
  type RetryDecodeResult,
  type StopResult,
} from "./use-recorder";
import type { CaptureScope } from "@/lib/audio/capture-peaks";
import { fitMp3Decode } from "@/lib/audio/mp3-align";
import {
  playbackPosition,
  type PlaybackPosition,
} from "@/lib/audio/playback-position";
import { createAudioSession, type SourceKind } from "@/lib/audio/session";
import { danglingReason, loadSegmentClip } from "@/lib/storage/segment-audio";
import { strings } from "@/lib/strings";
import type { SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

export interface UseAudioSession {
  /** The segment whose take is sounding, or `null`. */
  readonly playingId: SegmentId | null;
  /**
   * Whether the in-memory recorder buffer is sounding. Distinct from
   * `playingId`, which names a Segments row loaded from IndexedDB: this is the
   * recorder's edited working buffer, played straight from memory with no disk
   * load. The two share the floor, so only one is ever true at a time.
   */
  readonly playingBuffer: boolean;
  /**
   * Milliseconds into the sounding take, for the Segments-row scrub dot. PUSHED
   * on a ~60 ms interval that runs ONLY while a list take plays (`playingId !==
   * null`), because the moving dot earns the re-render. It does NOT advance for
   * recorder buffer playback — that reads `readPlaybackPosition` on its own rAF
   * (#102) — so read it only on the `playingId` path; it stays at its last reset
   * (0) throughout a buffer preview.
   */
  readonly playbackElapsedMs: number;
  /**
   * The list take that last stopped RAN OUT, rather than being stopped by hand
   * or superseded. Reported in the same commit as `playingId` going null, so a
   * row reads the two together.
   *
   * Only `playSamples`' `onEnded` knows this — it never fires on a hand stop
   * (`audio-io.ts` sets `stopped` before `source.stop()`) — and it cannot be
   * reconstructed from the elapsed a row last saw: the ~60 ms push above lands
   * a tick short of the duration, so "at the end" is a guess and this is not.
   * The Segments row rests its scrub dot at the start on a run-out and where it
   * reached on a hand stop, which is the difference between a segment that can
   * be played twice and one that cannot (#601).
   */
  readonly playbackRanOut: boolean;
  readonly recorderState: RecorderState;
  readonly elapsedMs: number;
  readonly supported: boolean;
  /** One surface for the sheet's Notice — a recorder failure, else a playback one. */
  readonly error: string | null;
  /**
   * The RECORDER's own error, without the playback message `error` folds in. A
   * caller deciding "the mic failed, show the permission panel" must key on this,
   * not `error`: a failed `playBuffer`/`playTake` sets a playback message that is
   * not a mic miss and must not raise the mic panel or its Retry.
   */
  readonly recorderError: string | null;
  /**
   * Play a segment's take, optionally from a scrub offset (seconds). Tapping
   * the segment that is already playing stops it.
   */
  playTake: (row: SegmentRow, offsetSeconds?: number) => void;
  /**
   * Play a raw in-memory PCM buffer — the recorder's edited working buffer —
   * optionally from a scrub offset (seconds), with no IndexedDB load. Tapping
   * while it is already sounding stops it.
   *
   * A buffer only ever sounds at idle now (#614): the tap that ends a recording
   * commits it, so there is no open-but-not-capturing microphone for a playback
   * to borrow the floor from. `claim("take")` under a LIVE mic is refused, which
   * is the property `session.ts` exists to keep.
   *
   * `onEnded` fires when the clip RAN OUT, and only then: not on a hand-stop
   * (`stopBuffer`, or a Play that stops what is sounding), not for a superseded
   * claim, and not when playback failed to start. It is the one fact about an
   * ending that cannot be reconstructed from outside — the position goes with
   * the handle, and a clip shorter than a frame can end before any rAF observes
   * it — and the recorder's frozen pan (#416) turns on it.
   */
  playBuffer: (
    samples: Int16Array,
    offsetSeconds?: number,
    opts?: { onEnded?: () => void }
  ) => void;
  /** Stop buffer playback if it is the one sounding. A no-op otherwise. */
  stopBuffer: () => void;
  /**
   * The sounding position, PULLED (D-LEVEL-PULL, like `readLevel`). The
   * recorder polls this on its own rAF so buffer playback never lifts into App
   * state — `playbackElapsedMs` is pushed only for the Segments-row scrub dot
   * (a `playingId` take), whose moving dot earns the re-render; the recorder's
   * inert-list neighbour did not (#102).
   *
   * `null` means nothing is sounding — a HIDE sentinel distinct from position
   * 0, so the overlay hides instead of snapping to the left edge for a frame
   * when playback ends or is stopped (the handle is cleared a React commit
   * before `playingBuffer` does).
   */
  readPlaybackPosition: () => PlaybackPosition | null;
  startRecording: () => void;
  /**
   * Stop the microphone and return what it captured, or the reason it captured
   * nothing (`StopResult`). Never rejects.
   */
  stopRecording: () => Promise<StopResult>;
  /**
   * Re-decode a held take's container bytes after a decode failed on Stop
   * (#165). Resumes the context first; call it synchronously in a tap. See
   * `UseRecorder.retryDecode`. Passed straight through — it touches neither the
   * floor nor the session, only the shared decode context.
   */
  retryDecode: (blob: Blob) => Promise<RetryDecodeResult>;
  /** End every sound this screen owns, synchronously. Call on every navigation. */
  leave: () => void;
  /**
   * Resume the shared audio context inside the gesture that opens the recorder
   * sheet (#184), before the async segment load one commit later. Fire-and-
   * forget, like the retry and playback resume paths; call it synchronously in
   * the open tap so an iOS `"interrupted"` context is running by the time the
   * first `decodeAudioData` runs, sparing the common transient case a failed
   * open and an extra "Try again" tap. A no-op when the context is already
   * running.
   */
  primeAudioContext: () => void;
  /**
   * The live capture level for the VU meter, in the raw amplitude domain. A PULL
   * read (D-LEVEL-PULL): the meter polls it on its own frame clock, so nothing
   * above this layer re-renders per frame. 0 whenever nothing is capturing.
   */
  readLevel: () => number;
  /**
   * Whether `readLevel` can be trusted this frame (#76). A PULL like `readLevel`:
   * `true` when NOT in a live take (the meter rests empty via `active`, so "not
   * recording" reads as "not broken"); `false` ONLY while recording and either
   * the tap is missing or the shared context is not `"running"` (iOS
   * `"suspended"`/`"interrupted"` after backgrounding or an interruption), where
   * the analyser reads zeros a translator would misread as a dead mic. The VU
   * meter hatches "unavailable" on a false. Distinct from `meterFailed`, the
   * OPEN-time "tap never wired" state.
   */
  readMeterAvailable: () => boolean;
  /**
   * The live-waveform scope for the current take (#120), or `null` when nothing
   * is capturing OR the tap could not be wired (a `meterFailed` take records but
   * produces no scope — the sheet keeps the static waveform up in that case). A
   * PULL like `readLevel`: the scope drawer polls it on its own frame clock, so
   * nothing above this layer re-renders per frame.
   */
  readScope: () => CaptureScope | null;
  /**
   * The capture ring as it stands, WITHOUT advancing it — for a paint that is
   * not the animation tick (a drawer's activation/remount edge). See
   * `use-recorder`'s implementation for why the two must not be interchanged.
   */
  peekScope: () => CaptureScope | null;
  /** The VU tap could not be wired for the current take; the meter shows
   *  unavailable rather than a resting-empty strip. Recording is unaffected. */
  meterFailed: boolean;
}

/**
 * The two narrow views of {@link UseAudioSession} the screens actually take
 * (#160, L-18).
 *
 * One object was drilled to both screens, which use different subsets — not
 * disjoint ones: `error`, `playingBuffer` and `stopBuffer` are on both, and
 * `primeAudioContext` is on neither. So the
 * list screen's prop type admitted `startRecording` and `stopRecording` — the
 * microphone — to a screen whose only job with audio is to play a row back.
 * Nothing called them, and the type is what stops the next change from being
 * able to: a list that can start the microphone has no sheet up to stop it,
 * and the floor arbiter would be holding "mic" with nothing on screen able to
 * release it.
 *
 * `Pick` rather than two hand-written interfaces, deliberately: the member
 * lists here are an allow-list over one declaration, so a view cannot drift
 * from the session's own types, and every member keeps the docblock it has
 * above rather than acquiring a second, staler copy.
 *
 * `primeAudioContext` is on neither: App calls it itself, in the tap that
 * opens the recorder.
 *
 * No membership COUNTS here, and that is not an omission. An earlier draft
 * named three (26 members, 21 and 7) and every one of them is now wrong:
 * #614's retirement of the paused preview took `audioNeedsGesture`,
 * `pauseRecording`, `previewCapture` and `resumeRecording` off the interface
 * and #601 added `playbackRanOut`, so the two views drifted out of step with
 * it and only `tsc` noticed. `tests/audio-views.test.ts` asserts the two
 * properties that actually matter instead — the microphone is on exactly one
 * view, and `primeAudioContext` is the only member on neither — where a
 * number cannot go stale unread.
 */
export type SegmentsAudio = Pick<
  UseAudioSession,
  | "error"
  | "leave"
  | "playTake"
  | "playbackElapsedMs"
  | "playbackRanOut"
  | "playingBuffer"
  | "playingId"
  | "stopBuffer"
>;

export type RecorderAudio = Pick<
  UseAudioSession,
  | "elapsedMs"
  | "error"
  | "meterFailed"
  | "peekScope"
  | "playBuffer"
  | "playingBuffer"
  | "readLevel"
  | "readMeterAvailable"
  | "readPlaybackPosition"
  | "readScope"
  | "recorderError"
  | "recorderState"
  | "retryDecode"
  | "startRecording"
  | "stopBuffer"
  | "stopRecording"
  | "supported"
>;

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
    stop: endRecording,
    retryDecode,
    cancel: cancelRecording,
    state: recorderState,
    error: recorderError,
    elapsedMs,
    supported,
    readLevel,
    readMeterAvailable,
    readScope,
    peekScope,
    meterFailed,
  } = recorder;

  const [playingId, setPlayingId] = useState<SegmentId | null>(null);
  const [playingBuffer, setPlayingBufferState] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState(0);
  const [playbackRanOut, setPlaybackRanOut] = useState(false);

  // Mirrored in a ref because it is read from inside a tap handler to decide
  // whether the tap means "start" or "stop". A second tap can land before React
  // has re-rendered, and the render closure would answer for the previous frame
  // — which is the toggle half of issue #2.
  const playingIdRef = useRef<SegmentId | null>(null);
  // The buffer's equivalent, read from inside the tap for the same start-vs-stop
  // decision. `playingId` and this share the floor, so at most one is ever set.
  const playingBufferRef = useRef(false);
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

  // `ranOut` travels with the id so the two land in one commit: a row reads the
  // reason on the same render that tells it playback stopped. Every other call
  // site takes the default — a start, a hand stop, a superseded claim and a
  // teardown are all "not a run-out" — so only `onEnded` ever passes true.
  const setPlaying = useCallback((id: SegmentId | null, ranOut = false) => {
    playingIdRef.current = id;
    setPlayingId(id);
    setPlaybackRanOut(ranOut);
    // The handle belongs to a single playing segment; when playback ends the
    // position resets so a resting scrub dot never reads a stale elapsed.
    if (id === null) {
      playbackHandleRef.current = null;
      setPlaybackElapsedMs(0);
    }
  }, []);

  // The buffer's parallel setter, with the same handle/position cleanup as
  // `setPlaying(null)` — the two playback paths share `playbackHandleRef` and
  // the scrub position, so whichever one ends must leave both clean.
  const setPlayingBuffer = useCallback((sounding: boolean) => {
    playingBufferRef.current = sounding;
    setPlayingBufferState(sounding);
    if (!sounding) {
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
      // The floor is shared, so taking it also invalidates a buffer that was
      // sounding — including the floor-steal case where a new recording claims
      // "mic". The arbiter stops the source; this resets the React flag it left
      // behind, exactly as `setPlaying(null)` does for a segment take.
      setPlayingBuffer(false);
      setPlaybackError(null);
      return token;
    },
    [session, setPlaying, setPlayingBuffer]
  );

  /**
   * The tail both playback paths share (#160, L-15): hand the samples to the
   * graph, keep the handle only if this claim still owns the floor, and let the
   * clip's own end reach the caller only while it does.
   *
   * `playTake` and `playBuffer` were ~80 % the same, and this is the part that
   * was identical rather than merely similar. What stays with each caller is
   * everything they genuinely disagree about: what a second tap means (stop the
   * segment vs `stopBuffer`), whether a disk read and an MP3 decode come first,
   * which optimistic state the tap sets, and — the reason `onEnded` is a
   * parameter and not a flag — what ending means. `playTake` gives the floor
   * back and reports a run-out (#601); `playBuffer` also notifies its caller
   * BEFORE the state update (#416).
   *
   * The supersession guard IS here, because both wrote it and neither could
   * correctly omit it: a handle or an end belonging to a claim someone else has
   * taken over must not touch this screen's state. `settle` returning false
   * means the handle was built for a superseded claim and has already been
   * stopped for us.
   */
  const startPlayback = useCallback(
    async (
      samples: Int16Array,
      token: number,
      offsetSeconds: number,
      source: ProbeSource,
      onEnded: () => void
    ): Promise<void> => {
      const handle = await playSamples(samples, {
        offsetSeconds,
        source,
        isStillCurrent: () => session.isCurrent(token),
        onEnded: () => {
          if (!session.isCurrent(token)) return;
          onEnded();
        },
      });
      // A `false` here means the handle was built for a claim that has since
      // been superseded; `settle` has already stopped it.
      if (session.settle(token, handle)) {
        playbackHandleRef.current = handle;
      }
    },
    [session]
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
              setPlaybackError(strings.playbackFailed);
            }
            session.release(token);
            setPlaying(null);
            return;
          }

          // A finished segment's clip is MP3 (B8/D3): decode it first. Then the
          // same supersession check as after the read — the decode is a real
          // await, and another tap may have taken the floor during it.
          const samples =
            audio.clip.encoding === "pcm"
              ? audio.clip.samples
              : fitMp3Decode(
                  await decodeMp3ToCanonical(audio.clip.mp3),
                  audio.clip.mp3,
                  audio.clip.meta.frameCount
                );
          if (!session.isCurrent(token)) return;

          const source =
            audio.clip.encoding === "pcm" ? "stored-pcm" : "stored-mp3";
          await startPlayback(samples, token, offsetSeconds, source, () => {
            session.release(token);
            setPlaying(null, true);
          });
        } catch (cause) {
          console.error("Playing a take failed", cause);
          // Inside the guard: a failure that belongs to a superseded claim is
          // not this screen's news. Tapping play on B while A is still loading
          // supersedes A, and A's rejection must not paint an alert over B.
          if (session.isCurrent(token)) {
            session.release(token);
            setPlaying(null);
            setPlaybackError(strings.playbackFailed);
          }
        }
      })();
    },
    [claimFloor, session, setPlaying, startPlayback]
  );

  const stopBuffer = useCallback(() => {
    // Nothing sounding from us, nothing to do. Only our OWN floor is released:
    // stopping buffer playback must never stop a recording that has taken the
    // floor since.
    if (!playingBufferRef.current) return;
    if (session.live === "take") session.stopAll();
    setPlayingBuffer(false);
    // Nothing to hand the floor back TO since #614: a microphone is either
    // capturing — and then it holds the floor, so this branch never ran — or
    // gone. The #101/#129 reclaim that used to stand here existed only for the
    // paused-alive mic a preview borrowed from, and that state no longer exists.
  }, [session, setPlayingBuffer]);

  const playBuffer = useCallback(
    (
      samples: Int16Array,
      offsetSeconds = 0,
      opts?: { onEnded?: () => void }
    ) => {
      if (playingBufferRef.current) {
        stopBuffer();
        return;
      }

      // Nothing to play: never claim the floor for an empty buffer. `toAudioBuffer`
      // pads a 0-sample clip to one frame (audio-io.ts), so this would otherwise
      // sound a frame of silence and hold the floor until it ended. The recorder
      // disables Play on an empty buffer, so this mirrors playTake's bail as
      // defence (George R5).
      if (samples.length === 0) return;

      const token = claimFloor("take");
      // Refused: the microphone holds the floor. The recorder disables Play
      // while recording, so this is defensive — but a refusal must fail quiet.
      if (token === null) return;

      // Unlock Web Audio inside the tap: iOS will not resume a suspended context
      // once the activation is spent. There is no disk read to follow — the
      // samples are already in hand — but the gesture rule is unchanged.
      void resumeAudioContext().catch((cause: unknown) => {
        console.error("Could not resume the audio context", cause);
      });

      // Optimistic, so the control responds to the tap rather than to the graph.
      // No `playbackElapsedMs` seed on the buffer path: the recorder's playhead
      // PULLS `readPlaybackPosition` on its own rAF (#102), so pushing here would
      // only re-render App and the inert list for a value nothing reads.
      setPlayingBuffer(true);

      void (async () => {
        try {
          await startPlayback(samples, token, offsetSeconds, "working", () => {
            // The clip RAN OUT — `startPlayback` only calls this from a source
            // that was not stopped by hand (`audio-io.ts` guards it with its
            // `stopped` flag) and only while this claim still owns the floor.
            // The recorder needs that distinction and cannot infer it: the
            // position is gone the moment the handle is cleared, and a
            // playback that never started looks identical from outside
            // (Frank R2 P2, #416). Called BEFORE the state update, so a
            // caller's flag is set by the time the re-render reads it.
            opts?.onEnded?.();
            session.release(token);
            setPlayingBuffer(false);
          });
        } catch (cause) {
          console.error("Playing the buffer failed", cause);
          // Inside the guard, exactly as in `playTake`: a failure that belongs
          // to a superseded claim is not this screen's news.
          if (session.isCurrent(token)) {
            session.release(token);
            setPlayingBuffer(false);
            setPlaybackError(strings.playbackFailed);
          }
        }
      })();
    },
    [claimFloor, session, setPlayingBuffer, startPlayback, stopBuffer]
  );

  // The buffer-playback position, PULLED on the caller's own clock. The handle's
  // `elapsed()` is the source of truth (it clamps to the clip duration), so a
  // pause or an end reads a settled value rather than a drifting integration.
  // Returns null when nothing is sounding — a HIDE sentinel distinct from
  // position 0 (the clip start): the handle is nulled a React commit BEFORE the
  // overlay's `active` prop goes false, so a plain 0 would snap the line to the
  // left edge for a frame on every end/stop (George #102 R2). A stopped handle
  // is never read: its `elapsed()` keeps tracking ctx.currentTime and would race
  // the line to the end. Stable identity ([] deps): the overlay depends on it,
  // so it must not churn per render (#102).
  //
  // The optimistic window — sounding, no handle yet — answers the range start
  // WITH its provenance (`measured: false`) rather than a bare 0, which is the
  // George R4 P1 class: see `lib/audio/playback-position` for the rule, the
  // defect and the tests. This layer contributes only what `lib/` may not
  // touch — the handle and the ref.
  const readPlaybackPosition = useCallback((): PlaybackPosition | null => {
    const handle = playbackHandleRef.current;
    return playbackPosition(
      handle ? handle.elapsed() * 1000 : null,
      playingBufferRef.current
    );
  }, []);

  // Advance the Segments-row scrub dot while a LIST take is sounding. Gated on
  // `playingId` only — buffer playback (the recorder) reads `readPlaybackPosition`
  // on its own clock, so a preview no longer pushes App state ~16×/s and
  // re-renders the inert Segments list behind the sheet (#102). The handle's own
  // `elapsed()` is the source of truth, polled rather than integrated so a pause
  // or an end never leaves the dot drifting.
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

  const stopRecording = useCallback(async (): Promise<StopResult> => {
    // Snapshot BEFORE the await. `startRecording` writes every new claim into
    // the same ref, so reading it afterwards would hand us a *newer*
    // recording's token — releasing that is precisely the bug this token exists
    // to prevent, one level up.
    const token = micTokenRef.current;
    try {
      return await endRecording();
    } catch (cause) {
      // Backstop only — `stop()` returns its failure in the result and does not
      // reject. The reason rides the result to the recorder sheet (a toolbar
      // Notice), rather than `playbackError`, which would bleed onto the
      // Segments screen after the sheet is gone. Reported to the funnel so a
      // failed confirmed Stop leaves a row (#480); console.error is kept
      // beside it, not replaced.
      reportFailure(cause, "recorder-stop-backstop");
      console.error("Stopping the recorder failed", cause);
      return { samples: null, error: "unfinished", blob: null };
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
    // `stopAll` silences a sounding buffer through the shared floor; this clears
    // the React flag it leaves behind, the same reset `setPlaying(null)` does.
    setPlayingBuffer(false);
    setPlaybackError(null);
  }, [cancelRecording, session, setPlaying, setPlayingBuffer]);

  const primeAudioContext = useCallback(() => {
    // Un-interrupt the shared context inside the tap that opens the sheet, so
    // the FIRST decode of a finished segment runs on a running context rather
    // than an interrupted one (#184). The load itself runs one commit later from
    // `useRecorderSegment`'s effect — after this gesture's activation is spent —
    // so resuming there would be too late on iOS, exactly the shape #155's retry
    // fixed for the SECOND attempt. Fire-and-forget with the same failure sink
    // as the sibling resume call sites; it touches neither the floor nor the
    // session, only the shared decode/playback context.
    void resumeAudioContext().catch((cause: unknown) => {
      console.error("Could not resume the audio context", cause);
    });
  }, []);

  useEffect(() => {
    // Backstop only. `startRecording` releases a refused claim on the completion
    // path; this still covers a recorder that reaches idle by some route that
    // never resolved a `start()` at all. `processing` is not idle, so a take
    // still being committed does not trip this.
    //
    // The RENDERED state, deliberately, not `readState()` (#173): an effect
    // runs after the commit that carries the value, so the rendered one is the
    // one that matches the tree this effect is reconciling. The owner-owned
    // read is for a SYNCHRONOUS caller inside a handler, which is what the
    // mirror #173 deleted used to answer wrongly.
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
    playingBuffer,
    playbackElapsedMs,
    playbackRanOut,
    recorderState,
    elapsedMs,
    supported,
    // One surface, newest cause first: a recorder failure is what the
    // translator just did, so it outranks a stale playback message.
    error: recorderError ?? playbackError,
    recorderError,
    playTake,
    playBuffer,
    stopBuffer,
    readPlaybackPosition,
    startRecording,
    stopRecording,
    retryDecode,
    leave,
    primeAudioContext,
    readLevel,
    readMeterAvailable,
    readScope,
    peekScope,
    meterFailed,
  };
}
