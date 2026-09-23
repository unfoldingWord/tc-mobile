/**
 * The string table for the locale the app is running in.
 *
 * `strings.foo` is what every screen, and now every hook, reads. What changed
 * in #169 is what sits behind it: a record of catalogs keyed by locale, one
 * per language, rather than a single object that was English by construction.
 * Adding a second UI language is now `en.ts` copied, edited and listed in
 * `catalogs` — a data change — plus the one line in `locale.ts` that decides
 * which key is active.
 *
 * Choosing that key from the phone is NOT here, and this file will not pretend
 * otherwise: following the OS language is #357. `DEFAULT_LOCALE` is the active
 * locale today because it is the only one.
 */
import { en } from "./en";
import { DEFAULT_LOCALE, type Locale } from "./locale";

/**
 * The shape every catalog has to have, with the English one as its definition.
 *
 * Widened deliberately. `en` is `as const`, so `typeof en` types each entry as
 * the exact English sentence — a second catalog would have to repeat the
 * English text to satisfy it, which is the opposite of the point. This keeps
 * the keys and the parameter lists, and says only that each entry produces a
 * string.
 */
export type StringTable = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends (
    ...args: infer A
  ) => string
    ? (...args: A) => string
    : string;
};

/** Every catalog the build ships. One row per `Locale`, checked both ways. */
const catalogs: Record<Locale, StringTable> = { en };

export const strings: StringTable = catalogs[DEFAULT_LOCALE];
