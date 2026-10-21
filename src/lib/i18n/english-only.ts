/**
 * The table keys that are English on purpose, in every language (#1483).
 *
 * Decided on #1483 as S11-tester-screens, choice `english`; the requirements
 * owner's note, verbatim: "We will revisit if this is needed." The tester-only
 * screens, today the phone check, stay English in v2. Their words are in
 * `lib/strings.ts` because every screen word is, but they are not offered for
 * translation: a language file may not carry them, and they are neither
 * missing nor pending in any language.
 *
 * R19 adds "Use Arabic numerals; default to simplified text on Chinese
 * phones." That is about numerals and the Chinese script and does not touch
 * this list.
 *
 * `tests/strings-locale-coverage.test.ts` pins this set to the table: every
 * `phoneCheck*` key must be here, and nothing else may be. Revisiting S11
 * means deleting entries from this list in a reviewed change; the language
 * files and `pending.ts` then pick the keys up as ordinary pending ones.
 * The full record of what stays English is in `docs/i18n/english-only.md`.
 */
export const ENGLISH_ONLY: ReadonlySet<string> = new Set([
  "phoneCheckTitle",
  "phoneCheckIntro",
  "phoneCheckStart",
  "phoneCheckRunWaiting",
  "phoneCheckRunStopping",
  "phoneCheckRunDevice",
  "phoneCheckRunEncode",
  "phoneCheckRunDsp",
  "phoneCheckRunStorage",
  "phoneCheckDone",
  "phoneCheckMemoryTitle",
  "phoneCheckMemoryWarning",
  "phoneCheckMemoryStart",
  "phoneCheckMemoryStep",
  "phoneCheckReportLabel",
  "phoneCheckCopy",
  "phoneCheckCopied",
  "phoneCheckSelected",
  "phoneCheckClose",
]);
