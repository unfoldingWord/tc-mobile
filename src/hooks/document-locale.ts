/**
 * Tell the document which language it is in, and which way it reads.
 *
 * `<html lang>` was a literal `"en"` in `index.html` and `<html dir>` was
 * absent altogether (#169). Both are wrong the moment a second catalog exists,
 * and the `dir` one is wrong in the way that is hardest to see: an absent
 * direction is not neutral, it is `ltr` asserted by default, so a right-to-left
 * catalog would render its own words backwards with nothing in the tree saying
 * so.
 *
 * `lang` is not decoration. A screen reader picks its voice and its
 * pronunciation rules from it — on a product whose entire text layer is the
 * accessible name, that IS the text layer — and the browser keys hyphenation
 * and font fallback on it too.
 *
 * Here rather than in `lib/` because it touches `document`, and called before
 * `createRoot` for the same reason `installStoredTheme` is: an effect runs
 * after the first paint, and the first paint is the one an assistive
 * technology reads.
 *
 * The static shell keeps its own copy of these two values, which is what the
 * document carries until this runs; `tests/document-locale.test.ts` pins the
 * two copies to each other so they cannot drift.
 */
import { DEFAULT_LOCALE, LOCALE_META } from "@/lib/i18n/locale";

export function installDocumentLocale(): void {
  const meta = LOCALE_META[DEFAULT_LOCALE];
  const root = document.documentElement;
  root.lang = meta.tag;
  root.dir = meta.dir;
}
