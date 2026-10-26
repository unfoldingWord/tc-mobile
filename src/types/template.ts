/**
 * Template package v0 (#1465, child of #1451): the one shape every template
 * content source is published in.
 *
 * A template is content the app can build a book from: an ordered list of
 * chapters, each an ordered list of segments, with an optional passage span
 * per segment and a title table per language. The app reads a package; it
 * never knows which source made it. Nothing here names a particular source,
 * testament or dataset, and nothing may: which packages a build ships is a
 * build-time choice (the package list), not something these types or the
 * validator encode. A new source is a new package, and no code change here.
 * `tests/template-validate.test.ts` pins that by reading this file's code and
 * by validating a synthetic source nobody wrote code for.
 *
 * Names follow the v12 schema freeze (`docs/design/v12-schema.md`, PR #1490):
 * `TemplateRef`, `LicenceId`, and the span's `book`, `startChapter`,
 * `startVerse`, `endChapter`, `endVerse`. The span type is declared here as
 * `SegmentSpan`; since the v12 migration (#1462), `SegmentRef` in
 * `domain.ts` is this type.
 */

/**
 * What a package is, as an open vocabulary: a lowercase slug the source picks
 * ("collection", "hymnal", …). It is not a closed union on purpose — a closed
 * union would need an edit here for every new source. The validator checks
 * the slug's form and nothing else; any behaviour that differs by kind
 * belongs to the code that reads that kind, not to this contract.
 */
type TemplateKind = string;

/** Which package, at which content version, a book was made from. */
export interface TemplateRef {
  /** Stable forever and never reused: "pkg", "set:name". */
  readonly id: string;
  /** The package's content version (semver). */
  readonly version: string;
  readonly kind: TemplateKind;
}

/** SPDX ids where one exists; all-rights-reserved has none. */
export type LicenceId =
  "CC-BY-SA-4.0" | "CC-BY-4.0" | "CC0-1.0" | "all-rights-reserved";

/**
 * Where a segment sits in its source, as numbers (Q4: a segment stores a
 * start and an end chapter:verse, so a span can cross a chapter boundary).
 * `book` is an opaque short code the source uses. Three states are allowed,
 * every number an integer >= 1: whole chapters (both verses null,
 * `startChapter <= endChapter`); verses in one chapter (both numbers, same
 * chapter, `startVerse <= endVerse`); verses across chapters (both numbers,
 * `startChapter < endChapter`).
 */
export interface SegmentSpan {
  readonly book: string;
  readonly startChapter: number;
  readonly startVerse: number | null;
  readonly endChapter: number;
  readonly endVerse: number | null;
}

/** BCP-47 tag to text. */
type LocalizedText = Readonly<Record<string, string>>;

export interface TemplateSegment {
  /** Stable across versions of one package id (the contract's rule). */
  readonly key: string;
  /** Null for a segment with no passage, such as an introduction. */
  readonly reference: SegmentSpan | null;
  /** A bundled asset path, or null. */
  readonly thumbnail: string | null;
}

export interface TemplateChapter {
  /** Stable across versions of one package id; unique within the package. */
  readonly key: string;
  /**
   * The real number of this chapter, always present (R7): a template gives
   * the number, and order alone is not the authority.
   */
  readonly number: number;
  readonly segments: readonly TemplateSegment[];
}

export interface TemplatePackage {
  readonly format: "tc-mobile-template";
  /** The contract's own version; a reader refuses one it does not know. */
  readonly formatVersion: 0;
  readonly id: string;
  /** Content version (semver). */
  readonly version: string;
  readonly kind: TemplateKind;
  /** The source's own code for the whole package, or null if it has none. */
  readonly bookCode: string | null;
  /** The package's own name per language. */
  readonly title: LocalizedText;
  /** Every language a title table may cover. */
  readonly titleLanguages: readonly string[];
  /** Licence of the package data itself. */
  readonly dataLicence: string;
  /** D5: recordings made from a template are CC BY-SA 4.0; v0 admits only this. */
  readonly recordingLicence: "CC-BY-SA-4.0";
  /** Must travel with any display or export. */
  readonly attribution: string;
  readonly source: { readonly url: string; readonly revision: string };
  readonly chapters: readonly TemplateChapter[];
}

/**
 * Titles ship as one table per language, so a phone loads only the one it
 * shows. A key the table lacks has no title; it is never an error.
 */
export interface TemplateTitleTable {
  readonly packageId: string;
  readonly version: string;
  readonly language: string;
  /** Chapter key to title. */
  readonly chapters: Readonly<Record<string, string>>;
  /** Segment key to title. */
  readonly segments: Readonly<Record<string, string>>;
}
