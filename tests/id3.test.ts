import { describe, expect, expectTypeOf, it } from "vitest";

import { type Id3Fields, id3v2Tag, withId3v2 } from "@/lib/audio/id3";
import { encodeMp3 } from "@/lib/audio/mp3";
import { parseJoinableMp3 } from "@/lib/audio/mp3-join";

/**
 * The frames a shared MP3 may carry (#252, S7). Written out here, not
 * imported, so the pin does not move when the writer does: the requirements
 * owner's note is "nothing should be included that potentially compromises
 * the identity of the user", so no artist (TPE1), composer, device or account
 * frame, ever.
 */
const ALLOWED = ["TIT2", "TALB", "TRCK", "TCOP", "COMM"] as const;

const EMPTY: Id3Fields = {
  title: null,
  album: null,
  track: null,
  copyright: null,
  comment: null,
};

const FULL: Id3Fields = {
  title: "Mark 6",
  album: "Mark",
  track: 6,
  copyright: "CC BY-SA 4.0",
  comment: "Open Bible Stories, CC BY-SA 4.0",
};

interface ParsedFrame {
  readonly id: string;
  readonly body: Uint8Array;
}

/** A sync-safe 28-bit integer from four bytes, each below 0x80. */
function syncSafe(bytes: Uint8Array): number {
  for (const b of bytes) expect(b & 0x80).toBe(0);
  return (bytes[0]! << 21) | (bytes[1]! << 14) | (bytes[2]! << 7) | bytes[3]!;
}

/**
 * A minimal ID3v2.3 reader, test-side and independent of the writer: the
 * header, then every frame to the tag's declared end. Throws when a frame runs
 * past the end or the frames do not fill the tag exactly, so nothing can hide
 * in bytes the loop never reached.
 */
function parseTag(bytes: Uint8Array): {
  readonly length: number;
  readonly frames: ParsedFrame[];
} {
  expect([...bytes.subarray(0, 3)]).toEqual([0x49, 0x44, 0x33]); // "ID3"
  expect([bytes[3], bytes[4], bytes[5]]).toEqual([3, 0, 0]); // v2.3.0, no flags
  const size = syncSafe(bytes.subarray(6, 10));
  const end = 10 + size;
  const frames: ParsedFrame[] = [];
  let at = 10;
  while (at < end) {
    const id = String.fromCharCode(...bytes.subarray(at, at + 4));
    const view = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4);
    const length = view.getUint32(0); // v2.3 frame sizes are plain big-endian
    expect([bytes[at + 8], bytes[at + 9]]).toEqual([0, 0]); // no frame flags
    const bodyAt = at + 10;
    if (bodyAt + length > end) throw new Error(`${id} runs past the tag`);
    frames.push({ id, body: bytes.subarray(bodyAt, bodyAt + length) });
    at = bodyAt + length;
  }
  if (at !== end) throw new Error("frames do not fill the tag");
  return { length: end, frames };
}

/** UTF-16 with a little-endian BOM, as the writer emits it. */
function utf16(bytes: Uint8Array): string {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
  let out = "";
  for (let i = 2; i + 1 < bytes.length; i += 2)
    out += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  return out;
}

/** A text frame's value: encoding byte 1 (UTF-16), then the string. */
function textOf(frame: ParsedFrame): string {
  expect(frame.body[0]).toBe(1);
  return utf16(frame.body.subarray(1));
}

/** COMM: encoding, language, an empty terminated description, then the text. */
function commentOf(frame: ParsedFrame): { lang: string; text: string } {
  expect(frame.body[0]).toBe(1);
  const lang = String.fromCharCode(...frame.body.subarray(1, 4));
  expect([...frame.body.subarray(4, 8)]).toEqual([0xff, 0xfe, 0, 0]);
  return { lang, text: utf16(frame.body.subarray(8)) };
}

function fieldsOf(tag: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const frame of parseTag(tag).frames) {
    out[frame.id] = frame.id === "COMM" ? commentOf(frame).text : textOf(frame);
  }
  return out;
}

describe("id3v2Tag (#252)", () => {
  it("writes a one-frame tag byte for byte", () => {
    expect([...id3v2Tag({ ...EMPTY, track: 7 })]).toEqual([
      // "ID3", v2.3.0, no flags, sync-safe size 15
      0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f,
      // "TRCK", size 5, no flags
      0x54, 0x52, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00,
      // UTF-16, BOM FF FE, "7"
      0x01, 0xff, 0xfe, 0x37, 0x00,
    ]);
  });

  it("reads back every field, in a fixed frame order", () => {
    const tag = id3v2Tag(FULL);
    expect(parseTag(tag).frames.map((f) => f.id)).toEqual([...ALLOWED]);
    expect(fieldsOf(tag)).toEqual({
      TIT2: "Mark 6",
      TALB: "Mark",
      TRCK: "6",
      TCOP: "CC BY-SA 4.0",
      COMM: "Open Bible Stories, CC BY-SA 4.0",
    });
    const comm = parseTag(tag).frames.find((f) => f.id === "COMM")!;
    expect(commentOf(comm).lang).toBe("und");
  });

  it("keeps non-Latin text whole, a character outside the BMP included", () => {
    const title = "मरकुस ६ — Марк — 马可 𝄞";
    expect(fieldsOf(id3v2Tag({ ...EMPTY, title, album: "ማርቆስ" }))).toEqual({
      TIT2: title,
      TALB: "ማርቆስ",
    });
  });

  it("writes only allowlisted frames, never an identity frame (S7)", () => {
    // Every field set, plus keys the type does not have: none may reach a frame.
    const extra = {
      ...FULL,
      artist: "a person",
      composer: "a person",
      device: "a phone",
    } as Id3Fields;
    for (const fields of [FULL, extra]) {
      for (const frame of parseTag(id3v2Tag(fields)).frames)
        expect(ALLOWED).toContain(frame.id);
    }
    // And the input type cannot grow a field without this pin moving with it.
    expectTypeOf<keyof Id3Fields>().toEqualTypeOf<
      "title" | "album" | "track" | "copyright" | "comment"
    >();
  });

  it("leaves out a field that is null or empty, and writes no tag at all for none", () => {
    expect(
      parseTag(id3v2Tag({ ...EMPTY, title: "", album: "Mark" })).frames.map(
        (f) => f.id
      )
    ).toEqual(["TALB"]);
    expect(id3v2Tag(EMPTY).length).toBe(0);
  });

  it("writes no TRCK for a number that is not a positive whole number", () => {
    for (const track of [0, -1, 1.5, Number.NaN])
      expect(id3v2Tag({ ...EMPTY, track }).length).toBe(0);
  });

  it("encodes a tag over 127 bytes with a sync-safe size", () => {
    const comment = "x".repeat(300);
    const tag = id3v2Tag({ ...EMPTY, comment });
    // Tag header, then one frame: its 10-byte header and a body of
    // 1 + 3 + 4 + 2 + 600 bytes of UTF-16 — 620 bytes after the tag header.
    expect(tag.length).toBe(10 + 620);
    expect([...tag.subarray(6, 10)]).toEqual([0, 0, 0x04, 0x6c]); // 620
    expect(parseTag(tag).length).toBe(tag.length);
    expect(fieldsOf(tag).COMM).toBe(comment);
  });
});

describe("withId3v2 (#252)", () => {
  const mp3 = encodeMp3(new Int16Array(4410).fill(500));

  it("puts the tag before the audio and leaves the audio buffer as it is", () => {
    const [tag, audio] = withId3v2(mp3, FULL);
    expect(tag).toEqual(id3v2Tag(FULL));
    expect(audio).toBe(mp3); // the same buffer, not a copy
  });

  it("gives a file a decoder skips straight to the same frames", () => {
    const parts = withId3v2(mp3, FULL);
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      file.set(p, at);
      at += p.length;
    }
    expect(parseTag(file).length).toBe(parts[0]!.length);
    expect(parseJoinableMp3(file)!.bytes).toEqual(parseJoinableMp3(mp3)!.bytes);
  });

  it("refuses an MP3 that already carries an ID3v2 tag: a file has one tag", () => {
    const [tag] = withId3v2(mp3, FULL);
    const tagged = new Uint8Array(tag!.length + mp3.length);
    tagged.set(tag!);
    tagged.set(mp3, tag!.length);
    expect(() => withId3v2(tagged, FULL)).toThrow(/already/);
  });

  it("hands back the audio alone when there is nothing to write", () => {
    const parts = withId3v2(mp3, EMPTY);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(mp3);
  });
});
