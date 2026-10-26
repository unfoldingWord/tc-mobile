/**
 * An ID3v2.3 tag for a shared MP3 (#252).
 *
 * The requirements owner, S7: "Also write title, comment and copyright inside
 * the MP3 in v2", with the note "nothing should be included that potentially
 * compromises the identity of the user." So the tag is an ALLOWLIST, fixed by
 * the shape of {@link Id3Fields}: a title (TIT2), an album (TALB), a track
 * number (TRCK), a copyright line (TCOP) and a comment (COMM). There is no
 * artist, composer, device or account frame, and no way to ask for one; the
 * test that pins this lists the five frames itself (`tests/id3.test.ts`).
 *
 * Only a SHARED file is tagged. A stored clip stays as the encoder wrote it:
 * the join (`mp3-join.ts`) drops any tag it meets, and the decode and
 * transcode paths never see a tag from this module.
 *
 * Version 2.3, not 2.4, because more players read it. Text is UTF-16 with a
 * byte-order mark (encoding 1), the one v2.3 encoding that carries a name in
 * any script. Frame sizes are plain big-endian in v2.3; only the tag's own
 * size is sync-safe. No padding, no extended header, no unsynchronisation.
 *
 * Pure: strings in, bytes out.
 */

/**
 * What a shared MP3's tag may say. Every field is `null` (or empty) when there
 * is nothing to write, and that frame is then left out.
 */
export interface Id3Fields {
  /** TIT2: the chapter's own name. */
  readonly title: string | null;
  /** TALB: the book's name. */
  readonly album: string | null;
  /** TRCK: the chapter's number; a positive whole number, or no frame. */
  readonly track: number | null;
  /** TCOP: the licence label, only when a licence was chosen. */
  readonly copyright: string | null;
  /** COMM: a template's attribution, only for a book made from one. */
  readonly comment: string | null;
}

/** ISO 639-2 "undetermined": the attribution's language is not recorded. */
const COMMENT_LANGUAGE = "und";

/** The UTF-16 byte-order mark, little-endian. */
const BOM = [0xff, 0xfe] as const;

/** `text` as UTF-16LE code units after a BOM. */
function utf16(text: string): number[] {
  const out: number[] = [...BOM];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out.push(unit & 0xff, unit >> 8);
  }
  return out;
}

/** One frame: a four-letter id, a big-endian size, two zero flag bytes, the body. */
function frame(id: string, body: readonly number[]): number[] {
  const size = body.length;
  return [
    ...[...id].map((c) => c.charCodeAt(0)),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    0,
    0,
    ...body,
  ];
}

const textFrame = (id: string, text: string): number[] =>
  frame(id, [1, ...utf16(text)]);

/** COMM: encoding, language, an empty description (BOM + terminator), the text. */
const commentFrame = (text: string): number[] =>
  frame("COMM", [
    1,
    ...[...COMMENT_LANGUAGE].map((c) => c.charCodeAt(0)),
    ...BOM,
    0,
    0,
    ...utf16(text),
  ]);

const present = (text: string | null): text is string =>
  text !== null && text.length > 0;

/**
 * The tag for `fields`, or an empty array when no field has anything to say —
 * a tag must hold at least one frame. Frames are written in one fixed order:
 * TIT2, TALB, TRCK, TCOP, COMM.
 */
export function id3v2Tag(fields: Id3Fields): Uint8Array<ArrayBuffer> {
  const { title, album, track, copyright, comment } = fields;
  const frames: number[] = [];
  if (present(title)) frames.push(...textFrame("TIT2", title));
  if (present(album)) frames.push(...textFrame("TALB", album));
  if (track !== null && Number.isInteger(track) && track > 0)
    frames.push(...textFrame("TRCK", String(track)));
  if (present(copyright)) frames.push(...textFrame("TCOP", copyright));
  if (present(comment)) frames.push(...commentFrame(comment));
  if (frames.length === 0) return new Uint8Array(0);

  const size = frames.length;
  if (size >= 1 << 28) throw new Error("ID3 tag too large");
  return Uint8Array.from([
    0x49, // I
    0x44, // D
    0x33, // 3
    3, // version 2.3
    0, // revision 0
    0, // flags: none
    (size >>> 21) & 0x7f, // sync-safe: seven bits a byte
    (size >>> 14) & 0x7f,
    (size >>> 7) & 0x7f,
    size & 0x7f,
    ...frames,
  ]);
}

/** Whether `mp3` already opens with an ID3v2 header. */
function hasId3v2(mp3: Uint8Array): boolean {
  return mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33;
}

/**
 * A shared file as its parts, in order: the tag, then `mp3` itself (the same
 * buffer, not a copy), or `mp3` alone when there is nothing to tag. A caller
 * hands the parts on as they are — `new File(parts)`, or one zip push each —
 * so the chapter's MP3 is never copied to make room for the tag.
 *
 * Throws on an `mp3` that already starts with an ID3v2 tag: a shared file
 * carries exactly one, and the export never builds one that has another.
 */
export function withId3v2(
  mp3: Uint8Array<ArrayBuffer>,
  fields: Id3Fields
): Uint8Array<ArrayBuffer>[] {
  if (hasId3v2(mp3)) throw new Error("MP3 already carries an ID3v2 tag");
  const tag = id3v2Tag(fields);
  return tag.length === 0 ? [mp3] : [tag, mp3];
}
