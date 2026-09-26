import { describe, expect, it } from "vitest";

import {
  COVER_COLOUR_KEYS,
  coverColourHex,
  resolveCoverKey,
  type CoverColourKey,
} from "@/lib/cover-colour";
import type { Book, BookId } from "@/types/domain";

/**
 * `resolveCoverKey` is the one function #957 promises: a book's own chosen
 * palette key when it has a live one, otherwise a stable, deterministic
 * fallback derived from its id — never a crash, never a re-roll.
 *
 * Only the two fields `resolveCoverKey` actually reads are built here
 * (`Pick<Book, "id" | "coverColourKey">`), per its own docblock.
 */
const book = (
  id: string,
  coverColourKey: string | null
): Pick<Book, "id" | "coverColourKey"> => ({
  id: id as BookId,
  coverColourKey,
});

describe("the palette", () => {
  it("has the ten final keys (#937 D8b, decided 2026-09-25)", () => {
    expect(COVER_COLOUR_KEYS.length).toBe(10);
    // The round-1 candidates D8b dropped must actually be gone, not just
    // uncounted — a size-only assertion would pass just as well with two
    // OTHER keys missing instead.
    expect(COVER_COLOUR_KEYS).not.toContain("mulberry");
    expect(COVER_COLOUR_KEYS).not.toContain("pine");
  });

  it("gives every key a distinct 6-digit hex", () => {
    const hexes = COVER_COLOUR_KEYS.map((k) => coverColourHex(k));
    expect(hexes.every((h) => /^#[0-9a-f]{6}$/.test(h))).toBe(true);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("resolveCoverKey", () => {
  it("trusts a stored key that is still in the live palette", () => {
    const chosen: CoverColourKey = COVER_COLOUR_KEYS[3]!;
    expect(resolveCoverKey(book("b1", chosen))).toBe(chosen);
  });

  it("falls back to a derived key when nothing is chosen (null)", () => {
    const resolved = resolveCoverKey(book("b1", null));
    expect(COVER_COLOUR_KEYS).toContain(resolved);
  });

  it("falls back deterministically for a key the live palette no longer has, rather than throwing (D8b's real trim)", () => {
    // "pine" is not a hypothetical stand-in: it was one of the twelve round-1
    // candidates and D8b (2026-09-25, #937 issuecomment-5837859829) actually
    // dropped it. A book coloured "pine" before that decision must keep
    // resolving to something in the CURRENT ten-key palette, not crash and
    // not paint a broken swatch.
    expect(() => resolveCoverKey(book("b1", "pine"))).not.toThrow();
    const resolved = resolveCoverKey(book("b1", "pine"));
    expect(COVER_COLOUR_KEYS).toContain(resolved);
    expect(resolved).not.toBe("pine");
  });

  it("falls back for the empty string, never treating it as a live key", () => {
    const resolved = resolveCoverKey(book("b1", ""));
    expect(COVER_COLOUR_KEYS).toContain(resolved);
  });

  it("is stable across repeated calls for the same book (no re-roll)", () => {
    const first = resolveCoverKey(book("same-id", null));
    for (let i = 0; i < 20; i++) {
      expect(resolveCoverKey(book("same-id", null))).toBe(first);
    }
  });

  it("is stable across repeated calls for an unrecognised stored key too", () => {
    const first = resolveCoverKey(book("same-id", "not-a-real-key"));
    for (let i = 0; i < 20; i++) {
      expect(resolveCoverKey(book("same-id", "not-a-real-key"))).toBe(first);
    }
  });

  it("gives two different book ids with no chosen colour independent rolls, not the same key for every book", () => {
    // Not a claim that DIFFERENT ids never collide (10 keys, pigeonhole makes
    // that certain eventually) — a claim that they don't ALL collide, which a
    // constant-fallback regression (mutating fallbackKey to always return
    // index 0) would produce.
    const ids = Array.from({ length: 60 }, (_, i) => `book-${i}`);
    const resolved = new Set(ids.map((id) => resolveCoverKey(book(id, null))));
    expect(resolved.size).toBeGreaterThan(1);
  });

  it("spreads fallback rolls across the whole palette, not a narrow slice of it", () => {
    // A fixed, deterministic set of ids (not random — reproducible on every
    // run) large enough that, with an even-ish hash, every key gets hit at
    // least once. This is the spread property the hash's distribution has to
    // hold for a shelf of many uncoloured books to look varied rather than
    // mostly-one-colour.
    const ids = Array.from({ length: 400 }, (_, i) => `book-${i}`);
    const resolved = new Set(ids.map((id) => resolveCoverKey(book(id, null))));
    expect(resolved.size).toBe(COVER_COLOUR_KEYS.length);
  });

  it("gives a book with a live chosen key priority over any hash at all", () => {
    // Two ids that would otherwise land on different fallback keys both agree
    // once they carry the SAME explicit choice.
    const chosen: CoverColourKey = COVER_COLOUR_KEYS[0]!;
    expect(resolveCoverKey(book("book-1", chosen))).toBe(chosen);
    expect(resolveCoverKey(book("book-2", chosen))).toBe(chosen);
  });
});
