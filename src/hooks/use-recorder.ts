import { useCallback, useEffect, useRef, useState } from "react";

import {
  type CapturePeaks,
  type CaptureScope,
  createCapturePeaks,
} from "@/lib/audio/capture-peaks";

import {
  createLevelTap,
  decodeToCanonical,
  isRecordingSupported,
  type LevelTap,
  pickMimeType,
  resumeAudioContext,
} from "./audio-io";

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
   * an empty capture or an undecodable one. Null when there is nothing to say:
   * a superseded stop, whose UI belongs to a newer recording.
   */
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
   * reason it produced none. The failure is in the result, not the `error`
   * state — see `StopResult`.
   */
  stop: () => Promise<StopResult>;
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
   * `readLevel`, polled on the meter's own frame clock: false while nothing is
   * capturing, and false mid-take while the shared context is not `"running"`
   * (iOS `"suspended"`/`"interrupted"` after backgrounding or an interruption),
   * where the analyser reads zeros indistinguishable from a dead mic. The meter
   * hatches "unavailable" on a false rather than resting empty (#76). Distinct
   * from `meterFailed`, which is the OPEN-time "tap never wired" state; this is
   * the per-frame runtime state a wired tap can still fall into.
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

  // Whether that level can be trusted this frame (#76). No tap (idle, or a
  // meterFailed take) is not trustworthy — false; but the meter only surfaces
  // "unavailable" while `active` (recording), so a false at idle rests empty as
  // before. A wired tap defers to its own live context-state check.
  const readMeterAvailable = useCallback(
    (): boolean => tapRef.current?.available() ?? false,
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
      setError("This device cannot record audio.");
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
      await resumeAudioContext();

      // The resume is a real await on the first recording of a session — iOS
      // starts the context suspended — so a `cancel()` from navigation, the
      // pagehide handler or unmount can land here. A `cancel()` has already
      // stopped this stream through `releaseStream`; a newer `start()` has
      // not, which is why the stream is abandoned by identity. Either way no
      // recorder is opened: one started after the teardown would report
      // "recording" with the session floor already released.
      if (generation !== generationRef.current) {
        abandonStream(stream);
        return false;
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
      const onInterrupted = () => {
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
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Could not start recording."
      );
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
    if (!recorder) return { samples: null, error: null };

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
    } else {
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
        const timer = window.setTimeout(finish, STOP_FLUSH_TIMEOUT_MS);
        recorder.onstop = () => {
          clearTimeout(timer);
          finish();
        };
        recorder.stop();
      });

      // Only our own stream. `releaseStream()` reads the shared ref, which by now
      // may hold a NEWER recording's stream — releasing that would cut off a
      // recording in progress.
      if (stream) abandonStream(stream);
    }

    // The flush window is past — now stop the cloned capture tracks of THIS
    // stop's tap (its graph was disconnected up top). The local `tap`, not
    // closeTap(): a newer recording's tap in the ref must not be touched.
    tap?.close();

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
        error: current ? "No sound was recorded. Try again." : null,
      };
    }

    try {
      const samples = await decodeToCanonical(blob);
      const decodedCurrent = generation === generationRef.current;
      // Returned even when superseded: these are confirmed samples, and the
      // caller decides what to do with them. Only the shared UI state is
      // withheld, because a newer recording owns it now.
      if (decodedCurrent) setState("idle");
      // A successful decode to ZERO samples is "no sound" too — same class as an
      // empty blob, not a usable take. Classified here, at the source, so a
      // caller keying on `samples.length` never gets a non-null empty buffer
      // paired with a null error (which showed no message at all — F7).
      if (samples.length === 0) {
        return {
          samples: null,
          error: decodedCurrent ? "No sound was recorded. Try again." : null,
        };
      }
      return { samples, error: null };
    } catch {
      const stillCurrent = generation === generationRef.current;
      if (stillCurrent) setState("idle");
      return {
        samples: null,
        error: stillCurrent
          ? "Recording could not be decoded on this device."
          : null,
      };
    }
  }, [abandonStream, clearTick]);

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
    if (recorder && recorder.state !== "inactive") recorder.stop();
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
  // Returning from an iOS backgrounding or an OS interruption can leave the
  // shared context "suspended"/"interrupted", so the VU tap reads zeros even
  // though capture is fine. The `resume()` gesture already covers a manual
  // pause→resume; this covers a return that is NOT a resume tap — a background
  // then foreground with capture still live. Only while recording: a paused or
  // idle recorder has no live meter to rescue, and `resume()` owns the paused
  // edge. Fire-and-forget — the resume must never gate anything — and best
  // effort: iOS MAY withhold the un-suspend until the next real user gesture, in
  // which case the meter stays honestly hatched (`available()` -> false) until a
  // tap. That withholding is the open device question the iOS pass settles.
  useEffect(() => {
    if (state !== "recording") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void resumeAudioContext().catch((cause: unknown) => {
        console.error(
          "Could not resume the audio context on foreground",
          cause
        );
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state]);

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
    previewCapture,
    cancel,
    readLevel,
    readMeterAvailable,
    readScope,
    peekScope,
    meterFailed,
  };
}
