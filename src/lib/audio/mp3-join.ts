/**
 * Join stored MP3 streams frame by frame, without decoding them (#1004).
 *
 * A Finished segment is stored as the MP3 the transcode sweep wrote (B8,
 * ADR 0009): `lib/audio/mp3.ts`'s encoder, 64 kbps CBR, mono, at
 * `CANONICAL_SAMPLE_RATE`. Share used to decode each one back to PCM and
 * re-encode the whole chapter — a second lossy generation, and minutes of CPU
 * on a slow phone for a long book. This module builds the chapter MP3 from the
 * stored frames instead.
 *
 * Why a byte join is a legal MP3:
 *
 * - **Frames are self-delimiting.** Each frame's length follows from its own
 *   header, so a decoder walks a concatenation exactly as it walks one stream.
 *   A join is only accepted when every frame of every piece shares one bitrate,
 *   sample rate and channel mode (mono), so the result is still one constant
 *   bitrate stream a player can size from its first header.
 * - **The bit reservoir never crosses a join.** A frame's `main_data_begin` may
 *   point BACK into earlier frames' bytes, never forward. A stream's first
 *   frame has nothing behind it, so an encoder writes `main_data_begin = 0`
 *   there. This module checks every audio frame, not just the first: its
 *   `main_data_begin` (a count of main-data bytes, headers and side
 *   information excluded) must not exceed the main-data bytes the piece's own
 *   earlier frames hold, so the first frame must be 0 and no later frame may
 *   reach back past the piece's start. A piece that breaks this is refused.
 *   Nothing before a join is then read by what follows it.
 * - **No tag survives into the middle.** A leading ID3v2 tag, a trailing ID3v1
 *   tag and a leading Xing/Info/VBRI metadata frame are dropped; any other
 *   trailing bytes refuse the piece. The joined stream carries no tag at all,
 *   which is what a whole-chapter encode by the same encoder produces too.
 *
 * Gaps and the encoder delay. Each piece decodes as
 *
 *     [ MP3_ENCODER_DELAY priming ][ the recording ][ padding to a granule ]
 *
 * (see `mp3-align.ts`), and a decoder adds its own delay once, at the head of
 * the whole stream. The whole-chapter encode places segment `j`'s recording
 * at `MP3_ENCODER_DELAY + Σ(frames + gap)` over the segments before it. Here
 * the silence between pieces can only be whole frames of `MP3_GRANULE`
 * samples, so the number of silent frames before each piece is chosen against
 * that same absolute target, not against the previous piece's end: every
 * segment then starts within half a granule (576 samples, ~13 ms at 44.1 kHz)
 * of where the re-encode put it, and the error does not add up along a long
 * chapter. The silence is a hand-built frame with zero side information —
 * no spectral data at all, which every conforming decoder reconstructs as
 * digital silence — so the join never calls the encoder.
 *
 * Pure: bytes in, bytes out; no decoder, no DOM, no encoder import (the
 * encoder is LGPL and lives in its own worker chunk, ADR 0009).
 */

import { MP3_GRANULE, readMp3FrameHeader } from "./mp3-align";

/** Channel mode of a single-channel (mono) MPEG-1 frame. */
const MONO = 3;
/** MPEG-1 Layer III side information for one channel, in bytes. */
const MONO_SIDE_INFO_BYTES = 17;

/** One stored MP3, reduced to the audio frames a join may copy. */
export interface Mp3Frames {
  /** The audio frames only, tags and any metadata frame dropped. */
  readonly bytes: Uint8Array;
  /** How many frames (= granules of `MP3_GRANULE` samples) `bytes` holds. */
  readonly granules: number;
  /**
   * The header bytes every frame shares — bitrate, sample rate and channel
   * mode — as one number, so two pieces can be compared for a legal join.
   */
  readonly format: number;
  /** The first audio frame's four header bytes, the silence frame's template. */
  readonly header: Uint8Array;
}

/** The length of an ID3v2 tag at the head of `mp3`, or 0 when there is none; -1 if malformed. */
function id3v2Length(mp3: Uint8Array): number {
  if (
    mp3.length < 10 ||
    mp3[0] !== 0x49 /* I */ ||
    mp3[1] !== 0x44 /* D */ ||
    mp3[2] !== 0x33 /* 3 */
  )
    return 0;
  const size = mp3.subarray(6, 10);
  if (size.some((b) => b & 0x80)) return -1;
  const body = (size[0]! << 21) | (size[1]! << 14) | (size[2]! << 7) | size[3]!;
  const footer = mp3[5]! & 0x10 ? 10 : 0;
  return 10 + body + footer;
}

/** Whether `mp3` ends in a 128-byte ID3v1 tag after `start`. */
function hasId3v1(mp3: Uint8Array, start: number): boolean {
  const at = mp3.length - 128;
  return (
    at >= start &&
    mp3[at] === 0x54 /* T */ &&
    mp3[at + 1] === 0x41 /* A */ &&
    mp3[at + 2] === 0x47 /* G */
  );
}

function asciiAt(mp3: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (mp3[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Whether the frame at `at` is a Xing/Info (LAME) or VBRI metadata frame, not audio. */
function isMetadataFrame(mp3: Uint8Array, at: number, crc: boolean): boolean {
  const xing = at + 4 + (crc ? 2 : 0) + MONO_SIDE_INFO_BYTES;
  return (
    asciiAt(mp3, xing, "Xing") ||
    asciiAt(mp3, xing, "Info") ||
    asciiAt(mp3, at + 36, "VBRI")
  );
}

/** A frame's `main_data_begin`: the first 9 bits of its side information. */
function mainDataBegin(mp3: Uint8Array, at: number, crc: boolean): number {
  const side = at + 4 + (crc ? 2 : 0);
  return (mp3[side]! << 1) | (mp3[side + 1]! >> 7);
}

/** Bitrate, sample rate and channel mode of the frame at `at`, as one number. */
function formatOf(mp3: Uint8Array, at: number): number {
  return ((mp3[at + 2]! & 0xfc) << 8) | (mp3[at + 3]! & 0xc0);
}

/**
 * Reduce a stored MP3 to the frames a join may copy, or `null` when it cannot
 * be joined safely — and the caller must decode and re-encode it instead.
 *
 * Refused: anything that is not mono MPEG-1 Layer III; a stream whose frames
 * change bitrate, sample rate or mode (not constant bitrate); a truncated last
 * frame; bytes after the last frame other than one ID3v1 tag; any audio frame
 * whose `main_data_begin` reaches back before the piece's first audio frame
 * (a bit reservoir the joined stream no longer has); and a stream with
 * no audio frames at all. Fail-closed on purpose: a refused piece costs a
 * re-encode, a wrongly accepted one costs a broken share.
 */
export function parseJoinableMp3(mp3: Uint8Array): Mp3Frames | null {
  const start = id3v2Length(mp3);
  if (start < 0 || start > mp3.length) return null;
  const end = hasId3v1(mp3, start) ? mp3.length - 128 : mp3.length;

  let at = start;
  let first = -1;
  let format = -1;
  let granules = 0;
  // Main-data bytes the piece's audio frames so far hold: the most any frame's
  // `main_data_begin` may reach back without leaving the piece.
  let reservoir = 0;
  while (at < end) {
    const header = readMp3FrameHeader(mp3, at);
    if (header === null || header.mode !== MONO) return null;
    if (at + header.length > end) return null;
    if (first === -1) {
      if (granules === 0 && isMetadataFrame(mp3, at, header.crc)) {
        // A metadata frame decodes as silence and its counts describe the old
        // stream, not the joined one; it is dropped, never copied.
        at += header.length;
        continue;
      }
      first = at;
      format = formatOf(mp3, at);
    } else if (formatOf(mp3, at) !== format) {
      return null;
    }
    // 0 on the first audio frame; on every later one, within this piece.
    if (mainDataBegin(mp3, at, header.crc) > reservoir) return null;
    reservoir +=
      header.length - 4 - (header.crc ? 2 : 0) - MONO_SIDE_INFO_BYTES;
    granules++;
    at += header.length;
  }
  if (first === -1) return null;
  return {
    bytes: mp3.subarray(first, end),
    granules,
    format,
    header: mp3.slice(first, first + 4),
  };
}

/**
 * One frame of digital silence in the format of `header` (a piece's first
 * audio-frame header): no CRC, no padding, and all-zero side information —
 * `part2_3_length = 0`, so the frame carries no spectral data and decodes to
 * zeros. `main_data_begin = 0` too, so it borrows nothing.
 */
export function silentMp3Frame(header: Uint8Array): Uint8Array {
  const template = Uint8Array.of(
    0xff,
    0xfb, // MPEG-1, Layer III, protection bit set: no CRC follows
    header[2]! & 0xfd, // same bitrate and sample rate, padding bit cleared
    header[3]!
  );
  const parsed = readMp3FrameHeader(template, 0);
  if (parsed === null) throw new Error("not an MPEG-1 Layer III header");
  const frame = new Uint8Array(parsed.length);
  frame.set(template);
  return frame;
}

/** One segment's stored audio, in chapter order, and its recorded length. */
export interface JoinPiece {
  readonly frames: Mp3Frames;
  /** Samples of the ORIGINAL recording (the clip's `frameCount`). */
  readonly recorded: number;
}

/**
 * Whether a piece's stream covers exactly its recording: it holds the
 * encoder's priming and every recorded sample, and at most two granules of
 * padding after them. A stream that ends short of the recording, or runs well
 * past it, disagrees with its clip's metadata; the re-encode fits such a clip
 * to its slot, and a byte join could not, so it is refused.
 */
function coversRecording(piece: JoinPiece, priming: number): boolean {
  const tail = piece.frames.granules * MP3_GRANULE - priming - piece.recorded;
  return tail >= 0 && tail < 2 * MP3_GRANULE;
}

/**
 * Join `pieces`, in order, into one MP3 with about `gapSamples` of silence
 * between consecutive recordings — or `null` when they cannot be joined
 * (formats differ, or a piece does not cover its recording). `priming` is the
 * encoder's delay (`MP3_ENCODER_DELAY` for this app's encoder).
 *
 * Piece `j`'s stream is placed so its recording starts as close as a whole
 * number of silent frames allows to `priming + Σ(recorded + gapSamples)` over
 * the pieces before it — the position a single encode of the concatenated
 * PCM gives it. See the header for why the target is absolute.
 */
export function joinMp3(
  pieces: readonly JoinPiece[],
  gapSamples: number,
  priming: number
): Uint8Array<ArrayBuffer> | null {
  const head = pieces[0];
  if (head === undefined) return null;
  for (const piece of pieces) {
    if (piece.frames.format !== head.frames.format) return null;
    if (!coversRecording(piece, priming)) return null;
  }

  const silence = silentMp3Frame(head.frames.header);
  // Silent frames before each piece (none before the first).
  const silentBefore: number[] = [];
  let emitted = 0; // samples the joined stream holds so far
  let target = 0; // where the next piece's stream should begin
  let size = 0;
  for (const piece of pieces) {
    const silent = Math.max(0, Math.round((target - emitted) / MP3_GRANULE));
    silentBefore.push(silent);
    emitted += (silent + piece.frames.granules) * MP3_GRANULE;
    size += silent * silence.length + piece.frames.bytes.length;
    target += piece.recorded + gapSamples;
  }

  const out = new Uint8Array(size);
  let at = 0;
  pieces.forEach((piece, i) => {
    for (let s = 0; s < silentBefore[i]!; s++) {
      out.set(silence, at);
      at += silence.length;
    }
    out.set(piece.frames.bytes, at);
    at += piece.frames.bytes.length;
  });
  return out;
}
