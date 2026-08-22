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
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      setError("This device cannot record audio.");
      return;
    }
    setError(null);
    setState("requesting");
    const generation = ++generationRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Speech in a noisy room, recorded on a phone held in the hand.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Unlock Web Audio while we still have the user gesture that started
      // this recording — iOS will not resume the context later without one.
      await resumeAudioContext();

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
      releaseStream();
      setState("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : "Could not start recording."
      );
    }
  }, [releaseStream, supported]);

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
  }, [clearTick, releaseStream]);

  // Never leave the microphone hot if the screen unmounts mid-recording.
  useEffect(() => () => cancel(), [cancel]);

  return { state, supported, elapsedMs, error, start, stop, cancel };
}
