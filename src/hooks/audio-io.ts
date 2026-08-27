/**
 * Browser audio I/O — the only module that talks to MediaRecorder, Web Audio,
 * and getUserMedia.
 *
 * Everything below `hooks/` is deliberately free of these APIs so the audio
 * core stays unit-testable in Node. The device-specific mess is concentrated
 * here.
 */

import {
  CANONICAL_CHANNELS,
  CANONICAL_SAMPLE_RATE,
  floatToInt16,
  int16ToFloat,
} from "@/lib/audio/format";
import { rmsLevel } from "@/lib/audio/meter";

/**
 * Candidate capture formats, best first.
 *
 * The mp4/aac entries are load-bearing: iOS Safari's MediaRecorder does not
 * support webm or ogg at all, so a webm-only list silently yields a recorder
 * that produces nothing usable on roughly half the target devices. The spec
 * requires Android *and* iOS.
 */
const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
] as const;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "mediaDevices" in navigator &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    "MediaRecorder" in window
  );
}

/**
 * Pick a capture MIME type this device actually supports.
 *
 * Returns `undefined` rather than a guess when nothing matches: passing an
 * unsupported type to the MediaRecorder constructor throws, whereas passing
 * no type lets the browser choose its own default, which is the better
 * fallback.
 */
export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!ctor) throw new Error("Web Audio is not available on this device");
  return ctor;
}

let sharedContext: AudioContext | null = null;

/**
 * A single shared AudioContext.
 *
 * iOS caps the number of AudioContexts a page may create and starts them
 * suspended until a user gesture, so creating one per playback both leaks and
 * silently fails. One context, resumed on demand, avoids both.
 */
function getAudioContext(): AudioContext {
  sharedContext ??= new (getAudioContextCtor())();
  return sharedContext;
}

export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume();
}

/** A live level tap on a capture stream, for the recorder's VU meter. */
export interface LevelTap {
  /**
   * The current raw capture amplitude in [0, 1] (RMS of the latest frame), the
   * domain `@/lib/audio/meter`'s `toDisplayLevel` maps from. Returns 0 once the
   * tap is closed, so a stale read after teardown is silent, not a throw.
   */
  read: () => number;
  /** Disconnect the tap. Never closes the shared context, which outlives it. */
  close: () => void;
}

/**
 * Open a read-only level tap on a live capture stream.
 *
 * The Web Audio graph stays inside this boundary; the meter math is imported
 * from `lib/`, so the pure part is unit-tested and this file only wires the
 * `AnalyserNode`. The source is connected to the analyser and to NOTHING else —
 * in particular not to `ctx.destination`, which would route the microphone back
 * out of the speakers as a feedback loop. The analyser reads the time-domain
 * frame into one reused buffer, so a per-frame `read()` allocates nothing.
 */
export function createLevelTap(stream: MediaStream): LevelTap {
  const ctx = getAudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  // source -> analyser ONLY. Never analyser -> destination: that is a mic
  // monitored to the speaker, i.e. feedback.
  source.connect(analyser);

  const frame = new Float32Array(analyser.fftSize);
  let closed = false;

  return {
    read: () => {
      if (closed) return 0;
      analyser.getFloatTimeDomainData(frame);
      return rmsLevel(frame);
    },
    close: () => {
      if (closed) return;
      closed = true;
      // Tear down only this tap's own nodes; the shared context stays open for
      // playback and the next recording.
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // Already disconnected — Web Audio throws on a redundant disconnect and
        // there is nothing to do about it.
      }
    },
  };
}

/**
 * Decode captured audio of whatever codec the device produced into the
 * canonical format: mono, 16-bit, CANONICAL_SAMPLE_RATE.
 *
 * Normalising here is what lets `lib/audio` treat every clip as
 * interchangeable — concatenating an iPhone's aac take with an Android's opus
 * take is a buffer join, not a codec problem.
 */
export async function decodeToCanonical(blob: Blob): Promise<Int16Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await getAudioContext().decodeAudioData(arrayBuffer);
  return toCanonical(decoded);
}

async function toCanonical(buffer: AudioBuffer): Promise<Int16Array> {
  const alreadyCanonical =
    buffer.sampleRate === CANONICAL_SAMPLE_RATE &&
    buffer.numberOfChannels === CANONICAL_CHANNELS;

  if (alreadyCanonical) {
    return floatToInt16(buffer.getChannelData(0));
  }

  // OfflineAudioContext does the resample and the downmix in one pass, and
  // does it in optimised native code rather than a hand-rolled JS resampler.
  const frames = Math.max(
    1,
    Math.ceil(
      (buffer.duration * CANONICAL_SAMPLE_RATE * buffer.sampleRate) /
        buffer.sampleRate
    )
  );
  const offline = new OfflineAudioContext(
    CANONICAL_CHANNELS,
    frames,
    CANONICAL_SAMPLE_RATE
  );
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return floatToInt16(rendered.getChannelData(0));
}

/** Wrap canonical PCM in an AudioBuffer for playback. */
function toAudioBuffer(
  samples: Int16Array,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): AudioBuffer {
  const ctx = getAudioContext();
  const buffer = ctx.createBuffer(
    CANONICAL_CHANNELS,
    Math.max(1, samples.length),
    sampleRate
  );
  buffer.copyToChannel(int16ToFloat(samples), 0);
  return buffer;
}

export interface PlaybackHandle {
  stop: () => void;
  /** Seconds elapsed since playback started, clamped to the clip duration. */
  elapsed: () => number;
  readonly duration: number;
}

/** Play canonical PCM, optionally from an offset. Returns a stop handle. */
export async function playSamples(
  samples: Int16Array,
  options: { offsetSeconds?: number; onEnded?: () => void } = {}
): Promise<PlaybackHandle> {
  await resumeAudioContext();
  const ctx = getAudioContext();
  const buffer = toAudioBuffer(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  const offset = Math.max(
    0,
    Math.min(options.offsetSeconds ?? 0, buffer.duration)
  );
  const startedAt = ctx.currentTime;
  let stopped = false;

  source.onended = () => {
    if (!stopped) options.onEnded?.();
  };
  source.start(0, offset);

  return {
    stop: () => {
      stopped = true;
      try {
        source.stop();
      } catch {
        // Already stopped — Web Audio throws on a second stop() call and
        // there is nothing meaningful to do about it.
      }
    },
    elapsed: () =>
      Math.min(buffer.duration, offset + (ctx.currentTime - startedAt)),
    duration: buffer.duration,
  };
}
