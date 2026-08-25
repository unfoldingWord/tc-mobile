import { useCallback, useEffect, useRef, useState } from "react";

import {
  decodeToCanonical,
  isRecordingSupported,
  pickMimeType,
  resumeAudioContext,
} from "./audio-io";

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
   * Open the microphone. Resolves `true` only when capture actually began.
   *
   * The result is the caller's release signal: a refused start (no permission,
   * no device, superseded by a newer start) has to hand back the audio floor
   * on this path rather than through an effect watching for an intermediate
   * `state`, which a React batch can hide.
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
  cancel: () => void;
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

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

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
        setState("processing");
      };
      recorder.onerror = onInterrupted;
      stream.getTracks().forEach((track) => {
        track.onended = onInterrupted;
      });

      recorder.start(250);
      startedAtRef.current = performance.now();
      baseElapsedRef.current = 0;
      setElapsedMs(0);
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
  }, [abandonStream, clearTick, releaseStream, startTick, supported]);

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
    baseElapsedRef.current += performance.now() - startedAtRef.current;
    clearTick();
    setElapsedMs(baseElapsedRef.current);
    setState("paused");
  }, [clearTick]);

  /** Resume the paused take into the same recording. */
  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
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
    // Take the stream OUT of the shared ref before the flush await. A cancel()
    // (pagehide, navigation, unmount) landing during the wait calls
    // releaseStream(), which stops whatever streamRef holds — and stopping THIS
    // stream mid-flush truncates the final `dataavailable`, which for a
    // sub-timeslice take is the entire recording. Held only as the local
    // `stream`, this stop owns it; cancel() finds the ref already null.
    streamRef.current = null;
    clearTick();
    setState("processing");

    let blob: Blob;
    if (recorder.state === "inactive") {
      // The recorder ended on its OWN — an interruption took the mic (#59), not
      // a stop we drove. There is no flush to await: whatever it delivered
      // before it died is already in `chunks` and is final. Assemble and recover
      // it rather than dropping the take. The capture track is already dead;
      // release the stream for the ref bookkeeping.
      if (stream) abandonStream(stream);
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

  const cancel = useCallback(() => {
    generationRef.current++;
    clearTick();
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
    cancel,
  };
}
