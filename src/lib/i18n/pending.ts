/**
 * The keys each language is allowed to still be missing (#1481), as a ratchet.
 *
 * Decided on #357 (2026-10-19, "Pending list, strict at release"): a
 * development build may carry keys waiting for a translation; a release build
 * may not. `tests/strings-locale-coverage.test.ts` fails on a key that is
 * missing and not listed, and on a key that is listed and present, so the
 * list only shrinks as translations land.
 *
 * A language that has translated nothing yet is `"all"`: every English key is
 * pending, including keys added later, so a lane adding an English key edits
 * nothing here. The first translated key fails the test until the list is
 * regenerated. Run `npm run i18n:pending` after adding a key or a translation;
 * it rewrites this file from the tables and nothing else.
 */
export const PENDING: Readonly<Record<string, readonly string[] | "all">> = {
  ar: "all",
  es: [],
  fr: [],
  hi: "all",
  id: [],
  pt: [],
  ru: "all",
  sw: [],
  "zh-Hans": "all",
};

/**
 * The release gate. While false, `PENDING` may be non-empty. The commit that
 * flips it to true is the one that makes an incomplete language fail the
 * build, and it must be reviewed on its own before a 2.0.0 candidate.
 */
export const ENFORCE_COMPLETE = false;
