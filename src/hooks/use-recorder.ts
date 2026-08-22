import { useCallback, useEffect, useRef, useState } from "react";

import {
  decodeToCanonical,
  isRecordingSupported,
  pickMimeType,
  resumeAudioContext,
} from "./audio-io";

export type RecorderState = "idle" | "requesting" | "recording" | "processing";

export interface UseRecorder {
  readonly state: RecorderState;
  readonly supported: boolean;
  readonly elapsedMs: number;
  readonly error: string | null;
  start: () => Promise<void>;
  /** Stop and return the captured audio as canonical mono 16-bit PCM. */
  stop: () => Promise<Int16Array | null>;
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

  const start = useCallback(async () => {
    if (!supported) {
      setError("This device cannot record audio.");
      return;
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
        return;
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
        return;
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.start(250);
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      setState("recording");

      tickRef.current = window.setInterval(() => {
        setElapsedMs(performance.now() - startedAtRef.current);
      }, 100);
    } catch (cause) {
      if (stream) abandonStream(stream);
      // A `cancel()` or a newer `start()` owns the state and the message now.
      // Reporting this failure over theirs is the stale-message problem
      // `cancel()` clears `error` to avoid.
      if (generation !== generationRef.current) return;
      releaseStream();
      setState("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Could not start recording."
      );
    }
  }, [abandonStream, releaseStream, supported]);

  const stop = useCallback(async (): Promise<Int16Array | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return null;

    const generation = generationRef.current;
    clearTick();
    setState("processing");

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.stop();
    });

    releaseStream();

    if (generation !== generationRef.current || blob.size === 0) {
      setState("idle");
      return null;
    }

    try {
      const samples = await decodeToCanonical(blob);
      // Decoding awaits, so a cancel() — or a newer recording — can land here.
      // Returning samples from a superseded stop hands a take to a caller that
      // has already moved on, and sets state on a recorder it no longer owns.
      if (generation !== generationRef.current) return null;
      setState("idle");
      return samples;
    } catch {
      setState("idle");
      setError("Recording could not be decoded on this device.");
      return null;
    }
  }, [clearTick, releaseStream]);

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

  return { state, supported, elapsedMs, error, start, stop, cancel };
}
