# Progress tracker — tC Mobile

Newest first. One entry per working session.

---

## 2026-08-26 — Day 8: B5 waveform editing, and two recorder P3s

**Branch:** `develop` · **PRs:** [#64](https://github.com/sethstoll3/tc-mobile/pull/64) (#60/#61), [#65](https://github.com/sethstoll3/tc-mobile/pull/65) (B5) both merged · **On `develop`** (`94f9f01`) · **Closed:** #60, #61, #31, #66 · **Open/new:** #67, #68

### Completed

- **#60/#61 shipped** (#64 → `develop`, `d15563f`) — the two Fable-pass P3s on the
  recorder: `start()` gains an idle guard (no hot-mic on a double-start; returns
  `true` so the mic floor is held), and the waveform pan freezes an in-flight drag
  while `busy`, not just its start. Two review rounds (round 1 caught a converged
  pan P2 + a floor-semantics P2), round 2 clean.
- **B5 — waveform editing shipped** (#65 → `develop`, `94f9f01`), mockups 4 & 5:
  selection frame with drag handles, cut to a chapter-scoped clipboard, paste at
  the centerline, undo/redo, over an in-memory working buffer.
  - **Undo = O-B** (in-memory operation log, `lib/audio/edit-log.ts`, replayed from
    the original; D2's "survives a restart" resolved against G3's ephemeral
    clipboard — the flattened result persists on close, the history does not). **No
    schema change.**
  - **Record×edit = Model A** (edits at idle, one record commits on close, splice
    base = the edited buffer). G3 was already decided at Gate 1 — #31's "blocked"
    line was stale.
  - Clipboard lives in `App` (survives the per-segment sheet remount), cleared on
    chapter change. Persist reuses the never-lose slot; an edit-only cut-to-empty
    clears the take instead of writing a 0-frame ghost.

### Five review rounds, both reviewers each round (Frank/George)

- The cap is 4; **round 5 was DRI-authorized**. Every round triaged on the PR with
  dispositions + head SHA. Convergences each round were the highest-value class.
- **R1** cut-to-empty persisted a phantom 0-frame recording (converged). **R2** the
  cut-to-empty _failure_ was swallowed on close; cut allocated outside the edit
  guard; selection-clamp teleport; off-viewport handle. **R3** permission panel hid
  the editor (edits lost); multitouch handle race. **R4** Frank **P1** —
  `clearSegmentTake` could delete a shared clip; George — AT `inert`/Redo gating +
  0-frame invariant belongs in the T1 store. **DRI chose to harden the store**
  (reference-counted clip delete; `putClip` rejects empty). **R5** George **P1** —
  a superseded stop (pagehide) during cut-all+record erased the original; fixed by
  gating the edit-only close on `!attemptedCapture`. Cut pan-remap (#66) closed.
- **Merged on a DRI override** of the both-clean rule (Frank APPROVE since R3;
  George's R5 findings fixed but not re-reviewed), recorded on the PR.

### Blockers / needs a human

- **On-device is the real gate for B5 (T1 audio).** The overlay, pointer, canvas,
  and the `close()` state machine are browser-only (no jsdom) — none of it is
  Node-tested. Smoke the editing path (select → cut → paste → undo/redo →
  close/reopen persistence) on **iOS and Android**. Android remains the standing
  gap across #59/#58 too.
- **#67** SaveFailed copy says "recording" for an edit-only fail (cosmetic, safety
  intact). **#68** `addTake`'s parallel unconditional clip-delete (latent; lands
  with content-addressed clips).

### Next steps

1. **On-device B5 smoke** (iOS + Android), plus the still-open #59/#58 Android
   checks and the two day-1 cases.
2. **B6 (#32)** — VU meter, the recorder `≡` menu's Erase Segment (G4; the
   `clearSegmentTake` store op B5 added is its foundation), erase confirmation.
3. `staging` promotion once B5 is device-verified; `staging→main` stays gated on
   Android.

---

## 2026-08-25 — Day 7: the pivot foundation (B1–B4), built and hardened under review

**Branch:** `feat/pivot-b1-b4` → `develop` → **`staging`** · **PRs:** [#57](https://github.com/sethstoll3/tc-mobile/pull/57) (B1–B4), [#62](https://github.com/sethstoll3/tc-mobile/pull/62) (#59 fix), [#63](https://github.com/sethstoll3/tc-mobile/pull/63) (promotion) all merged · **On staging** (`c7ef2af`) and device-smoked on iOS · **Open:** #59/#58 (Android), #60/#61 (P3)

### Completed

- **B1–B4 built as one clean lane** (`ultracode` workflow → `6b7b4e4`). Pre-alpha,
  no field data, so the pre-pivot model/UI was torn out and replaced, not evolved:
  - `Section` removed; `Segment` hangs off `Chapter` and is the unit of work.
    `Project` → `Book`. `Take` 1:1/hidden (re-record replaces, reclaims PCM — the
    `takeIds[]` leak is gone). Binary finished flag over the 5-value enum, with the
    never-recorded-can't-be-finished invariant in the store.
  - Books, Segments, and Recorder screens (fixed centerline, insert/append,
    pause, zoom, no-permission screen). `projects.ts` → `books.ts`.
  - **ADR 0008** waives append-only for the v2→v3 destructive recreate (DRI call,
    pre-alpha) — supersedes #27's "still append-only" line for that one transition.
- **Five review rounds, both reviewers each round** (Frank/George), every round
  triaged on the PR with dispositions + head SHA. The data-loss class converged
  and **closed by round 3** (own-before-fallible: the pending slot holds the merge
  recipe, the merge is deferred into the guarded commit); the reload-race class
  **closed by round 4** (coordinate the reload window; recorder awaits its writes).
  No P1 in rounds 4 or 5.
- **CI green** on the head (`46dcea4`); `npm run verify` green (141 tests).

### Review, resumed and finished (rounds 6–10 + Fable)

- **The round-5 plan landed** (`stop()` → `{samples | error}`; finished-write
  failures reach the `Notice`; the finished mark rides the take through
  `addTake`; scrub reset; docs) — then five more rounds hardened it.
- **R6** one P2 (finished mark dropped on a save-retry → carry `finished`
  through the pending take, atomic on first attempt and retry; tested +
  mutation-checked). **R7** four P2 (scrub keyed on clip id not duration; empty
  _decoded_ PCM; checkbox honesty; Segments load-failure). **R8** three P2
  (Books load-failure sibling — class enumerated; first-take Finished; recorder
  `key=`+`inert` for wrong-segment splice + modal isolation). **R9** Frank +
  George _converged on the same fix_ — `finishedIntent` made explicit-only after
  an optimistic reset demoted an untouched segment on a denied start; Books got
  a Retry (home has no back-out). **R10** Frank **APPROVE**; George one P2 +
  one P3 (checkbox frozen across the close window; dashed glyph keys on state).
- **No P1 in any Frank/George round**; the never-lose and reload-race classes
  stayed closed throughout. Per DRI, no 11th round — a **Fable adverse pass**
  instead, then merge on green.
- **Fable found one real P1** (#59), plus two P3 (#60, #61). Its full walk of
  the finished-flag state machine and the splice/pending-take machinery came
  back clean.

### Shipped to staging, and first device evidence on the pivot build

- **#59 (P1) fixed** (#62, `4b4482b`): a mid-take mic interruption used to drop
  the recording silently and deadlock the sheet (no `onerror`/`onended`; `stop()`
  ignored the held chunks). Now `start()` registers `onerror` + track `onended`
  (freeze to `processing`, release the mic once inactive), and `stop()` recovers
  the held chunks from an inactive recorder so **Back commits the partial take**.
  A second Fable pass on the fix: **no P1/P2**; its four P3 hardenings folded in.
- **Promoted `develop` → `staging`** (#63, `c7ef2af`) — B0 + B1–B4 + the #59 fix,
  auto-deployed to `tc-mobile-staging`.
- **On-device (iPhone / Safari, staging):** record+playback work; backgrounding
  mid-take keeps recording; **an incoming call mid-take (via Google Voice)
  stopped capture but saved the partial take as a playable segment — #59
  confirmed on iOS.** Logged in AGENTS.md (`2937311`).

### Blockers / needs a human

- **Android — untested, all of it.** #59 and #58 both specified iOS _and_
  Android; nothing has run there. Now the single biggest coverage gap. #59 is
  reopened, iOS-verified, Android-pending.
- **#58 — pagehide.** Distinct from backgrounding (which was verified): pagehide
  discards the page. Still unverified, iOS and Android.
- Other on-device gaps: a take under one 250 ms timeslice; backgrounding
  _immediately after Stop_; a Bluetooth-mic disconnect as the interruption
  trigger (only an incoming call was exercised).

### Next steps

1. **Android on staging** — the interruption path (#59), pagehide (#58), and the
   two day-1 checks. Closes the last of #59/#58.
2. **#60/#61 (P3)** recorder nits — cheap, same file, whenever.
3. **B5–B8** (#31–#34) — waveform editing, VU/menu/erase, template+share, MP3
   off the main thread. B5 (#31) consumes the `lib/audio/edit.ts` engine.
4. `staging → main` is the production gate — untouched, waits on the device
   checks (esp. Android) passing.

---

## 2026-08-24 (evening) — Day 6: B0 lands, the pivot's first deletion

**Branch:** `develop` · **PR:** #55 merged (`95418e6`) · **Issues:** closed #1, #5, #9, #26; noted #27

### Completed

- **B0 merged** (#55 → `develop`, `95418e6`) — the first pivot batch, deletion
  before construction. Net ~−1400 lines across three orphaned paths:
  - the **timing seam** (`lib/timing/**`, `types/timing.ts`, its test) —
    supersedes ADR 0007, closes #5;
  - the **reference-audio / narration path** (through `audio-io`,
    `use-audio-session`, `section-view`, `App`, `use-chapter`, `view`) —
    closes #9;
  - the **OBS media cache accessors** (`hooks/obs-media.ts`,
    `lib/storage/media.ts`, the `CachedMedia` export) — closes #1 as moot.
- **Four review rounds, both reviewers clean.** A converging consequence-tail,
  P3-only and shrinking after round 1 — no P1/P2 since round 1. Every round
  triaged on the PR with dispositions and head SHAs.
- **The #26 contradiction was settled first**, on the record: kill the whole
  OBS media cache, not keep it. Q4 answered no, #1 closed as moot, ADR 0006 and
  the pivot plan amended.

### Two calls review corrected, recorded not glossed

- **B0 makes no schema change.** The plan (and my #26 decision comment) had B0
  removing the `media` object store from `db.ts`. Frank was right that this
  edited a shipped migration step — the append-only violation the discipline
  exists to prevent. Narrowed: B0 removes the **accessors and the `CachedMedia`
  export**; the empty, unread `media` store stays until **B1's drop-and-recreate
  (#27)**, where the schema change and its migration test belong. Frank's
  blob-leak scenario was refuted — `downloadStoryMedia` never had a caller
  outside the deleted code, so the store is empty on every device.
- **The `"reference"` arbiter kind is gone.** I'd kept it as a "generic
  mechanism / Phase 2 reference audio" residual. Both reviewers converged on it —
  Frank as a P2, George naming it "a stub-for-later against the bar B0 is
  enforcing." They were right; that is exactly the speculative-future the bar
  rejects. `SourceKind` is now `"take" | "mic"`, and the reference-specific
  arbiter tests were redundant with `"take"`.

### What review caught that would have shipped

- **`ChapterCard.title` went write-only** when B0 deleted the section-view
  narration button that rendered it. Noted that B2's Books screen (#28) is the
  reader, kept for that batch — consistent with how `imageUrl` and the `media`
  store are kept for theirs.
- **"No Phase 1 screen shows artwork" was the mockup, not the tree.** My own
  round-1/2 doc edits carried it; the pre-pivot recording view still renders the
  Door43 CDN `<img>`, so a tester on this build sees the frame on every section.
  Qualified every instance to "no _mockup_ screen."

### Blockers / needs a human

- **None new.** B1 (#27) now carries the deferred `media`-store drop — recorded
  on #27 and in the `db.ts` comments, so it is on the checklist, not only in a
  comment.
- Device coverage unchanged from Day 5: still one device, one pre-release build,
  no Android; the three specific checks (background after Stop, sub-timeslice
  take, anything on Android) remain open.

### Next steps

1. **B2 (#28) and B3 (#29)** — the pivot screens, sequenced ahead of B1.
2. **B1 (#27)** once they land — drop-and-recreate migration, and **drop the v2
   `media` store** B0 left behind.
3. `develop` is now ahead of `staging` by B0; promotion is a separate call.

---

## 2026-08-24 — Day 5: the gate, the audit, and the debt lanes

**Branch:** `develop` · **PRs:** #22, #44–#52 merged · **Issues:** +1 (#43)

### Completed

- **#22 merged** (`58c6593`) after **six review rounds** and nineteen findings.
  The class was one defect repeated: a claim settled in one file with the old
  version still standing where a reader lands. Round 4 stopped fixing cited
  instances and enumerated the class by grep, which caught three sites no
  reviewer named — and rounds 5 and 6 still found classes the enumeration had
  not conceived of. Merged on a recorded acceptance, with the residual filed as
  **#43** rather than claimed closed.
- **First on-device evidence** (#45). iPhone / iOS 27 beta 6 / Safari: capture
  continued through a background and a screen lock, and the audio from that
  period was in the take. Worth flagging as surprising — WebKit has historically
  suspended capture when Safari backgrounds, and nothing in `hooks/audio-io.ts`
  depends on it not doing so.
- **Two promotions to `staging`** (#44, #50). The first carried 31 commits: every
  recorder fix from #21's five rounds had been unreachable from a phone until
  then, because the staging Worker only builds from `staging`.
- **#46 — the merge gate can now see what it was missing.** Five checks
  `AGENTS.md` claimed or implied were running, and were not.
- **The pre-pivot audit** — six read-only lenses, adversarially verified, 89
  findings surviving. It is what the rest of the day was spent on.
- **Three debt lanes merged** (#47, #48, #49), each adversarially reviewed inside
  its own worktree before a human looked at it.
- **#51 and #52** — untracked a `node_modules` symlink that had reached both
  `develop` and `staging`.

### The gate was blind in five places

Every one verified by running it, not by reading:

|                 | Claimed                               | Actual                                                                                        |
| --------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `knip` exports  | "no sprawl, no stubs"                 | **never checked** — 19 dead exports passing                                                   |
| `lib/` DOM ban  | "the rule that matters most"          | probe using `AudioContext`, `document`, `window`, `navigator` → **ESLint exit 0, tsc exit 0** |
| onion imports   | "enforced by ESLint, not convention"  | `@/`-aliased only; `../../hooks/x` passed silently                                            |
| `scripts/*.mjs` | globbed by lint-staged and `eslint .` | **0 rules** against 63 for `App.tsx`                                                          |
| CSS             | —                                     | nothing in the repo reads it at all                                                           |

`lib/` is now bounded by construction rather than enumeration:
`tsconfig.lib.json` compiles it with no DOM lib, and
`tests/lib-boundary.test.ts` asserts both halves. It was mutation-tested —
break either guard and exactly the covering case fails. **A guard nobody has
seen fail is not a guard.**

The named residual is recorded rather than glossed: `"types": ["node"]` brings
Node's own web globals, so `Navigator` and `Storage` type-check inside `lib/`.
Deliberate — both run in plain Node and in a Worker, which is the property the
rule protects.

### The tag that was silencing knip

`"tags": ["-@pivot-pending"]` did not mean what it looked like. knip's splitter
is `tag.match(/[a-zA-Z]+/)` and keeps only the first alphabetic run, so the
exclusion registered was **`@pivot`**. Proved by tagging an unrelated export
`@pivot` and watching it vanish from the report. The mechanism built to prevent
silencers was itself a silencer for anything tagged `@pivot`-anything, and it
had been passing CI as a working exemption. Now the single token
`@pivotpending`, with the reason in `AGENTS.md`.

### Three answers to one question

`lib/storage/segment-audio.ts` (#49) replaces three independent walks of
segment → active take → clip that had drifted to three different answers on a
broken pointer: one rendered "never recorded", one released the audio floor
silently, one pushed `take.clipId` onward unverified. The first is the dangerous
one — it re-enables Record over a segment that has a take, which is the class of
the P1 closed in round 3 of #21.

A tagged union now forces callers to distinguish "nobody recorded this" from
"this claims audio the database cannot produce", inside one readonly
transaction. **Five review rounds, no P1 in any of them.**

### What the reviewers caught that I would have shipped

Recorded because the pattern is the useful part, not the individual bugs.

- **George, #49 round 2.** The round-1 fix routed the dangling-take warning
  through `setPlaybackError` — reachable only by tapping Play. A card with a
  missing clip gets `durationMs: null`, and every surface keys off that to render
  **Record**. The one path that could speak was the one the translator never
  takes. That needs the diff chased into three components the diff never
  touches; a diff-local lens cannot find it.
- **George, #49 round 4**, correcting his own round-3 advice: a chapter-scoped
  count cannot speak on a per-section screen. Standing on an intact section it
  put a red alert beside the red "record again" control on a good take, and
  recording would demote it.
- **Frank, #46.** The banned-globals list was hand-picked and missing
  `AudioBuffer` and `HTMLAudioElement`. He was right that a list is not a
  boundary, and the tsconfig fix I had deferred as "needs its own project
  reference" turned out to be free.

Three of #49's nine findings were mine rather than the agent's: the committed
symlink, a `resolved` that rested on an argument instead of a check, and editing
the worktree while George was reading it — which voided a round, and is the loop
rule this repo already had written down.

### A mistake worth not repeating

The three debt lanes ran in isolated worktrees, which have no `node_modules`, so
each was symlinked at the real install to run `npm run verify`. Two lanes then
committed with `git add -A`. `.gitignore` read `node_modules/` — trailing slash
matches a **directory**, and a symlink is a file. Two of them shipped.

`npm ci` removes the tree before installing, so every CI job passed. The
exposure is a fresh clone on a machine where that absolute path exists and holds
another project's dependencies. Fixed in #51/#52; the ignore rule lost its
slash in #49.

### Decisions taken

- **B1 is re-sequenced behind B2 and B3.** Removing `Section` breaks every screen
  the app renders, #27's Done-when named only the store, index, roll-up and
  migration, and B2/B3 were written as additive — so the prior-UI files could
  have survived both batches with every issue closed. Recorded on #27, #28, #29
  and in the plan of record.
- **No v2 field data exists, so B1's migration is drop-and-recreate.** That
  collapses the upgrade-path test gap to a much smaller ask and takes the
  half-migrated-crash path off the table. True exactly once, because the app has
  never shipped.
- **Tim: the recorder sheet has no Play control** — his own drawing, and his own
  correction. The centerline annotation already says playback happens there, so
  the behaviour was specified and only the control was never drawn. Placement is
  on #30 with the two questions that settle it.

### Blockers / needs a human

- **The two Gate artifacts are off-repo and unread.** #28 sends B2 implementers
  to one for "jobs and states". A deletion recorded only in an artifact and not
  in the batch issue is the same "addressed with nothing posted" failure the
  triage rule exists to prevent.
- **#26 contradicts itself and must be settled before B0 is cut.** Scope deletes
  `narrationUrl`, "Not in scope" keeps `obs-media.ts`, Done-when requires knip
  clean. After B0 those cannot all hold, and the cheap way past it is a keep-alive
  import — the thing B0 exists to prevent.
- **Still one device, one pre-release build, and no Android at all.**

### Next steps

1. **Settle the `obs-media.ts` / Q4 question on #26**, then cut B0.
2. **B2 (#28) and B3 (#29)** — the re-sequencing puts the screens before the
   model.
3. **B1 (#27)** once they land, with a drop-and-recreate migration.
4. The three device checks still open: background immediately after Stop, a take
   under one 250 ms timeslice, and anything at all on Android.

---

## 2026-08-23 (evening) — Day 4: clearing the review queue

**Branches:** `docs/pivot-plan-p3-p4`, `fix/review-round-1-scheme-independent`,
`docs/correct-obs-audio-and-journal-claims` · **PRs:** #35 and #21 merged, #22
mid-review · **Issues:** +5

### Completed

- **#35 merged** (`9c0230b`). Documentation-only, so CI green alone; the
  decision to merge without a reviewer round is recorded on the PR rather than
  taken silently.
- **#21 merged** (`20df466`) — the round-1 fix lane, after **three more review
  rounds**. B0 (#26) is unblocked.
- **#22's five findings fixed**, awaiting one more round.

### #21, rounds 3 to 5

**Round 3 had run and was never triaged.** Both reports were sitting in
`.review/` from earlier in the day with no comment on the PR — the exact failure
AGENTS.md's mandatory-triage rule exists to prevent, since a finding whose only
record is the author's disk is not verifiable by anyone else. Posted late, with
dispositions, before doing anything else.

Nine findings closed across the three rounds (`0418971`, `7fced15`, `3a5d205`):

- **George's P1** — `ondataavailable` followed `chunksRef` rather than the array
  the recording owns. MediaRecorder delivers its last slice _after_ `stop()` is
  invoked, so a `cancel()` in that window sent the slice to a fresh array while
  `stop()` built its blob from the old one. For a take under one 250 ms
  timeslice — and on WebKit builds that ignore the timeslice entirely — that
  slice is the whole recording: `blob.size === 0`, the section still reads
  unrecorded. This is the one that mattered.
- **Frank's P2** — a refused `getUserMedia` could leave the mic floor claimed
  forever, because the only release was an effect keyed on a state the
  denied-permission path may never present. `start()` now resolves to whether
  capture began, and the claim is handed back on that completion.
- **George's P2s** — a save that reported done before the card reflected it, so
  Record re-enabled over a section reading as unrecorded and a second take
  demoted the good one; a Retry guard on stale render state that let two taps
  append two take rows for one clip; the same guard missing from Discard, its
  sibling on the same screen; and `leave()` rewinding chapter narration on every
  section step.
- Plus the two findings #22 had deferred into this lane, and two P3s.

**Round 5 was the stopping point, and it is recorded as an escalation rather
than an approval.** Frank was clean twice running; George returned two more P2s
and two P3s, all in territory no earlier round had touched. That is the tell:
he was still discovering, not converging.

### Why a 2,345-line PR does not converge

Both review scripts build their input from `git diff "$BASE"...HEAD` — the whole
branch, not the delta since the last reviewed SHA. So cost is pinned to the
cumulative branch while the fixes shrink:

|                          |                            |
| ------------------------ | -------------------------- |
| branch diff vs `develop` | 23 files, 2,345 insertions |
| round 5's own commit     | 1 file, 11 insertions      |

Across five rounds this PR had roughly 11,700 lines of diff reviewed, for a
branch whose last three rounds changed 236 lines between them. One commit is
most of the cause: `9f46e6a` closed five round-1 findings at once, 20 files and
1,868 insertions.

**The pivot already fixes this** — B0 through B8 are nine lanes instead of one
bundle. #21 was the last PR of the old shape, and the lesson is worth keeping:
a deep-tree lens does not terminate on a large branch by iterating.

### One refusal worth recording

George's round-5 P2 asked that the capture tracks be released the moment
`recorder.stop()` is invoked. Only half taken. The final `dataavailable` arrives
in exactly that window, and killing the tracks inside it truncates it — which is
the round-3 P1 the chunk-ownership rewrite had just closed. The exposure was
also narrower than stated: `abandonStream` already runs before the decode, so
the microphone is live only across the `onstop` window. Bounding that wait
(`3a5d205`, five seconds) closes the hang and the hot mic without touching the
flush ordering. Taking both halves would have traded a five-second hot mic for a
class of silent audio loss.

### A process failure worth not repeating

I reported George as having failed three times on #22 and concluded the harness
was broken. **That was wrong.** The run I called dead finished with a
9,800-byte report and a verdict; I checked it one to two minutes in, saw
narration, and applied the "narration-only output is a stalled run" test to a
run that had not finished. That test is for a _completed_ run.

Measured properly, George's eight runs took 5, 5, 6, 11, 11, 12, 15 and 25
minutes — median 12. The apparent slowness was polling, not the tool. Two
lessons: **read the elapsed time before declaring a stall**, and a `pgrep -f`
watcher whose own command line contains the pattern matches itself and never
terminates, which is how several waits here appeared to hang.

### Blockers

- **#22 needs one more round** at `20c154b` — Frank had approved at `6f8f051`
  before the fixes landed. It touches `ci.yml`, so it is a both-reviewers PR
  unless the exemption is recorded.
- **Nothing in the recorder path has run on iOS.** Every P1 closed across five
  rounds was verified by reading, including one about WebKit MediaRecorder
  behaviour that reading cannot settle, and the new `3a5d205` timeout is in the
  same category. This is now the largest open risk on the project.

### Next steps

1. **Re-run both reviewers on #22** at `20c154b`, triage, merge.
2. **Promote `develop` → `staging`** — the staging Worker only builds from
   `staging`, and a phone needs the secure context.
3. **Device test the recorder on iOS**: a take under 250 ms, and backgrounding
   the app immediately after Stop. Those two exercise the round-3 P1 and the
   flush timeout.
4. **B0 (#26)**, the first code lane of the pivot.

---

## 2026-08-23 — Day 3: the pivot, Gate 1, and a question register

**Branch:** `docs/pivot-plan-p3-p4` · **PRs:** #23 merged, #35 opened ·
**Issues:** +12, −3

### Completed

- **#23 merged** (`0d9ee9d`) — Tim's five notebook photographs archived, the gap
  analysis, and **ADR 0004's broad half rejected**: one generic
  `Book → Chapter → Segment (→ Take)` taxonomy, no pluggable division scheme.
  Docs-only, merged on green, with the reviewer exemption recorded on the PR
  rather than skipped silently.
- **Gate 1 of `ux-then-ui` run against the mockups and passed.** Three screens —
  Books, Segments, Recorder — as jobs and states, deliberately unstyled.
  Artifact: <https://claude.ai/code/artifact/2b4625a5-1a8c-4ad0-badd-5f045e2c0630>
- **The plan became the plan of record** (#35). It had been written before Tim's
  answers landed and still listed as open five questions that A1–A5 and ADR 0004
  had already settled, under a numbering that collided with the gap analysis's
  own. One list now, and every batch points at an issue.
- **A buried contradiction surfaced and resolved.** B0 deleted `lib/timing/**`;
  decision D5, written a day later, said the seam stays built and inert. Both
  were on paper and nobody had noticed. Decided as **G1: delete**, with ADR 0007
  superseded rather than the reasoning lost.
- **Twelve issues filed** — umbrella #25, batches B0–B8 as #26–#34, and #36 for
  the LGPL obligations. Dispositions posted on ten existing issues; **#11 closed**
  as superseded, **#14 and #15 closed** as answered.
- **The mockups read directly, and the transcription corrected.** It claimed the
  drawings carry no colour beyond the VU meter. They do: play is green, record is
  red, the selection and paste arrow are blue — which agrees with the token
  system's existing amber-for-voice, red-for-live split.

### Decisions taken

**G1** delete the timing seam · **G2** first run is the empty Books screen ·
**G3** the clipboard crosses a chapter and is lost on close · **G4** Erase
Segment erases the audio and keeps the row · **G5** the `⋮` row menu ships with a
first guess at its contents.

G5 went **against the recommendation**, and the plan records the disagreement
rather than absorbing it. It commits two batches to work worth naming now: Erase
Segment gains a second entry point that must share one implementation and one
confirmation with B6, and Share Segment is a scope Tim did not ask for — A4
specifies chapter and book only.

**Q3 (was Q4): keep lamejs.** MIT repo, one LGPL-3.0 dependency. ADR 0003 now
lists all five obligations instead of implying them; three are already met, two
are #36. B8 moving the encoder into a Web Worker strengthens the boundary, so the
performance work improves the licensing position as a side effect.

### The question register

Q1–Q7, each with a **best-effort default** we build against — on the principle
that steering a moving car beats steering a parked one — and each still open. The
register says so explicitly, because the failure mode is a guess quietly
hardening into a decision nobody took.

### Findings worth keeping

- **More than half the controls Tim drew are software convention**, not
  hardware-derived. Only play/pause/record, the waveform and the VU meter's
  colour ramp are genuinely script-independent. `ui-patterns.md` already records
  the harder version: no product in the reference sweep achieves a text-free path.
- **The rule that stops this becoming a localisation spike is frequency, not
  universality.** Learn-once-use-often is fine; learn-once-use-rarely is where
  icon-only fails. Under it, only erase, template library and share need words —
  three strings, not a pipeline.
- **The whole app is 3,261 lines.** This is a large change to a small codebase,
  which is the cheapest version of it we will ever get.

### Blockers

- **#21 and #22 both carry stale sign-offs.** Each triage names a head SHA that
  is no longer head, so Frank and George must re-run before either can move.
- **B0 (#26) cannot start until #21 merges** — that PR touches
  `lib/timing/parse.ts` and `types/timing.ts`, the files B0 deletes.

### Next steps

1. Re-run both reviewers on **#21** at current head, triage, merge.
2. Same for **#22**, which touches `ci.yml` and so is not green-alone.
3. Rebase and merge **#35**.
4. Then **B0 (#26)**, the first code lane of the pivot.
5. After #22 lands: correct AGENTS.md's three stale known-open-items (PCM
   storage, division scheme, OBS timing) and note the Cloudflare exclude paths
   as configured rather than to-do.

---

## 2026-08-22 — Day 2: review rounds, the family survey, and Tim's mockups

**Branches:** four lanes in worktrees · **PRs:** #21 #22 #23 · **Issues:** +7, −1

### Completed

- **Round-1 review findings closed** — #2, #3, #4, #7, #10 fixed on
  `fix/review-round-1-scheme-independent` (#21). The four lifecycle findings
  turned out to be one defect: nothing owned the audio lifecycle. Extracted
  `lib/audio/session.ts`, a pure DOM-free arbiter whose single invariant is that
  the microphone outranks playback, and `lib/takes/pending-take.ts`, a pure
  reducer so the save-failure transitions are testable at all. `6a629d6`,
  `5533863`, `769e413`
- **Three internal review passes plus two Frank/George rounds.** Round 2 of the
  internal pass closed all 13 of round 1's findings and introduced 3 more, which
  were also closed. Frank and George then found 2 P1s that both fix passes had
  missed — one of them a defect in the previous commit's own fix.
- **tC family survey** — read the source of seven tC-adjacent systems. Headline:
  none of them is an audio app, not one handles two people editing the same
  thing, and the ecosystem's auth is worse than none. Published as an artifact.
- **Four false claims corrected in canonical docs** (#22) — ADR 0007's "no OBS
  audio on DCS" (98 entries / 92 languages exist), prior-art's over-claim about
  tcorePSA's journal (no fold, no merge, no licence), AGENTS.md naming
  `lucide-react` as the icon library when nothing imports it, and the tracker's
  own claim that nothing had run on hardware.
- **`knip` on the merge gate** and an **Engineering bar** section in AGENTS.md.
  knip found `zustand` and `lucide-react` unused and three dead barrel files on
  its first run. `e930161`, `c395cc9`
- **Review round cap set at 4**, with an ask-the-DRI rule rather than an
  automatic stop. The docs had invoked "the round cap" in four places without
  ever defining a number.
- **Tim's mockups received, archived and analysed** (#23), and **all five
  blocking questions answered** by Tim the same evening.
- **ADR 0004's broad half rejected** — one generic taxonomy, no pluggable
  division scheme. Open since 19 Aug. `8fd883d`

### Decisions taken

D1 Takes stay in the schema, hidden · D2 undo is an operation log, not buffer
copies · D3 transcode to MP3 on "Finished" (660 MB → ~66 MB) · D4 MicroSD via
the share sheet only · D5 reference audio leaves Phase 1 · D6 artwork becomes an
optional per-segment illustration. Full reasoning in
`docs/design/mockups-gap-analysis.md`.

_Narrowed 2026-08-24:_ that table's D3 cell says "closes the storage strategy
in #12." It closes one of ADR 0002's three mitigations — PCM while editing,
MP3 on Finished. **#12 stays open** for 22 050 Hz and
`navigator.storage.persist()`.

Also: convergence target is **tC4**, Phase 1 is **standalone**, OBS-derived
recordings **are** CC BY-SA (#15 closed), and there is no cleaner MP3 encoder —
every one in the ecosystem descends from LAME or Shine, both LGPL.

### In progress

- **#21** — round 3 done. George has 1 P1 (the final `dataavailable` chunk can
  land in an array `cancel()` has already swapped) plus 3 P2 and 2 P3; Frank has
  1 P2. Two findings deferred here from #22. Round 4 is the last before the cap.
- **#22** — round 1 triaged, 7 of 9 fixed at `c395cc9`, needs re-review.
- **#23** — no review run yet; docs, so it merges on green.

### Blockers / needs a human

- **#24 (new)** — a Book can be exported but not saved or restored. Needs Tim to
  say whether a device is expected to survive the training holding the only copy
  of a translation.
- **#14** — lamejs LGPL-3.0. Open-sourcing the repo resolves the hard part;
  notice obligations remain and want a licensing sign-off before October.
  _Superseded 2026-08-23: keep lamejs, settled (ADR 0003). #14 is closed and
  the notice work is #36 — do not re-ask Tim._
- **Uncommitted parallel work** — `docs/design/pivot-plan.md`,
  `docs/spec-transcription-p3-p4.md` and `docs/mockups/` exist untracked in the
  `fix/…` worktree, written before Tim's answers arrived. They are complementary
  to `mockups-gap-analysis.md` rather than redundant — the plan and the
  transcription have no equivalent — but the mockup images are duplicated.
  **Reconcile before either is committed.**

### Next steps

1. **#21 round 4** — George's P1, the 4 P2s, and the two findings inherited from
   #22 (`ensureObsChapter`'s idempotency docblock, the dead `share` icon).
2. **#22 re-review** at `c395cc9`.
3. **Reconcile the two mockup write-ups**, then start the model change: drop
   `Section`, `Project` → `Book`, `SectionRef` nullable.

---

## 2026-08-22 — Day 1: scaffold to reviewed prototype

**Branch:** `develop` · **Commits:** 18 · **Repo created:** `sethstoll3/tc-mobile` (private)

### Completed

- **Scaffold** — Vite 7 + React 19 + TS strict + Tailwind 4, PWA via
  `vite-plugin-pwa`, onion architecture enforced by ESLint. Shape copied from
  `bt-servant-admin-portal` minus its BFF/auth/KV; Phase 1 has no backend
  (ADR 0005). `10cf265`
- **Audio core** — canonical mono 16-bit PCM @44.1kHz, sample-accurate
  cut/insert/paste/replace/concat, waveform peaks, WAV writer, MP3 via lamejs.
  Pure and DOM-free, so it is unit-testable in Node (ADR 0002, ADR 0003).
- **Storage** — IndexedDB as system of record (not a cache); clips, and the
  Project → Chapter → Section → Segment → Take tree. Schema at v2.
- **Open Bible Stories bundled** — 50 stories, 598 frames. Thumbnails
  downscaled to 128px are **2.5 MB, not the 46.8 MB the source implies**, so
  they ship with the app and the section list works offline on first run.
  `6173f8f`, `fc49026` (ADR 0006)
- **Design passes A and B** through `ux-then-ui`, all three gates approved.
  Artefacts published; records in `docs/design/`. `08f1b75`, `5520858`, `6a48748`
- **Working prototype** — section browser (grid for artwork chapters, list
  without), section view, three-layer CSS token system, pluggable timing seam.
  `2a78068`
- **Dual review pipeline** — Frank (codex, diff-local) + George (grok,
  deep-tree), both carrying the house evidence axioms. `fa3f4f5`, `5f7554b`
- **Deployment** — Cloudflare Workers Builds owns deploys; the four Actions
  deploy workflows were deleted to remove a real collision. `3464a30`, `3d9b931`
- **Both workers live** — `tc-mobile` and `tc-mobile-staging`.

### In progress

- **Review round 1 is complete and unfixed.** Frank and George both returned
  `REQUEST_CHANGES`: **4 P1 (#1–#4), 6 P2 (#5–#10), 1 P3 (#11)**. Deliberately
  left untouched so round 2 starts from a known base.
- Two **A+B convergences** — the playback race (#2) and the burrito
  chapter-drop (#6) — found independently by both lenses, which per prior
  experience makes them the highest-confidence findings of the round.

### Blockers / needs a human

- **#12** PCM storage strategy — must resolve before the October training.
- **#13** No OBS timing data exists anywhere; blocks record-along. Ask Tim and
  Benjamin Wright.
- **#14** lamejs LGPL-3.0 in an MIT repo.
- **#15** Are OBS-derived recordings CC BY-SA? Affects export and the data model.
- **`CLOUDFLARE_API_TOKEN`** is deliberately _not_ a GitHub secret — Actions no
  longer deploys. The token lives in Cloudflare's build settings. Do not "fix".
- **Cloudflare repo linking** is a manual step in the dashboard: connect the
  repo to both Workers, `main`→`tc-mobile`, `staging`→`tc-mobile-staging`
  (`--env staging`), non-production builds on **one** only.

### Not covered by tests, honestly

MediaRecorder and `decodeAudioData` can only be verified on-device.

**Updated 2026-08-22, narrowed and then answered 2026-08-24:** Seth and Tim
had both run the staging deploy and reported it functional, but **no device, OS
or browser was recorded**, and a staging URL runs in a desktop browser as
readily as on a phone — so that did not establish MediaRecorder had been
exercised on a phone at all.

**It has now. Seth, 2026-08-24, iPhone / iOS 27 beta 6 / Safari:** a recording
was started, Safari was backgrounded and the phone locked, and **capture
continued through both** — the audio from that period was present in the take.
That is worth flagging as surprising: WebKit has historically suspended media
capture when Safari backgrounds, and the code does not depend on it not doing
so. It is also **one device on one pre-release build.** iOS 27 is expected to
be the shipping release by the October training, which makes it the right
target rather than an academic one, but beta behaviour can change before
release and **Android has still never been run.**

That run covered backgrounding _during_ capture. What it did not touch is the
failure and interruption behaviour on the other side of Stop — a write that
actually rejects, and `pagehide` landing inside a pending `decodeToCanonical`.
Both P1s of review round 2 were exactly that second case. So the remaining
on-device checks are specific rather than general:

1. **Background the app immediately after tapping Stop on a long take**, and
   confirm the recording still lands. This is the `3a5d205` flush timeout.
2. **Record a take shorter than one 250 ms timeslice.** This is the round-3 P1:
   the final `dataavailable` slice is the whole recording, and on WebKit builds
   that ignore the timeslice it is the only one.
3. **Anything at all on Android.**

iOS is still the platform most likely to break here, and a beta is the build
most likely to change under us.

There is also no export path at all yet (#18), so the share sheet is not merely
untested — it does not exist.

### Next steps

1. Fix branch off `develop` addressing **#1–#10** in one pass; **#11** stays filed.
2. PR to `develop`, run both reviewers, loop to clean or capped-and-escalated.
3. **The remaining device check**, which is specific rather than general: the
   happy path (record, play back, short takes) has been smoked on staging by
   Seth and Tim. What is still unverified is the interruption path — background
   the app immediately after tapping Stop on a _long_ take and confirm the
   recording still lands — and the save-failure path, which needs a device
   with no room left.
