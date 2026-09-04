/**
 * Export filenames (Q-18, #163). These names were untested `strings` entries
 * that interpolated a translator-typed book name straight into a `File` name. A
 * book called `1/2 Kings` produced `1/2 Kings - Chapter 1.mp3` — a path
 * separator inside a filename, which a share target may read as a directory, an
 * Android MediaStore insert rejects, and Windows will not write at all.
 *
 * S-11 (names not unique across devices or books) is NOT this module's problem;
 * it rides on the export manifest (#115). These tests only assert the name is
 * *safe*, not that it is unique.
 */
import { describe, expect, it } from "vitest";

import { shareBookFilename, shareFilename } from "@/lib/export/naming";

describe("shareFilename", () => {
  it("names a chapter MP3 from the book and the chapter number", () => {
    expect(shareFilename("Genesis", 1)).toBe("Genesis - Chapter 1.mp3");
    expect(shareFilename("Genesis", 50)).toBe("Genesis - Chapter 50.mp3");
  });

  it("replaces path separators so the name cannot read as a path", () => {
    expect(shareFilename("1/2 Kings", 3)).toBe("1_2 Kings - Chapter 3.mp3");
    expect(shareFilename("a\\b", 1)).toBe("a_b - Chapter 1.mp3");
    expect(shareFilename("../etc", 1)).toBe(".._etc - Chapter 1.mp3");
  });

  it("replaces control characters", () => {
    // Built from char codes rather than written literally: a raw control
    // character in a source file is invisible to the next reader.
    const name = `Ge${String.fromCharCode(7)}ne${String.fromCharCode(
      10
    )}sis${String.fromCharCode(127)}`;
    expect(shareFilename(name, 1)).toBe("Ge_ne_sis_ - Chapter 1.mp3");
  });

  it("replaces the characters Windows and iOS reject", () => {
    expect(shareFilename('Job: why? "x" <y> |z| *', 2)).toBe(
      "Job_ why_ _x_ _y_ _z_ _ - Chapter 2.mp3"
    );
  });

  it("collapses a run of unsafe characters into one separator", () => {
    expect(shareFilename("Acts//??Kings", 1)).toBe(
      "Acts_Kings - Chapter 1.mp3"
    );
  });

  it("trims surrounding whitespace and trailing dots", () => {
    expect(shareFilename("  Ruth  ", 1)).toBe("Ruth - Chapter 1.mp3");
    expect(shareFilename("Ruth...", 1)).toBe("Ruth - Chapter 1.mp3");
  });

  it("falls back to a safe default when the name empties", () => {
    expect(shareFilename("", 1)).toBe("Book - Chapter 1.mp3");
    expect(shareFilename("   ", 1)).toBe("Book - Chapter 1.mp3");
  });
});

describe("shareBookFilename", () => {
  it("names a book zip from the book name", () => {
    expect(shareBookFilename("Genesis")).toBe("Genesis.zip");
  });

  it("sanitises the book name the same way", () => {
    expect(shareBookFilename("1/2 Kings")).toBe("1_2 Kings.zip");
    expect(shareBookFilename("a\\b:c")).toBe("a_b_c.zip");
  });

  it("falls back to a safe default when the name empties", () => {
    expect(shareBookFilename("")).toBe("Book.zip");
    expect(shareBookFilename(" \t ")).toBe("Book.zip");
  });
});
