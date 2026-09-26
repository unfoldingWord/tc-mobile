/**
 * Synthetic speech-like PCM for the phone check's encode probe (#1009).
 *
 * Not silence, and not a steady tone: an MP3 encoder does far less work on
 * either, so a speed measured on them would flatter the phone. This is a
 * voiced source — a wandering pitch between roughly 110 and 230 Hz with five
 * falling harmonics — under a syllable-rate envelope (about four a second),
 * with a breath of noise on every syllable and a short pause every few
 * seconds. It is a load profile, not a voice model; nothing here claims it
 * encodes exactly like a recording.
 *
 * Deterministic (a fixed-seed generator, no `Math.random`), so two runs on two
 * phones encode the same samples and their times are comparable.
 */
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";

/** The encode probe's length, from #1009: five minutes. */
export const ENCODE_PROBE_SECONDS = 5 * 60;

const TABLE_SIZE = 4096;
const SINE = Float32Array.from({ length: TABLE_SIZE }, (_, i) =>
  Math.sin((2 * Math.PI * i) / TABLE_SIZE)
);
const HARMONIC_GAIN = [1, 0.5, 0.33, 0.2, 0.12] as const;

/** A small linear congruential generator: deterministic, fast, good enough for noise. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * `seconds` of speech-like mono PCM at `sampleRate` (the app's canonical
 * rate by default, so it goes through the encoder exactly as a take would).
 */
export function speechLikePcm(
  seconds: number,
  sampleRate: number = CANONICAL_SAMPLE_RATE
): Int16Array {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const out = new Int16Array(n);
  const random = lcg(0x7c_2e_1009);
  const phases = new Float64Array(HARMONIC_GAIN.length);
  const gainSum = HARMONIC_GAIN.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Pitch wanders slowly, as intonation does.
    const pitch =
      170 +
      45 * Math.sin(2 * Math.PI * 0.3 * t) +
      15 * Math.sin(2 * Math.PI * 1.7 * t);
    // Syllables: a raised cosine at ~4 Hz, silenced for the last 0.4 s of
    // every 3.5 s so the encoder also sees pauses.
    const syllable = 0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * t);
    const pause = t % 3.5 > 3.1 ? 0 : 1;
    const envelope = syllable * pause;
    let voiced = 0;
    for (let h = 0; h < HARMONIC_GAIN.length; h++) {
      const step = (pitch * (h + 1) * TABLE_SIZE) / sampleRate;
      const phase = ((phases[h] ?? 0) + step) % TABLE_SIZE;
      phases[h] = phase;
      voiced += (HARMONIC_GAIN[h] ?? 0) * (SINE[phase | 0] ?? 0);
    }
    const noise = (random() * 2 - 1) * 0.08;
    const sample = envelope * ((voiced / gainSum) * 0.35 + noise);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  return out;
}
