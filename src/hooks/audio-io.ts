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
  canonicalFrameCount,
  floatToInt16,
  INT16_MAX,
  int16ToFloatInto,
} from "@/lib/audio/format";
import { measureLevel } from "@/lib/audio/level";
import { meterReadable, rmsLevel } from "@/lib/audio/meter";

import { type ProbeSource, withAudioProbe } from "./audio-probe";
import { reportFailure } from "./report-failure";

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
 * A single shared AudioContext, PINNED to the canonical rate.
 *
 * iOS caps the number of AudioContexts a page may create and starts them
 * suspended until a user gesture, so creating one per playback both leaks and
 * silently fails. One context, resumed on demand, avoids both.
 *
 * The rate is not cosmetic (#175). `decodeAudioData` resamples to the context's
 * rate, so a context left at the device default — 48 kHz on a typical phone —
 * made `toCanonical` render EVERY take and every stored clip through an
 * `OfflineAudioContext`, a whole-clip copy on top of the two playback already
 * held. Asking for `CANONICAL_SAMPLE_RATE` lands the decode already canonical
 * and that copy disappears.
 *
 * Best-effort, never fatal: Safari before 14.1 throws `NotSupportedError` on the
 * `sampleRate` option, and a device may refuse the rate outright. Those fall
 * back to a default context, where `toCanonical`'s resample path — still there,
 * unchanged — does the conversion as before.
 */
function getAudioContext(): AudioContext {
  sharedContext ??= createSharedContext();
  return sharedContext;
}

function createSharedContext(): AudioContext {
  const Ctor = getAudioContextCtor();
  try {
    return new Ctor({ sampleRate: CANONICAL_SAMPLE_RATE });
  } catch {
    // The rate was refused, not the context. Swallowed deliberately: the
    // fallback is a fully working context whose decodes take the resample path.
    return new Ctor();
  }
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

/**
 * How long a caller of `resumeAudioContext()` is willing to block before
 * proceeding anyway.
 *
 * WebKit's `resume()` from an `"interrupted"` `AudioContext` state has been
 * observed to hang indefinitely (#108). An unbounded `await` on that promise
 * between "the floor is claimed" and "the recorder/source actually exists"
 * can leave a caller stuck forever — first found in `start()`
 * (`use-recorder.ts`, between `getUserMedia` and `new MediaRecorder`), and
 * the same shape on the playback path in `playSamples` below (#469).
 *
 * 1000ms is a PROVISIONAL ASSUMPTION, not a measured value — the real
 * distribution of WebKit's resume-from-interrupted latency is unmeasured on
 * any device, which is exactly the open question issue #108 poses. This is
 * the one place to correct it once an on-device pass answers that question.
 * Lives here, not in `use-recorder.ts`, because `playSamples` needs the same
 * bound and `resumeAudioContext` itself already lives in this file — the
 * browser-audio boundary is the natural shared home, and a hook this low
 * (`use-recorder.ts`) importing back FROM a higher hook would be circular.
 */
export const RESUME_TIMEOUT_MS = 1_000;

/**
 * Call `resumeAudioContext()` but never let it block the caller for longer
 * than `RESUME_TIMEOUT_MS` (#108, #469).
 *
 * `resumeAudioContext()` is invoked SYNCHRONOUSLY as the first statement,
 * before the timer or the race promise are even constructed, so a caller
 * still inside the user gesture that unlocked the microphone or claimed
 * playback loses none of that activation to a `.then`/microtask hop.
 *
 * NEVER rejects. A `resume()` that fails fast is treated exactly like one
 * that hangs — swallowed, and the caller proceeds — matching every
 * fire-and-forget `resumeAudioContext()` call site elsewhere in this repo
 * (`void resumeAudioContext().catch(...)`, several in `use-recorder.ts` and
 * `use-audio-session.ts`). A rejection that DECIDES the race's own outcome
 * (arrives before the timer and before any resolve) is reported through
 * `reportFailure` under the CALLER-SUPPLIED `rejectionContextKey` — unless
 * the caller passes `onEarlyRejection`, in which case THAT is called with
 * the cause instead, and reporting it becomes the caller's job. A LATE
 * rejection — arriving after the timer already won the race — is always
 * reported directly through `reportFailure`, regardless of
 * `onEarlyRejection`: nothing else observes it, since the caller
 * (`playSamples`) already threw under the timeout key by the time it lands.
 * Either way this is closer to AGENTS.md's "errors have a channel before
 * they have copy" bar than swallowing it outright or leaving it as an
 * unhandled rejection — but it never reaches this function's own caller as
 * a rejection of `raceAudioResume` itself.
 *
 * `onEarlyRejection` exists for `playSamples` alone. First cut (George
 * round-2 P3): an early rejection there used to write TWO durable rows for
 * one failed Play — this helper's own unconditional "playback-resume" row,
 * then `playSamples`'s fail-closed gate's "playback-resume-unusable" row for
 * the same cause, since the gate's own `audioContextNeedsResume()` re-read is
 * `true` after any rejection (the context never reached `"running"`). A flat
 * "never report from here" flag fixed that, but broke a DIFFERENT case
 * (Frank round-3 P2): `playTake`/`playBuffer` ALSO fire their own
 * fire-and-forget `resumeAudioContext()` call before `playSamples` even
 * runs (the in-gesture unlock, `use-audio-session.ts`) — a SEPARATE
 * `ctx.resume()` invocation on the same shared context. If THAT one wins
 * and leaves the context `"running"` before this claim's own (later)
 * `raceAudioResume` call observes its rejection, `audioContextNeedsResume()`
 * reads `false` and the gate never fires — the rejection was real but ended
 * up silently dropped, with playback proceeding fine. `onEarlyRejection`
 * lets `playSamples` capture the cause instead of swallowing or
 * unconditionally reporting it, and decide once it knows the live context
 * state: fold it into the SAME row as the fail-closed gate when the context
 * is still unusable (one row, not two), or report it on its own,
 * non-throwing, when a concurrent resume elsewhere already made the context
 * usable (so the fact is not lost just because it turned out harmless).
 * `start()` (`use-recorder.ts`) does not pass it, so its own
 * "recorder-start-resume" row on rejection is UNCHANGED in every case. A
 * plain callback, not an options object — an inline `{ ... }` type here
 * would put a brace before the function's own body opens, which breaks this
 * repo's text-shape gates that brace-match a declaration's body from its
 * first `{` (`tests/recorder-resume-race.test.ts`,
 * `tests/recorder-failure-rows.test.ts`'s `bodyAfter`); a bare arrow-function
 * TYPE (`(cause: unknown) => void`) has no such brace.
 *
 * RESOLVES `true` WHEN THE TIMER WON, `false` when `resume()` settled first
 * (either way, resolve or reject). Writes NO row for a timer win: the timer
 * firing is a fact worth logging only in light of what the CALLER decides to
 * do about it — `start()` gates its own "recorder-start-resume-timeout" row
 * behind its own generation check (a Record tap abandoned during the wait
 * must not light the failure log for work nobody is waiting on any more,
 * #498 George R1 P2), and `playSamples` gates its own
 * "playback-resume-timeout" row behind `isStillCurrent()` for the identical
 * reason. Both callers own that decision; this helper has no such state and
 * must not guess at it.
 *
 * Built with a manual `Promise` executor and a local `settled` flag rather
 * than `Promise.race`, so a same-tick or early rejection from
 * `resumeAudioContext()` can never propagate as this function's own
 * rejection before the `.then(resolve, reject)` handler below converts it —
 * `raceAudioResume` must never reject. The timer uses the bare global
 * `setTimeout`/`clearTimeout` (never `window.*`): no DOM global is needed,
 * and it is directly exercisable with `vi.useFakeTimers()` in this repo's
 * jsdom-free, Node-only vitest suite.
 */
export function raceAudioResume(
  rejectionContextKey: string,
  onEarlyRejection?: (cause: unknown) => void
): Promise<boolean> {
  const resumePromise = resumeAudioContext();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      // The timer won. No report from here — see the docblock: the caller
      // owns the decision this fact sits behind.
      resolve(true);
    }, RESUME_TIMEOUT_MS);
    resumePromise.then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(false);
      },
      (cause: unknown) => {
        // A rejection never bounds the race's own outcome — only resolve it
        // if the timer has not already done so. Whether THIS rejection is
        // the one deciding the race matters for `onEarlyRejection` (below):
        // a rejection that arrives once the timer has ALREADY won is a LATE
        // rejection nothing else will ever see — the caller's own flow moved
        // on when the timer settled the race, under the timeout key, not
        // this one — so it is always reported directly, regardless of
        // `onEarlyRejection`, exactly as before that callback existed.
        const decidesTheRace = !settled;
        if (decidesTheRace) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
        if (decidesTheRace && onEarlyRejection) {
          onEarlyRejection(cause);
        } else {
          reportFailure(cause, rejectionContextKey);
        }
      }
    );
  });
}

/**
 * Whether the shared context needs a user gesture to be audible RIGHT NOW. The
 * recorder checks this before auto-playing a preview it decoded outside the tap
 * (#101): a context left `"interrupted"` by a route change or backgrounding
 * during the decode would sound that preview silently (George R9). Reads the live
 * state, so it must be called at the decision point, not cached.
 */
export function audioContextNeedsResume(): boolean {
  return contextNeedsResume(getAudioContext().state);
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
   * Whether this LIVE tap's `read()` can be trusted RIGHT NOW — false once the
   * tap is disconnected, or while the shared `AudioContext` is not `"running"`
   * (iOS `"suspended"`/`"interrupted"` after backgrounding or an interruption).
   * In that state the analyser reads all-zeros with no error, so `read()` returns
   * a level indistinguishable from a dead microphone; the VU meter pulls THIS per
   * frame to hatch "unavailable" instead of resting empty (#76), mirroring the way
   * `readFrame()` returns null so the live scope freezes. Reads the LIVE context
   * state, so it must be called at the decision point (the meter's own frame
   * clock), never cached.
   */
  available: () => boolean;
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
 * Stop every track on `stream`, even when one `stop()` throws (#479).
 *
 * A bare `getTracks().forEach((t) => t.stop())` ends at the first throw: the
 * tracks after it stay live, and the throw escapes into a caller whose
 * contract is a synchronous, total microphone release (`cancel()` and
 * `leave()`). Each throw is reported through the funnel under `context` and
 * the loop moves on; nothing is rethrown, so the caller's own cleanup after
 * this call still runs.
 *
 * `MediaStreamTrack.stop()` is not specified to throw, and no engine has been
 * seen to throw there. This is insurance for a native call on a dying audio
 * stack, the same threat model as `cancel()`'s guarded `recorder.stop()`.
 */
export function stopTracks(stream: MediaStream, context: string): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch (cause) {
      reportFailure(cause, context);
    }
  }
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
  const stopClone = () => stopTracks(tapStream, "recorder-tap-clone-stop");

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
    // The meter's per-frame trust signal (#76). A disconnected tap has no live
    // reading; a live tap on a non-"running" context reads zeros. `meterReadable`
    // is the pure decision, unit-tested in Node — this only supplies the live
    // context state and the disconnected flag the browser owns.
    available: () => !disconnected && meterReadable(ctx.state),
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
export async function decodeToCanonical(
  blob: Blob,
  probeSource: ProbeSource = "capture"
): Promise<Int16Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await getAudioContext().decodeAudioData(arrayBuffer);
  probeDecode(decoded, probeSource);
  return toCanonical(decoded);
}

/**
 * The capture track's settings fields that bear on level, for the opt-in probe
 * (#555's `channelCount` question). Device and group ids are left out: they
 * identify hardware and say nothing about level.
 */
const PROBED_TRACK_SETTINGS = [
  "channelCount",
  "sampleRate",
  "sampleSize",
  "autoGainControl",
  "echoCancellation",
  "noiseSuppression",
  "latency",
] as const;

/** Record what the device granted for a capture stream, when the probe is on. */
export function probeCaptureTrack(stream: MediaStream): void {
  withAudioProbe(() => {
    const tracks = stream.getAudioTracks();
    const granted = tracks[0]?.getSettings() as
      Record<string, unknown> | undefined;
    const settings: Record<string, unknown> = { audioTracks: tracks.length };
    for (const key of PROBED_TRACK_SETTINGS) settings[key] = granted?.[key];
    return { stage: "capture-track", settings };
  });
}

/**
 * Every channel the decoder returned, measured separately and BEFORE the
 * canonical downmix — the reading that shows a two-channel capture with a dead
 * second channel, which the downmix would otherwise fold into a quiet mono
 * take with no trace of why (#555).
 */
function probeDecode(decoded: AudioBuffer, source: ProbeSource): void {
  withAudioProbe(() => {
    const perChannel = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      perChannel.push(measureLevel(decoded.getChannelData(c), 1));
    }
    return {
      stage: "decode",
      source,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      frames: decoded.length,
      perChannel,
    };
  });
}

/**
 * Decode a stored MP3 clip (a finished segment's audio, B8/D3) back to canonical
 * PCM, for playback, export, or editing. The same `decodeAudioData` path a
 * captured take goes through — the browser's decoder is the only MP3 decoder
 * the app has (lamejs encodes only), which is why `lib/` takes decoding as an
 * injected function rather than doing it.
 *
 * NOT the clip as recorded: the decode carries the encoder's priming at its
 * head (1105 samples on a decoder that trims nothing)
 * and granule padding at its tail. EVERY consumer must pass the result through
 * `fitMp3Decode` (`lib/audio/mp3-align.ts`) with the clip's bytes and
 * `frameCount` — the chapter export, playback and the recorder's edit buffer
 * all do — or the recording plays late and, once saved, loses its last ~25 ms.
 */
export async function decodeMp3ToCanonical(
  mp3: Uint8Array<ArrayBuffer>
): Promise<Int16Array> {
  return decodeToCanonical(
    new Blob([mp3], { type: "audio/mpeg" }),
    "stored-mp3"
  );
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
  const frames = canonicalFrameCount(buffer.duration, buffer.sampleRate);
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

/**
 * How many frames one playback fill window holds: one second of canonical audio,
 * 176 KB as Float32.
 *
 * The window is the whole point (#175) — it bounds the conversion scratch at a
 * constant instead of the clip's length — so it wants to be small enough that a
 * chapter-length recording costs nothing extra and large enough that the write
 * loop stays short (600 iterations for ten minutes).
 */
const PLAYBACK_FILL_FRAMES = CANONICAL_SAMPLE_RATE;

/**
 * Wrap canonical PCM in an AudioBuffer for playback, filling it through ONE
 * reused window rather than a whole-clip Float32 copy (#175).
 *
 * The predecessor built `int16ToFloat(samples)` — a second whole-clip buffer —
 * and handed it to `copyToChannel`, which holds a copy of its own; with the
 * retained Int16 source that put a ten-minute segment at roughly 265 MB on one
 * Play tap, unguarded. Writing window by window leaves the `AudioBuffer` (which
 * playback genuinely needs) plus 176 KB, whatever the clip's length.
 *
 * The tail is passed as a `subarray` of exactly the samples written, not the
 * whole window: the window still holds the previous chunk past that point, and
 * `copyToChannel` would otherwise write those stale frames as audio.
 */
function toAudioBuffer(
  samples: Int16Array,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): AudioBuffer {
  const ctx = getAudioContext();
  const frames = Math.max(1, samples.length);
  const buffer = ctx.createBuffer(CANONICAL_CHANNELS, frames, sampleRate);
  const window = new Float32Array(Math.min(PLAYBACK_FILL_FRAMES, frames));
  for (let offset = 0; offset < samples.length; offset += window.length) {
    const written = int16ToFloatInto(samples, window, offset);
    buffer.copyToChannel(
      written === window.length ? window : window.subarray(0, written),
      0,
      offset
    );
  }
  return buffer;
}

export interface PlaybackHandle {
  stop: () => void;
  /** Seconds elapsed since playback started, clamped to the clip duration. */
  elapsed: () => number;
  readonly duration: number;
}

/** Resolve after the current task, so queued input gets its turn first. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The one fail-closed gate `playSamples` applies whenever a play claim is
 * still current: if the shared context needs a resume RIGHT NOW, this writes
 * a single durable row and throws, so `playSamples` builds no source and
 * `onEnded` never fires for a clip that was never heard (#469).
 *
 * Called from TWO points in `playSamples` — immediately after the resume
 * race settles, and again right before `createBufferSource`, once the
 * intervening `nextTask()` yield has run (George round-2 P2). One gate, two
 * call sites, so both share the identical contract rather than drifting: an
 * OS interruption delivered as a task during the buffer fill/yield is
 * otherwise invisible to the first call alone, since that call only proves
 * the context was usable BEFORE the fill started.
 *
 * `resumeTimedOut` selects which row this reports UNDER, not WHETHER it
 * reports — that is `audioContextNeedsResume()` alone. The first call site
 * passes the real flag from `raceAudioResume`, so a bound that elapsed is
 * reported as "playback-resume-timeout". The second call site always passes
 * `false`: by the time it runs, the timeout branch above has already thrown
 * (a `true` never reaches it), so anything this second call catches is a
 * context that went back to `"interrupted"` after resume succeeded — logged
 * as "playback-resume-unusable", the same key an early rejection reports
 * under at the first call site (George R1 P1's fix; see the docblock there).
 *
 * Only called when the context is STILL unusable, so it is not the sole
 * writer for an early rejection any more (Frank round-3 P2): `playSamples`
 * passes `onEarlyRejection` to `raceAudioResume` to CAPTURE, not report, an
 * early rejection, then calls this gate first — if the context is still
 * unusable, the captured cause is folded into this ONE row rather than
 * reported separately (George round-2 P3's fix); if the context turned out
 * usable anyway (a concurrent resume elsewhere won), `playSamples` reports
 * the captured cause itself, on its own, since this gate never fires for a
 * usable context.
 */
function buildResumeUnusableMessage(resumeTimedOut: boolean): string {
  return resumeTimedOut
    ? `resumeAudioContext() did not settle within ${RESUME_TIMEOUT_MS} ms; the bounded wait in playSamples elapsed (#469)`
    : `resumeAudioContext() settled but the shared context still needs resume; playSamples refusing a silent start (#469)`;
}

/** Play canonical PCM, optionally from an offset. Returns a stop handle. */
export async function playSamples(
  samples: Int16Array,
  options: {
    offsetSeconds?: number;
    onEnded?: () => void;
    /**
     * Checked twice: after the resume await, before the buffer is filled; and
     * again after the fill, once a task has passed (see the body). A play
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
    /**
     * Which path produced `samples`, for the opt-in level probe only
     * (`hooks/audio-probe.ts`). Changes nothing about what is played.
     */
    source?: ProbeSource;
  }
): Promise<PlaybackHandle> {
  // SINGLE EXIT for the #469 resume-bound row (dev lead pick, option A on the
  // 2026-09-19 judgment sheet, replacing the per-site reports round-2 and
  // Frank round-3 each patched one exit of at a time — George R2 P3 (two
  // rows for one rejection), Frank r1 (zero rows when a CONCURRENT
  // `resumeAudioContext()` elsewhere won the race), Frank r2 P2 @ :678 (the
  // `isStillCurrent()` supersession bail returned before ever looking at a
  // captured rejection) and P2 @ :694 (the gate always built its OWN
  // synthetic `Error`, discarding a real captured cause). All four were the
  // same class: "which exit of `playSamples` owns the row". The `finally`
  // below is now the ONLY `reportFailure` call for this row, reached from
  // EVERY exit — success, either supersession bail, or either fail-closed
  // throw — so accounting can no longer drift per call site by construction.
  //
  // `hadRejection`/`capturedCause` are set at most once, from
  // `raceAudioResume`'s `onEarlyRejection` below, and are never cleared —
  // once a claim's OWN `resumeAudioContext()` call has genuinely rejected,
  // that fact survives every branch after it, superseded or not.
  // `unusableError` is set only at the exact point (either fail-closed
  // check, at most one of them reachable per call) this function is ABOUT TO
  // THROW for an unusable context; its presence is what the `finally` uses
  // to select the "-timeout"/"-unusable" key, kept separate from
  // `hadRejection` so a captured real cause can still be preferred as the
  // REPORTED object while the THROWN error stays the stable, synthetic,
  // user-flow message both call sites' `catch` already matches against.
  let hadRejection = false;
  let capturedCause: unknown;
  let unusableError: Error | undefined;

  const resumeTimedOut = await raceAudioResume("playback-resume", (cause) => {
    hadRejection = true;
    capturedCause = cause;
  });

  try {
    if (!options.isStillCurrent()) {
      // Superseded during the resume await. Return an inert handle before
      // building any node — nothing is created, nothing reaches
      // `ctx.destination`, nothing sounds. `onEnded` is deliberately not
      // called, since nothing started and the newer claim owns the UI state
      // now. Unlike before this round, a captured rejection is NOT dropped
      // here (Frank round-3 r2 P2 @ audio-io.ts:678) — the `finally` below
      // still reports it; only the SYNTHETIC "still unusable" row stays
      // suppressed for a claim nobody is waiting on any more, mirroring
      // `start()`'s generation check for the identical reason (#498 George
      // R1 P2) — see the `finally`'s own comment for why those two are not
      // the same rule.
      return { stop: () => {}, elapsed: () => 0, duration: 0 };
    }

    if (audioContextNeedsResume()) {
      // Still current, so an unusable context here IS a #469 event worth a
      // row. Gated on the AUDIBILITY predicate, not `resumeTimedOut` (George
      // R1 P1): `raceAudioResume` also resolves `false` — "timer did not
      // win" — when `resume()` REJECTS before the bound, and a rejection is
      // not a success. Checking only the timer flag let that case fall
      // through to `source.start()` on a context that still needs resume:
      // the iOS silent-playback shape, with no error and no rejection ever
      // reaching `playTake`/`playBuffer`'s `catch`. Re-reading the live
      // state here (rather than trusting `resumeTimedOut`) closes that path
      // for BOTH causes — timeout and early rejection — with one check.
      unusableError = new Error(buildResumeUnusableMessage(resumeTimedOut));
      throw unusableError;
    }

    const ctx = getAudioContext();
    const buffer = toAudioBuffer(samples);

    // The fill above is synchronous and scales with the clip (#175): about
    // 600 `copyToChannel` calls for ten minutes. A Stop, or a Play on
    // another row, tapped DURING it cannot run until something yields. With
    // no yield between here and `source.start()`, that tap would be handled
    // only after the source had started, and `settle` would kill it: the
    // start-then-stop #104 exists to prevent (George R4 G-1). A bare
    // re-check here would be dead code, because nothing can change within
    // this task. So yield one TASK, not a microtask (input events are
    // tasks), and ask again. The cost is one macrotask of latency per Play.
    await nextTask();
    if (!options.isStillCurrent()) {
      return { stop: () => {}, elapsed: () => 0, duration: 0 };
    }

    if (audioContextNeedsResume()) {
      // Re-applied after the yield (George round-2 P2): the check above only
      // proves the context was usable BEFORE the fill/yield. An OS
      // interruption (call / Siri / route change) is delivered as a task
      // exactly like the Stop or competing Play the yield above exists to
      // let land — nothing between there and `source.start()` re-read
      // audibility, so a source could still start on a context that went
      // back to `"interrupted"` during that window: the same
      // silent-playback shape this function exists to refuse, reachable
      // through the unchanged yield. `resumeTimedOut` is always `false`
      // here — a `true` would already have thrown above, before this line
      // could ever run — so this always builds the "-unusable" message, not
      // "-timeout".
      unusableError = new Error(buildResumeUnusableMessage(false));
      throw unusableError;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const offset = Math.max(
      0,
      Math.min(options.offsetSeconds ?? 0, buffer.duration)
    );
    // Measured here, past both supersession bails and both fail-closed gates:
    // a reading exists only for a buffer that is about to sound. `level`
    // covers only what `source.start(0, offset)` sounds, from `startFrame`
    // on, so a scrubbed play of a quiet tail reads quiet (Frank round 1 on
    // #716). `withAudioProbe` drops any throw, so this cannot fail the play.
    withAudioProbe(() => {
      const startFrame = Math.min(
        samples.length,
        Math.floor(offset * buffer.sampleRate)
      );
      return {
        stage: "play",
        source: options.source ?? "unlabelled",
        level: measureLevel(samples.subarray(startFrame), INT16_MAX),
        viewOffset: samples.byteOffset / Int16Array.BYTES_PER_ELEMENT,
        startFrame,
        backingFrames: samples.buffer.byteLength / Int16Array.BYTES_PER_ELEMENT,
        offsetSeconds: offset,
        contextState: ctx.state,
        contextRate: ctx.sampleRate,
        destinationChannels: ctx.destination.channelCount,
      };
    });
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
  } finally {
    // THE single exit (see the long comment above the function): whichever
    // path above this function left through, this is reached exactly once,
    // and is the ONLY place that writes the #469 resume-bound row.
    if (hadRejection) {
      // A real rejection was captured — ALWAYS the cause reported, never a
      // synthetic stand-in (Frank round-3 r2 P2 @ audio-io.ts:694: the old
      // per-site gate always built its own `Error`, discarding the actual
      // WebKit exception's name/message/stack even when the real cause was
      // sitting right there). Still folded into the SAME key the fail-closed
      // throw above would have used when this claim is ALSO still unusable
      // (`unusableError` set) — one row, not two, preserving George round-2
      // P3's fix — or reported on its own under the plain "playback-resume"
      // key, with NO throw already having happened, when a concurrent
      // `resumeAudioContext()` elsewhere made the context usable anyway
      // (Frank round-1: the fact must not be lost just because it turned
      // out harmless). And — the actual fix this round makes — reported
      // here EVEN WHEN the claim was superseded before either fail-closed
      // check ever ran (Frank round-3 r2 P2 @ audio-io.ts:678): the old
      // `isStillCurrent()` bail returned before the gate could ever see the
      // captured cause; a `finally` cannot be skipped by an early `return`.
      reportFailure(
        capturedCause,
        unusableError
          ? resumeTimedOut
            ? "playback-resume-timeout"
            : "playback-resume-unusable"
          : "playback-resume"
      );
    } else if (unusableError) {
      // No rejection was ever observed for THIS claim — the bound simply
      // elapsed, or the context is unusable for some other reason a plain
      // `resume()` call never surfaces as a promise rejection — so the
      // synthetic message built at the throw site above is the only cause
      // there is to report. NOT reported at all when the claim was
      // superseded before either fail-closed check ran: `unusableError` is
      // only ever set immediately before a throw INSIDE the try above, and
      // both supersession bails return before reaching either throw site, so
      // a superseded claim with no captured rejection reaches here with
      // `unusableError` still `undefined` — mirroring `start()`'s generation
      // check for the identical reason (#498 George R1 P2): a claim nobody
      // is waiting on any more is not a #469 event to log, unless a REAL
      // rejection (the branch above) makes it one regardless.
      reportFailure(
        unusableError,
        resumeTimedOut ? "playback-resume-timeout" : "playback-resume-unusable"
      );
    }
  }
}
