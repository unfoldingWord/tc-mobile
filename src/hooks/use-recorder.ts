import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CapturePeaks,
  type CaptureScope,
  createCapturePeaks,
} from "@/lib/audio/capture-peaks";
import {
  classifyMicRefusal,
  type MicPermissionState,
} from "@/lib/audio/mic-refusal";
import { classifyStopDecode } from "@/lib/audio/stop-decode";
import { messages, micRefusalMessage, stopDecodeMessage } from "@/lib/messages";

import {
  createLevelTap,
  decodeToCanonical,
  isRecordingSupported,
  type LevelTap,
  pickMimeType,
  raceAudioResume,
  RESUME_TIMEOUT_MS,
  resumeAudioContext,
} from "./audio-io";
import { reportFailure } from "./report-failure";

/**
 * The permission state for the microphone, or `"unknown"` where the platform
 * hides it (iOS Safari has no `navigator.permissions`). Browser-only, so it
 * lives here at the audio boundary and feeds the pure `classifyMicRefusal`.
 */
async function queryMicPermission(): Promise<MicPermissionState> {
  try {
    const perms = navigator.permissions;
    if (!perms?.query) return "unknown";
    const status = await perms.query({
      // `"microphone"` is a valid PermissionName at runtime but missing from
      // some TS DOM lib versions; the cast is the one narrow spot that needs it.
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    // Firefox rejects a microphone query outright; treat that like an absent API.
    return "unknown";
  }
}

/**
 * Install the foreground re-arm for a live take (#76), returning the effect
 * cleanup.
 *
 * Returning from an iOS backgrounding or an OS interruption can leave the shared
 * `AudioContext` `"suspended"`/`"interrupted"`, so the VU tap reads zeros even
 * though capture is fine. The `resume()` gesture already covers a manual
 * pause→resume; this covers a return that is NOT a resume tap — a background then
 * foreground with capture still live. Fire-and-forget: the resume must never gate
 * anything, and best effort — iOS MAY withhold the un-suspend until the next real
 * user gesture, in which case the meter stays honestly hatched (`available()` ->
 * false) until a tap. That withholding is the open device question the iOS pass
 * settles.
 *
 * `recording` gates it: only a live take has a meter to rescue, and `resume()`
 * owns the paused edge, so idle/paused/requesting/processing arm nothing and hand
 * back a no-op cleanup. A module function, not an inline effect body, so the two
 * guards and the listener add/remove are exercisable without a React renderer
 * (this repo has none in Node) — see `tests/foreground-resume.test.ts`.
 */
export function armForegroundResume(recording: boolean): () => void {
  if (!recording) return () => {};
  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    void resumeAudioContext().catch((cause: unknown) => {
      console.error("Could not resume the audio context on foreground", cause);
    });
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}

/**
 * Columns the live-waveform ring holds while recording (#120). One column is
 * pushed per animation frame, so at ~60 fps this is roughly `SCOPE_CAPACITY/60`
 * seconds of visible history. 180 ≈ 3 s beside the head — a provisional default
 * to tune on the device pass alongside `headFraction` (the requirements owner's UX call).
 */
const SCOPE_CAPACITY = 180;

export type RecorderState =
  "idle" | "requesting" | "recording" | "paused" | "processing";

/**
 * The outcome of `stop()`.
 *
 * The failure travels WITH the result rather than through the `error` state, so
 * the consumer deciding what to show reads the real cause synchronously instead
 * of a render closure that has not caught up yet. That stale read was the
 * round-4 regression: a decode failure set `error` asynchronously, `close()`
 * read the still-null closure value, and the sheet fell through to the
 * permission panel. It also gives the empty-capture case a message it never had.
 */
export interface StopResult {
  /** Canonical PCM when the take produced usable audio, else null. */
  readonly samples: Int16Array | null;
  /**
   * A translator-facing reason when `samples` is null and it is worth saying —
   * an empty capture, an undecodable one, or a teardown that threw. A native
   * `stop()` throwing inside the flush (#485) is NOT its own outcome: the
   * slices MediaRecorder delivered before the throw are sealed from the local
   * `chunks` exactly as on the flush timeout, reported under
   * `"recorder-stop-flush"`, and classified by the same tail — a decodable
   * seal is the take, an undecodable one is held in `blob`, and only an EMPTY
   * seal yields `samples` and `blob` both null with `error` "Could not finish
   * this recording." (the backstop's sentence, chosen over "No sound" because
   * the engine failed). The recorder is back at `idle` either way, free to
   * `start()` again. Null when there is nothing to say: a superseded stop,
   * whose UI belongs to a newer recording — on every exit, the throw path
   * included.
   */
  readonly error: string | null;
  /**
   * The captured container bytes, kept whenever a decode FAILED — on a current
   * stop AND on a superseded one (George R1 G2). A failed decode is the one case
   * where the take exists nowhere else, so dropping the blob would lose it for
   * good (#165); and a `leave()`/pagehide bumping the generation mid-decode is
   * the very #106 interruption most likely to fail it, so the bytes are kept even
   * when the stop is superseded — only the shared `error` is withheld then, since
   * a newer owner speaks for the screen. `close()` DEPENDS on this: it holds the
   * take whenever `blob` is set, so re-narrowing it to current-only would re-drop
   * the interruption case. Null on success (the PCM is the take) and on an empty
   * or silent capture (no audio worth keeping — a retry of the same bytes cannot
   * help). A caller holding this can re-decode it (`retryDecode`) or hand the raw
   * bytes to the share sheet so the recording leaves the phone in some form.
   */
  readonly blob: Blob | null;
}

/** The outcome of re-decoding a held take's container bytes (#165). */
export interface RetryDecodeResult {
  readonly samples: Int16Array | null;
  readonly error: string | null;
}

/**
 * How long `stop()` waits for MediaRecorder to flush before taking what it has.
 *
 * `onstop` is not guaranteed to fire. This module already special-cases WebKit
 * emitting a single blob on stop rather than honouring the timeslice, and a
 * recorder that also never fires `stop` would leave the await hanging forever
 * — on a screen whose Back is hidden and whose Stop is disabled while
 * `processing`, so the translator has no exit and the confirmed take never
 * reaches `saveTake`.
 *
 * Generous, because the flush is only delivery of already-captured blobs, not
 * encoding: five seconds is far past a healthy stop and far short of a
 * translator concluding the app is dead.
 */
const STOP_FLUSH_TIMEOUT_MS = 5_000;

/**
 * `raceAudioResume` and its `RESUME_TIMEOUT_MS` bound moved to `audio-io.ts`
 * (#469): `playSamples` needs the identical #108 bound on its own
 * `resumeAudioContext()` await, and `audio-io.ts` — where
 * `resumeAudioContext` itself already lives — is the shared home both
 * callers can reach without a circular import back into this higher-level
 * hook. `start()` below now imports both and passes its own
 * `"recorder-start-resume"` rejection key at the call site, which is the
 * only change to this file's own behavior; `raceAudioResume`'s full history
 * and design rationale (the #108 regression, the #475/#498 George R1 P2
 * "the helper has no generation to check" reasoning) now lives on the
 * moved docblock in `audio-io.ts`.
 */

export interface UseRecorder {
  readonly state: RecorderState;
  readonly supported: boolean;
  readonly elapsedMs: number;
  readonly error: string | null;
  /**
   * Open the microphone. Resolves `true` when capture is live after the call —
   * a take this call started, or one already running when a redundant start was
   * refused (the mic is live either way).
   *
   * `false` is the caller's release signal: a start that produced no live
   * capture (no permission, no device, superseded by a newer start) has to hand
   * back the audio floor on this path rather than through an effect watching for
   * an intermediate `state`, which a React batch can hide. An already-live take
   * is deliberately NOT this case — releasing the floor while capture continues
   * would strand a live microphone with no floor holder.
   */
  start: () => Promise<boolean>;
  /**
   * Pause capture without ending the take. The same take resumes with
   * `resume()`; the elapsed timer freezes. No-op unless currently recording.
   */
  pause: () => void;
  /** Resume a paused take into the SAME recording. No-op unless paused. */
  resume: () => void;
  /**
   * Stop and return the captured audio as canonical mono 16-bit PCM, or the
   * reason it produced none — an empty capture, an undecodable one, or a
   * teardown that threw. The failure is in the result, not the `error` state
   * — see `StopResult`. A throw inside its own flush does not reject: that
   * path reports `"recorder-stop-flush"`, seals whatever slices are already in
   * hand and resolves through the same tail as a flush timeout — the take, a
   * held `blob`, or (only when the seal is empty) `{ samples: null, error:
   * "Could not finish this recording.", blob: null }` — with state back at
   * `idle` when current and the recorder ref dropped, so `start()` is free
   * again (#485).
   */
  stop: () => Promise<StopResult>;
  /**
   * Re-decode a held take's container bytes (`StopResult.blob`) after a decode
   * failed on Stop (#165). Resumes the shared `AudioContext` first — the caller
   * must invoke this synchronously in a tap so iOS honours the resume of a
   * context left "interrupted" (#106), the likeliest cause of the original
   * failure — then decodes. Never throws: a still-undecodable blob comes back as
   * `{ samples: null, error }`, a silent one as `{ samples: null }` with the
   * "no sound" reason, and success as `{ samples, error: null }`. The blob is the
   * caller's to keep or share out; this does not consume it.
   */
  retryDecode: (blob: Blob) => Promise<RetryDecodeResult>;
  /**
   * Decode the take captured SO FAR to canonical PCM for an in-sheet preview,
   * WITHOUT ending the take (#101). Meant for a paused take — the caller enables
   * Play while paused and previews what was recorded before committing on Back.
   *
   * Returns null, never throws, when there is nothing to preview or the take
   * cannot be decoded mid-capture: `pause()` does not finalise the container, and
   * iOS writes the moov atom only on `stop()`, so a paused fMP4 may not decode on
   * that platform. The caller degrades to a disabled Play rather than claiming a
   * preview it cannot produce — the flow is correct on every device, and whether
   * a given device can decode a paused take is answered by the on-device pass.
   *
   * Resolves null if the take is no longer this paused recorder by the time the
   * flush settles — a cancel/leave, a newer recording, a Resume, or a Back (whose
   * `stop()` owns the chunks then). So it never previews post-resume audio as "the
   * take so far", and never decodes in parallel with `stop()`'s own decode.
   */
  previewCapture: () => Promise<Int16Array | null>;
  cancel: () => void;
  /**
   * The live capture level for the VU meter, in the raw amplitude domain (RMS of
   * the latest frame). A PULL read (D-LEVEL-PULL): the meter polls this on its
   * own animation clock so the recorder never re-renders per frame. Returns 0
   * whenever nothing is capturing — the tap is opened with the recording and
   * closed the instant the stream is torn down, so this never reads a dead or
   * superseded analyser.
   */
  readLevel: () => number;
  /**
   * Whether the VU meter's `readLevel` can be trusted RIGHT NOW. A PULL like
   * `readLevel`, polled on the meter's own frame clock. `true` when NOT in a live
   * take — outside recording the meter rests empty via `active` rather than
   * hatching on the way down, so "not recording" reads as "not broken". `false`
   * ONLY while recording and either the tap is missing or the shared context is
   * not `"running"` (iOS `"suspended"`/`"interrupted"` after backgrounding or an
   * interruption), where the analyser reads zeros indistinguishable from a dead
   * mic. The meter hatches "unavailable" on a false (#76). Distinct from
   * `meterFailed`, which is the OPEN-time "tap never wired" state; this is the
   * per-frame runtime state a wired tap can still fall into.
   */
  readMeterAvailable: () => boolean;
  /**
   * The live-waveform scope for the current take (#120), or `null` when nothing
   * is capturing or the tap could not be wired. A PULL like `readLevel`: the
   * scope drawer polls it on its own frame clock. Folds the latest analyser
   * frame in as one column per call and returns the ring's `CaptureScope`.
   */
  readScope: () => CaptureScope | null;
  /** The ring as it stands, without advancing it. See the implementation. */
  peekScope: () => CaptureScope | null;
  /**
   * The level tap could not be wired for the current take (a quirky Web Audio
   * implementation). Recording is unaffected; the meter should show unavailable
   * rather than a resting-empty strip. False while it is working or idle.
   */
  meterFailed: boolean;
}

/**
 * Microphone capture, normalised to the app's canonical PCM format.
 *
 * Deliberately returns samples rather than a Blob: every consumer wants PCM
 * (waveform, editing, export), so decoding once here avoids each of them
 * having to know what codec the device produced.
 */
export function useRecorder(): UseRecorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The VU tap could not be wired on this device (createLevelTap threw). The
  // recorder runs meterless, but the UI must be able to SHOW the meter as
  // unavailable rather than an empty strip a translator reads as a dead mic —
  // console.error is not a channel on a phone in a village (Frank R-B6).
  const [meterFailed, setMeterFailed] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  /**
   * The capture stream, held from the moment `getUserMedia` resolves.
   *
   * Deliberately not reached through `recorderRef`: the recorder does not
   * exist yet while `start()` is awaiting `resumeAudioContext()`, and that is
   * precisely the window in which a `cancel()` — or a throw — has to be able
   * to close the microphone. A stream only the running `start()` can see is a
   * stream nothing else can stop.
   */
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /**
   * The VU tap on the current capture stream, or null when nothing is
   * capturing. Its lifetime is exactly the stream's: opened right after
   * `recorder.start()` and closed at every teardown (`releaseStream`, `stop()`,
   * and the interruption path), so no analyser ever outlives its stream and
   * `readLevel()` cannot read a superseded or dead one.
   */
  const tapRef = useRef<LevelTap | null>(null);
  const startedAtRef = useRef(0);
  /**
   * Elapsed time banked before the current running span.
   *
   * Pause/resume splits one take into several running spans. The timer cannot
   * be `now - startedAt` any more — that would keep counting the paused gap.
   * So each pause banks the span that just ended here, and the live timer adds
   * only the current span on top. The take's length is the sum, never the wall
   * clock since Record was first pressed.
   */
  const baseElapsedRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  /** Bumped on cancel so a stop() already in flight resolves to nothing. */
  const generationRef = useRef(0);

  const supported = isRecordingSupported();

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** Run the elapsed timer for the current span, on top of the banked total. */
  const startTick = useCallback(() => {
    clearTick();
    tickRef.current = window.setInterval(() => {
      setElapsedMs(
        baseElapsedRef.current + (performance.now() - startedAtRef.current)
      );
    }, 100);
  }, [clearTick]);

  /** Close the VU tap if one is open. Safe to call when there is none. */
  const closeTap = useCallback(() => {
    tapRef.current?.close();
    tapRef.current = null;
  }, []);

  /**
   * The live-waveform ring for the current take (#120). One column per frame is
   * folded in by `readScope`; reset at each idle→recording edge in `start`.
   * Created ONCE, behind a null guard, and reused — reusing its buffers is the
   * whole point (#102). `useRef`'s argument is evaluated on EVERY render, so
   * `createCapturePeaks` (four `Float32Array`s) must not sit in the `useRef`
   * call: the 100 ms timer would re-allocate a ring ~10×/s through a take, all
   * discarded (Frank R3).
   */
  const scopeRef = useRef<CapturePeaks | null>(null);
  if (scopeRef.current === null) {
    scopeRef.current = createCapturePeaks(SCOPE_CAPACITY);
  }
  // Whether a recorded frame is live, for `readScope` to gate the ring push
  // without sitting in a dependency array. Written SYNCHRONOUSLY at each
  // transition (start/resume → true; pause/stop/cancel/interrupt → false), in
  // the same turn as the tap/recorder change — the same way `tapRef` is cut at
  // `stop()`. A `useEffect` mirror lags a commit, and `pause()` leaves the
  // analyser live (R-B6), so a queued rAF `tick` between `pause()` and the
  // effect would push a post-pause room-tone column into the frozen freeze
  // (George R3). The effect is a backstop for any path the writes miss.
  const recordingRef = useRef(false);
  useEffect(() => {
    recordingRef.current = state === "recording";
  }, [state]);

  /** The current capture level for the VU meter, 0 when nothing is capturing. */
  const readLevel = useCallback((): number => tapRef.current?.read() ?? 0, []);

  // Whether that level can be trusted this frame (#76). Gated on `recordingRef`
  // exactly like `readScope` below, and for the same teardown-window reason: at
  // Stop/interrupt the tap is torn down SYNCHRONOUSLY (nulled in `stop()`,
  // `disconnect()`ed in `onInterrupted`) one commit BEFORE `setState` leaves
  // "recording", so `active` in `VuMeter` is still true in that window. Without
  // the gate `available()` -> false there would flash the "meter broken" hatch —
  // the exact dead-mic misread #76 exists to prevent (George R1 P2). `LiveScope`
  // documents the same frame (`live-scope.tsx:176-180`). While recording, a
  // wired tap defers to its own live context-state check; a false there is a
  // genuine suspended/interrupted context. Outside recording return `true` so the
  // meter never hatches on the way down — it rests empty via `active` instead.
  const readMeterAvailable = useCallback(
    (): boolean =>
      recordingRef.current ? (tapRef.current?.available() ?? false) : true,
    []
  );

  /**
   * The live-waveform scope for the current take, or `null` when not recording
   * (idle/paused/processing) or the tap could not be wired. A PULL like
   * `readLevel` (D-LEVEL-PULL): the scope drawer polls it on its own animation
   * clock, so the recorder never re-renders per frame. Each call while recording
   * folds the latest analyser frame in as one column and returns the ring.
   */
  /**
   * The ring as it stands, WITHOUT folding a frame in — the non-mutating twin of
   * {@link readScope}, for a drawer that needs to paint what is already there.
   *
   * `readScope` is a pull that ADVANCES the ring ("one column per recorded
   * frame" is its enforced invariant), so it is wrong for any paint that is not
   * itself the animation tick. `LiveScope`'s activation paint called it on every
   * `active` edge, which folded an extra column per pause→resume cycle and ran
   * the waveform ahead of real time (George, #139 round 3).
   *
   * Deliberately NOT gated on `recordingRef`: a paused or remounted scope must
   * be able to draw its frozen ring, which is the other half of that bug — when
   * `readFrame()` refuses (a suspended context) `readScope` returns null and the
   * freeze could not be painted at all.
   */
  const peekScope = useCallback(
    (): CaptureScope | null => scopeRef.current?.toScope() ?? null,
    []
  );

  const readScope = useCallback((): CaptureScope | null => {
    // Advance the ring only while actually recording. The drawer already gates
    // its loop on `recording`; gating the PUSH here too makes "one column per
    // recorded frame" an enforced invariant, not caller discipline, so a paused
    // take or a future second consumer cannot scroll or double-fold it (George
    // R2/R3).
    const ring = scopeRef.current;
    if (!recordingRef.current || !ring) return null;
    const frame = tapRef.current?.readFrame();
    if (!frame) return null;
    ring.push(frame);
    return ring.toScope();
  }, []);

  const releaseStream = useCallback(() => {
    closeTap();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, [closeTap]);

  /**
   * Stop a stream this `start()` acquired but will not use.
   *
   * Scoped to that one stream instead of going through `releaseStream`, so a
   * superseded `start()` can never stop the microphone a newer one has since
   * opened.
   */
  const abandonStream = useCallback((stream: MediaStream) => {
    stream.getTracks().forEach((t) => t.stop());
    if (streamRef.current === stream) streamRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setError(messages.recordUnsupported);
      return false;
    }
    // Refuse to open a SECOND microphone while one is already live. Unreachable
    // through the current UI — Record maps to pause/resume while non-idle and the
    // permission panel only renders at idle — but a future caller invoking start()
    // mid-take would otherwise overwrite streamRef, stranding the old stream as a
    // hot mic while its recorder kept capturing into an orphaned array (#60). Leave
    // the running take's state and error untouched; just decline to open a new one.
    //
    // Resolve `true`, NOT `false`: `false` is the caller's floor-release signal
    // (`startRecording` calls `session.stopAll()` on it), and releasing the mic
    // floor while capture continues would let playback claim the floor under a
    // live microphone — the exact invariant the session refuses to gate on which
    // buttons happen to be rendered. Capture is already happening, so the honest
    // answer is "yes, the mic is live"; the caller keeps the floor it holds.
    const live = recorderRef.current;
    if (live && live.state !== "inactive") return true;
    setError(null);
    setState("requesting");
    const generation = ++generationRef.current;

    // Declared out here so the catch below can still reach the stream: from
    // `getUserMedia` resolving until the recorder is assigned there is no
    // other reference to it, and a throw in that window would otherwise leave
    // the microphone open for the life of the page.
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Speech in a noisy room, recorded on a phone held in the hand.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (generation !== generationRef.current) {
        abandonStream(stream);
        return false;
      }
      // Reachable by `cancel()` from here on, which is what matters across the
      // await below.
      streamRef.current = stream;

      // Unlock Web Audio while we still have the user gesture that started
      // this recording — iOS will not resume the context later without one.
      // Bounded (#108): WebKit's resume() from "interrupted" has been
      // observed to hang, and an unbounded await here left the recorder
      // stuck in "requesting" forever with the mic already hot. `true` when
      // the bound elapsed before resume() settled — reported below, behind
      // the generation check, never by the helper (George R1 P2 on #498).
      const resumeTimedOut = await raceAudioResume("recorder-start-resume");

      // The resume is a real await on the first recording of a session — iOS
      // starts the context suspended — so a `cancel()` from navigation, the
      // pagehide handler or unmount can land here. A `cancel()` has already
      // stopped this stream through `releaseStream`; a newer `start()` has
      // not, which is why the stream is abandoned by identity. Either way no
      // recorder is opened: one started after the teardown would report
      // "recording" with the session floor already released. This check
      // absorbs a cancel() landing during raceAudioResume's bounded wait
      // exactly as it already did during the previous unbounded await.
      if (generation !== generationRef.current) {
        abandonStream(stream);
        return false;
      }
      // The bound firing on a start that is STILL CURRENT is the #108 fact
      // the log exists to carry (#475): every tester phone becomes a
      // measurement of how often resume() takes longer than
      // `RESUME_TIMEOUT_MS`. Placed after the generation check on
      // purpose — a start() that cancel() discarded during the wait (Back
      // or pagehide while "requesting") is not a #108 event and must not
      // light the Books `≡`. This row fires on EVERY live start() whose
      // resume overruns the bound; if a phone's resume-from-interrupted is
      // routinely slow it competes for the failure ring, and the constant is
      // the one knob. The row cannot tell a WebKit resume() that hung from a
      // page frozen mid-wait by background throttling — both elapse the same
      // timer — so which one a device row records is an inference for the
      // reader, not a fact the row carries.
      if (resumeTimedOut) {
        reportFailure(
          new Error(
            `resumeAudioContext() did not settle within ${RESUME_TIMEOUT_MS} ms; the bounded wait in start() elapsed (#108)`
          ),
          "recorder-start-resume-timeout"
        );
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recorderRef.current = recorder;

      // Bound to the array THIS recording owns, not to the ref.
      //
      // MediaRecorder delivers its last slice as a `dataavailable` after
      // `stop()` is invoked and before `onstop`. A handler that followed the
      // ref would write that slice into whatever array the ref happens to
      // name by then — and `cancel()` (pagehide, navigation, unmount) puts a
      // fresh one there. For a take shorter than one 250 ms timeslice, and on
      // WebKit builds that ignore the timeslice and emit a single blob on
      // stop, that diverted slice is the entire recording. Following the array
      // also stops an old recorder's final slice landing on a newer take.
      const chunks: Blob[] = [];
      chunksRef.current = chunks;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      // The mic can be taken mid-take — an incoming call, a Bluetooth device
      // change, an OS audio interruption — which ends the capture track and
      // inactivates the recorder on its own. Without this the hook never learns:
      // state stays "recording", the timer keeps ticking, Record stays a live
      // no-op Pause, and the chunks captured before the interruption are
      // stranded (#59). Freeze the UI into `processing` so Record is dead and
      // the timer stops, and leave the state where `close()` still runs the
      // commit path — `stop()` then recovers those chunks instead of dropping
      // the take. Guarded by generation so an interruption on a superseded
      // recorder cannot repaint a newer one. `MediaStreamTrack.stop()` (our own
      // teardown) does NOT fire `ended`, so this only reacts to real losses.
      // The still-active arm (recorder not yet "inactive") is reported once
      // per take so tester phones show whether it is ever reached (#478).
      // The row carries only what this frame can observe — `recorder.state`
      // and `event.type`, i.e. which feed fired (`error` from the recorder,
      // `ended` from a track). Whether the mic is still hot is NOT observable
      // here: on `ended` the track is already dead, and an `error` at
      // "recording" may be followed by an `ended` that reaches the inactive
      // arm and releases everything — so the row must not assert it.
      //
      // Per take, not per call: a fresh binding per start() closure, like
      // `chunks` above. `onInterrupted` is bound to `onerror` AND every
      // track's `onended`, so one interruption can invoke it more than once,
      // in different tasks — and the funnel's own dedup collapses only the
      // same Error identity within one microtask, which a synthesized Error
      // per call is not. Never reset: a take that hits the still-active arm
      // is frozen at "processing" and cannot resume, so per-take and
      // per-interruption coincide today. If a take ever continues after an
      // interruption, this boolean would suppress a second, genuine one.
      let interruptionReported = false;
      const onInterrupted = (event: Event) => {
        if (generation !== generationRef.current) return;
        clearTick();
        // DISCONNECT the tap's graph (readLevel -> 0) always. Whether its cloned
        // tracks are stopped depends on the recorder state below, exactly as for
        // the original tracks.
        tapRef.current?.disconnect();
        // Cut the live-scope push synchronously, like the tap above — a queued
        // rAF must not fold a post-interrupt column into the frozen freeze (R3).
        recordingRef.current = false;
        setState("processing");
        // Release the mic the moment the recorder has actually ended. On the
        // `error` path the track can still be live — a hot mic on a frozen sheet
        // until Back, potentially minutes. Only once inactive: the chunks are
        // then final, so stopping the track drops no audio; on the `ended` path
        // the track is already dead and this is a no-op.
        if (recorder.state === "inactive") {
          // Chunks final — stop BOTH the original tracks AND the VU clone. A
          // cloned getUserMedia track is independent, so disconnect() alone left
          // it live and kept the mic device captured until Back (a hot mic the
          // original-track stop was written to prevent — George R-B6). Safe here
          // for the same reason the original stop is: the chunks are final. NOT
          // on the error path (recorder still active), where clone-stop could
          // truncate the slice stop() will recover.
          stream?.getTracks().forEach((track) => track.stop());
          closeTap();
        } else if (!interruptionReported) {
          interruptionReported = true;
          reportFailure(
            new Error(
              `Recorder interrupted via "${event.type}" while still "${recorder.state}" (still-active arm, #478)`,
              // The `error` feed's event carries the native failure as
              // `.error` (lib.dom types `MediaRecorder.onerror`'s event as
              // `ErrorEvent`; `MediaRecorderErrorEvent` is not declared at
              // TypeScript 5.9.3, so this narrows structurally rather than
              // by that name). `describeCause` walks `.cause`, so the durable
              // row names the DOMException — `NotReadableError`,
              // `InvalidStateError` — instead of only that an error arrived
              // (George R1 P3 on #498). The `ended` feed has no such field:
              // `undefined` keeps that row's shape unchanged.
              { cause: "error" in event ? event.error : undefined }
            ),
            "recorder-interrupted-active"
          );
        }
      };
      recorder.onerror = onInterrupted;
      stream.getTracks().forEach((track) => {
        track.onended = onInterrupted;
      });

      recorder.start(250);
      // A new take starts from an empty live-waveform scope (#120) — the ring
      // must not carry the previous take's tail into this one.
      scopeRef.current?.reset();
      // Open the VU tap on the live stream. Non-fatal: a device with a quirky
      // Web Audio implementation should still record even if the meter cannot
      // be wired, so a failure here is logged and the recorder runs meterless.
      try {
        tapRef.current = createLevelTap(stream);
        setMeterFailed(false);
      } catch (tapCause) {
        console.error("Could not open the level meter", tapCause);
        tapRef.current = null;
        setMeterFailed(true);
      }
      startedAtRef.current = performance.now();
      baseElapsedRef.current = 0;
      setElapsedMs(0);
      // The ring may advance from the next rAF on — set before the state edge.
      recordingRef.current = true;
      setState("recording");

      startTick();
      return true;
    } catch (cause) {
      if (stream) abandonStream(stream);
      // A `cancel()` or a newer `start()` owns the state and the message now.
      // Reporting this failure over theirs is the stale-message problem
      // `cancel()` clears `error` to avoid.
      if (generation !== generationRef.current) return false;
      releaseStream();
      setState("idle");
      const name = cause instanceof DOMException ? cause.name : undefined;
      // Immediate message from the exception alone — the permission state is not
      // in hand yet, so classify as `unknown` (a NotAllowedError → the honest
      // "allow it, or check settings" line). No blank while the query resolves.
      setError(micRefusalMessage(classifyMicRefusal(name, "unknown")));
      // Refine once the Permissions API answers, which splits the site block from
      // the OS block (#203/#195). It is async, so re-check the generation before
      // applying — a `cancel()`/newer `start()` may have taken over meanwhile —
      // and only for the refusal it can sharpen. iOS returns `unknown` and this
      // no-ops, leaving the immediate line.
      if (name === "NotAllowedError") {
        void queryMicPermission().then((permission) => {
          if (permission === "unknown") return;
          if (generation !== generationRef.current) return;
          setError(micRefusalMessage(classifyMicRefusal(name, permission)));
        });
      }
      return false;
    }
  }, [abandonStream, clearTick, closeTap, releaseStream, startTick, supported]);

  /**
   * Pause the take. `MediaRecorder.pause()` stops delivering `dataavailable`
   * but keeps the recorder and stream alive, so `resume()` continues the same
   * clip. The span that just ran is banked and the timer stopped, so the paused
   * gap is not counted toward the take's length.
   */
  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    // Freeze the live scope the instant capture pauses: the analyser stays live
    // (R-B6), so without this a queued rAF would fold a room-tone column into
    // the freeze before the state effect catches up (George R3).
    recordingRef.current = false;
    baseElapsedRef.current += performance.now() - startedAtRef.current;
    clearTick();
    setElapsedMs(baseElapsedRef.current);
    setState("paused");
  }, [clearTick]);

  /** Resume the paused take into the same recording. */
  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    // Re-arm Web Audio in the resume gesture. A pause that spanned an iOS
    // interruption or a backgrounding can leave the shared context suspended or
    // interrupted; the VU tap then reads zeros — an empty strip a translator
    // reads as a dead mic — even though capture is fine. This is the moment iOS
    // allows the un-suspend (a user gesture), so fire it here. Fire-and-forget:
    // the resume must not gate the recorder's own resume (#76).
    void resumeAudioContext().catch((cause: unknown) => {
      console.error("Could not resume the audio context", cause);
    });
    recorder.resume();
    // Re-arm the live-scope push as capture resumes (the ring persists — the
    // scope continues from where it froze, no `reset`).
    recordingRef.current = true;
    startedAtRef.current = performance.now();
    setState("recording");
    startTick();
  }, [startTick]);

  const stop = useCallback(async (): Promise<StopResult> => {
    const recorder = recorderRef.current;
    if (!recorder) return { samples: null, error: null, blob: null };

    // Everything this stop needs is captured HERE, before the first await.
    // The rule the two awaits below force: **the audio belongs to this
    // invocation, the UI state belongs to the current generation.**
    //
    // Stop is the translator confirming a take. A `pagehide` landing while we
    // decode must release the microphone without destroying what they already
    // confirmed — so the chunks and the stream are held as locals. `cancel()`
    // reassigns `chunksRef.current` to a fresh array and clears `streamRef`;
    // neither reaches the array and stream this call is holding. That holds
    // for the still-live `ondataavailable` too, and only because it is bound
    // to the array rather than to the ref — see `start()`.
    const generation = generationRef.current;
    const chunks = chunksRef.current;
    const stream = streamRef.current;
    // OWN the VU tap exactly as the stream is owned (below): steal it into a
    // local and null the ref. Two flush-window races this closes (Frank + George
    // R-B6): (1) a concurrent cancel()/leave()/pagehide runs releaseStream() ->
    // closeTap() during our flush await — reading the ref, it would stop THIS
    // take's clone mid-`dataavailable` and, on a WebKit build where clone-stop
    // reaches the shared source, truncate the final slice; nulling the ref makes
    // that a no-op. (2) an OLDER stop() resuming after a newer recording B
    // installed its tap would close B's tap through the shared ref. disconnect
    // now (readLevel -> 0); the clone tracks are stopped after the flush, on the
    // LOCAL tap.
    const tap = tapRef.current;
    tapRef.current = null;
    tap?.disconnect();
    // This invocation owns teardown now: detach the interruption handlers so a
    // late `error`/`ended` event, delivered after our final `setState`, cannot
    // repaint a stopped recorder back to "processing".
    recorder.onerror = null;
    stream?.getTracks().forEach((track) => (track.onended = null));
    // Take the stream OUT of the shared ref before the flush await. A cancel()
    // (pagehide, navigation, unmount) landing during the wait calls
    // releaseStream(), which stops whatever streamRef holds — and stopping THIS
    // stream mid-flush truncates the final `dataavailable`, which for a
    // sub-timeslice take is the entire recording. Held only as the local
    // `stream`, this stop owns it; cancel() finds the ref already null.
    streamRef.current = null;
    clearTick();
    // The tap is already nulled above, so `readScope` returns null regardless;
    // clearing the flag too keeps the invariant explicit at every stop path.
    recordingRef.current = false;
    setState("processing");

    let blob: Blob;
    // Set only by the flush arm's catch: the tail's empty-capture exit reads it
    // to say "could not finish" rather than "no sound" when the seal is empty
    // because the engine threw, not because the translator was silent.
    let flushThrew = false;
    if (recorder.state === "inactive") {
      // The recorder ended on its OWN — an interruption took the mic (#59), not
      // a stop we drove. There is no `stop()` flush to await, but the recorder
      // flips inactive before its final queued `dataavailable` is delivered — so
      // yield one macrotask to let a tail slice already in flight land in
      // `chunks` before we seal the blob. Then recover it rather than dropping
      // the take. The capture track is already dead; release the stream for the
      // ref bookkeeping.
      if (stream) abandonStream(stream);
      await new Promise((resolve) => setTimeout(resolve, 0));
      blob = new Blob(chunks, { type: recorder.mimeType });
      // The flush window is past — now stop the cloned capture tracks of THIS
      // stop's tap (its graph was disconnected up top). The local `tap`, not
      // closeTap(): a newer recording's tap in the ref must not be touched.
      // Mirrors the `finally` in the other branch below, so both arms release
      // the same way; this arm has nothing that can throw between here and
      // there, so a bare call after the blob is sealed is equivalent to a
      // `finally` and needs none.
      tap?.close();
    } else {
      // Hoisted out of the executor so the `finally` can clear it. Left
      // scoped to the executor, the timer on the throw path would fire up to
      // five seconds later, build a Blob nobody awaits and `resolve` an
      // already-rejected promise (a no-op), holding `chunks` reachable for the
      // window (panel r1 on #500). `clearTimeout(undefined)` is a no-op, so
      // the finally can clear it unconditionally.
      let timer: number | undefined;
      try {
        blob = await new Promise<Blob>((resolve) => {
          // Bounded. On the timeout we take whatever the local array already holds
          // — everything MediaRecorder delivered before it stopped answering —
          // rather than waiting for an event that is not coming.
          //
          // Deliberately NOT paired with releasing the tracks the moment `stop()`
          // is invoked: the final `dataavailable` arrives between `stop()` and
          // `onstop`, and killing the capture tracks inside that window is a way
          // to truncate it. That slice is the whole recording for a take under one
          // timeslice, which is the loss this module's chunk ownership exists to
          // prevent. The microphone is released immediately after this await and
          // before the decode, so bounding the wait bounds the hot mic too.
          const finish = () =>
            resolve(new Blob(chunks, { type: recorder.mimeType }));
          timer = window.setTimeout(finish, STOP_FLUSH_TIMEOUT_MS);
          recorder.onstop = () => {
            clearTimeout(timer);
            finish();
          };
          // Bare, deliberately: guarding IT would mean branching on
          // `recorder.state` afterward to decide whether to seal now or keep
          // waiting for `onstop`/the timer — correctness that depends on the
          // recorder's post-throw state, which is neither observed on a
          // device nor simulable in this Node-only suite (no `MediaRecorder`).
          // That is the J7 shape rounds 3 and 4 oscillated on; the round-5 cap
          // decision left it out. The `finally` below is the J6 shape instead
          // — it reasons about nothing beyond the stream and tap this
          // invocation already owns, so it stays correct regardless of that
          // unobservable state.
          recorder.stop();
        });
      } catch (cause) {
        // The catch is on the AWAIT, not on the executor's `recorder.stop()`
        // (which stays bare, above): once the executor throws there is no
        // `onstop` left to await, so nothing here depends on the recorder's
        // post-throw state (J6, not J7) — this branch reasons only about the
        // recorder ref THIS invocation captured at the top of `stop()` and the
        // `chunks`/`mimeType` locals the timeout arm already relies on.
        // Without it the throw rode out of `stop()` with React state left at
        // "processing" (set above, never cleared) and `recorderRef` still
        // holding the dead recorder — so the sheet stayed `busy`, the status
        // Notice read "Recording finished" over a take that was gone, every
        // Back stayed, and a later `start()` returned early on the zombie ref
        // without opening a mic (#485, George R6 on #474).
        //
        // What is lost on this path is the `onstop` event itself, NOT
        // necessarily every slice: `chunks` holds every `dataavailable`
        // MediaRecorder delivered before the throw (`start(250)` requests one
        // per 250 ms on every engine but the WebKit builds that emit a single
        // blob at stop) — plus, after the one-macrotask yield below, a final
        // slice that was already queued at the moment of the throw. A
        // synchronous throw does not prove `dataavailable`/`stop` were not
        // already queued (Frank r2 P2 on #500), so the catch does not seal
        // immediately; it yields the same one macrotask the inactive arm
        // above yields, THEN seals — the same seal the timeout arm's `finish`
        // builds. It then FALLS THROUGH to the ordinary tail below — an empty
        // seal becomes the notice (with the "could not finish" sentence, via
        // `flushThrew`), an undecodable one is held with its bytes for the
        // recovery panel, a decodable one is the take — instead of returning
        // `blob: null` and discarding minutes of audio that were in this
        // closure (panel r1 P2 on #500). The tail also owns
        // `setState("idle")`, gated on `current` exactly as at every other
        // exit, so a superseded throw-path stop paints nothing.
        //
        // Timing, precisely: this catch resumes one microtask AFTER the
        // executor throws (an `await` on an already-rejected promise still
        // yields), so the caller's synchronous continuation — and a React
        // sync-lane commit it queued — can run first. Nothing that installs a
        // recorder can land in that window regardless: `start()` needs two
        // real awaits (`getUserMedia`, `raceAudioResume`) before it assigns
        // the ref, and `cancel()` is reached only from a `pagehide` handler
        // or an unmount commit (macrotasks). The ref is still nulled only
        // while it is THIS recorder, mirroring `abandonStream`'s
        // `streamRef.current === stream`, so the guard holds even if a future
        // await lands before this `try`.
        //
        // Reported, not swallowed: this arm exists as insurance against an
        // engine departing from the spec, and it is the one event that could
        // turn "unobserved on any device" into observed — a row under
        // `"recorder-stop-flush"` with `console.error` kept beside it, the
        // same shape as `cancel()`'s `"recorder-cancel-stop"` guard and
        // `stopRecording`'s `"recorder-stop-backstop"` (AGENTS.md "Errors have
        // a channel"). `stopRecording`'s backstop is NOT entered for this
        // path (the failure rides the `StopResult`, honouring its "never
        // rejects" contract), so without this report the throw would leave
        // no evidence anywhere.
        reportFailure(cause, "recorder-stop-flush");
        console.error("Stopping the recorder failed", cause);
        if (recorderRef.current === recorder) recorderRef.current = null;
        flushThrew = true;
        // Same order as the inactive arm above: stop the stolen tracks, yield
        // one macrotask, seal; the tap closes after the seal, in `finally`
        // below (George r2 on #500, G-R2-P2-1; DRI decision 2026-09-19,
        // option A — this order, no new theory). `abandonStream` is safe to
        // call again from `finally`: `track.stop()` on an already-stopped
        // track is a spec no-op, and the ref check is identity-gated, so the
        // second call is inert.
        if (stream) abandonStream(stream);
        // One macrotask, same bound as the inactive arm and the timeout arm's
        // `finish`, so a slice already queued at the moment of the throw has
        // a window to land in `chunks` before the seal (Frank r2 P2 on #500).
        await new Promise((resolve) => setTimeout(resolve, 0));
        blob = new Blob(chunks, { type: recorder.mimeType });
      } finally {
        // The `catch` above owns the recorder ref and the seal; this `finally`
        // owns the timer, the stream and the tap, and runs after the catch
        // body and before the tail below — on the normal path, the throw path
        // and the timeout path alike.
        //
        // A `finally`, not a bare release after the await: once the executor
        // itself throws there is no `onstop` left to come, so releasing here
        // cannot truncate a final slice the way releasing before `onstop`/the
        // timer fires would (the very thing the executor's own bound exists
        // to avoid). What a bare release-after-await would cost instead is a
        // hot microphone: `stop()` stole the stream and the VU tap's clone
        // out of the shared refs before this await (`streamRef.current =
        // null` / `tapRef.current = null`, above), so a `cancel()` landing
        // after a throw here finds both refs already null and its
        // `releaseStream()` releases neither — the original tracks AND the VU
        // clone stay live for the life of the page (George R5 P2).
        //
        // Reachability, as in `cancel()`'s docblock: the current MediaStream
        // Recording spec's `stop()` algorithm defines no throw at all (step 2
        // is "if state is inactive, abort these steps", not "throw"). No
        // engine in evidence throws from `stop()`. This is insurance against
        // an engine departing from the spec, not a fix for an observed or
        // spec-defined failure.
        //
        // Only our own stream. `releaseStream()` reads the shared ref, which
        // by now may hold a NEWER recording's stream — releasing that would
        // cut off a recording in progress.
        clearTimeout(timer);
        if (stream) abandonStream(stream);
        tap?.close();
      }
    }

    // The shared UI state belongs to the current generation; the failure travels
    // with the result to whoever called stop(). A superseded stop stays silent —
    // a newer recording owns both the state and the screen — so its `error` is
    // null and only a current attempt earns a message to show. The failure is
    // deliberately NOT written to the `error` state: routing it through the
    // result lets the caller place it (a toolbar Notice, not the permission
    // panel) and avoids the stale-closure read that reopened the panel in round
    // 4.
    const current = generation === generationRef.current;

    if (blob.size === 0) {
      if (current) setState("idle");
      return {
        samples: null,
        // An empty seal after the flush arm threw is the engine's failure,
        // not the translator's silence — the same sentence `stopRecording`'s
        // backstop uses, and the one the facilitator runbook names.
        error: current
          ? flushThrew
            ? messages.recordStopFailed
            : messages.recordSilent
          : null,
        blob: null, // nothing was captured — no bytes to keep
      };
    }

    // The whole outcome — emit samples? keep the bytes? which message? — is the
    // pure `classifyStopDecode`, so the load-bearing #106/#165 contract (a decode
    // THROW keeps the bytes even when superseded; a zero-sample decode keeps
    // nothing) is pinned by a Node test rather than living only here (George R3
    // G-3). `current` is re-read after each await, so it reflects a `leave()`/
    // pagehide that landed during the decode.
    try {
      const samples = await decodeToCanonical(blob);
      const current2 = generation === generationRef.current;
      const verdict = classifyStopDecode(
        { decoded: true, sampleCount: samples.length },
        current2
      );
      if (current2) setState("idle");
      return {
        samples: verdict.emitSamples ? samples : null,
        error: stopDecodeMessage(verdict.error),
        blob: verdict.keepBlob ? blob : null,
      };
    } catch {
      const current2 = generation === generationRef.current;
      const verdict = classifyStopDecode({ decoded: false }, current2);
      if (current2) setState("idle");
      return {
        samples: null,
        error: stopDecodeMessage(verdict.error),
        // Kept even when superseded — see `classifyStopDecode` and #165.
        blob: verdict.keepBlob ? blob : null,
      };
    }
  }, [abandonStream, clearTick]);

  const retryDecode = useCallback(
    async (blob: Blob): Promise<RetryDecodeResult> => {
      // Resume synchronously in the gesture that called this, BEFORE the decode's
      // await: a stop that failed because the shared context was left
      // "interrupted" (a call, Siri, a route change — #106) only un-interrupts on
      // a user tap, and iOS spends that activation on the first synchronous Web
      // Audio touch. Fire-and-forget like the record/preview paths — the decode
      // below runs on the same context the resume is waking.
      void resumeAudioContext().catch((cause: unknown) => {
        console.error("Could not resume the audio context", cause);
      });
      try {
        const samples = await decodeToCanonical(blob);
        // A decode to zero samples yields no usable take. On the RETRY path this
        // is NOT proven silence the way it is for `stop()`: the bytes are held
        // only because the FIRST decode THREW, so a later zero-sample decode is
        // ambiguous, and dropping the held take on it would lose the only copy
        // (George R3 G-1). So this is just another retry failure — the caller
        // keeps the bytes and surfaces the message; it never drops them.
        if (samples.length === 0) {
          return { samples: null, error: messages.recordSilent };
        }
        return { samples, error: null };
      } catch {
        return { samples: null, error: messages.recordUndecodable };
      }
    },
    []
  );

  const previewCapture = useCallback(async (): Promise<Int16Array | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return null;
    // Unlock Web Audio in the SAME gesture turn as the Play tap that reaches this
    // synchronously, BEFORE the awaits below: a pause that spanned an iOS
    // interruption or backgrounding leaves the shared context suspended, and iOS
    // will not un-suspend it once the activation is spent — so a preview decoded
    // first, then played, would be silent. Fire-and-forget, like the record and
    // playback paths (#101 / George R1 P3).
    void resumeAudioContext().catch((cause: unknown) => {
      console.error("Could not resume the audio context", cause);
    });
    // Snapshot before the awaits, exactly as `stop()` does: the audio belongs to
    // this invocation, so a cancel()/leave() reassigning `chunksRef` mid-decode
    // cannot divert it. A superseded generation returns null (silent), never a
    // preview a newer recording would own.
    const generation = generationRef.current;
    const chunks = chunksRef.current;
    // Flush any slice MediaRecorder is still buffering, so the preview includes
    // the audio right up to the pause. `requestData` is valid while paused and
    // fires `dataavailable` synchronously-ish; a macrotask lets it land. Some
    // implementations reject it outside "recording" — then we preview the chunks
    // already in hand, which is only the last sub-250 ms slice short.
    try {
      recorder.requestData();
    } catch {
      // requestData unsupported in this state — decode what already arrived.
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Only decode a take that is STILL this recorder and STILL paused. A Back
    // (which runs stop()) or a Resume during the flush wait means stop() or a new
    // span owns the chunks now — decoding them here would run a second
    // decodeToCanonical + PCM allocation in parallel with stop()'s, doubling the
    // main-thread cost and memory on the low-end device the save path guards
    // (George R3 #2). This closes the pre-decode window; a decode already in
    // flight cannot be aborted (decodeAudioData has no cancel), but the caller's
    // epoch drops its result.
    if (
      generation !== generationRef.current ||
      recorderRef.current !== recorder ||
      recorder.state !== "paused"
    ) {
      return null;
    }
    if (chunks.length === 0) return null;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (blob.size === 0) return null;
    try {
      const samples = await decodeToCanonical(blob);
      // Re-check ownership AND paused-state after the decode, not just generation:
      // `resume()`/`stop()` do not bump `generationRef`, so a Resume or Back landing
      // DURING the decode must still resolve null — the documented contract a future
      // hook caller relies on, not only the component's epoch (Frank R8).
      if (
        generation !== generationRef.current ||
        recorderRef.current !== recorder ||
        recorder.state !== "paused"
      ) {
        return null;
      }
      // Zero samples is nothing to preview — same class as an undecodable blob.
      return samples.length > 0 ? samples : null;
    } catch (cause: unknown) {
      // An undecodable partial container (device-dependent, chiefly iOS fMP4
      // before its moov atom). Not this hook's error state: the caller degrades
      // Play to disabled. Logged, not surfaced — console is the diagnostic here,
      // and the `cause` is what tells "this device can't preview" from a real
      // decoder bug in the field (#130).
      console.error("Could not decode the take for preview", cause);
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    generationRef.current++;
    clearTick();
    // Stop the live-scope push before the stream is torn down (releaseStream
    // nulls the tap too, but keep the flag consistent with the other exits).
    recordingRef.current = false;
    const recorder = recorderRef.current;
    // Guarded because of the casualty a throw here would cause, not because
    // one has been observed: an uncaught throw would skip `releaseStream()`
    // on the next line and propagate out of `cancel()` into `leave()`, whose
    // whole contract is "synchronous and total … the microphone has to be
    // released in the same task as the tap". `cancel()` is what `pagehide`,
    // navigation and unmount all reach, so a throw would leave a hot
    // microphone on a page that is going away — and the take is being
    // abandoned regardless, so there is nothing to weigh against releasing
    // the mic.
    //
    // Reachability, honestly: the current MediaStream Recording spec's
    // `stop()` algorithm defines NO throw at all — step 2 is "if state is
    // inactive, abort these steps", not "throw" (the `state !== "inactive"`
    // test above already makes that step moot here regardless). No engine in
    // evidence throws from `stop()` while active or otherwise. This guard is
    // insurance against an engine departing from the spec, not a fix for a
    // spec-defined or observed failure.
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (cause) {
        reportFailure(cause, "recorder-cancel-stop");
      }
    }
    releaseStream();
    chunksRef.current = [];
    setElapsedMs(0);
    setState("idle");
    // Cancelling is now also how navigation abandons a take, so a permission
    // failure must not follow the translator to the next screen and read as a
    // fresh one. Nothing else clears it that `start()` does not already clear.
    setError(null);
  }, [clearTick, releaseStream]);

  // Re-arm Web Audio when the app returns to the foreground mid-take (#76).
  // Extracted to `armForegroundResume` so its two guards (recording, visible) and
  // the add/remove-listener wiring are unit-testable in Node with no renderer,
  // the way `resumeAudioContext` itself is — `tests/foreground-resume.test.ts`
  // mutates each guard to prove it. The effect is the one-line call plus the
  // `[state]` dependency: browser-boundary wiring whose guards are Node-tested,
  // but the effect actually firing and iOS gesture-withholding are the on-device
  // pass for #76 — NOT yet run on any device.
  useEffect(() => armForegroundResume(state === "recording"), [state]);

  // Never leave the microphone hot if the screen unmounts mid-recording.
  useEffect(() => () => cancel(), [cancel]);

  return {
    state,
    supported,
    elapsedMs,
    error,
    start,
    pause,
    resume,
    stop,
    retryDecode,
    previewCapture,
    cancel,
    readLevel,
    readMeterAvailable,
    readScope,
    peekScope,
    meterFailed,
  };
}
