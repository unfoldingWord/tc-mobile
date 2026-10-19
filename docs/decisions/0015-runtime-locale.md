# 0015 — The phone's language is chosen at runtime, not by the build

**Status:** Proposed · **Date:** 2026-10-19 · **DRI:** the dev lead drafts; the requirements owner owns the language scope · **Issue:** [#1479](https://github.com/unfoldingWord/tc-mobile/issues/1479) (part of epic [#1458](https://github.com/unfoldingWord/tc-mobile/issues/1458))

This ADR is **Proposed**: it records the design the runtime-apply and resolver
issues will build, and nothing in it is running yet. It moves to **Accepted**
when the DRI accepts it on the PR that carries it. Claims about the first-paint
reflow (section a) are inference until the device check of the language-follow
issue observes them.

## Context

`src/lib/locale.ts` states the UI language as a build constant:
`SHIPPED_LOCALE = { tag: "en", dir: "ltr" }` (`locale.ts:75`).
`withLocaleAttributes` writes it into `index.html`, and `vite.config.ts` writes
it into the manifest. `plural()` defaults to its tag (`plural.ts:110`). The
docblock at `locale.ts:21-30` argues that this is right and a runtime applier
is wrong: "A theme is a stored per-translator choice … The shipped UI language
is a constant of the build, and `dir` in particular must be right in the first
byte the parser reads … There is no stored locale to read, so there is nothing
a runtime pass could learn that the build does not already know."

That argument held while the app had one language. It does not hold for v2:

- The DRI's target set (#357, 2026-10-08): "The 26 (levels 3+4)". Decision
  D6-languages (`level-4-first`): "The 10 level-4 languages in v2, the 16
  level-3 languages after". The requirements owner's answer R8 (round 2,
  2026-10-19) says the 16 level-3 languages come "After 2.0.0" and are
  v2-desired (they become v3-required if they miss the v2 launch).
- #357 Ask: "No language picker is required for v2. If one is added later it
  overrides the OS choice"; "Translations are bundled with the app. The app is
  offline-first; no runtime fetch."
- Q1-order and Q3-reviewers: "We will use AI to draft all of them and revise
  them as-needed" and "Use AI to draft, we'll revise as-needed."
- #357, 2026-10-19 (DRI), missing keys: "Pending list, strict at release
  (Recommended)".
- R19 (round 2): "Use Arabic numerals; default to simplified text on Chinese
  phones."

Ten languages in v2 means the language is a fact about the phone that the build
cannot know. One installed app must serve a phone whose language was set after
the app was installed, on a phone that may be handed to someone with a
different language setting.

## Decision

**The UI locale is read from the phone at each launch and on return to the
app. It is not a stored choice, and it is not a build constant.** The build
keeps writing an English, left-to-right default; a runtime installer replaces
it before the first render. All translations ship inside the one build.

### (a) The old rationale, and what replaces it

Retired: the paragraph at `locale.ts:21-30`, headed "WHY BUILD TIME AND NOT A
RUNTIME APPLIER", and the "WHAT THIS DOES NOT DO" paragraph at `locale.ts:31-36`,
which says "Nothing about the running app changes today: the shipped locale is
still English, still left-to-right." Together that is `locale.ts:21-36`, the
one span this ADR retires. The runtime-apply issue replaces that docblock; this
ADR links forward to it and does not edit the file.

What replaces the argument:

1. The locale is **a fact about the phone**, not a translator's stored choice.
   There is still nothing to store: the app reads the phone's language list at
   launch and again on return (section e). The resolved locale follows the
   phone's list, and differs from the phone's first language only by the rules
   in (g) (an incomplete locale is skipped, ending at English) and (h) (every
   Chinese variant gets Simplified).
2. The old objection was a reflow after first paint. The inference here is that
   the launch intro is a full-screen, direction-neutral, `aria-hidden` overlay
   that paints before React mounts, so the first frames show no
   direction-dependent layout. `dir` is set before `createRoot` (section b),
   so the first React render is already correct. This is **inference**, not
   observation: the language-follow issue's device check must confirm the intro
   covers the first frames on a right-to-left phone. If it does not, the
   fallback is the inline `<head>` script below, which is cheap to add.
3. To close the earliest gap without a device observation, an inline `<head>`
   script, **generated at build time from the one locale table**, sets `lang`
   and `dir` from `navigator.languages` before the stylesheet paints. It is
   generated, not hand-written, from the same table **and the same resolver**
   as section (b), including the (g) and (h) rules, and it writes only `lang`
   and `dir` values the table holds. So the table in `lib/locale.ts` stays the
   one place either fact is stated (the original #169 reason for the module),
   and there is one resolution algorithm, not two.

### (b) Where `lang` and `dir` are applied

- The build still writes a default (`en`, `ltr`) into `index.html` and the
  manifest through `withLocaleAttributes`. That is the answer for anything that
  reads the file without running JavaScript, and `tests/locale.test.ts` keeps
  the two together.
- A runtime installer sets `documentElement.lang` and `documentElement.dir`
  before `createRoot`, in the same slot as `installStoredTheme()`
  (`src/app/main.tsx:22`). It lives in `hooks/` (it touches `document` and
  `navigator`); the resolver that maps the phone's language list to a supported
  locale is pure and stays in `lib/`.
- `dir` stays data on each locale entry, never derived from the tag
  (`locale.ts:65-74` gives the reason, and it still holds).
- `plural()` takes the resolved locale; its `SHIPPED_LOCALE.tag` default is
  removed by the wiring issue, so the default cannot become a second source of
  truth.

### (c) The manifest and native app names stay English

The web manifest's name is read by the operating system at install. A native
app could localize its launcher label through platform resources, but this ADR
does not take that on: both stay English, as a scope decision. The runtime locale changes what is drawn inside the app, not the
launcher label.

### (d) Strings are statically imported and precached

Every supported language's string table is a static import, so the `strings`
binding is synchronous at first render and the service worker precaches all of
them with the shell. There is no dynamic `import()` and no fetch for a
translation. Size: about 20 KB raw per language, so about 200 KB for ten before
gzip (inference from the 20.5 KB English figure; not measured for ten). **The PR
that ships the first additional language must measure the real figure** and
record it, per the app's no-claim-without-a-run rule.

### (e) Change while running

The app listens for `languagechange` and re-reads the locale when it returns to
the foreground. A new locale is **applied only when no take is open**: a hidden
page already seals an open take (#836), so a language change that arrives while
the page was hidden is applied on return after the seal, and one that arrives
with a take open and the page visible waits until the take closes. The app never
re-renders its words under a recording in progress.

### (f) The waveform and time axis stay left to right

Audio time runs left to right in the waveform and the time axis in every
language, as a timeline does in other audio tools. The controls and text around
them mirror with `dir`; the waveform, its selection handles and its time axis do
not. This needs a test on a right-to-left locale when one ships.

### (g) No fallback mid-screen; a pending list until release

A screen is wholly in one language. A missing key does not fall back to English
on a screen otherwise in another language, because a half-translated screen is
worse for a person who may not read the fallback. During the build-out, a
**pending list** records the keys a language does not yet have and the check
reports them without failing; **at release the check is strict** and a missing
key fails the build (#357, 2026-10-19: "Pending list, strict at release").
If a locale is not complete the resolver treats it as unsupported and picks the
next language in the phone's list, ending at English.

### (h) Numerals and script

R19 settles both open questions:

- **Arabic numerals everywhere.** Every language shows `0-9`, including
  languages whose own convention uses other digits. `Intl.NumberFormat` is
  called with the Latin numbering system explicitly (`numberingSystem:
"latn"`), so a phone's regional setting cannot change the digits.
  `plural.ts` only picks the plural form; it writes the count as `String(n)`
  (`plural.ts:125`), which is always `0-9`.
- **Simplified text on Chinese phones.** A phone whose language is any Chinese
  variant, including Traditional, gets the Simplified translation, until a
  Traditional translation is separately scoped.

Whether tester-only screens (the phone check, the failure log) are translated
is not decided here and stays open with the requirements owner.

## Alternatives rejected

1. **One build per language.** Rejected. One install must work offline for a
   phone whose language is set after install, and a shared phone may change
   language. A per-language build fixes the language at the moment of download,
   multiplies the store listings, the native builds and the review and release
   work by ten (then twenty-six), and leaves a facilitator unable to hand a
   phone to someone with another language.
2. **Fetch translations at runtime.** Rejected. #357: "Translations are bundled
   with the app. The app is offline-first; no runtime fetch." A first launch in
   a new language with no connection would show the wrong language or none, in
   the situation the app exists for.
3. **A build-time constant plus a picker.** Rejected for v2. #357: "No language
   picker is required for v2." It also fails the same case: the build still
   fixes the default, and the person must find and use a picker in a language
   they may not read, with an app meant for people who may not read. If a picker
   is added later it overrides the phone's choice, which this design allows
   (the resolver gets one more input).
4. **Dynamic `import()` of the active language.** Rejected for now (section d):
   it makes the `strings` binding asynchronous at first render. Revisit only if
   the measured size of the full set is a problem.
5. **Keep the old build-constant docblock and add a runtime override beside
   it.** Rejected: two sources for one fact is the drift `locale.ts` was
   written to remove.

## Consequences

- The `locale.ts` docblock at lines 21-36 (the "WHY BUILD TIME" paragraph,
  21-30, and the "WHAT THIS DOES NOT DO" paragraph, 31-36) is wrong once runtime apply lands and is replaced
  by that issue.
- `SHIPPED_LOCALE` is replaced by a table of supported locales and a resolver.
  `plural()` and every other reader of the constant move to the resolved
  locale.
- Every language adds about 20 KB raw to the precache and one more table to the
  completeness check.
- A right-to-left phone is a supported case, not a future one: the waveform
  exception (f) and the first-frames inference (a) each need a device check
  before this ADR is Accepted.

## Out of scope

Code, in this PR. A language picker. The 16 level-3 languages (R8: after 2.0.0).
Translation of tester-only screens. A Traditional Chinese translation.

## What this ADR does not verify

Nothing here was run on a device. The first-paint behaviour in (a), the size in
(d) and the take-open behaviour in (e) are design statements, to be checked by
the issues that build them.
