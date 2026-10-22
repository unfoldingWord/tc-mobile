import { describe, expect, it } from "vitest";

import { USFM_BOOK_CODES } from "@/lib/export/bundle/metadata";
import { BIBLE_BOOKS, bibleBookByCode } from "@/lib/templates/bible-books";

/**
 * The 66-book table (#1606, part of #1450 and #253). The expected list below
 * is typed out here on purpose, apart from the module: a test that derived
 * its expectation from the table could not catch a wrong row in it.
 * Chapter counts are the standard Protestant canon, KJV versification.
 */
const EXPECTED = (
  "GEN:50 EXO:40 LEV:27 NUM:36 DEU:34 JOS:24 JDG:21 RUT:4 1SA:31 2SA:24 " +
  "1KI:22 2KI:25 1CH:29 2CH:36 EZR:10 NEH:13 EST:10 JOB:42 PSA:150 PRO:31 " +
  "ECC:12 SNG:8 ISA:66 JER:52 LAM:5 EZK:48 DAN:12 HOS:14 JOL:3 AMO:9 " +
  "OBA:1 JON:4 MIC:7 NAM:3 HAB:3 ZEP:3 HAG:2 ZEC:14 MAL:4 " +
  "MAT:28 MRK:16 LUK:24 JHN:21 ACT:28 ROM:16 1CO:16 2CO:13 GAL:6 EPH:6 " +
  "PHP:4 COL:4 1TH:5 2TH:3 1TI:6 2TI:4 TIT:3 PHM:1 HEB:13 JAS:5 1PE:5 " +
  "2PE:3 1JN:5 2JN:1 3JN:1 JUD:1 REV:22"
)
  .split(" ")
  .map((pair) => {
    const [code = "", count = ""] = pair.split(":");
    return { code, chapterCount: Number(count) };
  });

const sum = (rows: readonly { chapterCount: number }[]): number =>
  rows.reduce((total, row) => total + row.chapterCount, 0);

describe("BIBLE_BOOKS", () => {
  it("has 66 rows whose codes and chapter counts match the independent list, in canonical order", () => {
    expect(EXPECTED).toHaveLength(66);
    expect(
      BIBLE_BOOKS.map(({ code, chapterCount }) => ({ code, chapterCount }))
    ).toEqual(EXPECTED);
  });

  it("has unique codes, each one the spec's USFM code", () => {
    const codes = BIBLE_BOOKS.map((book) => book.code);
    expect(new Set(codes).size).toBe(66);
    for (const code of codes) expect(USFM_BOOK_CODES.has(code)).toBe(true);
  });

  it("totals 929 OT, 260 NT and 1189 overall", () => {
    const ot = BIBLE_BOOKS.slice(0, 39);
    const nt = BIBLE_BOOKS.slice(39);
    expect(ot).toHaveLength(39);
    expect(nt).toHaveLength(27);
    expect(sum(ot)).toBe(929);
    expect(sum(nt)).toBe(260);
    expect(sum(BIBLE_BOOKS)).toBe(1189);
  });

  it("gives every row a non-empty, distinct English name; spot checks", () => {
    const names = BIBLE_BOOKS.map((book) => book.name);
    for (const name of names) expect(name.trim()).not.toBe("");
    expect(new Set(names).size).toBe(66);
    expect(bibleBookByCode("PSA")).toEqual({
      code: "PSA",
      name: "Psalms",
      chapterCount: 150,
      testament: "OT",
    });
    expect(bibleBookByCode("SNG")?.name).toBe("Song of Solomon");
    expect(bibleBookByCode("REV")?.name).toBe("Revelation");
    expect(bibleBookByCode("1JN")?.name).toBe("1 John");
    expect(bibleBookByCode("TOB")).toBeUndefined();
  });

  it("tags the first 39 rows OT and the last 27 NT", () => {
    expect(BIBLE_BOOKS.filter((b) => b.testament === "OT")).toHaveLength(39);
    expect(BIBLE_BOOKS[38]?.code).toBe("MAL");
    expect(BIBLE_BOOKS[38]?.testament).toBe("OT");
    expect(BIBLE_BOOKS[39]?.code).toBe("MAT");
    expect(BIBLE_BOOKS[39]?.testament).toBe("NT");
  });
});
