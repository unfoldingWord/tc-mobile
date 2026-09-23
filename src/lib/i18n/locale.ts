/**
 * Which language the interface speaks, and what the document has to say about
 * it.
 *
 * One catalog exists today (`en.ts`). This module is the seam that makes a
 * second one a data change rather than a code change: a locale is a key, the
 * catalog behind it is data, and everything that has to move with the language
 * — the plural rules, the `<html lang>`, the text direction — is derived from
 * the key rather than written out again at each site (#169).
 *
 * What this module deliberately does NOT do is CHOOSE the locale from the
 * phone. Following the OS language, and the 35 Strategic Languages that would
 * make it worth following, are #357. Until then the active locale is the
 * default one, and that single line below is where the choice will be made.
 */

/** Every interface language the app ships a catalog for. */
export type Locale = "en";

/**
 * The locale the interface renders in.
 *
 * Constant on purpose: nothing in the product selects a language yet (#357),
 * and a setting nothing can change is a stub. When selection lands, this is
 * what it resolves.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * What a locale means to the document, as opposed to what it says.
 *
 * `tag` is the BCP-47 tag — the value `<html lang>` and the PWA manifest carry,
 * and what `Intl` keys its plural rules on. `dir` is the writing direction;
 * `<html dir>` was absent entirely before this, which is not a neutral default
 * but an assertion of `ltr` that a right-to-left catalog would have to undo
 * from inside the page.
 */
export interface LocaleMeta {
  readonly tag: string;
  readonly dir: "ltr" | "rtl";
}

/** One row per `Locale`. A new catalog adds its row here and nowhere else. */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { tag: "en", dir: "ltr" },
};
