import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  BundleAudio,
  BundleBookInput,
  BundleSegmentInput,
} from "@/lib/export/bundle/input";
import { InvalidExportTimeError } from "@/lib/export/bundle/input";
import {
  buildBundleMetadata,
  scopeString,
  USFM_BOOK_CODES,
} from "@/lib/export/bundle/metadata";
import { buildProjectManifest } from "@/lib/export/bundle/project";
import type { ClipMeta } from "@/types/audio";
import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  ClipId,
  Segment,
  SegmentId,
  TakeId,
} from "@/types/domain";
import type { LicenceId, SegmentSpan } from "@/types/template";

import { validateBundleMetadata } from "./support/scripture-bundle-schema";

/**
 * The Scripture Bundle builders (#1567, ADR 0014). The worked examples are
 * rebuilt from fixtures and held to the vendored v1.0.0 gate (#1478); the
 * reasons the flavour, copyright and project rules exist are asserted one by
 * one. The builders are pure, so nothing here needs a browser.
 */

const EXAMPLES = path.resolve(
  import.meta.dirname,
  "fixtures/scripture-bundle/examples"
);
function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(EXAMPLES, name), "utf8"));
}

const BOOK_ID = "0b5c6f0e-1111-4222-8333-944445555666";
const EXPORTED_AT = Date.parse("2026-11-20T10:00:00.000Z");
const PROJECT = { size: 2048, md5: "c32e9efa2f1af2064e513c807d606421" };

const MARK_1_1_8: SegmentSpan = {
  book: "MRK",
  startChapter: 1,
  startVerse: 1,
  endChapter: 1,
  endVerse: 8,
};
const MARK_1_9_13: SegmentSpan = { ...MARK_1_1_8, startVerse: 9, endVerse: 13 };

function clip(
  id: string,
  encoding: "pcm" | "mp3",
  byteLength: number
): ClipMeta {
  return {
    id: id as ClipId,
    sampleRate: 44100,
    frameCount: 44100,
    durationMs: 1000,
    createdAt: 1,
    encoding,
    generation: encoding === "mp3" ? 1 : 0,
    byteLength,
    transcodeStallCount: 0,
    peaks: null,
    processing: null,
  };
}

const MP3: BundleAudio = {
  clip: clip("clip-1", "mp3", 277053),
  size: 277053,
  md5: "d32e9efa2f1af2064e513c807d606421",
};
const WAV: BundleAudio = {
  clip: clip("clip-2", "pcm", 5292000),
  size: 5292044,
  md5: "a32e9efa2f1af2064e513c807d606421",
};

function seg(
  n: number,
  reference: SegmentSpan | null,
  audio: BundleAudio | null,
  opts: { take?: boolean } = {}
): BundleSegmentInput {
  const hasTake = opts.take ?? audio !== null;
  return {
    segment: {
      id: `seg-${n}` as SegmentId,
      chapterId: "ch-1" as ChapterId,
      index: n,
      reference,
      label: null,
      activeTakeId: hasTake ? (`take-${n}` as TakeId) : null,
      status: audio === null ? "not-started" : "affirmed",
      createdAt: 1,
      modifiedAt: null,
      templateKey: null,
      audioRevision: 0,
    } satisfies Segment,
    take: hasTake
      ? {
          id: `take-${n}` as TakeId,
          segmentId: `seg-${n}` as SegmentId,
          clipId: (audio?.clip.id ?? "gone") as ClipId,
          createdAt: 2,
          durationMs: 1000,
        }
      : null,
    audio,
  };
}

function bookInput(
  segments: BundleSegmentInput[],
  over: Partial<Book> = {}
): BundleBookInput {
  const chapter: Chapter = {
    id: "ch-1" as ChapterId,
    bookId: BOOK_ID as BookId,
    number: 1,
    name: null,
    segmentIds: segments.map((s) => s.segment.id),
    createdAt: 1,
    modifiedAt: null,
    templateKey: null,
  };
  const book: Book = {
    id: BOOK_ID as BookId,
    name: "Mark",
    number: 1,
    languageCode: "sw",
    chapterIds: [chapter.id],
    createdAt: 1,
    updatedAt: 1,
    coverColourKey: null,
    shelfPosition: 0,
    provenance: { kind: "blank" },
    licence: "CC-BY-SA-4.0",
    modifiedAt: null,
    ...over,
  };
  return {
    book,
    bookName: "Mark",
    chapters: [{ chapter, segments }],
    appVersion: "2.0.0",
    defaultLocale: "en",
    exportedAt: EXPORTED_AT,
    languageName: "Swahili",
  };
}

/** The input without the optional language name, as the caller has it before #1492. */
function unnamedLanguage(input: BundleBookInput): BundleBookInput {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "languageName")
  ) as unknown as BundleBookInput;
}

const referencedBook = () =>
  bookInput([seg(1, MARK_1_1_8, MP3), seg(2, MARK_1_9_13, WAV)]);
const otherBook = () => bookInput([seg(1, null, MP3), seg(2, null, WAV)]);

describe("the worked examples of ADR 0014 are rebuilt and pass the gate", () => {
  it("rebuilds the referenced-book example exactly", () => {
    const doc = buildBundleMetadata(referencedBook(), PROJECT);
    expect(doc).toEqual(example("referenced-audioTranslation.json"));
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("rebuilds the any-other-book example exactly", () => {
    const doc = buildBundleMetadata(otherBook(), PROJECT);
    expect(doc).toEqual(example("custom-x-tcMobileAudio.json"));
    expect(validateBundleMetadata(doc)).toEqual([]);
  });
});

describe("the flavour rule (ADR 0014 point 2)", () => {
  const OBS_SPAN: SegmentSpan = {
    book: "OBS",
    startChapter: 3,
    startVerse: 2,
    endChapter: 3,
    endVerse: 2,
  };

  it("takes the custom flavour, with no currentScope, for a book of only OBS segments", () => {
    const input = bookInput([
      seg(1, OBS_SPAN, MP3),
      seg(2, { ...OBS_SPAN, startVerse: 3, endVerse: 3 }, WAV),
    ]);
    const doc = buildBundleMetadata(input, PROJECT) as {
      type: { flavorType: Record<string, unknown> };
      ingredients: Record<string, Record<string, unknown>>;
    };
    expect(doc.type.flavorType).toEqual({
      name: "parascriptural",
      flavor: { name: "x-tcMobileAudio" },
    });
    expect(doc.type.flavorType).not.toHaveProperty("currentScope");
    expect(Object.values(doc.ingredients).some((i) => "scope" in i)).toBe(
      false
    );
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("takes the custom flavour when one recorded segment has no reference", () => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, MP3), seg(2, null, WAV)]),
      PROJECT
    ) as { type: { flavorType: { name: string } } };
    expect(doc.type.flavorType.name).toBe("parascriptural");
  });

  it("takes the custom flavour for references spread over two books", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(1, MARK_1_1_8, MP3),
        seg(2, { ...MARK_1_9_13, book: "LUK" }, WAV),
      ]),
      PROJECT
    ) as { type: { flavorType: { name: string } } };
    expect(doc.type.flavorType.name).toBe("parascriptural");
  });

  it("ignores an unrecorded segment's missing reference", () => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, MP3), seg(2, null, null)]),
      PROJECT
    ) as { type: { flavorType: { name: string } } };
    expect(doc.type.flavorType.name).toBe("scripture");
  });

  it("takes the custom flavour when nothing is recorded, and still validates", () => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, null)]),
      PROJECT
    ) as { type: { flavorType: { name: string } } };
    expect(doc.type.flavorType.name).toBe("parascriptural");
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("lists only the formats present, and validates a span across a chapter", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(
          1,
          { ...MARK_1_1_8, startVerse: 9, endChapter: 2, endVerse: 3 },
          MP3
        ),
      ]),
      PROJECT
    ) as {
      type: {
        flavorType: {
          flavor: { formats: Record<string, unknown> };
          currentScope: unknown;
        };
      };
    };
    expect(Object.keys(doc.type.flavorType.flavor.formats)).toEqual(["mp3"]);
    expect(doc.type.flavorType.currentScope).toEqual({ MRK: ["1:9-2:3"] });
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("writes each distinct scope once", () => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, MP3), seg(2, MARK_1_1_8, WAV)]),
      PROJECT
    ) as { type: { flavorType: { currentScope: unknown } } };
    expect(doc.type.flavorType.currentScope).toEqual({ MRK: ["1:1-8"] });
  });

  it("takes the custom flavour, with no scope, for a span with one verse null", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(1, { ...MARK_1_1_8, startVerse: 5, endVerse: null }, MP3),
      ]),
      PROJECT
    ) as {
      type: { flavorType: Record<string, unknown> };
      ingredients: Record<string, Record<string, unknown>>;
    };
    expect(doc.type.flavorType.name).toBe("parascriptural");
    expect(doc.type.flavorType).not.toHaveProperty("currentScope");
    expect(Object.values(doc.ingredients).some((i) => "scope" in i)).toBe(
      false
    );
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("writes the clips' own sampling rate in formats", () => {
    const mp3At16k: BundleAudio = {
      ...MP3,
      clip: { ...MP3.clip, sampleRate: 16000 },
    };
    const wavAt22k: BundleAudio = {
      ...WAV,
      clip: { ...WAV.clip, sampleRate: 22050 },
    };
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, mp3At16k), seg(2, MARK_1_9_13, wavAt22k)]),
      PROJECT
    ) as {
      type: {
        flavorType: {
          flavor: { formats: Record<string, { samplingRate: number }> };
        };
      };
    };
    const formats = doc.type.flavorType.flavor.formats;
    expect(formats.mp3!.samplingRate).toBe(16000);
    expect(formats.wav!.samplingRate).toBe(22050);
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("takes the custom flavour when the clips of one codec disagree on rate", () => {
    const mp3At16k: BundleAudio = {
      ...MP3,
      clip: { ...MP3.clip, sampleRate: 16000 },
    };
    const doc = buildBundleMetadata(
      bookInput([seg(1, MARK_1_1_8, MP3), seg(2, MARK_1_9_13, mp3At16k)]),
      PROJECT
    ) as { type: { flavorType: { name: string } } };
    expect(doc.type.flavorType.name).toBe("parascriptural");
    expect(validateBundleMetadata(doc)).toEqual([]);
  });
});

describe("meta.normalization is NFC, and the strings written are", () => {
  it("normalises the book and language names", () => {
    const input = {
      ...bookInput([seg(1, MARK_1_1_8, MP3)]),
      bookName: "Café",
      languageName: "Kiswahilí",
    };
    const doc = buildBundleMetadata(input, PROJECT) as {
      identification: { name: Record<string, string> };
      languages: { name: Record<string, string> }[];
      localizedNames: Record<string, { short: Record<string, string> }>;
    };
    expect(doc.identification.name.en).toBe("Café");
    expect(doc.localizedNames["book-mrk"]!.short.en).toBe("Café");
    expect(doc.languages[0]!.name.en).toBe("Kiswahilí".normalize("NFC"));
  });
});

describe("scopeString writes the spec grammar", () => {
  it.each([
    [{ ...MARK_1_1_8, startVerse: null, endVerse: null }, "1"],
    [{ ...MARK_1_1_8, startVerse: null, endVerse: null, endChapter: 3 }, "1-3"],
    [{ ...MARK_1_1_8, endVerse: 1 }, "1:1"],
    [MARK_1_9_13, "1:9-13"],
    [{ ...MARK_1_1_8, endChapter: 2, endVerse: 3 }, "1:1-2:3"],
  ])("%j is %s", (span, expected) => {
    expect(scopeString(span)).toBe(expected);
  });
});

describe("copyright (ADR 0014 point 6): licenses and shortStatements never together", () => {
  const ALL: (LicenceId | null)[] = [
    "CC-BY-SA-4.0",
    "CC-BY-4.0",
    "CC0-1.0",
    "all-rights-reserved",
    null,
  ];

  it.each(ALL)(
    "writes exactly one of the two for licence %s, and validates",
    (licence) => {
      const doc = buildBundleMetadata(
        bookInput([seg(1, MARK_1_1_8, MP3)], { licence }),
        PROJECT
      ) as { copyright: Record<string, unknown> };
      const keys = Object.keys(doc.copyright);
      expect(keys).toHaveLength(1);
      expect(validateBundleMetadata(doc)).toEqual([]);
    }
  );

  it.each([
    ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0/"],
    ["CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  ] as const)("maps %s to its URL", (licence, url) => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, null, MP3)], { licence }),
      PROJECT
    ) as { copyright: unknown };
    expect(doc.copyright).toEqual({ licenses: [{ url }] });
  });

  it.each(["all-rights-reserved", null] as const)(
    "writes %s as exactly the statement No licence chosen. (DRI, #1567)",
    (licence) => {
      const doc = buildBundleMetadata(
        bookInput([seg(1, null, MP3)], { licence }),
        PROJECT
      ) as { copyright: unknown };
      expect(doc.copyright).toEqual({
        shortStatements: [{ statement: "No licence chosen." }],
      });
    }
  );
});

describe("languages (R12, pending #1492)", () => {
  it.each([null, "", "  "])(
    "is und for a book language of %j",
    (languageCode) => {
      const rest = unnamedLanguage(
        bookInput([seg(1, MARK_1_1_8, MP3)], { languageCode })
      );
      const doc = buildBundleMetadata(rest, PROJECT) as {
        languages: unknown;
      };
      expect(doc.languages).toEqual([
        { tag: "und", name: { en: "Undetermined" } },
      ]);
      expect(validateBundleMetadata(doc)).toEqual([]);
    }
  );

  it("falls back to the tag as the name when none is given", () => {
    const rest = unnamedLanguage(referencedBook());
    const doc = buildBundleMetadata(rest, PROJECT) as { languages: unknown };
    expect(doc.languages).toEqual([{ tag: "sw", name: { en: "sw" } }]);
  });
});

describe("ingredients", () => {
  it("are ordinal paths, not names, even when numbers and positions differ", () => {
    const input = referencedBook();
    const chapter = { ...input.chapters[0]!.chapter, number: 7, name: "A b/c" };
    const doc = buildBundleMetadata(
      { ...input, chapters: [{ ...input.chapters[0]!, chapter }] },
      PROJECT
    ) as { ingredients: Record<string, unknown> };
    expect(Object.keys(doc.ingredients)).toEqual([
      "ingredients/audio/c001/s001.mp3",
      "ingredients/audio/c001/s002.wav",
      "ingredients/tc-mobile/project.json",
    ]);
  });

  it("leave a segment with no audio out", () => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, null, null), seg(2, null, MP3)]),
      PROJECT
    ) as { ingredients: Record<string, unknown> };
    expect(Object.keys(doc.ingredients)).toEqual([
      "ingredients/audio/c001/s002.mp3",
      "ingredients/tc-mobile/project.json",
    ]);
  });
});

describe("project.json lists every segment, with the reason where audio is missing", () => {
  it("records ingredient paths, and not-recorded and audio-missing reasons", () => {
    const input = bookInput([
      seg(1, MARK_1_1_8, MP3),
      seg(2, MARK_1_9_13, null),
      seg(3, null, null, { take: true }),
    ]);
    const manifest = buildProjectManifest(input);
    const segments = (
      manifest.chapters[0] as {
        segments: {
          id: string;
          ingredient: string | null;
          missingAudio: string | null;
          position: number;
        }[];
      }
    ).segments;
    expect(segments.map((s) => [s.id, s.position])).toEqual([
      ["seg-1", 1],
      ["seg-2", 2],
      ["seg-3", 3],
    ]);
    expect(segments.map((s) => s.ingredient)).toEqual([
      "ingredients/audio/c001/s001.mp3",
      null,
      null,
    ]);
    expect(segments.map((s) => s.missingAudio)).toEqual([
      null,
      "not-recorded",
      "audio-missing",
    ]);
  });

  it("writes no number for a hand-made chapter, still at schemaVersion 1 (#1272)", () => {
    // The DRI on #1272, Q5 (b): "None, same format version". A hand-made
    // chapter's stored number is not a template's, so none is written.
    const input = bookInput([seg(1, MARK_1_1_8, MP3)]);
    const chapter = { ...input.chapters[0]!.chapter, number: 3 };
    const manifest = buildProjectManifest({
      ...input,
      chapters: [{ ...input.chapters[0]!, chapter }],
    });
    expect(manifest.schemaVersion).toBe(1);
    const c = manifest.chapters[0] as { number: number | null };
    expect(c.number).toBeNull();
  });

  it("carries its own schemaVersion, the template's chapter number, and the OBS story and frame", () => {
    const span: SegmentSpan = {
      book: "OBS",
      startChapter: 3,
      startVerse: 2,
      endChapter: 3,
      endVerse: 2,
    };
    const input = bookInput([seg(1, span, MP3)]);
    const chapter = {
      ...input.chapters[0]!.chapter,
      number: 3,
      templateKey: "03",
    };
    const manifest = buildProjectManifest({
      ...input,
      chapters: [{ ...input.chapters[0]!, chapter }],
    });
    expect(manifest.schemaVersion).toBe(1);
    const c = manifest.chapters[0] as {
      number: number;
      position: number;
      segments: { obs: unknown }[];
    };
    expect([c.number, c.position]).toEqual([3, 1]);
    expect(c.segments[0]!.obs).toEqual({ story: 3, frame: 2 });
    expect(manifest.book).toMatchObject({
      languageCode: "sw",
      licence: "CC-BY-SA-4.0",
    });
  });

  it("survives a JSON round trip unchanged", () => {
    const manifest = buildProjectManifest(referencedBook());
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

/** An audio piece with its clip's sample rate set, for the formats block. */
function atRate(base: BundleAudio, sampleRate: number): BundleAudio {
  return { ...base, clip: { ...base.clip, sampleRate } };
}

type FlavorDoc = {
  type: {
    flavorType: {
      name: string;
      flavor: { formats?: Record<string, { samplingRate: number }> };
      currentScope?: unknown;
    };
  };
};

describe("formats come from the clips (George round 1, Medium 1)", () => {
  it("writes the clips' own rate, not 44100, for a 16000 Hz take", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(1, MARK_1_1_8, atRate(MP3, 16000)),
        seg(2, MARK_1_9_13, atRate(WAV, 16000)),
      ]),
      PROJECT
    ) as FlavorDoc;
    const formats = doc.type.flavorType.flavor.formats!;
    expect(formats.mp3!.samplingRate).toBe(16000);
    expect(formats.wav!.samplingRate).toBe(16000);
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("takes the custom flavour when two mp3 clips differ in rate", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(1, MARK_1_1_8, atRate(MP3, 16000)),
        seg(2, MARK_1_9_13, atRate(MP3, 44100)),
      ]),
      PROJECT
    ) as FlavorDoc;
    expect(doc.type.flavorType.name).toBe("parascriptural");
    expect(doc.type.flavorType).not.toHaveProperty("currentScope");
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("lets mp3 and wav differ from each other when each is uniform", () => {
    const doc = buildBundleMetadata(
      bookInput([
        seg(1, MARK_1_1_8, atRate(MP3, 16000)),
        seg(2, MARK_1_9_13, WAV),
      ]),
      PROJECT
    ) as FlavorDoc;
    const formats = doc.type.flavorType.flavor.formats!;
    expect([formats.mp3!.samplingRate, formats.wav!.samplingRate]).toEqual([
      16000, 44100,
    ]);
  });
});

describe("a half-null verse span is not a reference (George round 1, Medium 2)", () => {
  it.each([
    ["end verse null", { ...MARK_1_1_8, startVerse: 5, endVerse: null }],
    ["start verse null", { ...MARK_1_1_8, startVerse: null, endVerse: 5 }],
  ])("takes the custom flavour with no scope when the %s", (_l, span) => {
    const doc = buildBundleMetadata(
      bookInput([seg(1, span, MP3), seg(2, MARK_1_9_13, WAV)]),
      PROJECT
    ) as FlavorDoc & {
      ingredients: Record<string, Record<string, unknown>>;
    };
    expect(doc.type.flavorType.name).toBe("parascriptural");
    expect(doc.type.flavorType).not.toHaveProperty("currentScope");
    expect(Object.values(doc.ingredients).some((i) => "scope" in i)).toBe(
      false
    );
    expect(validateBundleMetadata(doc)).toEqual([]);
  });
});

describe("user strings are NFC, as meta.normalization says (George round 1, Low)", () => {
  it("normalises the book name, the language name and the tag", () => {
    const decomposed = "Café"; // e + combining acute
    const input = {
      ...bookInput([seg(1, MARK_1_1_8, MP3)], {
        languageCode: "sw",
      }),
      bookName: decomposed,
      languageName: "Kiswahilí",
    };
    const doc = buildBundleMetadata(input, PROJECT) as {
      identification: { name: { en: string } };
      languages: { name: { en: string } }[];
      localizedNames: Record<string, { short: { en: string } }>;
    };
    expect(doc.identification.name.en).toBe("Café");
    expect(doc.languages[0]!.name.en).toBe("Kiswahilí".normalize("NFC"));
    expect(doc.localizedNames["book-mrk"]!.short.en).toBe("Café");
  });
});

describe("exportedAt must be a time", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "throws a named error for %s, in both builders",
    (exportedAt) => {
      const input = { ...referencedBook(), exportedAt };
      expect(() => buildBundleMetadata(input, PROJECT)).toThrow(
        InvalidExportTimeError
      );
      expect(() => buildProjectManifest(input)).toThrow(InvalidExportTimeError);
    }
  );
});

describe("USFM codes and multi-chapter paths", () => {
  it("USFM_BOOK_CODES equals the vendored schema's bookId enum", () => {
    const schema = JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          "fixtures/scripture-bundle/schema-1.0.0/common.schema.json"
        ),
        "utf8"
      )
    ) as { definitions: { bookId: { enum: string[] } } };
    expect([...USFM_BOOK_CODES].sort()).toEqual(
      [...schema.definitions.bookId.enum].sort()
    );
  });

  it("numbers a second chapter c002 from its position, not its number", () => {
    const one = referencedBook();
    const first = one.chapters[0]!;
    const second = {
      chapter: { ...first.chapter, id: "ch-2" as ChapterId, number: 9 },
      segments: [
        seg(3, { ...MARK_1_1_8, startChapter: 2, endChapter: 2 }, MP3),
      ],
    };
    const doc = buildBundleMetadata(
      { ...one, chapters: [first, second] },
      PROJECT
    ) as { ingredients: Record<string, unknown> };
    expect(Object.keys(doc.ingredients)).toContain(
      "ingredients/audio/c002/s001.mp3"
    );
    expect(validateBundleMetadata(doc)).toEqual([]);
  });
});
