# AGENTS.md — tC Mobile

The canonical contributor guide. Read this before changing anything.

## Purpose

tC Mobile is an offline-first PWA for oral Bible translation: record a passage,
edit the waveform, manage sections, export MP3 (export is not wired yet, #18). It targets Android and iOS
phones, frequently offline, used by people who may not read.

The driving deadline is the **East Africa training in the first week of
October 2026**, with production readiness targeted for **end of September 2026**.

## Tech stack

|         |                                                          |
| ------- | -------------------------------------------------------- |
| Runtime | Node 22.12+ (knip's floor)                               |
| Build   | Vite 7, `@vitejs/plugin-react`                           |
| UI      | React 19, Tailwind CSS 4, hand-rolled SVG icons          |
| PWA     | `vite-plugin-pwa` 1.3 (Workbox `generateSW`)             |
| Storage | IndexedDB via `idb` 8                                    |
| Audio   | Web Audio + MediaRecorder; `@breezystack/lamejs` for MP3 |
| Tests   | Vitest 3, `fake-indexeddb`                               |
| Lint    | ESLint 9 flat config, `typescript-eslint` 8, Prettier 3  |
| Deploy  | Cloudflare Workers static assets, Wrangler 4             |

## Commands

```bash
npm run dev            # dev server
npm run dev:lan        # bind 0.0.0.0 for phone testing (see HTTPS caveat below)
npm run build          # production build
npm run preview        # preview the build
npm run lint           # ESLint, zero warnings allowed
npm run typecheck      # tsc -b (project references)
npm run knip           # unused files and dependencies
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
- **There is no export path at all** — `encodeMp3` exists in `lib/audio/mp3.ts`
  with no call site outside tests, and nothing calls `navigator.share`. Do not
  list the share sheet as an untested surface; it is an absent one (#18).
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

`knip` enforces the mechanical half — in `npm run verify` and in CI — and it is
scoped to **unused files and unused dependencies**, not unused exports. That
scope is deliberate and it is a gap: dead exports inside a live file pass it
today — `downloadStoryMedia`, `cachedImageObjectUrl`, `formatBytes`,
`storyMediaStatus`, `listMediaUrls` and `Mp3EncodeOptions` among them. Treat
that list as illustrative, not exhaustive; only `knip --include exports` can
enumerate it.
Widening to `exports` means deleting or wiring those, which belongs to the
change that reworks that code, not to a docs pass. **Do not read a green knip
as "no dead code."** It found an unused `zustand`, an unused `lucide-react`
that this document itself claimed was the icon library, and three dead barrel
files on its first run — that is the class it catches.

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

1. **MP3 encoding runs on the main thread** and will jank on a long chapter.
   Move it to a Web Worker — ADR 0003.
2. **PCM storage is ~5.3 MB/minute.** All 50 OBS stories is roughly 660 MB.
   **Partly decided.** D3 took one of ADR 0002's three mitigations — PCM while
   a segment is being edited, transcode to MP3 and drop the PCM on Finished,
   ~660 MB to ~66 MB. The other two are still open: 22 050 Hz for speech, and
   `navigator.storage.persist()`. #12 stays open on those. **Resolve before
   October.**
3. **lamejs is LGPL-3.0** in an MIT repo. **Decided: keep it** — ADR 0003.
   What remains is the notice and attribution work, #36, not a product call.
4. **The division-scheme question.** **Decided 2026-08-22 by Tim: no** to the
   broad half — one generic taxonomy, ADR 0004.
5. **No Scripture Burrito export yet.** The audio flavor supports it and MP3 is
   the right format; talk to Benjamin Wright first — `docs/research/prior-art.md` §4.
6. **No Shema Studio source access.** Tim asked us to read it; there is no
   public repo. Someone needs to ask Han Chung.
7. **No OBS frame timing exists**, so reference audio is story-level and
   record-along is not possible — ADR 0007. The seam is built; someone needs to
   ask uW to publish timing files.
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

**The repository is deliberately personal and private** —
`sethstoll3/tc-mobile`, not `unfoldingWord/tc-mobile`. Per
`dev-practices/new-project-checklist.md`, creating an org repo requires
tech-lead approval and a recorded DRI, and neither exists yet. A private
personal repo sidesteps that gate honestly rather than pre-empting it.

**Moving it into the org later is the plan, and it is a real transfer** — the
Cloudflare account is already unfoldingWord, so deployment does not change, but
the repo secrets, the Actions history and any issue references do. Get the
approval and the DRI recorded first.
