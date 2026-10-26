/**
 * App settings that are a choice and nothing else (#1575): the decisions, DOM-
 * free, so each is a table rather than a phone. The DOM half (storage, the
 * live value a screen subscribes to) is `hooks/use-settings.ts`. The theme is
 * the first setting and keeps its own module (`lib/theme.ts`); a setting added
 * after it lives here.
 */

/**
 * Where "always show the sequential chapter number" is kept (S12, #1272).
 * Namespaced and beside the theme's key, in the same store: per-device,
 * one character, worth nothing if lost.
 */
export const ALWAYS_CHAPTER_NUMBER_KEY = "tc-mobile.always-chapter-number";

/**
 * The stored choice, defaulting to OFF on anything this app did not write: the
 * requirements owner's default is the chapter's name when it has one.
 */
export function readStoredAlwaysChapterNumber(raw: string | null): boolean {
  return raw === "1";
}

/** What is written for a choice. Read back by the function above. */
export function storeAlwaysChapterNumber(on: boolean): string {
  return on ? "1" : "0";
}

/**
 * The name a chapter label may show. With the setting on, a chapter's name is
 * withheld, so `strings.chapterHeading` falls through to the sequential number
 * ("Chapter 3"); off, the name goes through untouched and a chapter without
 * one already gets its number. `chapterHeading` stays the one place that
 * decides what an unnamed chapter is called.
 */
export function chapterNameShown(
  name: string | null,
  alwaysNumber: boolean
): string | null {
  return alwaysNumber ? null : name;
}

/**
 * Where "even out the loudness of a finished segment" is kept (#1433, U6b).
 * The Settings row writes `"0"` for off and `"1"` for on.
 */
export const NORMALIZE_ON_FINISHED_KEY = "tc-mobile.normalize-on-finished";

/**
 * The stored choice, ON unless this app wrote an explicit off: the
 * requirements owner's "switch-on" default (U6b).
 */
export function readStoredNormalizeOnFinished(raw: string | null): boolean {
  return raw !== "0";
}

/** The value written for the choice; `readStoredNormalizeOnFinished` reads it back. */
export function storeNormalizeOnFinished(on: boolean): string {
  return on ? "1" : "0";
}
