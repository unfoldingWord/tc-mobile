/**
 * The Scripture Bundle `metadata.json` of an exported book (#1567), built to
 * ADR 0014 points 1 to 6 and pinned to spec v1.0.0. Pure: a book and the
 * measured size and MD5 of each ingredient go in, a plain object comes out.
 * No zip, no clock, no storage; the caller serialises it and writes it last.
 */

import type { ClipMeta } from "@/types/audio";
import type { SegmentRef } from "@/types/domain";
import type { LicenceId } from "@/types/template";

import {
  PROJECT_INGREDIENT_PATH,
  segmentIngredientPath,
  type BundleBookInput,
} from "./input";

/** `meta.version`: the spec tag the test gate validates against (ADR 0014 point 1). */
const BUNDLE_SPEC_VERSION = "1.0.0";

/** The one measured file that is not audio: `project.json`, built after the audio. */
export interface BundleFileDigest {
  readonly size: number;
  readonly md5: string;
}

/** A plain JSON object; the schema gate, not a type, says whether it is valid. */
export type BundleMetadata = Record<string, unknown>;

/**
 * The USFM book codes the spec's `scope.schema.json` enumerates
 * (`common.schema.json` `bookId`, v1.0.0). `OBS` is not one, which is why an
 * Open Bible Stories book takes the custom flavour.
 */
const USFM_BOOK_CODES: ReadonlySet<string> = new Set(
  (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO " +
    "ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT " +
    "MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE " +
    "2PE 1JN 2JN 3JN JUD REV TOB JDT ESG WIS SIR BAR LJE S3Y SUS BEL 1MA 2MA 3MA 4MA " +
    "1ES 2ES MAN PS2 ODA PSS JSA JDB TBS SST DNT BLT EZA 5EZ 6EZ DAG PS3 2BA LBA JUB " +
    "ENO 1MQ 2MQ 3MQ REP 4BA LAO"
  ).split(" ")
);

/** A span as the spec's scope grammar writes it: "1", "1-3", "1:9", "1:9-13", "1:9-2:3". */
export function scopeString(span: SegmentRef): string {
  const { startChapter, startVerse, endChapter, endVerse } = span;
  if (startVerse === null || endVerse === null) {
    return startChapter === endChapter
      ? `${startChapter}`
      : `${startChapter}-${endChapter}`;
  }
  if (startChapter !== endChapter) {
    return `${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
  }
  return startVerse === endVerse
    ? `${startChapter}:${startVerse}`
    : `${startChapter}:${startVerse}-${endVerse}`;
}

const LICENCE_URLS: Partial<Record<LicenceId, string>> = {
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

/**
 * ADR 0014 point 6. `licenses` and `shortStatements` are a `oneOf`, so exactly
 * one is ever written.
 *
 * A book whose licence is `null` or anything but the three CC licences says
 * "No licence chosen." and nothing more. The DRI's pick, 2026-10-21 (#1567,
 * after the schema finding that `copyright` is required and needs one of
 * `licenses`, `shortStatements` or `publicDomain`): "No licence chosen."
 * This replaces ADR 0014 point 6's all-rights-reserved fallback.
 */
function copyright(licence: LicenceId | null): Record<string, unknown> {
  const url = licence === null ? undefined : LICENCE_URLS[licence];
  if (url !== undefined) return { licenses: [{ url }] };
  return {
    shortStatements: [{ statement: "No licence chosen." }],
  };
}

function isoTime(ms: number): string {
  return new Date(ms).toISOString();
}

interface Recorded {
  readonly ingredient: string;
  readonly scope: SegmentRef | null;
  readonly entry: Record<string, unknown>;
}

/**
 * Build `metadata.json`. `project` is the measured `project.json`, which lists
 * itself last among the ingredients.
 */
export function buildBundleMetadata(
  input: BundleBookInput,
  project: BundleFileDigest
): BundleMetadata {
  const { book } = input;
  // meta.normalization declares NFC, so the free-text strings are made NFC.
  const defaultLocale = input.defaultLocale.normalize("NFC");
  const bookName = input.bookName.normalize("NFC");
  const exportedAt = isoTime(input.exportedAt);

  const recorded: Recorded[] = [];
  input.chapters.forEach((chapterInput, ci) => {
    chapterInput.segments.forEach((segmentInput, si) => {
      const audio = segmentInput.audio;
      if (audio === null) return;
      const reference = segmentInput.segment.reference;
      recorded.push({
        ingredient: segmentIngredientPath(ci + 1, si + 1, audio.clip.encoding),
        // A span with one verse null is outside SegmentSpan's three states;
        // treated as no reference rather than widened to the whole chapter.
        scope:
          reference !== null &&
          (reference.startVerse === null) === (reference.endVerse === null)
            ? reference
            : null,
        entry: {
          checksum: { md5: audio.md5 },
          mimeType: audio.clip.encoding === "mp3" ? "audio/mpeg" : "audio/wav",
          size: audio.size,
        },
      });
    });
  });

  // `formats` states one sampling rate per codec, so it is read from the clips;
  // codecs whose clips disagree cannot be described and take the custom flavour.
  const rates = new Map<ClipMeta["encoding"], Set<number>>();
  for (const c of input.chapters) {
    for (const s of c.segments) {
      if (s.audio === null) continue;
      const { encoding, sampleRate } = s.audio.clip;
      const set = rates.get(encoding) ?? new Set<number>();
      set.add(sampleRate);
      rates.set(encoding, set);
    }
  }
  const uniformRates = [...rates.values()].every((set) => set.size === 1);

  // ADR 0014 point 2: audioTranslation only when every recorded segment has a
  // reference, all in one USFM book. No recorded segment at all: custom.
  const books = new Set(recorded.map((r) => r.scope?.book ?? null));
  const sole = books.size === 1 ? [...books][0]! : null;
  const usfm =
    sole !== null && USFM_BOOK_CODES.has(sole) && uniformRates ? sole : null;

  const ingredients: Record<string, unknown> = {};
  for (const r of recorded) {
    ingredients[r.ingredient] =
      usfm !== null && r.scope !== null
        ? { ...r.entry, scope: { [usfm]: [scopeString(r.scope)] } }
        : r.entry;
  }
  ingredients[PROJECT_INGREDIENT_PATH] = {
    checksum: { md5: project.md5 },
    mimeType: "application/json",
    size: project.size,
    role: "x-tcMobileProject",
  };

  let flavorType: Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  if (usfm !== null) {
    const scopes = [
      ...new Set(recorded.map((r) => scopeString(r.scope as SegmentRef))),
    ];
    // Mono and 16-bit are invariants, not readings: ClipMeta carries neither,
    // and every clip is stored as mono Int16 PCM (CANONICAL_CHANNELS).
    const formats: Record<string, unknown> = {};
    const mp3Rate = rates.get("mp3");
    if (mp3Rate !== undefined) {
      formats.mp3 = {
        compression: "mp3",
        trackConfiguration: "1/0 (Mono)",
        samplingRate: [...mp3Rate][0]!,
      };
    }
    const pcmRate = rates.get("pcm");
    if (pcmRate !== undefined) {
      formats.wav = {
        compression: "wav",
        trackConfiguration: "1/0 (Mono)",
        bitDepth: 16,
        samplingRate: [...pcmRate][0]!,
      };
    }
    flavorType = {
      name: "scripture",
      flavor: {
        name: "audioTranslation",
        // Assumption (ADR 0014 point 5): one person records, reading not drama.
        performance: ["singleVoice", "reading"],
        formats,
      },
      currentScope: { [usfm]: scopes },
    };
    extra.localizedNames = {
      [`book-${usfm.toLowerCase()}`]: {
        short: { [defaultLocale]: bookName },
      },
    };
  } else {
    flavorType = {
      name: "parascriptural",
      flavor: { name: "x-tcMobileAudio" },
    };
  }

  const tag = book.languageCode?.trim() || "und";
  const languageName =
    input.languageName?.normalize("NFC") ??
    (tag === "und" ? "Undetermined" : tag);

  return {
    format: "scripture burrito",
    meta: {
      version: BUNDLE_SPEC_VERSION,
      category: "source",
      generator: {
        softwareName: "tC Mobile",
        softwareVersion: input.appVersion,
      },
      defaultLocale,
      dateCreated: exportedAt,
      normalization: "NFC",
    },
    idAuthorities: {
      tcmobile: { id: "https://tcmobile.app", name: { en: "tC Mobile" } },
    },
    identification: {
      primary: {
        // Revision stays "1": nothing stores an export count (ADR 0014 point 5).
        tcmobile: { [book.id]: { revision: "1", timestamp: exportedAt } },
      },
      name: { [defaultLocale]: bookName },
    },
    confidential: false,
    type: { flavorType },
    languages: [{ tag, name: { [defaultLocale]: languageName } }],
    ...extra,
    copyright: copyright(book.licence),
    ingredients,
  };
}
