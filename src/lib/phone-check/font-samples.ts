/**
 * The script samples and digit forms of the phone check's font section (#1486,
 * the instrument half of the device font check).
 *
 * The app ships no `@font-face` (`--p-font-ui` is `system-ui, ...`), so whether
 * a script draws as text or as boxes is the phone's own fonts talking. Each
 * sample is a line of that script with the language it is written in, so the
 * phone picks the font it would pick for a page in that language. A tester
 * reads the screen and writes "rendered" or "tofu" per line in the report; the
 * run itself is a person's, on real phones, and its record belongs in
 * `docs/progress_tracker.md`.
 *
 * Data only: no DOM, no clock. A label belongs to its sample, beside the
 * text and the `lang` it names, so it lives here as part of that data and not
 * in `lib/strings.ts`. The section's own heading and intro are table keys,
 * registered English-only (S11, `lib/i18n/english-only.ts`).
 *
 * The digit samples are fixed strings and not `formatNumber` output: the
 * shared formatter (PR #1650) was not on develop when this was built, and the
 * point of these lines is which digit SHAPES the phone can draw, whatever the
 * app later chooses to print.
 */

export interface FontSample {
  /** Stable key, used for the DOM marker and the report line. */
  readonly id: string;
  /** What a tester reads: the script's English name. */
  readonly label: string;
  /** BCP 47 tag written on the sample's element, so the phone picks its font. */
  readonly lang: string;
  readonly dir: "ltr" | "rtl";
  readonly text: string;
}

/**
 * One line per script. The first five are the non-Latin scripts of the ten
 * UI languages (`LOCALES` in `lib/locale.ts`) plus Latin; the rest are the
 * level-3 follow-up scripts, the likelier tofu (an inference, #1486).
 */
export const SCRIPT_SAMPLES: readonly FontSample[] = [
  {
    id: "latin",
    label: "Latin with accents",
    lang: "fr",
    dir: "ltr",
    text: "Traduction orale de la Bible : é è ç à ñ ã ũ",
  },
  {
    id: "arabic",
    label: "Arabic",
    lang: "ar",
    dir: "rtl",
    text: "ترجمة الكتاب المقدس الشفهية",
  },
  {
    id: "devanagari",
    label: "Devanagari",
    lang: "hi",
    dir: "ltr",
    text: "बाइबल का मौखिक अनुवाद",
  },
  {
    id: "han",
    label: "Han (Simplified)",
    lang: "zh-Hans",
    dir: "ltr",
    text: "圣经口头翻译",
  },
  {
    id: "cyrillic",
    label: "Cyrillic",
    lang: "ru",
    dir: "ltr",
    text: "Устный перевод Библии",
  },
  {
    id: "ethiopic",
    label: "Ethiopic",
    lang: "am",
    dir: "ltr",
    text: "የመጽሐፍ ቅዱስ የቃል ትርጉም",
  },
  {
    id: "bengali",
    label: "Bengali",
    lang: "bn",
    dir: "ltr",
    text: "বাইবেলের মৌখিক অনুবাদ",
  },
  {
    id: "myanmar",
    label: "Myanmar",
    lang: "my",
    dir: "ltr",
    text: "သမ္မာကျမ်းစာ နှုတ်ဖြင့် ဘာသာပြန်ခြင်း",
  },
  {
    id: "lao",
    label: "Lao",
    lang: "lo",
    dir: "ltr",
    text: "ການແປພຣະຄຳພີດ້ວຍປາກເປົ່າ",
  },
  {
    id: "thai",
    label: "Thai",
    lang: "th",
    dir: "ltr",
    text: "การแปลพระคัมภีร์ด้วยวาจา",
  },
  {
    id: "urdu",
    label: "Urdu (Arabic script)",
    lang: "ur",
    dir: "rtl",
    text: "بائبل کا زبانی ترجمہ",
  },
];

/** The same ten digits in three forms. */
export const DIGIT_SAMPLES: readonly FontSample[] = [
  {
    id: "digits-latin",
    label: "Latin digits",
    lang: "en",
    dir: "ltr",
    text: "0123456789",
  },
  {
    id: "digits-arabic-indic",
    label: "Arabic-Indic digits",
    lang: "ar",
    dir: "rtl",
    text: "٠١٢٣٤٥٦٧٨٩",
  },
  {
    id: "digits-devanagari",
    label: "Devanagari digits",
    lang: "hi",
    dir: "ltr",
    text: "०१२३४५६७८९",
  },
];

/** The report's fill-in lines: one per sample, the verdict left for the tester. */
export function fontReportLines(): string[] {
  return [...SCRIPT_SAMPLES, ...DIGIT_SAMPLES].map(
    (s) => `- ${s.label} (${s.lang}): `
  );
}
