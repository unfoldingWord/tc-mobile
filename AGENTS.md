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
[#25](https://github.com/sethstoll3/tc-mobile/issues/25) is the umbrella issue,
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

|         |                                                                            |
| ------- | -------------------------------------------------------------------------- |
| Runtime | Node 22.12+ (knip's floor)                                                 |
| Build   | Vite 7, `@vitejs/plugin-react`                                             |
| UI      | React 19, Tailwind CSS 4, hand-rolled SVG icons                            |
| PWA     | `vite-plugin-pwa` 1.3 (Workbox `generateSW`)                               |
| Storage | IndexedDB via `idb` 8                                                      |
| Audio   | Web Audio + MediaRecorder; `@breezystack/lamejs` for MP3 (in a Web Worker) |
| Tests   | Vitest 3, `fake-indexeddb`                                                 |
| Lint    | ESLint 9 flat config, `typescript-eslint` 8, Prettier 3                    |
| Deploy  | Cloudflare Workers static assets, Wrangler 4                               |

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
npm test               # vitest run
npm run format         # prettier --write
npm run verify         # everything above, in one command
npm run deploy:staging # wrangler deploy --env staging
npm run deploy         # wrangler deploy (production)
```

## Architecture — onion layers

```
types → lib → hooks → components → app
```

Styling is layered separately, in `src/app/styles/`:

```
1-primitives.css   raw values, no meaning        (nothing outside layer 2 may use these)
2-semantic.css     roles + themes                (the only layer that knows about themes)
3-components.css   component tokens and parts    (may use layer 2, never layer 1)
```

`@layer primitives, semantic, components, utilities` fixes the cascade order
once, so Tailwind utilities always win and a one-off utility stays a safe
escape hatch rather than a specificity fight. Using a primitive directly in a
component is the leak this exists to prevent — it is what makes a theme
unswitchable later.

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
  was present in the take. That is one device on one pre-release build; **iOS 27
  beta 6 is not a shipping release and Android has never been run at all.** The
  cases in `docs/progress_tracker.md` — a take shorter than one 250 ms
  timeslice, and backgrounding immediately after Stop — are still open. Say so
  honestly rather than claiming coverage that does not exist.
- **Second on-device run: 2026-08-25, Seth, iPhone / Safari (staging pivot
  build).** Record → playback works. Backgrounding mid-take still records, and an
  incoming call mid-take (dialed in via Google Voice) stopped capture but **saved
  the partial take as a playable segment** — the #59 interruption fix, verified
  on iOS. Still **iOS Safari only; Android has never been run**, so #59 and #58
  (pagehide) remain open for Android. The two cases above (sub-timeslice take,
  background right after Stop) are also still unrun. iOS version not recorded.
- **The export path exists (B7) and the encoder runs in a Web Worker (B8).**
  Share Chapter / Share Book, the worker round-trip (`hooks/mp3.worker.ts`,
  `hooks/mp3-codec.ts`), `decodeAudioData` of a stored MP3, and the
  transcode-on-Finished sweep are browser-boundary code: the gather → encode and
  encode → commit paths are unit-tested in Node through the injected
  `AudioCodec`, but the worker, the share sheet and the decode are verified only
  in a browser or on a device. **Neither has been run on a phone as of
  2026-09-02.**
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

**Never claim verification you did not perform.** No docblock, comment or PR
body may state that something is tested, verified, or checked on-device unless
it was. This has been the single most recurrent defect class in this repo's
review history — three separate passes wrote a false "verified" claim. A test
file's name is a claim too: a file named for a bug, covering only a string
classifier, invites a triage reader to mark a P1 fixed.

**Idempotency is a property, not a policy.** Every write is safely re-runnable
or documented as to why not. In practice that means: get-or-create in **one**
transaction, never two; content-addressed clips so a repeated import dedupes
instead of duplicating; append-only migrations. `ensureObsChapter` is the
counter-example currently in the tree.

**Errors have a channel before they have copy.** An unhandled rejection must
reach an error boundary and a single sink — `console.error` is not a channel on
a phone in a village. The _presentation_ is a separate question and is
deliberately deferred: this UI is for people who may not read, so a text toast
is close to useless. Prefer state-in-place — the control itself shows the
condition — over a message bubble.

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

**`react-hooks/refs` has a named blind spot too (#212).** A `catch (cause) {
... }` block that passes a `setState` updater a closure capturing `cause`,
anywhere in a hook's body, makes eslint-plugin-react-hooks 7.1.1's analysis
bail out on that hook — silencing every rule that depends on it, `refs`
included, for that hook only (a second hook in the same file is unaffected).
This is how `src/hooks/use-save-take.ts` carried a real render-time
`ref.current = x` write, clean through `npm run lint`, until PR #180
simplified `commit` and the write started failing. `npm run lint` reported
nothing before that, over that exact line. `tests/react-hooks-refs-gate.test.ts`
pins both halves: a plain ref write fires, and the bail-out shape stays
silent — so a plugin upgrade that fixes it fails that test instead of the
gate quietly narrowing again.

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
  `0.1.30` is fine.
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

There are no deploy workflows in `.github/`. Deleting them removed a real
collision: Cloudflare and Actions would otherwise both deploy on the same
triggers, to different targets — two preview deploys per PR and two
deployments per merge.

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

Cloudflare account **unfoldingWord** (`5a3ffd86280d3ed086be76d955829242`). The
API token lives in Cloudflare's build settings, **not** in a GitHub secret —
Actions no longer deploys anything, so it needs no Cloudflare credentials. Only
`ci.yml` remains there.

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
   next encode after an error. What remains from ADR
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
   Benjamin Wright first" next action is retired; the background is still
   `docs/research/prior-art.md` §4.
6. **No Shema Studio source access.** Tim asked us to read it; there is no
   public repo. Someone needs to ask Han Chung.
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

**Seth Stoll** is building this. **Tim Jore** owns the requirements.
**Birch Champeon** is the project manager — and demoed translationCore4, so the
tC Mobile / tC4 convergence question runs through the same person.

Route questions accordingly: requirements to Tim, scheduling and tC4 to Birch,
Scripture Burrito and the event journal to **Benjamin Wright**, OBS content and
audio to **Rich Mahn**, Shema Studio to **Han Chung** (via Birch, who is already
helping him add OBS support).

**The repository lives at `unfoldingWord/tc-mobile`, private,** since Seth
transferred it from `sethstoll3/tc-mobile` on 2026-09-02. GitHub redirects the
old name, so existing clones keep working — but repoint them
(`git remote set-url origin https://github.com/unfoldingWord/tc-mobile.git`)
and use `--repo unfoldingWord/tc-mobile` with `gh` rather than relying on the
redirect. Issue and PR numbers carried over unchanged.

**The transfer broke Cloudflare Workers Builds** (#143): the connection was
bound to the repo under its old owner, and the first promotion after the move
(#142, staging v0.1.11) merged green on GitHub without ever deploying. Until
both Workers are re-linked to the org repo, **a merged promotion PR is not a
deployed build** — confirm the served bundle's version string on the staging
URL, not the merge. The AGENTS.md rule that the Cloudflare account is
unfoldingWord was already true; only the GitHub side moved.

Other contributors now push here (Jesse Griffin, `jag3773`, from 2026-09-02),
which is what the version/milestone scheme above and the reviewer/author split
in the review section exist for.
