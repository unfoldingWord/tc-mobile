# AGENTS.md — tC Mobile

The canonical contributor guide. Read this before changing anything.

## Purpose

tC Mobile is an offline-first PWA for oral Bible translation: record a passage,
edit the waveform, manage the segments of a chapter, export MP3 (export is not
wired yet, #18). It targets Android and iOS phones, frequently offline, used by
people who may not read.

The driving deadline is the **East Africa training in the first week of
October 2026**, with production readiness targeted for **end of September 2026**.

## The pivot — read this before the rest of the file

Tim's hand-drawn screen mockups (22 Aug 2026) are the first principles for the
UI, and the domain model moves with them:

```
was:  Project -> Chapter -> Section -> Segment -> Take
now:  Book    -> Chapter ->            Segment  (-> Take, hidden, 1:1)
```

A segment is the unit of work: one recording per segment, edited in place. The
pre-pivot UI is **replaced, not evolved**.

[`docs/design/pivot-plan.md`](docs/design/pivot-plan.md) is the plan of record.
[#25](https://github.com/unfoldingWord/tc-mobile/issues/25) is the umbrella issue,
and the work is nine batches, B0–B8 (#26–#34).

**B0–B6 and B8 have landed, and B7's Share half; B7's Template Library has
not.** `Section` is gone from the model — a `Segment` hangs off a `Chapter`
directly and is the unit of work — and the three pivot screens (Books, Segments,
Recorder) exist; `Project` is now `Book`. Share Chapter / Share Book (B7) and
transcode-on-Finished with the encoder in a Web Worker (B8, ADR 0009) are in.
What B0 (#26) removed is still **gone** — the timing seam, the
reference-audio/narration path, and the OBS media cache's accessor code
(`hooks/obs-media.ts`, `lib/storage/media.ts`). Parts of the file below still
describe pre-pivot scaffolding (the OBS section browser, the old `use-chapter`
loader); do not read every description here as the target.

## Tech stack

|         |                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Runtime | Node `^22.12.0 \|\| >=24.0.0` (22.12 is knip's floor; Node 23.x is unsupported — jsdom 27's own engine range excludes it too, #577) |
| Build   | Vite 8, `@vitejs/plugin-react`                                                                                                      |
| UI      | React 19, Tailwind CSS 4, hand-rolled SVG icons                                                                                     |
| PWA     | `vite-plugin-pwa` 1.3 (Workbox `generateSW`)                                                                                        |
| Storage | IndexedDB via `idb` 8                                                                                                               |
| Audio   | Web Audio + MediaRecorder; `@breezystack/lamejs` for MP3 (in a Web Worker)                                                          |
| Tests   | Vitest 5, `fake-indexeddb`                                                                                                          |
| Lint    | ESLint 9 flat config, `typescript-eslint` 8, Prettier 3                                                                             |
| Deploy  | Cloudflare Workers static assets, Wrangler 4                                                                                        |

## Commands

```bash
npm run dev            # dev server
npm run dev:lan        # bind 0.0.0.0 for phone testing (see HTTPS caveat below)
npm run build          # production build
npm run preview        # preview the build
npm run lint           # ESLint, zero warnings allowed
npm run typecheck      # tsc -b (project references)
npm run typecheck:lib  # lib/ + types/ compiled with NO DOM lib — see below
npm run knip           # unused files, deps, exports and exported types
npm test               # vitest run — the build-artifact suites always skip here
npm run test:dist      # the build-artifact suites, run for real; needs a prior build
npm run format         # prettier --write
npm run verify         # everything above, in one command (test:dist last, after the build)
npm run deploy:staging # wrangler deploy --env staging
npm run deploy         # wrangler deploy (production)
npm run check:deploy      # confirm a develop -> staging deploy; see "Confirming a deploy" below
npm run check:deploy:prod # confirm a staging -> main deploy; requires the production origin explicitly
```

## Architecture — onion layers

```
types → lib → hooks → components → app
```

Styling is layered separately, in `src/app/styles/`:

```
1-primitives.css   raw values, no meaning        (colour primitives: reachable only through layer 2)
2-semantic.css     roles + themes                (the only layer that knows about themes)
3-components.css   component tokens and parts    (colour via layer 2 roles; structural primitives direct)
```

`@layer primitives, semantic, components, utilities` fixes the cascade order
once, so Tailwind utilities always win and a one-off utility stays a safe
escape hatch rather than a specificity fight. Using a _colour_ primitive
directly in a component is the leak this exists to prevent — it is what makes a
theme unswitchable later. Structural primitives (spacing, radius, type, motion)
carry no theme meaning, so component **and app-level** rules read them directly;
only colour, surface and ink must come through layer 2's roles. That is the
rule the files have always followed rather than the one their headers used to
claim (#146); `3-components.css`'s header states it in full, names the one
app-level rule that exercises it (`globals.css`'s `body`), and records that no
linter reads CSS, so it is a convention that is read, not enforced.

No _linter_ reads CSS — there is no stylelint, and knip's project globs are
`ts`/`tsx`/`mjs` only — but the test suite does. **Treat the list below as
examples, not as a set this file keeps current: `grep -rln "\.css\"" tests` is
the source of truth.** It over-matches by one —
`tests/smoke-path-filter.test.ts` lists stylesheet _paths_ as fixtures for a CI
path filter and never reads their contents. Among the readers:
`tests/touch-policy.test.ts`, `tests/notice-bridge.test.ts`,
`tests/share-progress.test.ts` and `tests/guided-ring.test.ts` all read
`3-components.css` — the last two by SLICING a rule block out of it, which is
the trap the paragraph below is about;
`tests/contrast.test.ts` and `tests/theme.test.ts` read layers 1 and 2
(theme.test.ts pins a `--p-cool-950` hex);
`tests/style-bridge.test.ts` reads `globals.css` and `2-semantic.css`; and
`tests/dist-css.test.ts` reads the **built** `dist/assets/*.css`, not a source
layer at all.

So a CSS check is buildable today. **For the colour boundary, copy
`tests/share-progress.test.ts`, not `tests/touch-policy.test.ts`** — share-progress
already asserts this exact split for `.share-scrim`, by slicing the rule block
and matching declaration _values_, which a comment cannot false-hit.
touch-policy reads its file whole and regexes the raw string, so the obvious
`not.toMatch(/--p-(amber|cool|green|red|warn)/)` copied from it fails on
`3-components.css`'s own header, which names those five families in prose in
order to ban them — and the natural repair is to weaken the pattern until it can
no longer catch a real leak in a rule. A whole-file reader must ignore comments
and match `var(…)` declarations rather than the bare identifier.

The same trap runs in the other direction, and it is observed, not theoretical:
a **comment** that names something a test greps for can capture that test. Round
3 of #529 wrote the share-scrim selector into `3-components.css`'s header, and
`share-progress.test.ts` — which locates its block with a raw `indexOf` over the
whole file — sliced the comment instead of the rule and went red. Its
`expect(declarations.length).toBeGreaterThanOrEqual(8)` floor is the only reason
that surfaced as a failure rather than as an assertion looping over nothing.
When a stylesheet comment must name a selector a test searches for, write it
without its leading dot, and keep a non-emptiness floor in any test that slices
a block out of a file.

Blind spot #2 under "No sprawl" below still says nothing in this repo reads CSS
at all; that sentence is stale and is tracked in #525, which is where it gets
fixed. Four places lean on it today, not one:
`tests/contrast.test.ts:12`, `tests/style-bridge.test.ts:18-19` and
`tests/notice-bridge.test.ts:21-23` cite it as their stated reason for existing,
and `src/app/globals.css:29` paraphrases it as the reason an orphaned alias
fails no check. No two quote it identically — notice-bridge elides the knip
parenthetical, style-bridge elides with an ellipsis, contrast lowercases it —
so #525 is a grep (`grep -rn "reads CSS at all" src tests AGENTS.md`), not a
one-line edit, which is why it is its own change and not a clause in this one.

Imports never go upward. This is enforced by ESLint `no-restricted-imports` in
`eslint.config.mjs`, not by convention.

**The rule that matters most:** `lib/` must stay free of DOM, Web Audio, and
MediaRecorder. All browser APIs live in `hooks/` (`hooks/audio-io.ts` is the
single audio boundary). That is what keeps the audio core unit-testable in
plain Node, and it is why the test suite can cover cut/paste/insert/export
without a browser or a microphone.

If you find yourself wanting `window` in `lib/`, the code belongs in `hooks/`.

## Testing

- `tests/` at the repo root, `*.test.ts`, run in the Node environment.
- The audio core and the storage layer are covered. Browser-only paths
  (MediaRecorder, `decodeAudioData`) are **not** covered by automated tests and
  can only be verified on-device. **First on-device run: 2026-08-24, Seth,
  iPhone / iOS 27 beta 6 / Safari** — capture continued while Safari was
  backgrounded and while the phone was locked, and the audio from that period
  was present in the take. That is one device on one pre-release build, and
  **iOS 27 beta 6 is not a shipping release.** **Android has been run.** The
  runs are recorded in `docs/progress_tracker.md`; they are not a finished #245
  sheet, and this file does not say which of them confirmed a defect — read the
  tracker and the issue. The cases in `docs/progress_tracker.md` — a take shorter
  than one 250 ms timeslice, and backgrounding immediately after Stop — are
  still open. Say so honestly rather than claiming coverage that does not exist.
- **Second on-device run: 2026-08-25, Seth, iPhone / Safari (staging pivot
  build).** Record → playback works. Backgrounding mid-take still records, and an
  incoming call mid-take (dialed in via Google Voice) stopped capture but **saved
  the partial take as a playable segment** — the #59 interruption fix, verified
  on iOS. **Backgrounding and interruption are still iOS Safari only** — no Android pass has
  reached interruption or background capture (#245), so #59 and #58 (pagehide)
  remain open for Android. The two cases above (sub-timeslice take,
  background right after Stop) are also still unrun. iOS version not recorded.
- **The export path exists (B7) and the encoder runs in a Web Worker (B8).**
  Share Chapter / Share Book, the worker round-trip (`hooks/mp3.worker.ts`,
  `hooks/mp3-codec.ts`), `decodeAudioData` of a stored MP3, and the
  transcode-on-Finished sweep are browser-boundary code: the gather → encode and
  encode → commit paths are unit-tested in Node through the injected
  `AudioCodec`, but the worker, the share sheet and the decode are verified only
  in a browser or on a device. **Neither has been run on a phone as of
  2026-09-02.**
- **There is a render harness now, and it is narrow on purpose (#197).**
  `tests/render.ts` runs one component through `renderToStaticMarkup` and parses
  the result with `jsdom`, so a test can read the attributes a component's JSX
  actually emits. The Vitest environment stays `node` — the harness brings its
  own document rather than swapping the global one, so `lib/`'s DOM ban and
  `typecheck:lib` are untouched. What it gives is **one render, no effects, no
  `act()`, no events, no layout and no cascade**: enough for a props → attribute
  guarantee (`tests/recorder-status.test.ts`, `tests/control-render.test.ts`),
  and nothing else. Where the CASCADE or the real build is what is under test,
  the answer is still the Playwright suite against `dist/`
  (`e2e/theme-toggle.spec.ts`); where a HOOK's effects or focus are, it is still
  on-device. Existing claims in `src/` and `tests/` still need individual
  review (#549): hook, focus and cascade limitations survive this harness,
  but statements that jsdom or a renderer is absent are now stale. The local
  corrections in this PR do not complete that sweep.
- `fake-indexeddb` backs the storage tests. Reset between cases by **clearing
  every object store**, not by `deleteDatabase`: deletion blocks indefinitely
  while any connection is open, and a harness that resolves on `onblocked`
  silently carries the previous test's data forward.

## Engineering bar

Small rules, each of which has already caught something real here.

**Red first.** A test that has never been observed failing is not a test — it
is a comment that costs CI time. Write it against the broken code and watch it
fail before you fix. Where the code already exists, get the same signal by
mutation.

**Mutation is how coverage is proved.** For any T1 change: break the guard, run
the suite, confirm a test dies. This is not theory — a review found one line
added to `settle()` that left the winning clip permanently unstoppable (issue
#2's exact symptom) while all eleven tests still passed. Line coverage would
have read 100%.

**A gate is tested in both states.** A CI step, a guard script or a smoke
assertion makes two claims: it goes red on the state it exists to catch, and
it stays green on every state the surrounding docs call legitimate, including
the documented _next_ one. Proving only the first half is not a gate. Three
tooling PRs in one week (#215, #232, #256; #270 has the details) each shipped
the first half only: a deploy check whose default origin is staging, so a
production promotion can PASS without production being fetched, and whose
entry guard exits 0 with no output on a path containing a space; a CI grep that
bans `obs/thumbs` in `dist/sw.js` unconditionally while the same PR's test says
jpg must be restored once a reader lands; a smoke assertion comparing
`fitToFrames(...).length` to the count `fitToFrames` guarantees by
construction. Every PR body had a red-first section. The rigor landed on the
pure core and skipped the boundary. So, for any gate: enumerate the legitimate
states and run the gate on each; mutate the thing the assertion claims to catch,
not a helper, and watch the gate itself die; test a gate script's entry path
and defaults, not just its exported function; derive a CI path filter from what
the suite imports, never from issue prose. And a review posted from the
author's own session is an author self-check — never "independent", never
"clean" (#215 carried one that missed all three P2s).

**Never claim verification you did not perform.** No docblock, comment or PR
body may state that something is tested, verified, or checked on-device unless
it was. This has been the single most recurrent defect class in this repo's
review history — three separate passes wrote a false "verified" claim. A test
file's name is a claim too: a file named for a bug, covering only a string
classifier, invites a triage reader to mark a P1 fixed.

**A run's output belongs in a PR comment or the progress tracker, never in a
docblock, a CSS comment or a test name.** Those three cannot be re-stamped at a
new head, and whoever opens the file next reads them as current. A docblock may
link that comment's URL; it may not restate its output. `docs/progress_tracker.md`
**is** the run record, and a dated observation a file needs in order to explain
itself is a reason rather than a run report. This rule binds prose you write or
edit; the sweep of what already violates it is **#575**, which is where an
existing docblock gets fixed, not here. Counts go in an assertion,
not in prose: a CSS comment quoting its own grep named a count the tree no
longer returns, having counted four comment lines as declarations — one of them
the sentence's own grep string. Do not name an environment: a docblock credited
a pinned Chromium that resolved to a path with nothing at it, so the run it
described used Playwright's own cached browser. Five such sentences shipped
across three PRs in one day — those two, a docblock claiming both assertions
were observed red when the first `expect` throws and the second never
evaluates, and two PR-body tallies a fresh checkout does not reproduce. Where
such a claim must change, **prefer deleting it to restating it**: of ten
repairs attempted that day, the only one that never needed re-correcting was
the one that removed a claim.

**"At the head this docblock ships on" is unverifiable by construction.** The
head moves with the commit that carries the sentence, so there is no head at
which the sentence can be checked. It reads as maximally precise and cannot be
falsified.

**A known-stale claim is worse than an unknown one, because it is being relied
on while it waits.** This file said Android had never been run; the staleness
was logged and deferred to the issue that would rewrite it "once the protocol
runs"; that sheet was never finished, the deferral was never revisited, and the
false sentence went on propagating into every agent's context, because that is
what AGENTS.md does. Correct a false claim where you find it, and prefer
deleting it to restating it. Deferring is available only when the claim is
quoted at several sites that have to move together and the deferral names the
issue that moves them — #525 and #575 are the standing examples. A single
false sentence does not qualify.

This applies to **living instructions** — this file, `CONTRIBUTING.md`, the
runbooks, docblocks, CSS comments. It does **not** apply to a dated entry in
`docs/progress_tracker.md`: that file is append-only and newest-first, so a
sentence inside an entry is judged as of that entry's date and is superseded
by a later one, never edited in place. "Android has still never run" in a
2026-09-12 entry was true on 2026-09-12; rewriting it would destroy the reason
that session's next step was the first Android pass.

**Idempotency is a property, not a policy.** Every write is safely re-runnable
or documented as to why not. In practice that means: get-or-create in **one**
transaction, never two; content-addressed clips so a repeated import dedupes
instead of duplicating; append-only migrations. `ensureObsChapter` is the
counter-example currently in the tree.

**Errors have a channel before they have copy.** An unhandled rejection must
reach an error boundary and a single sink — `console.error` is not a channel on
a phone in a village. The channel itself is now built end to end: the boundary
and the funnel (`hooks/report-failure.ts`, #188), and the funnel's durable
destination (#205) — a bounded log in the same IndexedDB the recordings live
in, marked state-in-place on the Books `≡` control and carried off the phone
through the OS share sheet. `console.error` is kept beside it, not replaced by
it: it is still the fastest read on a maintainer's desk, and the only one left
if the durable write is what failed.

**The channel being built is not the same as the app being wired into it, and
this file will not blur the two.** What reaches the funnel today is: uncaught
errors and unhandled rejections (`app/install-failure-listeners.ts`), render
throws (`components/error-boundary.tsx`), encoder health and recovery
(`hooks/mp3-codec.ts`), the transcode sweep (`hooks/finish-transcode.ts`),
share _prepare_ (`hooks/share-flow.ts`), the recorder's own guards and bounds
(`hooks/use-recorder.ts`: `cancel()`'s native `stop()` guard
`"recorder-cancel-stop"` #474, `start()`'s resume rejection
`"recorder-start-resume"` #470 and its 1000 ms bound firing
`"recorder-start-resume-timeout"` #475, an interruption that leaves the native
recorder still active `"recorder-interrupted-active"` #478, and a native
`stop()` throwing inside `stop()`'s own flush `"recorder-stop-flush"` #485 —
which seals the slices already in hand and rides the `StopResult`, so it
never reaches the backstop below — and a track `stop()` that throws while the
mic stream is released `"recorder-release-track"` #479), the level tap's clone
track throwing on its own `stop()` (`hooks/audio-io.ts`,
`"recorder-tap-clone-stop"`, #479), `stopRecording`'s commit-path backstop
(`hooks/use-audio-session.ts`, `"recorder-stop-backstop"`, #480), a failed
save (`hooks/use-save-take.ts`, `"save-take"`, #456), a failed book delete
(`hooks/use-books.ts`, `"book-delete"`, #456), a failed erase
(`hooks/use-erase-segment.ts`, `"erase-segment"`, #456), a failed
segment rename (`hooks/use-chapter-segments.ts`, `"segment-rename"`, #591),
playback's own
resume bound in `playSamples` (`hooks/audio-io.ts`: a `resume()` rejection
`"playback-resume"`, and the fail-closed gate that still finds the context
unusable after the resume await — `"playback-resume-timeout"` when the
1000 ms bound was what ended it, `"playback-resume-unusable"` when an
earlier rejection did or a fresh interruption arrived during the post-fill
yield, #469), and the log's own share and clear paths. `SaveFailed` now
carries the same `SendLogControl` the crash screen does (#456, moved into
its own module, `components/send-log-control.tsx`, so both screens share one
implementation) — `DatabasePanel` still does not: #456 itself calls that a
design call, since an unreachable database cannot read its own log either,
and that is different work from wiring the funnel. **`SaveFailed` pauses the
module-scoped transcode sweep while mounted** (#514), then resumes it on
unmount. Requests made during the pause are held in `requestedDuringPause`,
so a successful Finished retry still gets its conversion after recovery.
This pause is reversible; the crash screen's `quiesceTranscodeSweep()` remains
one-way because that screen exits through reload. An encoder turn already
in flight can still finish and write one failure entry before the pause takes
effect; pausing is not cancellation of that turn.
What still ends at `console.error` and is therefore **never written down** is
mic/record-start and the `use-audio-session.ts` catch sites that wrap
`playSamples` (a failed decode, a dangling clip with nothing to play) — the
resume bound's OWN failure is now on the funnel above, but the catch around
it still only `console.error`s — the recorder's preview path, and share
_send_ (`hooks/share-flow.ts`). Routing those is follow-up work — and it is
not a one-line change, because `SaveFailed` replaces the tree the way the
crash screen does, so that screen needs the Send control the boundary grew.
Until it lands, do not describe the log as holding "anything that went wrong":
`docs/training/facilitator-runbook.md` §5 names both halves for facilitators
and this paragraph is the engineering copy of the same list.

The _presentation_ stays deliberately thin, and that is the standing rule, not
a gap: this UI is for people who may not read, so a text toast is close to
useless and raw browser exception text on screen is a defect (#172). Prefer
state-in-place — the control itself shows the condition — over a message
bubble, and let a log's entries LEAVE the phone rather than be rendered on it.

**No sprawl, no duplicates, no stubs.** Nothing shipped that nothing uses;
nothing stubbed "for later."

`knip` enforces the mechanical half, in `npm run verify` and in CI, scoped to
**files, dependencies, unlisted imports, exports and exported types**. Exports
were added 2026-08-24; before that the gate had never checked them and nineteen
dead ones were passing.

An export that is genuinely dead now but that a named pivot batch wires up
carries a `@pivotpending` JSDoc tag, which knip honours.

**The tag must name a tracking issue, and the batch when a batch owns it.** A
tag need not cite a B-batch — a bare issue or open question is allowed (the OBS
media cache, tagged against #1 and Q4, was that example until B0 deleted it;
every remaining tag is now batch-owned). An export with **no** issue behind it
does not get a tag; it gets deleted. An
untagged unused export fails CI, and a tag without a reason is worse than the
export it hides.

**The tag is one alphabetic token on purpose.** knip parses tags with
`/[a-zA-Z]+/` and keeps only the first run, so a hyphenated `@pivot-pending`
is stored as `@pivot` — which would silently ignore _any_ future export tagged
`@pivot`-anything. Do not reintroduce a hyphen here.

**Two blind spots remain. Do not read a green knip as "no dead code."**

1. **A `src/` module imported only by a test looks used.** `tests/**` is a knip
   entry point, so a test import satisfies the `files` check. This is how 372
   lines of timing seam plus 494 lines of its tests survived to be deleted by
   hand. knip cannot tell that from `lib/audio/edit.ts`, which is the engine
   B5 will consume — so the judgement stays human.
2. **Nothing in this repo reads CSS at all.** knip says so itself
   (`.css — Compiled extension excluded by project`). There is no stylelint and
   no CSS plugin. An orphaned custom property or component token is invisible
   to every check, which matters most in B2 and B3 — the largest UI deletion
   this repo will do.

What it does catch, on its first run: an unused `zustand`, an unused
`lucide-react` that this document itself claimed was the icon library, and three
dead barrel files.

**The onion rule and the DOM ban are enforced, as of 2026-08-24.** Both were
prose until then. `no-restricted-imports` now matches relative specifiers as
well as `@/`-aliased ones, and `no-restricted-globals` bans the browser globals
from `src/lib/**` — a probe file in `src/lib/audio/` using `AudioContext`,
`document`, `window` and `navigator` previously produced zero ESLint and zero
`tsc` diagnostics. The ban catches value references; a type-position reference
is caught by `npm run typecheck:lib`, which compiles `src/lib` and `src/types`
against `tsconfig.lib.json` with no DOM lib — in `verify` and in CI. **That gate
has a named residual:** `"types": ["node"]` brings Node's own web globals, so
`Navigator` and `Storage` type-check inside `lib/`. Deliberate — both run in
plain Node and in a Worker, which is the property this rule protects — and
`tests/lib-boundary.test.ts` asserts what fires and what does not, so the line
cannot drift silently. Note `.husky/pre-commit` runs only `npm run typecheck`;
the DOM-free pass is `verify` and CI. `scripts/**/*.mjs`
are linted too — they matched no config block and ran with zero rules while
fetching over the network and writing 598 files into `public/`.

**`react-hooks/refs` has a named blind spot too (#212).** ANY nested function
defined inside a `catch (cause) { ... }` block that references `cause` —
a `setState` updater is the shape found so far, but nothing about `setState`
specifically is required — anywhere in a hook's body makes
eslint-plugin-react-hooks 7.1.1's analysis bail out on that hook, silencing
every rule that depends on it, `refs` included, for that hook only (a second
hook in the same file is unaffected). This is how `src/hooks/use-save-take.ts`
carried a real render-time `ref.current = x` write clean through
`npm run lint` until PR #180 simplified `commit` and the write started
failing. `tests/react-hooks-refs-gate.test.ts` pins both halves: a plain ref
write fires, and the bail-out shape stays silent — so a plugin upgrade that
fixes it fails that test instead of the gate quietly narrowing again. **That
test lints only synthetic probes, never `src/`** — it does not sweep the tree
for a live occurrence. It has needed a manual sweep twice, not once:
`use-save-take.ts` (closed by #213) and `src/hooks/use-books.ts`'s load
effect (found by George round 3 on #433, closed there by the same hoist). Do
not treat a green `npm run verify` as proof the tree is clean of this shape.

**Do not ramp up before it is needed.** Every rule above pays for itself now.
A rule that will pay off after October can wait until after October.

## Branches and deployment

```
feature  ->  develop  ->  staging  ->  main
             (default)    (staging)    (production)
```

| Branch      | Purpose                                              | Cloudflare deploys       |
| ----------- | ---------------------------------------------------- | ------------------------ |
| `feature/*` | one change                                           | preview version, own URL |
| `develop`   | **default.** Local and dev testing; where work lands | preview version, own URL |
| `staging`   | what testers and facilitators use                    | `tc-mobile-staging`      |
| `main`      | production                                           | `tc-mobile`              |

Work is cut from `develop` and merged back by PR. Promotion is `develop` ->
`staging` -> `main`, each by PR. **The `staging` -> `main` PR is the production
gate.**

### Versions and milestones

`package.json`'s `version` is the build number, and it moves in exactly one
place. Decided 2026-09-02, when the repo stopped being solo.

- **A feature or fix PR never touches the version.** With several contributors
  and three to six PRs a day, a bump in every PR is a guaranteed conflict on
  `package.json` and records nothing the merge commit does not.
- **One `chore(release): vX.Y.Z` PR per `develop -> staging` promotion bumps
  the patch** — daily, whenever there is something to promote. Its body lists
  the PRs it carries (#131 is the shape). Patch numbers are not capped;
  `0.1.30` is fine. **After the merge deploys, run `npm run check:deploy` and
  paste the PASS line into `docs/progress_tracker.md`** — v0.2.10 (#775)
  promoted without this and went unrecorded until a 2026-09-24 PR audit
  caught it (#839, #840 R7); the confirmation belongs in the tracker at
  promotion time, not reconstructed after the fact.
- **The minor is the milestone.** Every GitHub milestone is named for the
  version its `staging -> main` promotion ships. That PR bumps the minor and
  tags `main` (`git tag vX.Y.0` — the first tags this repo will have). A
  production hotfix between milestones is a patch on the shipped minor.

  | Milestone                            | Due        | Ships                                       |
  | ------------------------------------ | ---------- | ------------------------------------------- |
  | `v0.2.0 — Sept: production gate`     | 2026-09-30 | the first `staging -> main` since the pivot |
  | `v0.3.0 — Oct: East Africa training` | 2026-10-09 | what facilitators run at the training       |
  | `v1.0.0 — Post-training`             | —          | the first field-validated release           |

- **Every open issue carries a milestone.** File new issues into one. A
  milestone closes when its promotion PR merges, and anything still open in it
  moves to the next one explicitly, never silently.

### Cloudflare Workers Builds owns deployment

No Actions workflow deploys the **PWA**. The four web-deploy workflows were
deleted to remove a real collision: Cloudflare and Actions would otherwise both
deploy on the same triggers, to different targets — two preview deploys per PR
and two deployments per merge. The only deploy workflows in `.github/` are the
two **manual** native lanes — the iOS TestFlight lane (`ios-testflight.yml`, a
native build to App Store Connect, `docs/native/README.md` §4a) and the Android
APK lane (`android-apk.yml`, a signed release APK attached as a run artifact,
§5a). Both are `workflow_dispatch`-only, so they never fire on push/PR and are
not Workers Builds triggers (#262, #318). Do not add a push/PR deploy job.

Workers Builds is configured **per Worker**, so the same repository is
connected twice:

| Worker              | Production branch | Deploy command                      | Non-production builds |
| ------------------- | ----------------- | ----------------------------------- | --------------------- |
| `tc-mobile`         | `main`            | `npx wrangler deploy`               | **off**               |
| `tc-mobile-staging` | `staging`         | `npx wrangler deploy --env staging` | **on**                |

Non-production builds are enabled on **one** Worker only. With both on, every
push to `develop` triggers two preview builds of the same commit.

Add `docs/**` and `*.md` to Cloudflare's **Exclude paths** on both, or every
documentation commit burns a build.

Cloudflare account **unfoldingWord**. The
API token lives in Cloudflare's build settings, **not** in a GitHub secret —
Actions does not deploy the PWA, so it needs no Cloudflare credentials (the
TestFlight lane authenticates to App Store Connect with its own secrets, and
the Android lane signs with its own keystore secrets — neither is Cloudflare's).
Besides `ci.yml` and `dependabot.yml`, `.github/` holds only the two manual
native lanes, `ios-testflight.yml` and `android-apk.yml`.

### Confirming a deploy and rolling one back

A merged promotion PR is not a deployed build (#143 was exactly that: green on
GitHub, never deployed). This is the machine-checkable version signal and the
runbook for undoing a bad one.

**The version signal.** Every build emits `dist/version.json` (a small Vite
plugin in `vite.config.ts`, `generateBundle`, reusing the same `pkg.version`
and `buildSha` the footer build stamp uses) —
`{ "version": "0.1.x", "sha": "<short sha>", "builtAt": "<ISO timestamp>" }`.
It is deliberately not a build asset the PWA precaches (`.json` is outside
`workbox.globPatterns` in `vite.config.ts`), so fetching it always reaches the
origin, never a cached copy. `navigateFallbackDenylist` in the same Workbox
config (round-3 George #2) keeps that true for a browser _navigation_ to
`/version.json` too, not just `check:deploy`'s script-side fetch — without it,
Workbox's SPA-shell fallback would intercept a navigation there on an
installed PWA even though `.json` was never precached.

Each promotion type has its own explicit command — **the two are not
interchangeable**, and the production one is deliberately not just "the same
command with a different URL pasted in" (round-1 George G2: a bare
`check:deploy` run from a checkout still pointed at staging silently PASSed
for what should have been checking production, because the default origin is
always staging and nothing forced a promoter to say otherwise):

```bash
# develop -> staging: bare command, defaults to the staging Worker.
npm run check:deploy                        # expected sha from origin/staging
node scripts/check-deploy.mjs <origin> --sha=<short-sha> --version=<x.y.z>

# staging -> main (production, the highest-stakes gate in the repo):
# --require-origin makes the script itself refuse to run without an explicit
# origin, so this can never silently fall back to checking staging instead.
npm run check:deploy:prod                   # expected sha from origin/main
node scripts/check-deploy.mjs --require-origin --origin=<url> --sha=<short-sha> --version=<x.y.z>
```

**Which sha is compared, and how the check keeps it fresh itself.** Cloudflare
Workers Builds deploys the promoted branch's tip — for this repo's merge-PR
promotion flow, that tip is a **merge commit**, not the feature/develop
branch tip a promoter's local checkout usually has `HEAD` on (round-3
George #1: `docs/progress_tracker.md:102,118` recorded the v0.1.12
`develop -> staging` promotion (#202) as merge commit `afdfa6e`, not
develop's pre-merge tip `7152289`). So the bare commands above do **not**
compare against local `HEAD` by default: for the staging and production
default origins, `resolveExpectedSha()`/`resolveExpectedVersion()`
(`scripts/check-deploy.mjs`) read the corresponding **remote-tracking ref**
instead — `origin/staging` for `check:deploy`, `origin/main` for
`check:deploy:prod`. Falling back to local `HEAD`/this checkout's
`package.json` (and printing why) only ever happens for an origin that
**isn't** one of these two known defaults (a hand-typed preview-Worker
URL) — there is no promoted branch to be stale there. For a known origin,
see the fail-closed behavior below: nothing falls back.

Earlier drafts of this section said to run `git fetch origin` yourself
before either bare command — a **documented** prerequisite the gate itself
did nothing to enforce, and a promoter who forgot it (merging the promotion
PR on GitHub without ever fetching locally) on a checkout where Cloudflare
_also_ failed to deploy got a **false PASS**: the stale local ref and the
also-stale deployed build happened to agree, and neither reflected the new
promotion (the exact #143 failure mode this check exists to catch — found
in this PR's takeover round of dual review, Frank P1). The check now runs
that fetch itself, scoped to the one branch it's about to read
(`git fetch origin staging` / `git fetch origin main`, with an explicit
destination refspec so it updates the remote-tracking ref even on a
`--single-branch` clone), before resolving either half — and **fails
closed** if the fetch itself fails, if the ref still can't be resolved
after a successful fetch, or if the ref's `package.json` can't be read,
rather than silently falling back to whatever the local ref or working
tree already had. The fetch is skipped only when **both**
`--sha=<short-sha>` and `--version=<x.y.z>` are given explicitly — there is
then nothing left to resolve from the ref. Giving only one of the two still
triggers the fetch, to resolve the other half.

**The fetch also refuses to trust a non-canonical `origin`** (round-2
George P2). A fork's `origin` copies `staging`/`main` at fork time, and an
unrepointed pre-transfer clone's `origin` may not track this repo at all
(see "The transfer broke Cloudflare Workers Builds" below) — either way,
the fetch above would otherwise succeed against that stale branch and let
a stale deployed build coincidentally match it, the exact #143 false PASS
this check exists to close, just moved one level up the trust chain.
Before fetching, the check runs `git remote get-url origin` and fails
closed unless it resolves to `https://github.com/unfoldingWord/tc-mobile`
(https or ssh, with or without `.git`). Repoint `origin` (see the transfer
section) if this check fails on a clone that should be trusted.

`check:deploy:prod` is
`node scripts/check-deploy.mjs --require-origin --origin=https://tc-mobile.unfoldingword.workers.dev`
(`package.json`) — the `tc-mobile` Worker's URL, written down here because
nowhere else in the tree was. `check:deploy`'s (staging's) is
`https://tc-mobile-staging.unfoldingword.workers.dev`, also used in "Device
testing" below.

Either command fetches `<origin>/version.json?t=<timestamp>` (the query
string busts any intermediate cache), compares `sha` and `version` against
what was expected, prints a pass/fail line, and exits non-zero on a mismatch
or a fetch failure — so it can gate a promoter's next step without anyone
reading a diff by eye.

**Rolling back.** Two ways to move the deployed Worker back to a prior build,
independent of the version check above:

- **Cloudflare dashboard** — the Worker's **Deployments** tab offers rolling
  back to a previous deployment; see the Cloudflare Workers docs for the
  current steps, which are not reproduced here to avoid drifting from what the
  dashboard actually shows.
- **`npx wrangler rollback`** — run against the `tc-mobile` Worker for
  production, or `npx wrangler rollback --env staging` for
  `tc-mobile-staging`. This targets the Worker directly, without going through
  a build.

**What rollback does not do.** Either path moves the deployed Worker only — it
does not touch `staging` or `main`. The branch still points at the bad commit,
so a rollback must be followed by a revert PR against the affected branch, or
the next promotion will simply redeploy the same regression. And a PWA client
already installed keeps running its current service worker until it next
checks for an update (`registerType: "autoUpdate"` in `vite.config.ts` checks
on its own schedule, not instantly) — so a rollback is not immediately visible
on a phone that already has the app open or installed, and `check:deploy`
confirming the origin has rolled back is not the same claim as confirming a
given device has.

## Device testing — the HTTPS caveat

`getUserMedia` requires a secure context. `localhost` qualifies;
`http://192.168.x.x` does **not**. So `npm run dev:lan` alone will _not_ let a
phone record. Use a tunnel (`cloudflared tunnel --url http://localhost:5173`),
a per-PR Worker, or staging:

**<https://tc-mobile-staging.unfoldingword.workers.dev>**

**Test on real iOS at least once per meaningful audio change.** iOS Safari is
the platform most likely to break here: it produces mp4/aac rather than
webm/opus, caps AudioContext creation, and starts contexts suspended until a
user gesture. All three are handled in `hooks/audio-io.ts` — and all three are
easy to regress.

## Conventions

- **Branches:** `<type>/<short-description>` — `feat/waveform-selection`, cut
  from `develop` and merged back by PR. Never commit directly to `staging` or
  `main`; they are promoted to, not worked on.
- **Commits:** Conventional Commits. Subject _and_ body, neither blank.
- **Pre-commit** (fast): lint-staged, typecheck. **Pre-push** (slow): tests, build.
- **Never** `--no-verify`. Never suppress a lint rule or add a type suppression
  without asking first.
- **Never** swallow an error silently. If a `catch` is genuinely empty, the
  comment must say why.
- **Tester feedback is tagged by kind and source** (decided 2026-09-15).
  Field testers and facilitators are asked for _bug reports_; those go into
  the queue as `bug` with `source: tester`, and the body records who (by
  role, never by name), when, and on which build. _Feature requests_ from
  testers are documented, never dropped, and tagged `post-v1` with the source
  and the rationale in the body; they are not scheduled until they are
  reviewed against the plan after the training. Where a tester ask matches an
  issue already open, it lands as an evidence comment on that issue, not as a
  new one. `v1-required` means V1 = the v0.3.0 training build.

## Review — every PR, both reviewers

Two independent reviewers run on every code PR: **Frank** (codex, diff-local)
and **George** (grok, deep-tree). They are two lenses, never a primary and a
fallback — a PR is review-clean only when **both** are clean.

```bash
scripts/review/both.sh <base>          # run both
scripts/review/triage.sh <round> <pr>  # build the round's triage comment
```

**A triage comment is mandatory every round**, including clean rounds. Every
finding gets an explicit disposition — FIXED with a commit, REFUTED with
file:line evidence, or DEFERRED with a tracking issue — attributed to the
reviewer that raised it and stamped with the head SHA. A finding that was
"addressed" with nothing posted is not verifiable later.

P1 and P2 block merge. P3 is deferred to an issue unless the fix is trivial.

**The round cap is 4.** At round 4, say which shape the round has — a _chain_
(one finding, each a refinement of the last fix: converging, often worth one
more) or _siblings_ (new instances of one defect class: the fix approach is
wrong, and more rounds will not help) — and **ask the DRI whether to run
again**. The cap prompts a decision; it is not a gate the loop closes on its
own. Hitting it with findings open is an **escalation, not an approval**: name
the residual findings on the PR and have them explicitly accepted.

**Freeze budget (decided 2026-09-21, expires 2026-10-04).** Until the v0.3.0
handoff, T3 and docs changes take one George round (P1/P2 only), harness and
meta PRs cap at two rounds with residuals accepted on the PR, and a P3 never
triggers a round on any tier — it is batched into one follow-up issue at
triage. T1 and T2 are unchanged. The table is in
`docs/review/dual-review.md` ("Freeze budget").

**Decompose before any post-cap round (decided 2026-09-18).** The DRI's pick
at the cap is made from a _judgment sheet_, not from the round narrative:
break "is this PR right?" into atomic yes/no and choice judgments, answer each
from the strongest evidence reachable — the tree at the head SHA, the primary
spec, a device log, an issue thread — with a file:line or a URL per answer, and
include a "cannot tell" outcome. Then compose the options as explicit rules
over the answers and post the sheet on the PR with the pick. The discriminating
question is usually one nobody named in four rounds: for #474 it was whether
each guard's correctness depended on an _unobservable_ recorder state (one did,
one did not), and forcing a primary-source check per judgment is what caught a
spec claim in both docblocks that the current spec contradicts. Chain versus
siblings still gets stated; the sheet is what the pick is made from. The shape
is in `docs/review/dual-review.md` ("Decompose before the DRI picks").

**Merging.** This repo is solo, so Frank and George _are_ the review: once both
are clean at the current head SHA and CI is green, merge is an admin merge.
Documentation and content merge on green alone. Process/meta artifacts —
`ci.yml`, `AGENTS.md`, `scripts/review/**`, deploy config — normally need both
reviewers because they are _executed as instructions_; exempting them is
allowed, but **the decision is recorded on the PR**, never skipped silently.

**With several lanes in flight, merge one at a time and pre-flight each.** A
clean statement names a head SHA, so merging one lane moves the next lane's
base and staleness its sign-offs. After every merge, rebase and re-check the
remaining lanes.

Full process, and the traps that make a failed run look like a clean pass, in
[`docs/review/dual-review.md`](docs/review/dual-review.md).

## Risk tiers

| Tier   | Examples here                                        | Bar                                                                                                               |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **T1** | `lib/audio/*`, `lib/storage/*`, the IndexedDB schema | Tests required. Data loss or corrupted audio is unrecoverable in the field. Schema changes need a migration path. |
| **T2** | `hooks/*`, export/share paths                        | Tests where possible + on-device check on both Android and iOS.                                                   |
| **T3** | `components/*`, `app/*`, copy, styling               | Review only. This layer is expected to churn.                                                                     |

## Known open items

1. **MP3 encoding is off the main thread** since B8 (ADR 0009): one Web Worker,
   warmed at launch and reused across encodes (#182, ADR 0009 amended),
   terminated on abort or a worker error — re-warmed on abort, rebuilt on the
   next encode after an error. Every worker is built from a blob **snapshot** of
   the worker chunk taken at warmup, so no rebuild depends on a URL a
   service-worker update has purged (#192, ADR 0009 amended again). The blob
   worker is exercised in real Chromium by the #251 smoke, which simulates the
   purge and fails without the fix; the real purge chain, and any non-Chromium
   engine, are still unverified, so it carries a fallback to the direct chunk
   URL. What remains from ADR
   0003 is the notice and attribution work, #36. Not yet run on a phone.
2. **PCM storage is ~5.3 MB/minute** for segments still being worked on. **D3 is
   built** (B8, ADR 0009): a segment marked Finished is transcoded to 64 kbps
   MP3 and its PCM dropped in the same transaction, ~660 MB to ~66 MB for all 50
   OBS stories once finished. The other two ADR 0002 mitigations are still open:
   22 050 Hz for speech, and `navigator.storage.persist()`. #12 stays open on
   those. **Resolve before October.**
3. **lamejs is LGPL-3.0** in an MIT repo. **Decided: keep it** — ADR 0003.
   What remains is the notice and attribution work, #36, not a product call.
4. **The division-scheme question.** **Decided 2026-08-22 by Tim: no** to the
   broad half — one generic taxonomy, ADR 0004.
5. **Scripture Burrito export is out of Phase 1** — not pending, not blocked.
   A4 settled the share shape instead: Share Chapter is one concatenated MP3 to
   the OS share sheet, Share Book is a zip of chapter MP3s. B7 (#33) builds
   both. Burrito comes back only if a later phase asks for it, so the "talk to
   Benjamin first" next action is retired; the background is still
   `docs/research/prior-art.md` §4.
6. **No Shema Studio source access.** Tim asked us to read it; there is no
   public repo. Someone needs to ask Han.
7. **No OBS frame timing exists**, so record-along is not possible — ADR 0007.
   Reference audio is out of Phase 1 (D5). B0 (#26) **removed** the timing seam
   and the narration path and superseded ADR 0007 — both are gone from `src/`.
   The ask itself is still open: someone needs to ask uW to publish timing
   files — #13.
8. **OBS-derived recordings are CC BY-SA** — settled, #15 closed. What is
   still open is the _implementation_: the data model cannot tell an
   OBS-derived recording from a user-authored one, and the export path carries
   none of it — ADR 0006. That is engineering work, not another question for
   Tim.

## DRI

**Seth Stoll** is building this. **Tim** owns the requirements.
**Birch** is the project manager — and demoed translationCore4, so the
tC Mobile / tC4 convergence question runs through the same person.

Route questions accordingly: requirements to Tim, scheduling and tC4 to Birch,
Scripture Burrito and the event journal to **Benjamin**, OBS content and
audio to **Rich**, Shema Studio to **Han** (via Birch, who is already
helping him add OBS support).

**The repository lives at `unfoldingWord/tc-mobile`, public since 2026-09-13,**
transferred there by Seth from `sethstoll3/tc-mobile` on 2026-09-02. GitHub redirects the
old name, so existing clones keep working — but repoint them
(`git remote set-url origin https://github.com/unfoldingWord/tc-mobile.git`)
and use `--repo unfoldingWord/tc-mobile` with `gh` rather than relying on the
redirect. Issue and PR numbers carried over unchanged.

**The transfer broke Cloudflare Workers Builds** (#143): the connection was
bound to the repo under its old owner, and the first promotion after the move
(#142, staging v0.1.11) merged green on GitHub without ever deploying. Until
both Workers are re-linked to the org repo, **a merged promotion PR is not a
deployed build** — confirm the served bundle's version string with
`npm run check:deploy` / `npm run check:deploy:prod` (see "Confirming a
deploy and rolling one back" above), not the merge. The AGENTS.md rule that
the Cloudflare account is unfoldingWord was already true; only the GitHub
side moved.

Other contributors now push here (Jesse, `jag3773`, from 2026-09-02),
which is what the version/milestone scheme above and the reviewer/author split
in the review section exist for.
