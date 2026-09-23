/**
 * Where the recorded audio sits inside an MP3 decode, and how to get it back.
 *
 * An MP3 decode of a clip is not the clip. LAME primes its filterbank with
 * `MP3_ENCODER_DELAY` (576) samples before the first recorded sample, a
 * standard-conforming decoder adds `MP3_DECODER_DELAY` (529) more, and the
 * stream is padded to whole granules of `MP3_GRANULE` (1152) at the tail. A
 * decoder that returns every granule hands back
 *
 *     [ 1105 samples of priming ][ the recording ][ 0..1151 samples of padding ]
 *
 * and lamejs writes no Xing/LAME info tag, so no decoder can trim the priming
 * by tag. Some decoders trim the 529 on their own; a decoder given a tag by a
 * different encoder trims both.
 *
 * The round-1 fit kept the FIRST `frameCount` samples — which, on a decoder that
 * returns every granule, is 1105 samples of silence followed by the recording
 * minus its last 1105 samples. Playback and export started ~25 ms late, and an
 * edit → save of a finished segment deleted the last ~25 ms of speech for good,
 * again on every cycle (round-2 Frank P1 / George P2). This module is the fix:
 * it works out the head offset from evidence — the stream's own granule count
 * and the decode's length — instead of assuming which end the excess is on.
 *
 * Pure: no decoder, no DOM.
 */

import { fitToFrames } from "./edit";

/** Samples per MPEG-1 Layer III granule; the encoder's own chunk size. */
export const MP3_GRANULE = 1152;
/** LAME's filterbank priming: samples of silence before the recording. */
export const MP3_ENCODER_DELAY = 576;
/** The standard decoder's own delay, added to the encoder's by a decoder that trims nothing. */
export const MP3_DECODER_DELAY = 529;
/** Head offset of the recording in a decode that returns every granule. */
export const MP3_TOTAL_DELAY = MP3_ENCODER_DELAY + MP3_DECODER_DELAY;

/** MPEG-1 Layer III bitrate index → kbps (index 0 is "free", 15 is invalid). */
const BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
] as const;
/** MPEG-1 sample-rate index → Hz (index 3 is reserved). */
const SAMPLE_RATES = [44_100, 48_000, 32_000] as const;

/**
 * Count the MPEG-1 Layer III frames (= granules of `MP3_GRANULE` samples) in a
 * stream by walking its frame headers. Each frame's length is fixed by its
 * bitrate, sample rate and padding bit, so the walk is exact and costs one
 * header read per ~26 ms of audio. Stops at the first byte that is not a valid
 * MPEG-1 Layer III header — a truncated or foreign stream counts what it has.
 *
 * Multiplied by `MP3_GRANULE` this is the length a decoder that trims nothing
 * returns, and the reference `fitMp3Decode` measures a decode against.
 */
export function mp3GranuleCount(mp3: Uint8Array): number {
  let at = 0;
  let frames = 0;
  while (at + 4 <= mp3.length) {
    const b1 = mp3[at]!;
    const b2 = mp3[at + 1]!;
    const b3 = mp3[at + 2]!;
    // Sync (11 bits), MPEG-1 (bits 4-3 == 11), Layer III (bits 2-1 == 01).
    const isMpeg1Layer3 = b1 === 0xff && (b2 & 0xfe) === 0xfa;
    const bitrate = BITRATES_KBPS[b3 >> 4];
    const sampleRate = SAMPLE_RATES[(b3 >> 2) & 0x3];
    if (!isMpeg1Layer3 || !bitrate || !sampleRate) break;
    const padding = (b3 >> 1) & 0x1;
    at += Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
    frames++;
  }
  return frames;
}

/**
 * Recover the recorded `frames` samples from `decoded`, the output of decoding
 * `mp3` — whichever of the known decoder behaviours produced it.
 *
 * The decode's length says what the decoder did, measured against the stream's
 * own granule count:
 *
 *   emitted            → trimmed nothing: the recording starts at 1105.
 *   emitted − 529      → trimmed only its own delay: it starts at 576.
 *   frames             → trimmed both (a tag-honouring decoder): it starts at 0.
 *
 * Any other length is a decoder this module has not met. Then the head skip is
 * whatever part of the overshoot is not accounted for by the tail padding,
 * clamped to [0, 1105] — exact whenever the excess splits head/tail the way
 * MPEG says it must, and never more than the priming.
 *
 * The result is then fitted to `frames` with `fitToFrames`: trimmed at the tail
 * (padding) or, for a decode that came back short, padded with silence at the
 * tail. The head is never trimmed by more than the decoder's own priming, so
 * recorded audio is never dropped from the front; the tail is trimmed only past
 * `frames`, so none is dropped from the back.
 */
export function fitMp3Decode(
  decoded: Int16Array,
  mp3: Uint8Array,
  frames: number
): Int16Array {
  const emitted = mp3GranuleCount(mp3) * MP3_GRANULE;
  let headSkip: number;
  if (decoded.length === emitted) headSkip = MP3_TOTAL_DELAY;
  else if (decoded.length === emitted - MP3_DECODER_DELAY)
    headSkip = MP3_ENCODER_DELAY;
  else if (decoded.length === frames) headSkip = 0;
  else {
    const tail = Math.max(0, emitted - frames - MP3_TOTAL_DELAY);
    const overshoot = decoded.length - frames;
    headSkip = Math.max(0, Math.min(MP3_TOTAL_DELAY, overshoot - tail));
  }
  // Never skip past the decode itself (a decode shorter than the priming).
  headSkip = Math.min(headSkip, decoded.length);
  return fitToFrames(decoded.subarray(headSkip), frames);
}
