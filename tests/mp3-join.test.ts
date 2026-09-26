import { describe, expect, it } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import {
  MP3_ENCODER_DELAY,
  MP3_GRANULE,
  mp3GranuleCount,
  readMp3FrameHeader,
} from "@/lib/audio/mp3-align";
import {
  type JoinPiece,
  type Mp3Frames,
  joinMp3,
  parseJoinableMp3,
  silentMp3Frame,
} from "@/lib/audio/mp3-join";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { SEGMENT_GAP_SECONDS } from "@/lib/export/chapter";

/**
 * #1004: a Finished segment's stored MP3 is joined into the chapter MP3 frame
 * by frame. Every fixture here is a REAL encode by the app's own encoder
 * (`lib/audio/mp3.ts`, the one the transcode sweep and Share both run), so
 * what the join is asked to accept is what a phone actually stores.
 */

const GAP = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);

/** A tone, distinct per `seed`, so no two fixtures encode to the same bytes. */
function tone(n: number, seed: number): Int16Array {
  return Int16Array.from({ length: n }, (_, i) =>
    Math.round(6000 * Math.sin((i * (seed + 3)) / 50))
  );
}

function stored(n: number, seed: number): Uint8Array {
  return encodeMp3(tone(n, seed));
}

function parsed(mp3: Uint8Array): Mp3Frames {
  const frames = parseJoinableMp3(mp3);
  if (frames === null) throw new Error("fixture was refused");
  return frames;
}

function piece(n: number, seed: number): JoinPiece {
  return { frames: parsed(stored(n, seed)), recorded: n };
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Every frame's start offset, walking headers; fails on any gap or stray byte. */
function frameOffsets(mp3: Uint8Array): number[] {
  const offsets: number[] = [];
  let at = 0;
  while (at < mp3.length) {
    const header = readMp3FrameHeader(mp3, at);
    if (header === null) throw new Error(`no frame header at byte ${at}`);
    offsets.push(at);
    at += header.length;
  }
  expect(at).toBe(mp3.length);
  return offsets;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Where each piece's stream starts in the joined MP3, in samples of the
 * encoder timeline (frame index x granule), found by locating the piece's own
 * bytes in order. Also asserts that everything between pieces is silence.
 */
function pieceStarts(joined: Uint8Array, pieces: JoinPiece[]): number[] {
  const offsets = frameOffsets(joined);
  const silence = silentMp3Frame(pieces[0]!.frames.header);
  const starts: number[] = [];
  let frame = 0;
  for (const p of pieces) {
    while (
      frame < offsets.length &&
      !sameBytes(
        joined.subarray(
          offsets[frame]!,
          offsets[frame]! + p.frames.bytes.length
        ),
        p.frames.bytes
      )
    ) {
      // Anything skipped over on the way to the next piece is a silent frame.
      expect(
        sameBytes(
          joined.subarray(offsets[frame]!, offsets[frame]! + silence.length),
          silence
        )
      ).toBe(true);
      frame++;
    }
    expect(frame).toBeLessThan(offsets.length);
    starts.push(frame * MP3_GRANULE);
    frame += p.frames.granules;
  }
  expect(frame).toBe(offsets.length);
  return starts;
}

/** Where a single encode of the concatenated PCM starts each piece's stream. */
function reencodeStarts(pieces: JoinPiece[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const p of pieces) {
    starts.push(at);
    at += p.recorded + GAP;
  }
  return starts;
}

describe("the app's own encoder output (what a Finished segment stores)", () => {
  it.each([1, 100, 1152, 5000, GAP, 44_100, 44_101, 100_000])(
    "is accepted whole for a %i-sample recording, and covers it",
    (n) => {
      const mp3 = stored(n, 1);
      const frames = parsed(mp3);
      // No tag and no metadata frame to drop: every byte is an audio frame.
      expect(frames.bytes.length).toBe(mp3.length);
      expect(frames.granules).toBe(mp3GranuleCount(mp3));
      // Priming + recording fit in the frames, with under two granules over:
      // the bound `joinMp3` holds every piece to.
      const tail = frames.granules * MP3_GRANULE - MP3_ENCODER_DELAY - n;
      expect(tail).toBeGreaterThanOrEqual(0);
      expect(tail).toBeLessThan(2 * MP3_GRANULE);
      expect(
        joinMp3([{ frames, recorded: n }], GAP, MP3_ENCODER_DELAY)
      ).toEqual(mp3);
    }
  );
});

describe("silentMp3Frame", () => {
  it("is one valid frame of the piece's format with empty side information", () => {
    const frames = parsed(stored(5000, 1));
    const silence = silentMp3Frame(frames.header);
    const header = readMp3FrameHeader(silence, 0);
    expect(header).not.toBeNull();
    expect(header!.length).toBe(silence.length);
    expect(header!.crc).toBe(false);
    expect(header!.mode).toBe(3);
    // Same bitrate, sample rate and mode as the piece — a legal CBR neighbour.
    expect(parsed(silence).format).toBe(frames.format);
    // Side info all zero: part2_3_length 0, no spectral data, borrows nothing.
    expect(silence.subarray(4, 4 + 17).every((b) => b === 0)).toBe(true);
    expect(parsed(silence).granules).toBe(1);
  });
});

describe("joinMp3", () => {
  it("copies each piece's frames unchanged, in order, with only silence between", () => {
    const pieces = [piece(30_000, 1), piece(7_000, 2), piece(51_234, 3)];
    const joined = joinMp3(pieces, GAP, MP3_ENCODER_DELAY)!;
    expect(joined).not.toBeNull();
    const starts = pieceStarts(joined, pieces);
    expect(starts[0]).toBe(0);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("puts every recording within half a granule of where a single encode puts it", () => {
    const lengths = [30_000, 7_000, 51_234, 1, 1152, 22_050, 99_999];
    const pieces = lengths.map((n, i) => piece(n, i));
    const joined = joinMp3(pieces, GAP, MP3_ENCODER_DELAY)!;
    const starts = pieceStarts(joined, pieces);
    const expected = reencodeStarts(pieces);
    starts.forEach((start, i) => {
      expect(Math.abs(start - expected[i]!)).toBeLessThanOrEqual(
        MP3_GRANULE / 2
      );
    });
  });

  it("does not drift along a long chapter: the target is absolute, not per join", () => {
    // Forty segments whose lengths each round the same way: a per-join
    // rounding would add its error forty times over.
    const pieces = Array.from({ length: 40 }, (_, i) => piece(10_000, i));
    const joined = joinMp3(pieces, GAP, MP3_ENCODER_DELAY)!;
    const starts = pieceStarts(joined, pieces);
    const expected = reencodeStarts(pieces);
    expect(
      Math.abs(starts[starts.length - 1]! - expected[expected.length - 1]!)
    ).toBeLessThanOrEqual(MP3_GRANULE / 2);
  });

  it("comes out within a frame of the length a single encode of the chapter has", () => {
    const lengths = [30_000, 7_000, 51_234];
    const pieces = lengths.map((n, i) => piece(n, i));
    const joined = joinMp3(pieces, GAP, MP3_ENCODER_DELAY)!;
    const pcm = new Int16Array(
      lengths.reduce((sum, n) => sum + n, 0) + GAP * (lengths.length - 1)
    );
    const whole = encodeMp3(pcm);
    expect(
      Math.abs(mp3GranuleCount(joined) - mp3GranuleCount(whole))
    ).toBeLessThanOrEqual(1);
  });

  it("refuses pieces whose formats differ", () => {
    const a = piece(5000, 1);
    const b = piece(5000, 2);
    const other = {
      ...b,
      frames: { ...b.frames, format: b.frames.format ^ 0x100 },
    };
    expect(joinMp3([a, other], GAP, MP3_ENCODER_DELAY)).toBeNull();
  });

  it("refuses a piece whose stream does not cover its recorded length", () => {
    const a = piece(5000, 1);
    // Metadata claiming more samples than the stream holds.
    expect(
      joinMp3([{ ...a, recorded: 50_000 }], GAP, MP3_ENCODER_DELAY)
    ).toBeNull();
    // Or far fewer: the stream runs well past the recording.
    expect(
      joinMp3([{ ...a, recorded: 10 }], GAP, MP3_ENCODER_DELAY)
    ).toBeNull();
  });

  it("joins nothing to nothing", () => {
    expect(joinMp3([], GAP, MP3_ENCODER_DELAY)).toBeNull();
  });
});

describe("parseJoinableMp3", () => {
  const mp3 = stored(20_000, 4);

  it("drops a leading ID3v2 tag and a trailing ID3v1 tag", () => {
    const body = Uint8Array.from({ length: 20 }, (_, i) => i);
    // Synchsafe size 20; flags 0.
    const id3v2 = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20);
    const id3v1 = new Uint8Array(128);
    id3v1.set([0x54, 0x41, 0x47]);
    const tagged = concatBytes(id3v2, body, mp3, id3v1);
    const frames = parsed(tagged);
    expect(Array.from(frames.bytes)).toEqual(Array.from(mp3));
    expect(frames.granules).toBe(mp3GranuleCount(mp3));
  });

  it("drops a leading Xing/Info metadata frame", () => {
    const info = silentMp3Frame(parsed(mp3).header);
    info.set([0x49, 0x6e, 0x66, 0x6f], 4 + 17); // "Info"
    const frames = parsed(concatBytes(info, mp3));
    expect(Array.from(frames.bytes)).toEqual(Array.from(mp3));
  });

  it("refuses bytes after the last frame that are not an ID3v1 tag", () => {
    expect(
      parseJoinableMp3(concatBytes(mp3, Uint8Array.of(1, 2, 3)))
    ).toBeNull();
  });

  it("refuses a truncated last frame", () => {
    expect(parseJoinableMp3(mp3.subarray(0, mp3.length - 5))).toBeNull();
  });

  it("refuses a stream that changes bitrate part-way (not constant bitrate)", () => {
    // A well-formed 80 kbps frame after the 64 kbps ones: every header walks,
    // so only the constant-format check can refuse it.
    const header = new Uint8Array(parsed(mp3).header);
    header[2] = (header[2]! & 0x0f) | 0x60;
    const faster = silentMp3Frame(header);
    expect(parsed(faster).granules).toBe(1);
    expect(parseJoinableMp3(concatBytes(mp3, faster))).toBeNull();
  });

  it("refuses a stream that is not mono", () => {
    const stereo = new Uint8Array(mp3);
    stereo[3] = stereo[3]! & 0x3f; // channel mode 0: stereo
    expect(parseJoinableMp3(stereo)).toBeNull();
  });

  it("refuses a first audio frame that borrows from a bit reservoir", () => {
    const borrows = new Uint8Array(mp3);
    borrows[4] = 0x01; // main_data_begin = 2
    expect(parseJoinableMp3(borrows)).toBeNull();
  });

  it("refuses a stream with no audio frames", () => {
    expect(parseJoinableMp3(new Uint8Array(0))).toBeNull();
    expect(parseJoinableMp3(Uint8Array.of(1, 2, 3, 4, 5))).toBeNull();
  });

  it("refuses a malformed ID3v2 size", () => {
    const bad = Uint8Array.of(0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0);
    expect(parseJoinableMp3(concatBytes(bad, mp3))).toBeNull();
  });
});
