/**
 * Which supported UI language a phone's language list asks for (#1482).
 *
 * Pure and DOM-free: the caller reads `navigator.languages` (in `hooks/`, per
 * ADR 0015 (b)) and passes the list in. Nothing calls this yet; applying the
 * result is the runtime-apply issue under epic #1458.
 *
 * The rules, each pinned by `tests/locale-resolve.test.ts`:
 *
 * - The list is walked in order and the first entry whose base language is
 *   supported wins, so an unsupported first entry does not stop the walk.
 * - Only the base language (the first subtag) is compared, case-insensitively:
 *   `pt-BR` and `pt-PT` are `pt` (#357 Ask 2, "Region variants fall back to
 *   the base language").
 * - The legacy tag `in` is Indonesian, `id`.
 * - Every Chinese tag, Traditional script and regions included, is the
 *   Simplified entry (R19, "default to simplified text on Chinese phones").
 *   That follows from comparing the base only: `zh-Hans`'s base is `zh`.
 * - An empty or missing list, or one with nothing supported, is English
 *   ("an unsupported language falls back to English"). A malformed entry is
 *   skipped, never thrown on.
 */

import { LOCALES, SHIPPED_LOCALE, type Locale } from "../locale";

/** One BCP 47 subtag run, `-` or `_` separated (some platforms report `pt_BR`). */
const TAG = /^[a-z0-9]+([-_][a-z0-9]+)*$/i;

/** Retired language subtags still reported by older platforms. */
const LEGACY_BASE: Readonly<Record<string, string>> = { in: "id" };

function baseOf(tag: unknown): string | undefined {
  if (typeof tag !== "string") return undefined;
  const trimmed = tag.trim();
  if (!TAG.test(trimmed)) return undefined;
  const base = (trimmed.split(/[-_]/)[0] ?? "").toLowerCase();
  return LEGACY_BASE[base] ?? base;
}

/**
 * The locale for `languages`, chosen among `candidates`.
 *
 * `candidates` defaults to every supported locale. It exists so a caller can
 * narrow the choice, for the ADR 0015 (g) rule that a locale whose table is
 * incomplete is skipped; the fallback is English whatever is passed.
 */
export function resolveLocale(
  languages: readonly string[],
  candidates: readonly Locale[] = LOCALES
): Locale {
  if (!Array.isArray(languages)) return SHIPPED_LOCALE;
  for (const tag of languages) {
    const base = baseOf(tag);
    if (base === undefined) continue;
    const match = candidates.find((locale) => baseOf(locale.tag) === base);
    if (match !== undefined) return match;
  }
  return SHIPPED_LOCALE;
}
