import { afterEach, describe, expect, it } from "vitest";

import * as stringsModule from "@/lib/strings";
import {
  installStrings,
  strings,
  stringsEn,
  type Strings,
} from "@/lib/strings";

/**
 * `strings` is a live binding, and an entry that embeds another entry resolves
 * it within the table it was read from (#1480, #169).
 *
 * The equality pins elsewhere (`chapterHeading(null, n) === chapterName(n)`)
 * cannot see a wrong-table call: both sides go through the same table and
 * agree. These install a table whose embedded entries return a sentinel and
 * require the sentinel to come out of every entry that embeds them. An entry
 * that still called the module's English table would keep returning English
 * here, which is what turns these red.
 */

afterEach(() => installStrings(stringsEn));

const S = {
  chapterName: "CHAPTER-SENTINEL",
  segmentHeading: "SEGMENT-SENTINEL",
  shareMissing: "SHAREMISSING-SENTINEL",
  shareBookMissing: "BOOKMISSING-SENTINEL",
  takeRecoverDiscard: "DISCARD-SENTINEL",
  takeRecoverDiscardArmed: "DISCARDARMED-SENTINEL",
  takeRecoverDiscardHint: "DISCARDHINT-SENTINEL",
} as const;

const sentinelTable: Strings = {
  ...stringsEn,
  chapterName: () => S.chapterName,
  segmentHeading: () => S.segmentHeading,
  shareMissing: () => S.shareMissing,
  shareBookMissing: () => S.shareBookMissing,
  takeRecoverDiscard: S.takeRecoverDiscard,
  takeRecoverDiscardArmed: S.takeRecoverDiscardArmed,
  takeRecoverDiscardHint: S.takeRecoverDiscardHint,
};

/** Each entry that embeds another, with the sentinel it must carry. */
const EMBEDDERS: ReadonlyArray<
  readonly [string, (t: Strings) => string, string]
> = [
  ["chapterHeading", (t) => t.chapterHeading(null, 3), S.chapterName],
  ["editSegment", (t) => t.editSegment(1, null), S.segmentHeading],
  [
    "editSegmentFinished",
    (t) => t.editSegmentFinished(1, null),
    S.segmentHeading,
  ],
  ["openSegment", (t) => t.openSegment(1, null), S.segmentHeading],
  [
    "recorderBreadcrumb",
    (t) => t.recorderBreadcrumb("Book", "Chapter", 1, null),
    S.segmentHeading,
  ],
  ["shareFilename", (t) => t.shareFilename("Book", 4), S.chapterName],
  ["shareBookPartial", (t) => t.shareBookPartial(2), S.shareMissing],
  [
    "shareBookMissingAndPartial",
    (t) => t.shareBookMissingAndPartial(1, 1, 1),
    S.shareBookMissing,
  ],
  [
    "saveFailedDiscard (record, idle)",
    (t) => t.saveFailedDiscard(false, false),
    S.takeRecoverDiscard,
  ],
  [
    "saveFailedDiscard (record, armed)",
    (t) => t.saveFailedDiscard(false, true),
    S.takeRecoverDiscardArmed,
  ],
  [
    "saveFailedDiscardHint",
    (t) => t.saveFailedDiscardHint(false),
    S.takeRecoverDiscardHint,
  ],
];

describe("an installed table is the one the UI reads (#1480)", () => {
  it("serves English until something installs another", () => {
    expect(strings).toBe(stringsEn);
  });

  it("repoints the binding, including for a module that imported it earlier", () => {
    // `import * as` reads the exported binding live at each access; a copy
    // taken at import time would still be English after the install.
    expect(stringsModule.strings.newBook).toBe("New book");
    installStrings({ ...stringsEn, newBook: "NEWBOOK-SENTINEL" });
    expect(stringsModule.strings.newBook).toBe("NEWBOOK-SENTINEL");
    expect(strings.newBook).toBe("NEWBOOK-SENTINEL");
  });

  it("indexes the installed table dynamically, as the screens do", () => {
    installStrings({ ...stringsEn, dbBlocked: "DBBLOCKED-SENTINEL" });
    const key = "dbBlocked" as const;
    expect(strings[key]).toBe("DBBLOCKED-SENTINEL");
  });
});

describe("an entry that embeds another resolves it within its own table (#169)", () => {
  it.each(EMBEDDERS)(
    "%s carries the wording of the table it was read from",
    (_n, call, sentinel) => {
      // Read from a table that is NOT installed: an entry that went through
      // the module binding would answer in English here.
      expect(call(stringsEn)).not.toContain(sentinel);
      expect(call(sentinelTable)).toContain(sentinel);
    }
  );

  it.each(EMBEDDERS)(
    "%s carries the wording of the installed table when read through the binding",
    (_n, call, sentinel) => {
      installStrings(sentinelTable);
      expect(call(strings)).toContain(sentinel);
    }
  );

  it("covers every entry the self-reference pin lists as reaching `this`", () => {
    expect(EMBEDDERS).toHaveLength(11);
  });

  it("follows a table that is not the installed one", () => {
    // `this` is the table the entry was read from, not whichever is active.
    expect(sentinelTable.chapterHeading(null, 3)).toBe(S.chapterName);
    expect(strings.chapterHeading(null, 3)).not.toBe(S.chapterName);
  });
});
