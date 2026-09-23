/**
 * An opt-in level probe at the audio boundary, for the stored-playback level
 * reports (#555 iOS quiet, #612 audition quiet, #269 Android silent).
 *
 * A code read of every playback path found no gain applied anywhere in the
 * web layer: every play goes through one `playSamples`, one gain-free
 * `source -> destination` graph, one Int16 -> Float conversion. What differs
 * between the reports is the buffer each path hands that function, and what
 * the device does with the output. Neither can be read in Node. This records
 * the first so a device session can read it; it records nothing about the
 * second except the context state and destination channel count.
 *
 * OFF unless `localStorage["tc-mobile.audio-probe"] === "1"` at launch. The
 * flag is read once, lazily, and cached — so off costs one boolean test per
 * call site and no measurement, and turning it on means setting the key from
 * a console (Safari Web Inspector, `chrome://inspect`) and reloading.
 *
 * On, each reading is written to `console.info("TCPROBE", json)` and kept in a
 * bounded in-memory list at `globalThis.__tcAudioProbe`, newest last, for
 * `copy(__tcAudioProbe)` from the same console. Silence is -Infinity dBFS,
 * which the JSON line prints as `null`. Deliberately NOT the failure
 * log: a level reading is not a failure, and that log is the translator-facing
 * problem channel (the #478 constraint). Nothing is persisted.
 */

import type { SignalLevel } from "@/lib/audio/level";

const AUDIO_PROBE_KEY = "tc-mobile.audio-probe";

/** Readings kept; the oldest go first. A device session needs dozens. */
const MAX_READINGS = 200;

/** Which buffer a play or decode is handling. */
export type ProbeSource =
  "capture" | "stored-pcm" | "stored-mp3" | "working" | "unlabelled";

type ProbeReading =
  | {
      readonly stage: "capture-track";
      readonly settings: Readonly<Record<string, unknown>>;
    }
  | {
      readonly stage: "decode";
      readonly source: ProbeSource;
      readonly channels: number;
      readonly sampleRate: number;
      readonly frames: number;
      readonly perChannel: readonly SignalLevel[];
    }
  | {
      readonly stage: "play";
      readonly source: ProbeSource;
      readonly level: SignalLevel;
      /** Where the played view starts in its backing buffer, in samples. */
      readonly viewOffset: number;
      /** The backing buffer's length, in samples. */
      readonly backingFrames: number;
      readonly offsetSeconds: number;
      readonly contextState: string;
      readonly contextRate: number;
      readonly destinationChannels: number;
    };

let enabled: boolean | undefined;

/** Whether the probe was asked for. Read once per page load. */
export function audioProbeEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = window.localStorage.getItem(AUDIO_PROBE_KEY) === "1";
    } catch {
      // A storage accessor that throws (Safari with site data blocked, a
      // WebView with storage disabled) is "not asked for": the probe is a
      // developer's opt-in, and there is nothing to report to anyone.
      enabled = false;
    }
  }
  return enabled;
}

/** Record one reading. Callers check `audioProbeEnabled()` first. */
export function recordAudioProbe(reading: ProbeReading): void {
  const entry = { at: Date.now(), ...reading };
  const holder = globalThis as { __tcAudioProbe?: unknown[] };
  const list = (holder.__tcAudioProbe ??= []);
  list.push(entry);
  if (list.length > MAX_READINGS) list.splice(0, list.length - MAX_READINGS);
  console.info("TCPROBE", JSON.stringify(entry));
}
