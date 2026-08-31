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

/**
 * Which AudioContext states need a `resume()` to become audible.
 *
 * Pure and exported so the one bit of logic that decides audibility is unit-
 * tested without a Web Audio mock (the rest of this module is browser-only).
 *
 * The states are the standard three — `"suspended" | "running" | "closed"` —
 * plus WebKit's non-standard fourth, `"interrupted"`, entered on an OS audio
 * interruption (a call, Siri, a route change) and on backgrounding. A context
 * left `"interrupted"` plays every subsequent source SILENTLY with no error and
 * no rejection, for the life of the page — the iOS silent-playback report. So
 * the rule is "anything that is not already running and is still openable needs
 * a resume", which is every state but `"running"` and `"closed"`. Compared as
 * strings, not against the DOM `AudioContextState` union, because `"interrupted"`
 * is not in it.
 */
export function contextNeedsResume(state: string): boolean {
  return state !== "running" && state !== "closed";
}

export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (contextNeedsResume(ctx.state)) await ctx.resume();
}

/** A live level tap on a capture stream, for the recorder's VU meter. */
export interface LevelTap {
  /**
   * The current raw capture amplitude in [0, 1] (RMS of the latest frame), the
   * domain `@/lib/audio/meter`'s `toDisplayLevel` maps from. Returns 0 once the
   * tap is closed, so a stale read after teardown is silent, not a throw.
   */
  read: () => number;
  /**
   * The analyser's latest time-domain frame (the same reused buffer `read()`
   * measures its RMS from), or `null` once the tap is disconnected. The
   * live-waveform scope reduces this to one column per animation frame (#120),
   * while `read()` stays the VU meter's RMS pull. Returns the REUSED buffer, so
   * copy what you need synchronously (as `reduceFrame` does) — the next call
   * overwrites it. Reading the frame here rather than opening a second tap keeps
   * the scope and the meter on ONE analyser (iOS caps `AudioContext`s).
   */
  readFrame: () => Float32Array | null;
  /**
   * Disconnect the graph so `read()` returns 0, but LEAVE the cloned capture
   * tracks live. Safe to call inside the MediaRecorder flush window (between
   * `stop()` and `onstop`): stopping any capture track there can truncate the
   * final `dataavailable`. Idempotent.
   */
  disconnect: () => void;
  /**
   * Full teardown: disconnect the graph (if not already) AND stop the cloned
   * capture tracks. Use once the flush window is safely past (`stop()`), or where
   * the take is being abandoned outright (cancel/leave). NOT on the #59
   * interruption path, which freezes to `processing` and recovers the chunks via
   * `stop()` — there the graph is only `disconnect()`ed. Never closes the shared
   * context, which outlives it.
   */
  close: () => void;
}

/**
 * Open a read-only level tap on a live capture stream.
 *
 * The Web Audio graph stays inside this boundary; the meter math is imported
 * from `lib/`, so the pure part is unit-tested and this file only wires the
 * `AnalyserNode`. Two WebKit-driven decisions, both owed an iOS on-device check
 * (George R-B6):
 *
 *   - The tap reads a CLONE of the capture stream, not the stream MediaRecorder
 *     owns. Some WebKit builds have produced silent or truncated takes when an
 *     analyser's `MediaStreamSource` shares the recorder's stream. The clone
 *     carries the same microphone input, so the meter is unaffected, but the
 *     recorder is fully isolated from the graph — the meter can never cost a
 *     recording, which is the one thing it must never do.
 *   - The graph terminates at `destination` through a SILENCED gain. WebKit does
 *     not pull an `AnalyserNode` unless the graph reaches `destination` (Chrome
 *     pulls a dangling analyser; Safari returns zeros), so a mic-only connection
 *     leaves the strip dead on iOS. `gain = 0` keeps the graph live with no
 *     audible monitor — no feedback, because nothing reaches the speaker.
 *
 * The analyser reads the time-domain frame into one reused buffer, so a
 * per-frame `read()` allocates nothing.
 */
export function createLevelTap(stream: MediaStream): LevelTap {
  const ctx = getAudioContext();
  const tapStream = stream.clone();

  // Disconnect one node, tolerating a node that was never connected — Web Audio
  // throws on a redundant disconnect and there is nothing to do about it. Each
  // node is torn down independently so one failure does not skip the rest.
  const disconnect = (node: AudioNode | undefined) => {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      // Already disconnected / never connected — nothing to do.
    }
  };
  // Stop the cloned tracks; the recorder's own stream is left untouched.
  const stopClone = () => tapStream.getTracks().forEach((t) => t.stop());

  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let sink: GainNode | undefined;
  try {
    source = ctx.createMediaStreamSource(tapStream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // source -> analyser -> gain(0) -> destination. The silenced gain terminates
    // the graph so WebKit processes the analyser, without monitoring the mic.
    sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(ctx.destination);
  } catch (cause) {
    // Own-before-fallible: the clone was taken before these fallible calls, so a
    // throw here must not leak a hot microphone. Tear down whatever was built,
    // stop the cloned tracks, and rethrow for the caller's meterless fallback.
    disconnect(source);
    disconnect(analyser);
    disconnect(sink);
    stopClone();
    throw cause;
  }

  if (!source || !analyser || !sink) {
    // Unreachable — the catch above rethrows on any failure — but this satisfies
    // definite-assignment and cleans up if a node came back falsy.
    disconnect(source);
    disconnect(analyser);
    disconnect(sink);
    stopClone();
    throw new Error("Level tap graph did not initialise");
  }

  const graph = analyser;
  const frame = new Float32Array(graph.fftSize);
  let disconnected = false;

  // Tear down only this tap's own nodes; the shared context stays open for
  // playback and the next recording. Idempotent.
  const disconnectGraph = () => {
    if (disconnected) return;
    disconnected = true;
    disconnect(source);
    disconnect(analyser);
    disconnect(sink);
  };

  return {
    read: () => {
      if (disconnected) return 0;
      graph.getFloatTimeDomainData(frame);
      return rmsLevel(frame);
    },
    readFrame: () => {
      // An interrupted/suspended context (iOS backgrounding or a call — #76,
      // the same state #107 resumes) makes the analyser read all-zeros with no
      // error, and nothing resumes it mid-take. Return null rather than a silent
      // frame so the live scope freezes its last frame instead of scrolling the
      // shown speech off into a flat line a non-reader takes for a dead mic
      // (George R5). NOT an all-zero-frame check — that would freeze on real
      // silence too.
      if (disconnected || contextNeedsResume(ctx.state)) return null;
      graph.getFloatTimeDomainData(frame);
      return frame;
    },
    disconnect: disconnectGraph,
    close: () => {
      // Disconnect the graph (if not already), THEN stop the cloned tracks.
      disconnectGraph();
      stopClone();
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
  options: {
    offsetSeconds?: number;
    onEnded?: () => void;
    /**
     * Re-checked AFTER the resume await, just before any node is built. A play
     * claim can be superseded (a Stop, a competing take, a mic claim) during
     * `resumeAudioContext` — which on iOS is a real await that also un-suspends a
     * suspended/interrupted context. Without this the source starts and is only
     * then stopped by the caller's `settle`, a sub-perceptible start-then-stop,
     * worst case an audible click on iOS after the resume. Bailing here means
     * nothing ever sounds.
     *
     * REQUIRED, not optional: every playback claims the floor and holds a token,
     * so there is always a supersession predicate to pass. An optional callback
     * that a future caller forgot would silently restore the #104 start-then-stop
     * (the sink would wait out `resume()` and start a source `settle` then kills).
     * A caller with genuinely no token passes `() => true`. Both `playTake` and
     * `playBuffer` pass `() => session.isCurrent(token)`, so the guard lives once
     * in the shared sink (#104, George R1).
     */
    isStillCurrent: () => boolean;
  }
): Promise<PlaybackHandle> {
  await resumeAudioContext();

  if (!options.isStillCurrent()) {
    // Superseded during the resume await. Return an inert handle before building
    // any node — nothing is created, nothing reaches `ctx.destination`, nothing
    // sounds. The caller's `settle` stops it (a no-op) and discards it; `onEnded`
    // is deliberately not called, since nothing started and the newer claim owns
    // the UI state now.
    return { stop: () => {}, elapsed: () => 0, duration: 0 };
  }

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
