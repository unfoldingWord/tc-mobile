# What stays English, and why

The record for #1483. Everything not listed here is translated, or is pending
translation, through `src/lib/strings.ts` and `src/lib/i18n/`.

## Tester-only screens (S11-tester-screens)

The requirements owner's decision, verbatim: choice `english`, note "We will
revisit if this is needed."

- **Scope today:** the phone check, 23 `phoneCheck*` keys in `lib/strings.ts`.
- **Mechanism:** `src/lib/i18n/english-only.ts` names the keys. The coverage
  check (`tests/strings-locale-coverage.test.ts`) treats them as neither
  missing nor pending in any language, fails a language file that carries one,
  and fails if the set and the `phoneCheck*` group of the table differ in
  either direction. `npm run i18n:pending` leaves them out of every list.
- **To revisit:** delete entries from the set in a reviewed change. They then
  count as ordinary pending keys.
- **Related, from R19:** "Use Arabic numerals; default to simplified text on
  Chinese phones." That is about numerals and the Chinese script, not about
  this list.

## Other surfaces that stay English

Recorded as decisions on #1483. These are not table keys, so the mechanism
above does not apply to them.

- **The failure log and `Error` text.** These are for the person reading the
  log, not the screen. `lib/`'s `Error` messages are outside
  `tests/strings-one-table.test.ts` for the same reason.
- **`components/licenses.ts` and `public/licenses/*`.** Licence texts are
  verbatim legal records.
- **The manifest and the `<title>`.**
- **The phone-check report** (`lib/phone-check/report.ts`). It is engineering
  data a tester pastes into #974.
