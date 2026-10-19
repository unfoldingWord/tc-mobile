import type {
  LicenceId,
  SegmentSpan,
  TemplateChapter,
  TemplatePackage,
  TemplateRef,
  TemplateSegment,
  TemplateTitleTable,
} from "@/types/template";

/**
 * Validator for template package v0 (#1465). It takes `unknown` JSON and
 * returns a typed package or throws on the first violation, naming the field.
 * Hand-written: no schema dependency for one small contract.
 *
 * It checks the SHAPE of the contract and nothing about any one source. It
 * never branches on `kind` or on a book code, so a source it has never seen
 * validates the same as the ones it has. Keeping that true is what the
 * source-reading test in `tests/template-validate.test.ts` is for.
 */

/** The one value D5 admits for `recordingLicence` in v0. */
const RECORDING_LICENCE = "CC-BY-SA-4.0" satisfies LicenceId;
/** The contract versions this reader understands. */
const KNOWN_FORMAT_VERSION = 0;

const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CODE = /^[A-Z0-9_-]{1,16}$/;
/** SemVer 2.0.0's grammar (semver.org): no leading zeros, build metadata allowed. */
const NUM = "(?:0|[1-9]\\d*)";
const PRE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER = new RegExp(
  `^${NUM}\\.${NUM}\\.${NUM}` +
    `(?:-${PRE_ID}(?:\\.${PRE_ID})*)?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$"
);
/**
 * A well-formed BCP-47 tag (RFC 5646 §2.1 `langtag` or a private-use tag):
 * language with extlangs, script, region, variants, extensions and private
 * use. Form only — it does not look subtags up in the registry, and the
 * irregular grandfathered tags (`i-klingon`, …) are not admitted.
 */
const LANGTAG =
  "(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8})" +
  "(?:-[A-Za-z]{4})?" +
  "(?:-(?:[A-Za-z]{2}|\\d{3}))?" +
  "(?:-(?:[A-Za-z0-9]{5,8}|\\d[A-Za-z0-9]{3}))*" +
  "(?:-[0-9A-WY-Za-wy-z](?:-[A-Za-z0-9]{2,8})+)*";
const PRIVATE_USE = "[Xx](?:-[A-Za-z0-9]{1,8})+";
const LANGUAGE = new RegExp(
  `^(?:${LANGTAG}(?:-${PRIVATE_USE})?|${PRIVATE_USE})$`
);
/** A relative path to a bundled asset: no scheme, no leading slash, no `..`. */
const ASSET_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/** A refused package or title table. `field` is the path to the offending value. */
export class TemplateValidationError extends Error {
  readonly field: string;
  constructor(field: string, problem: string) {
    super(`${field}: ${problem}`);
    this.name = "TemplateValidationError";
    this.field = field;
  }
}

function fail(field: string, problem: string): never {
  throw new TemplateValidationError(field, problem);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) return fail(field, "must be an object");
  return value;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail(field, "must be an array");
  return value as readonly unknown[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(field, "must be a non-empty string");
  }
  return value;
}

function matching(value: unknown, field: string, re: RegExp, what: string) {
  const s = text(value, field);
  if (!re.test(s)) fail(field, `must be ${what}`);
  return s;
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return fail(field, "must be an integer of at least 1");
  }
  return value;
}

function verse(value: unknown, field: string): number | null {
  return value === null ? null : positiveInt(value, field);
}

function at(base: string, key: string): string {
  return `${base}.${key}`;
}

function span(value: unknown, field: string): SegmentSpan {
  const r = record(value, field);
  const book = matching(r["book"], at(field, "book"), CODE, "a short code");
  const startChapter = positiveInt(
    r["startChapter"],
    at(field, "startChapter")
  );
  const startVerse = verse(r["startVerse"], at(field, "startVerse"));
  const endChapter = positiveInt(r["endChapter"], at(field, "endChapter"));
  const endVerse = verse(r["endVerse"], at(field, "endVerse"));

  const shown = (c: number, v: number | null) =>
    v === null ? `${c}` : `${c}:${v}`;
  if ((startVerse === null) !== (endVerse === null)) {
    fail(field, "both verses must be numbers or both null");
  }
  if (startChapter > endChapter) {
    fail(
      field,
      `span ends before it starts (${shown(startChapter, startVerse)}-${shown(endChapter, endVerse)})`
    );
  }
  if (
    startChapter === endChapter &&
    startVerse !== null &&
    endVerse !== null &&
    startVerse > endVerse
  ) {
    fail(
      field,
      `span ends before it starts (${shown(startChapter, startVerse)}-${shown(endChapter, endVerse)})`
    );
  }
  return { book, startChapter, startVerse, endChapter, endVerse };
}

function segment(
  value: unknown,
  field: string,
  seenKeys: Set<string>
): TemplateSegment {
  const r = record(value, field);
  const key = matching(r["key"], at(field, "key"), KEY, "a stable key");
  if (seenKeys.has(key)) fail(at(field, "key"), `duplicate key "${key}"`);
  seenKeys.add(key);
  const reference =
    r["reference"] === null
      ? null
      : span(r["reference"], at(field, "reference"));
  const thumb = r["thumbnail"];
  const thumbField = at(field, "thumbnail");
  const thumbnail =
    thumb === null
      ? null
      : matching(thumb, thumbField, ASSET_PATH, "a relative asset path");
  if (thumbnail?.split("/").includes("..")) {
    fail(thumbField, "must not contain a .. segment");
  }
  return { key, reference, thumbnail };
}

function chapter(
  value: unknown,
  field: string,
  seenChapterKeys: Set<string>,
  seenNumbers: Set<number>,
  seenSegmentKeys: Set<string>
): TemplateChapter {
  const r = record(value, field);
  const key = matching(r["key"], at(field, "key"), KEY, "a stable key");
  if (seenChapterKeys.has(key))
    fail(at(field, "key"), `duplicate key "${key}"`);
  seenChapterKeys.add(key);
  const number = positiveInt(r["number"], at(field, "number"));
  if (seenNumbers.has(number)) {
    fail(at(field, "number"), `duplicate chapter number ${number}`);
  }
  seenNumbers.add(number);
  const rawSegments = array(r["segments"], at(field, "segments"));
  if (rawSegments.length === 0) {
    fail(at(field, "segments"), "a chapter needs at least one segment");
  }
  const segments = rawSegments.map((s, i) =>
    segment(s, `${field}.segments[${i}]`, seenSegmentKeys)
  );
  return { key, number, segments };
}

function languages(value: unknown): readonly string[] {
  const raw = array(value, "titleLanguages");
  if (raw.length === 0)
    fail("titleLanguages", "must list at least one language");
  const seen = new Set<string>();
  return raw.map((l, i) => {
    const lang = matching(
      l,
      `titleLanguages[${i}]`,
      LANGUAGE,
      "a BCP-47 language tag"
    );
    // BCP-47 tags are case-insensitive, so "en" and "EN" are one language.
    const folded = lang.toLowerCase();
    if (seen.has(folded))
      fail(`titleLanguages[${i}]`, `duplicate language "${lang}"`);
    seen.add(folded);
    return lang;
  });
}

/** Parse and check a template package; throws `TemplateValidationError` on the first violation. */
export function parseTemplatePackage(json: unknown): TemplatePackage {
  const r = record(json, "package");
  if (r["format"] !== "tc-mobile-template") {
    fail("format", 'must be "tc-mobile-template"');
  }
  if (r["formatVersion"] !== KNOWN_FORMAT_VERSION) {
    fail(
      "formatVersion",
      `unknown version ${JSON.stringify(r["formatVersion"])}; this reader knows ${KNOWN_FORMAT_VERSION}`
    );
  }
  const id = matching(r["id"], "id", ID, "a stable id");
  const version = matching(r["version"], "version", SEMVER, "a semver version");
  const kind = matching(r["kind"], "kind", KIND, "a lowercase slug");
  const bookCode =
    r["bookCode"] === null
      ? null
      : matching(r["bookCode"], "bookCode", CODE, "a short code or null");

  const titleLanguages = languages(r["titleLanguages"]);
  const titleIn = record(r["title"], "title");
  const titleEntries = Object.entries(titleIn);
  if (titleEntries.length === 0)
    fail("title", "must name the package in at least one language");
  const title: Record<string, string> = {};
  for (const [lang, name] of titleEntries) {
    const field = at("title", lang);
    if (!titleLanguages.includes(lang)) {
      fail(field, `language "${lang}" is not in titleLanguages`);
    }
    title[lang] = text(name, field);
  }

  const dataLicence = text(r["dataLicence"], "dataLicence");
  if (r["recordingLicence"] !== RECORDING_LICENCE) {
    fail("recordingLicence", `must be "${RECORDING_LICENCE}"`);
  }
  const attribution = text(r["attribution"], "attribution");

  const src = record(r["source"], "source");
  const url = text(src["url"], "source.url");
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    // Not parseable as a URL at all; the check below refuses it with the field named.
  }
  if (protocol !== "https:" && protocol !== "http:") {
    fail("source.url", "must be an http or https URL");
  }
  const revision = text(src["revision"], "source.revision");

  const rawChapters = array(r["chapters"], "chapters");
  if (rawChapters.length === 0)
    fail("chapters", "a package needs at least one chapter");
  const chapterKeys = new Set<string>();
  const numbers = new Set<number>();
  const segmentKeys = new Set<string>();
  const chapters = rawChapters.map((c, i) =>
    chapter(c, `chapters[${i}]`, chapterKeys, numbers, segmentKeys)
  );

  return {
    format: "tc-mobile-template",
    formatVersion: 0,
    id,
    version,
    kind,
    bookCode,
    title,
    titleLanguages,
    dataLicence,
    recordingLicence: RECORDING_LICENCE,
    attribution,
    source: { url, revision },
    chapters,
  };
}

/** The reference a book keeps to the package it was made from. */
export function templateRef(pkg: TemplatePackage): TemplateRef {
  return { id: pkg.id, version: pkg.version, kind: pkg.kind };
}

function titles(
  value: unknown,
  field: string,
  known: ReadonlySet<string>
): Readonly<Record<string, string>> {
  const r = record(value, field);
  const out: Record<string, string> = {};
  for (const [key, title] of Object.entries(r)) {
    const where = at(field, key);
    if (!known.has(key)) fail(where, "the package has no such key");
    out[key] = text(title, where);
  }
  return out;
}

/**
 * Parse one language's title table against the package it belongs to. The
 * table must name this package and version, a language the package lists, and
 * only keys the package has. A key the table leaves out is fine.
 */
export function parseTemplateTitleTable(
  json: unknown,
  pkg: TemplatePackage
): TemplateTitleTable {
  const r = record(json, "titleTable");
  const packageId = text(r["packageId"], "packageId");
  if (packageId !== pkg.id) {
    fail("packageId", `"${packageId}" is not this package ("${pkg.id}")`);
  }
  const version = text(r["version"], "version");
  if (version !== pkg.version) {
    fail(
      "version",
      `"${version}" is not this package version ("${pkg.version}")`
    );
  }
  const language = text(r["language"], "language");
  if (!pkg.titleLanguages.includes(language)) {
    fail("language", `"${language}" is not in titleLanguages`);
  }
  const chapterKeys = new Set(pkg.chapters.map((c) => c.key));
  const segmentKeys = new Set(
    pkg.chapters.flatMap((c) => c.segments.map((s) => s.key))
  );
  return {
    packageId,
    version,
    language,
    chapters: titles(r["chapters"], "chapters", chapterKeys),
    segments: titles(r["segments"], "segments", segmentKeys),
  };
}

/**
 * The title for a chapter or segment key, or `null` when there is none: no
 * table loaded, no key (a book made without a template), or a key this
 * version's table does not hold because a later package version dropped it.
 * Never throws: a missing title never breaks a book.
 */
export function titleFor(
  table: TemplateTitleTable | null,
  scope: "chapters" | "segments",
  key: string | null
): string | null {
  if (table === null || key === null) return null;
  const entries = table[scope];
  return Object.hasOwn(entries, key) ? (entries[key] ?? null) : null;
}
