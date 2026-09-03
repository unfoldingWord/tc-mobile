# Progress tracker — tC Mobile

Newest first. **One entry per working session, not per day** — a single date can
carry several sessions, so entries are titled by date plus a session marker
(e.g. "(evening)"). The historical "Day N" labels below predate this convention
and do not imply one entry per day.

Entries refer to "the pivot": the redesign of 22 Aug 2026, when the product
mockups arrived about an hour after work started and the initial scaffold was
replaced. Its batches B0–B8 (#26–#34, umbrella #25) keep that name.

---

## 2026-09-02 (day) — B8 merged + staging v0.1.11; the repo moves to the org; a contributor's first four PRs through the dual review

**Branches:** `claude/next-batch-issues-ns640m` → **`develop`** (#136, squash `485aacf`, the contributor's
B8); `release/v0.1.11` → develop (#141, `b746516`); develop → **`staging`** (#142, merge
`a180ee6`, **v0.1.11**). **Production `main` untouched** (`3464a30`). Open: **#138**
(docs, versioning + repo-move), **#139 #140 #144 #145** (the contributor's, review lanes below).
**Filed:** #134, #135, #143 (closed), #146 (the maintainer); #137, #147 (the contributor).

### The repo moved, and it broke the deploy

The maintainer transferred the repo from a personal account to **`unfoldingWord/tc-mobile`**. GitHub redirects
the old name; `gh` resolves to the org. **Cloudflare Workers Builds did not survive the
transfer:** the v0.1.11 staging merge went green on GitHub and never deployed — no
`Workers Builds` check on `a180ee6` where Monday's `6050d81` had one, and the staging URL
kept serving v0.1.10 for twenty minutes. The maintainer re-linked both Workers in the dashboard;
staging served v0.1.11 within ten minutes (`index-Crr9nweP.js`, worker chunk reachable).
**#143** records it. Lesson, now in AGENTS.md via #138: **a merged promotion PR is not a
deployed build — confirm the served bundle's version string.** The re-linked app posts
preview-bot comments on PRs and a `Workers Build` check on later pushes.

### Contributors, versions, milestones

- **A second contributor is building.** First PR #136 (B8) at 09:05 local; four more by
  evening. The review process split for the first time: **the maintainer's session runs
  Frank + George and posts each round's statements with per-finding CONFIRMED/REFUTED
  verification; the PR author posts FIXED/REFUTED/DEFERRED and merges.** Rounds 2–4 of the later PRs ran as **parallel subagents, one
  worktree per PR**, since each review diffs against develop independently.
- **Versioning rule (the maintainer, #138):** feature/fix PRs never touch `version`; one
  `chore(release)` PR per develop → staging promotion bumps the patch; **the minor is the
  milestone**, bumped and tagged by the `staging → main` promotion PR.
- **Milestones created**, all 35 open issues assigned: `v0.2.0 — Sept: production gate`
  (due 09-30), `v0.3.0 — Oct: training` (due 10-09), `v1.0.0 — Post-training`.
  Every new issue gets one.
- **Cleanup:** 9 merged remote branches and 24 stale local branches deleted; local
  `staging` fast-forwarded. Remaining remotes: the three mainline branches, #138's, and
  the contributor's four PR branches.

### #136 — B8, four rounds, both clean, merged, promoted

Frank + George both clean at `3df181860` after a **chain** of four rounds. The catch worth
keeping, round 2, both lenses independently: **an MP3 decode carries 1,105 samples of
encoder+decoder delay at the HEAD** (lamejs writes no Xing/LAME tag; reproduced in Node:
116 granules × 1,152 = 133,632 for 132,300 in, exactly Chromium's number), so the round-1
"fit to `frameCount`" that trimmed the _tail_ was deleting the last 25 ms of speech on
every edit-save of a finished segment. The PR author measured with impulse round-trips on
Chromium before the T1 gate let the fix (`fitMp3Decode`, granule count read off the
stream) through. Also caught: sweep + share running two LAME workers at once (now one
encoder lane), lamejs duplicated into the app bundle by the inline fallback (gone; app
chunk has zero lamejs markers), a rowAudio TOCTOU with the transcode sweep. **Nothing in
B8 has run on a phone**; the iOS/Android impulse round-trip is the T2 gate before
`staging → main`, alongside #106 and the first-launch sweep.

### The requirements owner's staging report → #134 / #135

The requirements owner, on v0.1.10: the editorial controls were no longer visible and the
edit icon was grayed out. Not a regression — the record/edit split approved on #89. The real finding: Edit is
idle-only and a take commits only on Back, so **Edit is unreachable in the same sheet
session as a take** (#134, needs the requirements owner's call on record-then-edit-in-one-sitting), and a
disabled row carried no reason (#135, fixed by the contributor's #139).

### The contributor's lanes at EOD

| PR                                               | Closes         | Rounds      | State @ EOD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#145** recovery screen copy (#38 half)         | —              | 3, chain    | **clean** @ `9f4b99249` — merge is the PR author's, after #139/#140                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **#140** Notice `info` tone (#112) + #129/#103   | #112 #129 #103 | 3           | **clean** @ `afa445e97` (1 P3 → #147) — merge is the PR author's, after #139                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **#139** disabled-row reasons (#135) + #130 nits | #135 #130      | **4 = cap** | Frank clean; **1 George P2 open** (menu stays open over the permission panel when the mic fails mid-request). Rounds 1→3 a chain, 3→4 siblings of a now-exhausted state class. The PR author pushed the fix (`2a036b47e`); **round 5 is the maintainer's call, not decided today.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **#144** LGPL notice + About panel (#36)         | #36            | **4 = cap** | **Not clean, siblings.** Frank **P1**: the panel/README/ADR assert an exercisable LGPL §4(d) relink right, but the repo is private and the bundle hard-references the hashed worker chunk — a licensing position for the maintainer and the requirements owner, not a patch. George 2 × P2 (`aria-label` on the `<pre>` masks loading/failed states; 13 px buttons under the 40 px floor + 11 px body with `user-scalable=no`), 2 × P3. The duplicate `info` icon is still there (TS1117 on rebase after #140). **Recommendation posted: no straight round 5** — the PR author fixes the P2s + `info` in one commit; the maintainer and the requirements owner decide the §4(d) claim and record it in ADR 0003; then one confirming round if the maintainer authorises. |

Lane order for the contributor's merges: **#139 → #140 → #145 → #144**. #140 and #144 both add an
`info` icon to `icon.tsx` (duplicate key → TS1117) and #139/#144 share `strings.ts`, so
#144 lands last, rebased, re-reviewed.

### Process notes worth keeping

- **Reviewer/author split works** but needs the triage comment to carry verification state
  per finding, not just dispositions; the author's dispositions comments then quote commits.
- **Never run a mutation probe while George is running** — George reads the disk. One
  agent did (5 s, restored); that George run was discarded and re-run solo, disclosed on
  #144. Probe only after both reports are in.
- **A push mid-round voids the round.** #140's head moved during round 2; the agent killed
  the run and re-ran at the new head rather than post stale verdicts.
- **The cap is a decision point, not a stop.** #139 and #144 both hit it; the shape
  analysis (chain vs siblings, and whether the sibling class is finite) is what the maintainer
  needs to decide a fifth round.
- **#146:** `3-components.css`'s header forbids layer-1 primitives in component rules; 42
  existing rules use them. Reconcile the header with the file rather than fight every PR.

### Blockers / needs a human

- **The maintainer:** round 5 on #139 (recommended: yes, ~5-line fix already pushed, class
  exhausted) and #144 (see state above); merge #138 (docs, reviewer exemption proposed);
  `git remote set-url origin https://github.com/unfoldingWord/tc-mobile.git` in the main
  checkout; `npm ci` there (its node_modules predate fflate).
- **The requirements owner:** #134 (record-then-edit-in-one-sitting), the #89 D1/D2 confirms, Q2 (Template
  Library), and the on-device pass on **staging v0.1.11** (B8 + everything since v0.1.5).
- **The contributor:** merge #140 and #145 (mark ready first), rebase #144 after #139/#140.

### Next steps

1. The maintainer's round-5 decisions; then the contributor merges in lane order; promote develop → staging
   as v0.1.12 once the four lanes land (one `chore(release)` PR).
2. On-device pass on staging (iOS + Android): B8 impulse round-trip, #106, first-launch
   sweep, B7 share, recorder preview — the `staging → main` gate for v0.2.0.
3. B7 Template Library (#33): `ux-then-ui` pass, then the requirements owner's Q2 call.

---

## 2026-09-02 — B8 (#34): MP3 on Finished + the encoder off the main thread — PR open

**Branch:** `claude/next-batch-issues-ns640m` → **`develop`** (draft PR, awaiting
Frank + George). **`develop`** unchanged (`196d55c`), **`staging`** at v0.1.10,
**`main`** untouched. **Decision record:** ADR 0009
(`docs/decisions/0009-transcode-on-finished.md`).

### Why this batch

The last unbuilt pivot batch, unblocked since B1 (schema) and Q3 (lamejs stays),
with Q5 carrying a recorded default; the storage half of #12 that "must resolve
before October"; and the three #34 comments (B7 R2 residuals) all point at the
same root cause — a synchronous main-thread `encodeMp3`.

### Built

- **`AudioCodec` seam** (`types/audio.ts`): `lib/` takes encode + decode as two
  async functions. `lib/export/chapter.ts` / `book.ts` and the new
  `lib/storage/transcode.ts` are pure and Node-tested against
  `tests/support.ts`'s codec (the real sync encoder + a fake decoder).
- **Web Worker encoder** (`hooks/mp3.worker.ts`, `hooks/mp3-codec.ts`): one
  worker per encode, PCM transferred in, MP3 transferred out, terminated on every
  exit — an `AbortSignal` really stops it. `useShareFlow` now aborts the encode on
  menu close / unmount. Vite emits the worker + lamejs as its own chunk (ADR
  0003 obligation 1 met).
- **Transcode on Finished (D3)**: `ClipMeta` gains `encoding | generation |
byteLength | peaks`; **schema v4, append-only backfill** (v3 rows stamped
  PCM/0, nothing dropped). `commitTranscode` is ONE strict-durability
  transaction that re-checks finished/take/clip/PCM inside it and writes
  nothing when `stale`. Triggered by an idempotent, serialised **sweep**
  (`hooks/finish-transcode.ts`) from every Finished transition and once at App
  mount, so a mid-encode page discard loses nothing.
- **Q5 default built**: a finished (MP3) segment opens in the recorder via
  `decodeMp3ToCanonical`; the save inherits the prior clip's `generation`.
  Play/export decode MP3 clips too; the export fits a decode to the recorded
  length (LAME padding). Rows draw finished segments from peaks stored at
  transcode time — listing never decodes.
- **Share Book archive streamed** (fflate `Zip`, chunks → `File` parts): the
  ~2× archive peak George flagged on #114 is gone from app code.

### Verified — exactly this

- **Node (`npm run verify` green):** 309 tests (+23). **17 mutations, all
  killed** (list in the PR body) — two survived the first pass and each got the
  test that reaches its guard directly.
- **Chromium on this workstation (Playwright, fake mic; NOT a phone):** worker
  encode of 3 s in ~0.3 s, input buffer detached, `AbortError` on abort;
  `decodeAudioData` round trip came back **1332 frames long** (LAME padding —
  the fit-to-length case, live). App flow: record → Back → row plays → Mark
  finished → sweep landed `encoding: mp3, generation 1`, **179,926 → 16,718
  bytes**, peaks stored → finished row plays → recorder reopens on the MP3
  segment with Record enabled in 56 ms (same as a PCM control) →
  `exportChapterMp3` over the MP3 + PCM chapter, real codec. Zero console
  errors.

### NOT verified — owed at the T2 gate

iOS Safari and Android Chrome: the module-worker round-trip, `decodeAudioData`
of a LAME MP3 (and on an `"interrupted"` iOS context), encode time of a real
chapter on a low-end phone, the first-launch sweep over a device full of
finished segments, battery/heat. Still no phone has run B7 share either.

### Review round 1 (the maintainer's session, both reviewers @ `d00b4c5`)

Frank 1 × P2, George 2 × P2 + 3 × P3, no P1. Fixed in the round-2 commit:
**F1/G3** every MP3 decode now fitted to the recorded `frameCount` via a pure
`fitToFrames` (recorder edit buffer, playback, export — the recorder path would
have made the decoder's padding permanent and compounding); **G1** one
app-wide encoder lane (`withEncoder`), the sweep takes it before loading a clip,
a share holds it for its whole build; **G2** the main-thread fallback dropped —
its static import kept lamejs in the app bundle (0 `Mp3Encoder` in the index
chunk now, 1 in the worker chunk, checked in `dist/`); **G4** the `clipData`
comment. **G5** DEFERRED to #137 (UX call, intersects #106/#135).

### Review round 2 (the maintainer's session, both reviewers @ `1924507f`) — chain shape

Frank **P1** ↔ George P2: round 1's `fitToFrames` trimmed the TAIL, but the
decode's excess is at the HEAD (LAME priming 576 + decoder delay 529 = 1105;
no info tag from lamejs), so an edit → save of a finished segment deleted its
last ~25 ms of speech. The maintainer reproduced the granule arithmetic in Node; I then
**measured it in Chromium** with impulses at known positions, five input
lengths: head offset 1105 every time, decode = granules × 1152. Fix:
`lib/audio/mp3-align.ts` — `mp3GranuleCount` walks the stream's own headers,
`fitMp3Decode` reads the decoder's behaviour off the decode length and skips
the priming, all three consumers use it, ramp fixtures + a modelled no-trim
decoder in the tests. Also **P2** cancel threaded into the gather (a dismissed
share lets go of the encoder lane at the next clip), **P3**s: sweep re-request
race, MP3 rows read metadata only, `decodeMp3ToCanonical` docblock.

### Review round 3 (the maintainer's session, both reviewers @ `5a42b6ba8`) — chain

Frank **APPROVE** (1 × P3: the sweep promise resolved before the follow-up pass
it promised — now chained into the returned promise). George REQUEST_CHANGES
(1 × P2: the row loader's two reads straddle the sweep's commit, so a clip read
as PCM then MP3 came back `null` and a finished segment drew as never-recorded
until the next reload — fixed by judging the second read on what it returns;
`rowAudio` exported and pinned by `tests/row-audio.test.ts`, mutation dies).
Round 4 is the cap.

### Next steps

1. Round 4: Frank + George re-run at the round-4 head (the DRI's session runs
   them; no codex/grok in the build session). If anything is open after it,
   that is an escalation to the maintainer per AGENTS.md, not a stop.
2. On-device pass (iOS + Android) on staging after promotion — the list above,
   plus the B7 share checks already owed.
3. Rest of B7 — Template Library (the requirements owner's Q2 call).
4. Q5: leave open; `generation` now records the evidence to decide it.

---

## 2026-08-31 (evening) — Recorder preview (#101) + pull-model playhead (#102): merged to develop, promoted to staging v0.1.10

**Branches:** `perf/recorder-playhead-pull` → **`develop`** (#127, merged, deleted);
`feat/recorder-preview` → **`develop`** (#128, merged, deleted); `release/v0.1.10`
→ develop (#131). **`develop`** (`de86a99`), **`staging`** promoted to **v0.1.10**
(`6050d81`, #132) — the first on-device-testable build of the recorder preview.
**Production `main` untouched** (`3464a30`). **Filed:** [#129](https://github.com/unfoldingWord/tc-mobile/issues/129),
[#130](https://github.com/unfoldingWord/tc-mobile/issues/130).

### Shipped

- **#102 — pull-model playhead overlay** (squash `3e41f8f`). Buffer playback no
  longer re-renders the inert Segments list (~16×/s) or reallocates the waveform
  canvas per frame: a dedicated `PlayheadOverlay` owns its rAF, PULLS
  `readPlaybackElapsed` (a `null` hide-sentinel), and moves a DOM line — the
  `VuMeter`/`LiveScope` pattern. `Waveform` lost its canvas playhead (gained a
  `playing` flag for centerline suppression). **Dual-review: 3 rounds**, both clean
  at `5f2201c`.
- **#101 — preview an uncommitted paused take** (squash `bcda499`). Play while
  paused decodes the take-so-far (`previewCapture`), splices it with `mergeTake`
  where Back will commit, and plays it — decode degrades to a disabled Play +
  Notice rather than a false preview. **Approach B** floor arbitration (release a
  paused mic's floor claim for the preview, reclaim on resume) extracted to a pure,
  **mutation-proven** `lib/audio/floor-transitions.ts`; `session.ts` untouched.
- **SOD + a staging QA-board artifact** at the start of the session.

### The #101 review — 10 rounds, a converging chain, both reviewers each round

A genuinely intricate T2 capture-pipeline feature. Severity fell **P1 → P2 → P3**;
Frank (codex) and George (grok) alternated on the residual edges each round. The
real defects George's deep-tree lens caught: the decode/resume/Back races (a stale
`playBuffer` closure preempting a live mic, R1 P1), a whole class of adjacent
cancel-surfaces (menu, close-state, double-tap, #59 interruption), the memory/OOM
class (parallel decodes + kept PCM through commit, R5 P1 — closed at the root by
chaining decodes and dropping the PCM before commit), the iOS silent-preview on an
interrupted-context-during-decode (R9), and a hook-contract gap (R8). **One P1 was
self-inflicted** (R7): an R4 `await` I added to serialise the preview decode with
`stop()` broke `stop()`'s pagehide capture-steal — a guaranteed take-loss on
lock/background between Back and decode-settle. George caught it; reverting the
await restored the invariant, and the memory serialisation it bought was re-accepted
as the device-gated R4 residual (a lost take never justifies a memory win). DRI
authorised looping past the round-4 cap three times; R10 both-clean at `f2746e3`.
Full 10-round triage on #128.

### Promotion

- **#131** v0.1.10 release bump → develop. **#132** develop → staging (merge
  commit). Cloudflare Workers Builds auto-deploys `tc-mobile-staging`.

### Blockers / needs a human — the on-device pass

- **The whole recorder preview/playhead path is browser-only and UNVERIFIED on a
  phone.** A 10-round clean review is not a working preview on a device. Owed on
  **iOS + Android** on staging v0.1.10: preview sounds a paused take + playhead
  sweeps + the inert list stays still; the **graceful-degradation** branch (a device
  that can't decode a paused container → Play disabled + Notice, take still saves on
  Back — expected on iOS fMP4); the interrupted-context silent-preview fix; the #59
  interruption; multi-minute-take memory; the device-gated R4 parallel-decode
  residual. **The T2 gate before `staging → main`.**

### Follow-ups / parked

- **#129** — latent paused-mic floor left empty after a preview ends (unreachable
  today). **#130** — two R10 P3 nits (one-frame LiveScope blank on first-take
  Resume; a `console.error` missing its `cause`).
- **Parked from the batch** (asked to "work 101 and any others we can parallel"):
  **#75/#39/#97** (recorder-UI, entangled with the recorder surface or gated on a requirements-owner UX call)
  and **#103** (latent, near-untestable standalone). **Blocked by the repo's own
  rules:** **#68** (don't-fix-before-dedup), **#76** (device-gated).

### Next steps

1. **On-device pass on staging v0.1.10** — the checks above, then the `staging →
main` production PR when clean.
2. **Rest of B7** — the Template Library (other half of #33), needs a `ux-then-ui`
   gate + the requirements owner's Q2/Bible-template call.
3. **#130 / #129** when next touching the preview stage / floor.

---

## 2026-08-31 — Live waveform during recording (#120): pure slice + browser lane, both merged, staging v0.1.9

**Branches:** `feat/live-waveform-capture` → **`develop`** (#121, merged, deleted);
`feat/live-waveform-wiring` → **`develop`** (#123, merged, deleted); release/promote
branches for v0.1.8 (#122) and v0.1.9 (#124/#125). **Filed:** [#120](https://github.com/unfoldingWord/tc-mobile/issues/120)
(the live-waveform tracking issue). **On `develop`** (`1219921`), **`staging`**
promoted to **v0.1.9** (`62afa75`) — the first on-device-testable build of the
feature. **Production `main` untouched** (`3464a30`).

### Shipped — the live waveform, built in two lanes

The recorder now shows the waveform **growing as you speak** on a first take —
the maintainer's recorded build-decision from 2026-08-28. Split into a pure slice and a
browser lane so the testable math lands separately from the device-gated wiring.

- **#121 — pure `lib/audio` slice** (squash `2e128e6`). `reduceFrame` (frame →
  one min/max column) + `createCapturePeaks` (a fixed-capacity ring, newest at
  the head, zero-padded front, reused output buffers — the #102 no-realloc
  rule) returning a `CaptureScope { min, max, count }`; `captureWindow(headFraction)`
  in `viewport.ts` for the R→L capture geometry; `WaveformWindow` unified into
  `viewport.ts`. 30 tests, **every guard mutation-proven** (13 mutations).
- **#123 — browser + device lane** (squash `eb5f75b`). `LevelTap.readFrame()`
  exposes the analyser frame (one tap, shared with the VU meter — no 2nd
  AudioContext, iOS cap); `use-recorder` owns the ring and a `readScope()` pull
  gated on `recordingRef` (written synchronously at every transition); a
  dedicated pull-model `LiveScope` canvas (VuMeter's pattern) that owns its rAF,
  skips the pad via `scope.count`, freezes on pause/close, and repaints on
  resize via a `ResizeObserver`. First-take only (`!hasAudio`); a punch-in keeps
  the static Waveform + #110 centerline.

### Ultracode + the review loops

- **Two workflows on #121:** a 6-agent scout over candidate build-lanes (picked
  the pure slice as the cleanest onion split), then a 4-agent adversarial review
  (found a NaN-frame inversion, a NaN-capacity ring, a NaN window, and three
  unpinned invariants — all folded in with tests).
- **#121 review — 3 Frank+George rounds.** R1 over-claimed drop-in docblocks +
  an `Infinity` RangeError; R2 non-finite edges + a structural `toScope`/`CaptureScope`
  recantation; R3 (split): George APPROVE, **Frank P1 "ships unwired code."** The DRI
  accepted the pure-slice split as a recorded residual (`@pivotpending`
  is the repo's sanctioned deferred-export marker) → admin squash-merge.
- **#123 review — 5 rounds, a converging chain.** Frank APPROVE/APPROVE/RC(perf
  bug)/RC/APPROVE; George walked the take lifecycle one state deeper each round
  (meter-fail → processing → pause-seam sync → F8 close → interruption freeze),
  every finding a real defect in the prior round's fix, **no P1 any round**. At
  the round-4 cap the DRI authorized a confirming R5; R5's new iOS-interruption
  P2 was fixed and the device-owed residuals DRI-accepted → merge (option B).

### Promotions

- **#122** develop → staging at **v0.1.8** — the pure slice, **no version bump**
  (unwired, nothing testable; the functions tree-shake out of the bundle).
- **#124/#125** — v0.1.9 bump + develop → staging. This one **is** on-device
  testable, so it got a build stamp for the testers.

### Blockers / needs a human — the on-device pass

- **The whole live-waveform lane is browser-only and UNVERIFIED.** A clean
  5-round review is not a working waveform on a phone. Owed on **iOS + Android**
  (Android never run) on staging v0.1.9: first-take scroll, pause freeze (R-B6),
  F8-close freeze, tap-failed Waveform fallback, background-mid-take interruption
  freeze, rotate-while-paused rescale. **The T2 gate before `staging → main`.**
- **`headFraction` is the requirements owner's UX call** (0.5 centerline vs right-edge full-width) —
  built to 0.5, best decided looking at the real thing on device.

### Next steps

1. **On-device pass on staging v0.1.9** — the live-waveform checks above, plus
   the carried v0.1.8 debt. Then the `staging → main` production PR when clean.
2. **#120 deferred follow-ups:** the rAF-rate ring window (`SCOPE_CAPACITY`
   assumes ~60fps — tune off wall-clock), the punch-in/append live-columns
   overlay, and `headFraction`.
3. **Rest of B7:** the Template Library (the remaining half of #33) — needs a
   ux-then-ui gate + the requirements owner's Q2/Bible-template call first.

---

## 2026-08-30 — B7 Share Book built, dual-reviewed to Frank-clean, merged to develop

**Branch:** `feat/b7-book-export` → **`develop`** (merged, deleted). **PR:**
[#114](https://github.com/unfoldingWord/tc-mobile/pull/114) B7 Share Book
(squash `342e3db`). **Filed:** [#115](https://github.com/unfoldingWord/tc-mobile/issues/115),
[#116](https://github.com/unfoldingWord/tc-mobile/issues/116); note added to
[#34](https://github.com/unfoldingWord/tc-mobile/issues/34). **Production `main`
untouched** (`3464a30`); **`staging`** still v0.1.7 (`6790a59`).

### Shipped

- **B7 Share Book (#114, #33/#18).** A book → one **zip of per-chapter MP3s**
  to the OS share sheet — the sibling of Share Chapter, the second half of #18's
  export path. `lib/export/book.ts` `exportBookZip` composes `exportChapterMp3`
  over `resolveBookChapters` and archives with `fflate` `zipSync` (level 0 —
  MP3 is already compressed). DOM-free, Node-tested, mutation-proven. Adds
  `fflate ^0.8.3`.
- **The two-gesture flow is now shared, not duplicated.** Extracted
  `hooks/share-flow.ts` `useShareFlow` (the iOS user-activation contract, the
  run-generation token, both re-entry guards) from `use-chapter-share`, whose
  public API is unchanged (segments-screen untouched); `use-book-share` is the
  parallel wrapper. `classifyShareError` moved with it (test →
  `tests/share-flow.test.ts`).
- **Books screen:** a per-book `≡` menu beside the `+` (after it, so add-chapter
  stays the row's first `.control` for the focus hand-off); one share flow for
  the screen; shelf goes inert behind the menu. Book share strings.

### The review — 2 rounds, both reviewers each round

Full triage on #114 (both rounds, head SHAs stamped).

- **Round 1** (both at `50f56d6`): both **REQUEST_CHANGES** → **3 P2s, all
  fixed + mutation-proven:** (a) duplicate chapter `number` collided in the zip
  and silently dropped a chapter's audio → `uniqueEntryName` disambiguates,
  lossless; (b) a dangling chapter record fell out of the `missing` count →
  `getChaptersOfBook` reshaped to `resolveBookChapters` returning
  `{ chapters, missing }` (mirrors `resolveChapterClipIds`); (c) a stale
  `send()` returned `sent`/`dismissed` and the Books caller reset on it,
  dropping a newer book's zip → new `superseded` outcome. Plus a P3 (dropped two
  needless full-archive copies via `Uint8Array<ArrayBuffer>`).
- **Round 2** (at `af5dae0`): **Frank APPROVE.** George REQUEST_CHANGES, no P1,
  2 P2 + 3 P3. One P3 fixed (`7dfb0e1`: the cancel test now bites the
  between-chapters guard, not just iteration 0). The **two P2s accepted as
  residuals by the DRI:** the send-race is unreachable on the modal iOS/Android
  share sheets that are the only target platforms (desktop-only); the zip peak
  memory (~Σ MP3s ×2 on a long book) is B8-shaped — fflate can't fix it
  main-thread — deferred to **#34**.
- **Merge:** Frank clean + CI green (Build, Code Quality, Secret Scan) + the two
  George residuals explicitly DRI-accepted → admin squash-merge to `develop`
  (`342e3db`). develop-integration lane, not the prod gate.

### Blockers / needs a human

- **On-device iOS + Android** for Share Book: the whole `navigator.share`/zip
  path is device-only, including `navigator.canShare({ files: [zip] })` for
  `application/zip` (George's one unverifiable residual). Owed with the rest of
  the v0.1.x device pass.
- **Local `develop` in the main checkout is behind** `342e3db` — `git pull`.

### Next steps

1. **Promote `develop` → `staging`** (Share Book onto the testers' link; likely
   a `chore(release)` version bump as #113 did for v0.1.7).
2. **On-device pass** on staging, then the `staging → main` production PR for
   v0.1.7 if clean.
3. **Rest of B7:** the **Template Library** (the remaining half of #33).
4. **Recorder UI lane** and **live-waveform-during-recording** lane.
5. Deferred from this review: **#115** (Q6 folders/manifest, pending the requirements owner),
   **#116** (segment-grain `missing`), **#34** (B8: encode off-thread + stream
   the book zip).

---

## 2026-08-28 (night) — B7 Share Chapter reworked to clean, merged, promoted to staging v0.1.7

**Branch:** `feat/b7-chapter-export` → **`develop`** (merged, deleted). **PRs:**
[#111](https://github.com/unfoldingWord/tc-mobile/pull/111) B7 Share Chapter
(squash `9adf9fc`), [#113](https://github.com/unfoldingWord/tc-mobile/pull/113)
develop→staging promotion. **Filed:** [#112](https://github.com/unfoldingWord/tc-mobile/issues/112).
**Released:** **v0.1.7** on staging, **deploy verified live** (bundle embeds `0.1.7`).
**Production `main` untouched** (`3464a30`).

### Shipped

- **B7 Share Chapter (#111, #33/#18).** The two-gesture rework that fixes the
  round-1 P1: `navigator.share` after `await exportChapterMp3` spent the iOS
  user-activation window → `NotAllowedError`, sheet never opened. Now tap 1
  (`prepare`) encodes + stashes the `File`; tap 2 (`send`) calls `navigator.share`
  synchronously in a fresh activation. `lib/export/chapter.ts` is #18's missing
  chapter-export core (ordered concat + 0.5s gaps + `missing` count), DOM-free,
  node-tested, mutation-proven.
- **Promotion to staging v0.1.7** carries the day's four fixes: #107
  (interrupted-context playback), #109 (atomic take save), #110 (recorder
  centerline), #111 (Share Chapter). Sent the maintainer the on-device test list.

### The review — 4 rounds after the rework, a converging chain

Frank (diff-local) **APPROVE** at `8b8f72b`. George (deep-tree) raised a chain of
concurrency P2s across rounds 2–5, **every one fixed** (full triage on #111):

- R2: in-flight prepare cancel + StrictMode wedge (one **run-generation token**
  replaced a set-once `cancelledRef`); mid-gather clip loss now counted.
- R3: `send` double-tap guard (`sendingRef`); stale-`finally` guard; stop
  disabling the prepare control (broke Menu's focus trap).
- R4: `NotAllowedError` split by live activation (permanent block → error, not an
  infinite retry loop); **single-buffer gather** (~160MB→~80MB peak on a 15-min
  chapter); dropped `title` from `share()` (iOS file-drop bug — WhatsApp/Signal
  take title, drop file); menu focuses the action not Close; fail-fast when Web
  Share absent.
- R5: cancel now skips the blocking encode (`shouldEncode` checkpoint);
  generation-guarded the `fileRef` null-clears; neutral `shareMissing` copy.

**Root cause of the residual class = the synchronous main-thread `encodeMp3`**
(George's own read). Merged on Frank-approve + the DRI's explicit acceptance of
George's residual (he had not re-reviewed the final `d8b4d54`), this being the
develop integration branch, not the prod gate. The real abort/non-block is **B8
(#34)** — commented there to reinforce it before October.

### Process note

George's round-3 run was **discarded**: a self-review edit changed the working
tree under a deep-tree pass mid-review, which voids it. Re-reviewed clean at a
new SHA. The lesson: never touch the tree while George is reading it.

### Blockers / needs a human

- **On-device iOS + Android** for v0.1.7 is owed before `staging → main`: #107
  (audible after an interruption), #109 (#38 failure path), #110 (centerline),
  and #111 (Share Chapter end-to-end — especially the WhatsApp/Signal file-drop
  check). **Android still never run.** Test list sent to the maintainer.
- **#112** — Notice has no "info" tone (the Share gap-warning nit), deferred.
- **#34 (B8)** — move `encodeMp3` off the main thread; reinforced by this review.

### Next steps

1. **On-device pass on staging v0.1.7**, then the `staging → main` production PR
   if clean.
2. **Rest of B7:** Share Book (zip of chapter MP3s, adds `fflate`), then Template
   Library.
3. **Recorder UI lane** (edit pencil onto the toolbar #2, Cut off the centerline
   #3, landscape full-width) and the **live-waveform-during-recording** lane.

---

## 2026-08-28 (late) — The requirements owner's v0.1.6 feedback: three fixes merged; B7 Share Chapter built (rework)

**Branches:** `fix/audio-context-interrupted-recovery`, `fix/atomic-take-save`,
`fix/recorder-ui-clear-items` → **`develop`** (all merged); `feat/b7-chapter-export`
(open, rework). **PRs merged:** [#107](https://github.com/unfoldingWord/tc-mobile/pull/107)
(`dd949e4`), [#109](https://github.com/unfoldingWord/tc-mobile/pull/109) (`3fa8a95`),
[#110](https://github.com/unfoldingWord/tc-mobile/pull/110) (`dae17f9`) · **PR open:**
[#111](https://github.com/unfoldingWord/tc-mobile/pull/111) (B7 Share Chapter,
REQUEST_CHANGES) · **Closed:** #6 (moot), #104 (via #107) · **Filed:** #106, #108 ·
**Production `main` untouched** (`3464a30`). **Merge permission granted** — develop
lanes now merge autonomously on clean-and-green (prod still doubly gated).

### Merged to develop (each: build → Frank+George dual review → merge)

- **#107 — silent-playback fix (reproduced on an iPhone 13 mini / iOS 26.6).** Root cause:
  `resumeAudioContext` only resumed `"suspended"`, not WebKit's `"interrupted"`
  state (iOS enters it on a call / background / route change). An interrupted
  context plays every later `playSamples` source **silently, no error, for the
  page's life**. Fix: broaden the resume (pure, mutation-tested `contextNeedsResume`
  - a fake-`AudioContext` wiring test), bail `playSamples` before `source.start()`
    if superseded (**closes #104**, both paths), `resumeRecording` re-arms (#76 resume
    half). 2 review rounds. Filed **#106** (the bug + on-device checklist), **#108**
    (start() now awaits an interrupted resume — latency, device-gated).
- **#109 — #38 atomic take save.** The commit was two IDB transactions (`putClip`
  then `addTake`); a quota fail on the 2nd stranded an orphan clip that ate the
  space the recovery screen tells you to free — the death spiral. New `saveTake`
  writes clip + take in **one transaction** (addTake's tx already spanned the clip
  stores → **no schema change/migration**); shared `writeTakeInTx` + `buildClipMeta`.
  Gotcha: a THROWN mid-tx error doesn't roll IndexedDB back (auto-commits) — must
  `tx.abort()` + consume the abort's `done` rejection. Mutation-proven. 2 rounds.
  #38 stays open for residual (b)/(c).
- **#110 — red centerline only when `recorded || capturing`** (the requirements owner's ask: only when a
  waveform exists). The `capturing` half keeps it during a first take. T3 canvas,
  device-owed. 1 clean round.

### B7 started — Share Chapter built, in a rework (PR #111, NOT merged)

- **Export core** (`lib/export/chapter.ts`, `798a0ed`): `gatherChapterPcm` (ordered
  concat + 0.5s gaps + missing-count) and `exportChapterMp3` — **#18's missing
  implementation**, Node-tested, mutation-proven. Composes existing pieces only,
  DOM-free.
- **Share Chapter UI** (`463c587`): chapter `≡` menu on the Segments screen → Share,
  `useChapterShare` hook (`navigator.share`), a `share` icon + strings.
- **Both reviewers REQUEST_CHANGES on a real P1 (my miss):** `navigator.share` runs
  after the encode's `await`s, so iOS spends the user-activation window → Safari
  rejects `NotAllowedError`, the sheet never opens. Needs a **two-gesture rework**
  (encode on tap 1, share synchronously on tap 2) + lifecycle wiring (busy/inert/
  unmount-cancel, P2) + surface `missing` (P3). Full triage on #111. The Node-tested
  export core stands.

### The requirements owner's feedback — findings + a stale-build discovery

- **The requirements owner's screenshots are v0.1.3, not v0.1.6** (image footer stamps `v0.1.3`; the
  recorder shots show the record button alone with the old unified toolbar — no
  Play-beside-Record, no record/edit split). Their PWA is cached on the old build, so
  **"this screen wants a play button right of record" is already shipped in #89**.
  **Action: have the requirements owner hard-refresh the staging link** before more recorder feedback.
- **The maintainer's build decisions (this session):** build recorder #2/#3 (edit pencil onto
  the toolbar; Cut off the centerline) with my placement, flagged for the requirements owner; **build
  the live-waveform-during-recording feature** (grows from the playhead, scrolls
  R→L) as its own lane; **build landscape full-width**; export gap stays 0.5s;
  Template Library deferred (Share first).

### Blockers / needs a human

- **On-device pass owed** on all of this before `staging → main`: #107 (playback
  audible after an interruption — #106), #109 (#38 failure path), #110 (centerline),
  plus the carried v0.1.5/v0.1.6 debt. Android still never run.
- **#111 rework** (two-gesture share) before Share Chapter can merge.
- The requirements owner still owes the #89 D1/D2 confirms (Finished-in-menu, the "Editing" pill).

### Next steps

1. **#111 rework** — two-gesture Share (prepare on tap 1, `navigator.share`
   synchronously on tap 2), lifecycle wiring, surface `missing`; re-review → merge.
2. **Recorder UI lane** — edit pencil onto the toolbar (#2) + Cut off the centerline
   (#3) + landscape full-width, flagged for the requirements owner.
3. **Live-waveform-during-recording** lane (the big recorder feature).
4. **Share Book** (zip of chapter MP3s, adds `fflate`); then Template Library.
5. Promote `develop → staging` (bump version) so the three merged fixes reach a
   device; send the requirements owner the refreshed link.

---

## 2026-08-28 (night) — #89 recorder Play button + record/edit mode split → staging v0.1.6

**Branch:** `feat/recorder-play-mode-split` → **`develop`** → **`staging`** ·
**PRs merged:** [#100](https://github.com/unfoldingWord/tc-mobile/pull/100) (#89,
squash, `ac06a15`), [#105](https://github.com/unfoldingWord/tc-mobile/pull/105)
(promotion, merge, `e333fee`) · **Filed:** #101, #102, #103, #104 · **On
`staging` serving `v0.1.6`** (`index-CkbJkhCs.js`, bundle grep-verified live) ·
**Production `main` untouched** at `3464a30`.

### Completed

- **#89 built and merged** — the recorder splits into a **record mode** (a
  centered Record + Play hero pair, `≡` menu top-right) and an **edit mode** (the
  `[zoom][select][undo][redo][≡]` toolbar + selection/paste/cut behind the menu,
  an "Editing" pill), per the wireframe the requirements owner approved on 2026-08-27.
- **Play plays the in-memory working buffer** via a new `playBuffer`/`stopBuffer`
  seam on `useAudioSession` — reuses `playSamples` + the single-owner floor,
  skips the disk load `playTake` does, so the stored recording + unsaved edits
  are audible. **Playback is a listen-only overlay:** whole-clip view, centerline
  suppressed, Record + pan disabled, buffer stopped at every boundary (menu open,
  edit entry, close, floor steal, leave).
- **Waveform playhead** with the clip-fraction→viewport-x mapping extracted to a
  pure, **red-first-tested** `lib/audio/viewport.ts` helper (the one unit-testable
  slice; the rest is browser-only).
- **Finished moved into the `≡` menu** (D1, reversible — flagged for the requirements owner), keying
  green/label on the resolved `finishedState`. **`Checkbox` component deleted**
  (recorder was its only consumer). The mic permission panel now keys on the
  recorder's **own** error, so a failed Play can't raise it.

### Built via ultracode, then five dual-review rounds (Frank/George)

- **Ultracode workflow:** design pass + two disjoint build lanes (the seam; the
  playhead + helper) + integration. Then I reviewed the diff by hand and tightened
  a real fragility (a "stop via re-call the toggle" idiom → an explicit `stopBuffer`).
- **The chain, and where it converged.** George (deep-tree) walked a real class
  across rounds — **buffer playback is a new idle-time source, and every call
  site that assumed "idle == silent" had to stop it.** R1 (6 P2: playhead
  visibility, finished-green lie, back-doesn't-stop, zoom-leak, an over-claim) →
  R2 (2: the whole-clip view left Record/pan/centerline live → made playback a
  listen-only overlay) → R3 (1: mic could go live in edit via the permission
  Retry) → R4 (1: `denied` conflated a playback error with a mic error → split
  `recorderError` out) → R5 (1: Erase locked its confirm over live sound). **R5
  closed the class at its gateway** — the `≡` menu is the one path to every
  idle-time action during playback, so stopping the buffer on menu-open cuts off
  the sibling stream instead of patching one more site. Frank (diff-local)
  APPROVE at R3 and R5; his R4 test-coverage P2 was refuted (the arbitration is
  fully covered in `session.ts`; the hook glue is the project's no-renderer
  on-device surface). A triage with dispositions + head SHA every round.
- **Round cap + DRI calls.** Hit the round-4 cap; the DRI authorized a
  confirming round 5, then **merge-on-green** after R5 closed the class. Squash
  merge on green (feature→develop convention).

### Blockers / needs a human

- **On-device pass (iOS + Android) owed on this** before `staging → main` — all
  browser-only: Play sounds the buffer, the playhead sweeps, Play dims while
  recording, the mode split, Finished-from-menu still marks/rides the take. Joins
  the existing `v0.1.5` device debt.
- **The requirements owner owes two confirms on #89** (both reversible, built to a default): D1
  (Finished in the menu vs deleted from the recorder) and D2 (the "Editing" pill
  as the non-reader edit affordance vs more, → #91).
- **Unchanged:** Capacitor go/no-go on the WKWebView audio spike (#86); org move
  (D1) needs a uW human; #12 PCM storage owed before October.

### Follow-ups filed

- **#101** — preview an uncommitted take in-sheet (Model A splices only on close).
- **#102** — recorder-playback perf: the inert Segments list re-renders ~16×/s,
  and the waveform reallocates its backing store per playhead tick (pull-model
  playhead is the fix for both).
- **#103** — latent: the Segments-list erase keys only on `playingId`, not
  `playingBuffer` (unreachable today).
- **#104** — `playSamples` should re-check the session token after
  `resumeAudioContext` (pre-existing, both playback paths).

### Next steps

1. **On-device pass on staging `v0.1.6`** (iOS + Android) — the #89 browser-only
   checks (Play sounds the buffer, playhead sweeps, Play dims while recording,
   the mode split, Finished-from-menu, playback stops at every boundary) plus the
   carried `v0.1.5` checks. The gate before `staging → main`.
2. **The requirements owner answers the two #89 confirms** (D1 Finished-in-menu, D2 the pill).
3. **B7 (#33)** — Template Library + Share, the October spine (subsumes #18
   export, most of #20). The next build lane. Competing priority: close the
   Android interruption/pagehide gap (#59/#58) and #38/#39 (save-death, processing
   lock) — field data-loss risks before October.

---

## 2026-08-28 (evening) — P3 cleanup lanes (#67/#77/#94), #89 Gate 1, promoted to staging v0.1.5

**Branches:** `fix/ui-p3-a11y-copy` → `develop` (#96), `fix/timer-pad-minutes` →
`develop` (#98), then `develop` → **`staging`** (#99) · **PRs merged:**
[#96](https://github.com/unfoldingWord/tc-mobile/pull/96),
[#98](https://github.com/unfoldingWord/tc-mobile/pull/98),
[#99](https://github.com/unfoldingWord/tc-mobile/pull/99) (promotion) · **Closed:**
#67, #73, #77, #94 · **Filed:** #97 · **On `staging` serving `v0.1.5`** (`3cdd700`,
deploy triggered — verify bundle once live) · **Production untouched**
(`main` at `3464a30`).

### Completed

- **#96 — P3 copy + a11y batch.** #67: an explicit `editOnly` flag on
  `PendingTake` (Node-tested), so the SaveFailed recovery screen words itself
  honestly — a failed edit-save keeps the previously stored recording on disk, so
  "delete this recording for good" is now "discard these changes" for an edit.
  #77: Books chrome goes `inert` behind its menu (New Book was reachable behind
  the scrim for AT/switch users); the post-change reload Notice reads a neutral
  "Updating the chapter." (was "Saving your recording." even after a
  recorder-path erase, which saved nothing); EraseConfirm's `busy` JSDoc
  corrected + focus moves to Cancel when Erase disables mid-op.
- **#98 — #94 timer width.** `formatDuration` now zero-pads minutes, so the live
  recorder clock holds five glyphs across the `9:59 → 10:00` rollover
  (`tabular-nums` fixes glyph width, not string length). Format is now `00:05` —
  **flagged for the requirements owner** as the visible change. New `tests/utils.test.ts`
  (`formatDuration` had no coverage); the cases assert width stability, the exact
  regression.
- **Promoted `develop` → `staging`, bumped to `v0.1.5`** (build-stamp convention)
  so the on-device pass can name this build. Auto-deployed by Cloudflare.
- **#89 Gate 1 (ux-then-ui) — recorder record/edit split.** A0 diagnosis
  (record competes with six editing controls on open), two-mode job list, ten
  states, the A3 cut (record mode stops asking for the editing toolbar). Product
  surface on the locked system, so identity/swap-test skipped. Recorded on #89. **Gate 1 is a stop** — two questions owed from the requirements owner before Gate 2.

### The review catch worth keeping

- **George (deep-tree) killed the #73 focus-restore hook, correctly, and the
  problem was bigger than his two P2s.** The `activeElement`-in-a-passive-effect
  capture does not compose with the app's `inert` model: `inert` blurs the
  trigger to `<body>` in the mutation phase _before_ the passive capture runs, so
  the hook captured body and no-op'd for **every** menu path whose trigger goes
  inert on open — including the Books hamburger that #96's own #77a had just made
  inert. Pulled the hook whole rather than half-fix. The correct version
  (synchronous trigger capture at click time, threaded through each opener, plus
  the row-menu inert-sync George's P2-2 named) is **#97**, sequenced with #89's
  recorder rewrite and #93. **Lesson: a focus fix that ignores `inert` is dead
  code — capture the trigger at the click, never in an effect after the DOM
  commits.**

### Process notes

- **gh-writes + merge policy set (the DRI):** run `gh` writes directly (comments,
  labels, issue-close); **check with the DRI before merging any PR**; prod
  (`staging → main`) is doubly gated — explicit go **and** the on-device pass.
  Tonight's develop-lane merges ran on a standing merge-on-clean-and-green
  authorization. Memory updated.
- **#93 was mis-scoped as a quick batch and corrected before building:** its core
  finding (hand focus to the new row after an empty-state create) already shipped
  in #92 — both Books and Segments do it. The residual is the Books
  reload-window double-tap race (the clean fix, an optimistic insert in
  `use-books`, tripped the react-compiler no-setState-in-effect rule once), not a
  nit.

### Blockers / needs a human

- **On-device pass owed on `v0.1.5`** before `staging → main`. Every #96/#98
  change is browser-only (focus/inert/copy, live timer width) and unverified by
  CI: SaveFailed edit-vs-record copy, Books inert + focus behind the menu,
  EraseConfirm focus-on-disable, the timer holding width past `10:00`.
- **#89 waits on the requirements owner** — Q1: edit-mode entry/exit affordance and the non-reader
  "you are now editing" legibility (adjacent to #91); Q2: confirm Finished stays a
  top-corner checkbox and does not join the centered Record+Play pair. Gate 2
  (composition) cannot start until these land.
- **Unchanged:** Capacitor go/no-go hinges on the WKWebView background-audio spike
  (#86); org move (D1) needs a uW human; #12 PCM storage owed before October.

### Next steps

1. **The requirements owner answers the two #89 Gate-1 questions**, then Gate 2 (composition) → build
   the record/edit split (absorbs #75 and #97).
2. **On-device pass on staging `v0.1.5`** — the browser-only changes above; then
   `staging → main` once it and #92's pass both hold.
3. **#93** Books double-tap race as its own lane; **B7 (#33)** — Template Library
   - Share, the October spine.

---

## 2026-08-28 — Audit lane #1: invite empty states + tabular numeric roles (#88, #90)

**Branch:** `fix/ui-tabular-empty-states` → **`develop`** (`633525f`) → **`staging`** (`f93ffa5`) · **PRs merged:** [#92](https://github.com/unfoldingWord/tc-mobile/pull/92) (lane), [#95](https://github.com/unfoldingWord/tc-mobile/pull/95) (promotion) · **Closed:** #88, #90 · **Filed:** #93, #94 · **On `staging` serving `v0.1.4`** (bundle grep-verified) · **Production untouched** (`main` at `3464a30`).

### Completed

- **#90 — invite empty states (Books + Segments).** Reframed the two "nothing here" notes into the ui-craft §21 invite shape: confident headline, one teaching line (vocabulary + "stays on this phone"), and a single **present primary CTA** that reuses the real create handlers (`onNewBook`/`onAppend`). New shared `EmptyState` component. The header create `+` now **hides while the invite is up**, so there is one create action — visually and to a screen reader. Strings are the shape only; exact words are the requirements owner's, in `strings.ts`.
- **#88 — tabular figures on the numeric type roles**, reframed and shipped as **regression-hardening, not a jitter fix.** The digits never jittered: `.app-shell` sets `font-variant-numeric: tabular-nums` (inherited), and every call site is in-shell. Declared it directly on `.t-count` / `.t-timer` / `.t-ordinal` so a future portaled surface can't regress to proportional.
- **Built direct (not a workflow) on purpose** — a two-line CSS change + copy/one element is below the bar for fan-out, and the one real risk (CSS/focus on device) is exactly what no subagent can verify. Recorded the call with the DRI.

### Four dual-review rounds (Frank codex / George grok) — a converging chain

- **R1:** Frank APPROVE; George P2 = two equal primary CTAs on the empty shelf → hid the corner `+`.
- **R2:** George P2 = hiding it stranded focus (Back became first tab stop, an Enter from leaving the chapter) → focus handoff to the new row.
- **R3:** George P2 = the hidden corner exposed that `loadFailed` conflated a failed _read_ with a failed _create_, so a create failure tore down the invite → **root-fixed** by latching `loaded` in `useBooks`/`useChapterSegments` (`loadFailed = error && !loaded`, `showEmpty = loaded && empty`). Plus the R3 focus target hit the row's first `<button>` (Books' toggle) → now targets `button.control` / `.row-open` explicitly.
- **Frank APPROVE every round; no P1 any round.** Merged at the **round-4 cap on a recorded DRI override** (the DRI's O2), rationale enumerated on #92. Triage posted every round with dispositions + head SHA.
- **Process note:** the `gh pr comment`/`merge`/`issue close` writes were blocked by the auto-mode classifier; the DRI ran them by hand via `!`. The override executed by the DRI is arguably the more correct form.

### Deferred / accepted residuals (tracked)

- **#93** — empty-CTA focus/first-run cluster: the Books reload-window double-tap (race-safe, no data loss; clean fix is optimistic insert in `use-books` — a `creating` busy-latch tripped the react-compiler no-setState-in-effect rule, not suppressed), and the first-run AT autofocus order. Adjacent to #73/#77.
- **#94** — `formatDuration` grows the clock a digit at the 10:00 rollover (tabular figures don't fix a length change). Fix is `padStart` (visible `00:05`, the requirements owner's call) or a `ch` width reserve.

### On-device pass — PASSED (2026-08-28, a tester's iPhone 16 / iOS 27 beta 7 / Safari, staging `v0.1.4`)

The lane's owed browser-only checks were verified on device by the maintainer: empty Books/Segments render one centered CTA (no corner `+`, **E1**); the invite CTA creates and, on VoiceOver, focus lands on the new row's control rather than Back (**E5** — the least code-provable one); the recording timer holds digit width while counting (**T1**). This **clears the `staging → main` gate for #92's changes.** Still **iOS Safari only on a pre-release build** (iOS 27 beta 7); Android never run.

### Blockers / needs a human (unchanged)

- **Capacitor go/no-go** still hinges on the WKWebView background-audio spike (#86). **Org move (D1)** needs a uW human. **#12** PCM storage strategy owed before October.

### Next steps

1. **Fast lane:** the #67/#73/#75/#77 P3 batch — today's exact shape, low-risk, one `fix(ui)` PR.
2. **Big lane:** **B7 (#33)** Template Library + Share — the October spine (subsumes #18 export, most of #20); the right ux-then-ui Gate-1 + ultracode candidate.
3. **#89** recorder record/edit split (ultracode candidate), then **#91**. **B8 (#34)** after B7.
4. Send the requirements owner the staging link for wider testing once the on-device pass clears.

---

## 2026-08-27 (late) — UI audit (ux-then-ui + ui-craft), updated mockups, requirements-owner sign-off

**Branch:** `develop` (no code shipped — a design/planning session) · **Filed:** #88–#91 · **Artifacts:** updated mockups (off-repo) · **No commits** beyond this tracker entry.

### What happened

- **Ran ux-then-ui + ui-craft over the three pivot screens** (Books, Segments, Recorder). These are _product_ surfaces, so identity/swap-test don't apply; the value was A0/A1/A2/A3 + the applicable ui-craft rows, audited **read-only against the code** (rendered visuals/motion/interactive-states are `n/t` — they belong to the on-device pass).
- **Verdict: no major failure.** The screens genuinely fit their audience (a non-reading field translator): text-free-leaning, glyph+colour carry state, errors route to a Notice channel not the console, state-in-place over toasts. Gate 1 already ran on the product mockups. So this was **polish + two questions for the requirements owner, not a rework** — and the strong states/error-channel/microcopy were explicitly flagged "don't churn."
- **Findings → four issues:** #88 (F1 — `.t-timer`/`.t-count` lack `tabular-nums`, so the live clock jitters; confirmed in code), #89 (F2 — split the recorder into a calm record mode and a deliberate edit mode; absorbs F4, the signature-screen character point), #90 (F3 — warmer empty states with a present primary CTA), #91 (F5 — non-reader affordance for the abstract editing controls; forward-looking, the `strings.ts` aria-label routing is its attach point).
- **Built the updated-mockups artifact** — all three screens (+ empty state, + edit mode) in the app's **real dark tokens**, no new colours.
- **The requirements owner approved the whole direction** and added the missing **Play button**: record + play centered as a pair, record the hero, play a step smaller to its right and dimmed while recording, the `≡` menu moved top-right. This resolves the old "recorder has no Play control" thread. #89 un-gated (`needs-decision` removed); mockup updated.

### Blockers / needs a human (unchanged from the prior session)

- **On-device pass on `v0.1.3`** remains the gate before `staging → main` and before the wider-testing link.
- **The Capacitor go/no-go still hinges on the WKWebView audio spike** (#86).

### Next steps

1. **#88 + #90** — small `fix(ui)` lane, both approved by the requirements owner and build-ready (F1 is a two-line CSS fix; F3 is copy + one CTA element).
2. **#89** — build the record/edit split via a quick **ux-then-ui Gate-1** (job list + record/edit states) to pin behaviour, then implement to the approved mockup.
3. **#91** after #89 (the mode split shrinks its exposure). Then out through `develop → staging` as usual.

---

## 2026-08-27 (evening) — The requirements owner's v0.1.2 UI review shipped to staging (v0.1.3); packaging + org-transfer research

**Branch:** the v0.1.2 UI-review lane → `develop` → **`staging`** · **PRs merged:** [#85](https://github.com/unfoldingWord/tc-mobile/pull/85) (UI review), [#87](https://github.com/unfoldingWord/tc-mobile/pull/87) (promotion) · **On `staging`** (`1730a07`), deployed and **verified serving `v0.1.3`** · **Closed:** #79–#84 (UI review), #86 (counter-case) · **Filed:** #79–#84, #86 · **Production untouched** (`main` at `3464a30`).

### Completed

- **The requirements owner's v0.1.2 UI review built and shipped** (#79–#84, PR #85). From the requirements owner's annotated review of the live v0.1.2 staging build (`A06`): the Segments-row rework — the actionable checkbox replaced by a **non-interactive green check-circle**, the whole left zone opens the editor, the row `⋮` menu now **Edit / Finished / Delete**, and a finished segment tints **green** (new `--s-done` semantic token) while in-progress stays amber; plus recorder fixes — centerline **0.66 → 0.5** (centered), disabled controls made legibly inactive, Cut stacks under the canvas. **The finished-invariant is now structural** (Finished lives only in the recorded-row menu, so a never-recorded segment cannot be marked finished).
- **Built via an ultracode workflow** — a design pass on the coupled row rework + 2 disjoint file-cluster build lanes (Segments-row / recorder) + integrate. Then **4 dual-review rounds** (Frank/George); merged at the round cap on a **recorded DRI override** (Frank APPROVE since R3; George's findings all fixed + enumerated, no P1 any round).
- **Promoted `develop` → `staging`, bumped to `v0.1.3`** (build-stamp convention) so the iOS pass can name the build. Auto-deployed by Cloudflare Workers Builds and **verified live** at the staging URL.
- **The requirements owner's F1 reply captured and built** — the checkbox was "too easy to trigger" (reads as select-all-to-delete); it becomes a green-circle **status indicator**, tapping the left zone opens the editor, marking finished moves to the menu.

### Research deliverables (for the go/no-go and the org move)

- **Native packaging recommendation** — `docs/research/native-packaging.md`. **Capacitor** (wrap the PWA): ~92% of `src` reuses untouched, ~8% boundary rework. Storage durability is the field data-loss reason to leave the bare PWA. The requirements owner resolved: no native-widget requirement.
- **Anti-Capacitor counter-case** (#86) appended to the same doc — the steelman: the field-critical 8% (background audio, durable storage) is exactly what Capacitor doesn't solve for free. **The whole decision hinges on one experiment: the WKWebView background-audio spike** — run it before the go/no-go.
- **Org-transfer plan** — `docs/org-transfer-plan.md`. Moving the repo from a personal account into `unfoldingWord`. tC Mobile already carries LICENSE/SECURITY/CONTRIBUTING/CI; the move gates on **one human approval** (tech-lead + recorded DRI + public/private) and two deliberate deviations to keep-and-record (Workers Builds deploy, the develop/staging/main branch model). A GitHub _transfer_ preserves issues/PRs/history.

### Lesson worth keeping

- **Don't double-background the review script.** Wrapping `nohup … &` inside `run_in_background` makes the launcher return exit 0 immediately — a **false "completed"** while `both.sh`/George keep running detached. Launch the script directly under the background runner and wait on the real process. (Adjacent to the day-4 "read elapsed before declaring George stalled" lesson.)

### Blockers / needs a human

- **On-device pass on `v0.1.3` is the gate** before `staging → main` and before the wider-testing link goes out. All the UI review changes are **CSS/layout — browser-only, unverified by CI**: green hue + waveform actually repainting on toggle, left-zone tap opens editor, record/play alignment, centered line + Cut-under-canvas, disabled legibility, completed-chapter counter green.
- **The Capacitor go/no-go hinges on the audio spike** (#86) — put the current recorder in a Capacitor WebView on a real iPhone + Android and test background capture + interruption. Decides days-vs-weeks and whether Capacitor is even right.
- **Org move (D1)** needs a uW human to approve name + ownership and record the DRI/tech-lead; route via the project manager.

### Next steps

1. **On-device pass on staging (`v0.1.3`)** — the open gate. Then send the requirements owner the staging link for wider testing, and `staging → main` when ready.
2. **Run the WKWebView audio spike** — the single input that settles the Capacitor go/no-go.
3. **B7 (#33)** — Template Library + Share; the next build lane (subsumes #18 export, most of #20).
4. Carry the counter-case doc (`develop` is 1 commit ahead of `staging`) on the next promotion.

---

## 2026-08-27 — Day 9: B6 (VU meter, recorder menu, erase segment) — shipped to staging, v0.1.2

**Branch:** `feat/b6-vu-erase` → `develop` → **`staging`** · **PRs merged:** [#74](https://github.com/unfoldingWord/tc-mobile/pull/74) (B6), [#78](https://github.com/unfoldingWord/tc-mobile/pull/78) (promotion) · **On `staging`** (`27a8ba3`), deployed and serving `v0.1.2` (bundle verified: VU meter, erase confirm, meter-unavailable hatch all present) · **Closed:** #32, and #8/#37/#40/#41 (pre-pivot dead wood) · **Filed:** #73, #75, #76, #77 · **Production untouched** (`main` at `3464a30`).

### Completed

- **B6 built** (`c6f3552`, ultracode workflow → 4 disjoint build lanes + one integration): the VU meter (green/yellow/red, on by default, `≡`-menu toggle), the recorder menu's VU show/hide + **Erase Segment** with a minimal-text confirm, and the B3/G5 `⋮` **row menu** (Erase-only; Share stays B7). Erase **reuses `clearSegmentTake` verbatim** — no new T1 op (G4: audio gone, row kept). One implementation + one confirm behind both entry points.
- **VU is the only new audio work.** Pure, Node-tested `lib/audio/meter.ts` (RMS → dB-compressed display → green/yellow/red zone, threshold tripwire tests); the browser-only tap (`createLevelTap`) lives in `audio-io.ts` (the onion boundary).
- **Promoted `develop` → `staging`**, bumped to **v0.1.2** (build-stamp convention from #70) so the iOS pass can name the build. Live at `tc-mobile-staging.unfoldingword.workers.dev`, bundle grep-verified.

### Six dual-review rounds (Frank codex / George grok)

- Erase/menu/confirm **converged by round 2.** **Rounds 3–5 were one chain on the VU tap lifecycle** — it entangles with the recorder's stop/cancel/pagehide/interruption flush machinery, and each round found an adjacent invariant miss (menu z-index regression from the round-2 portal; interruption teardown; the confirm busy-latch window). **Root fix (R5):** the tap now obeys the SAME ownership/generation discipline as `streamRef` — `stop()` steals it into a local and nulls `tapRef`, so a concurrent `cancel()`/`pagehide` during the flush can't stop THIS take's clone mid-`dataavailable` (WebKit truncation). iOS graph: `stream.clone()` + `analyser → gain(0) → destination`.
- **R6: Frank APPROVE; George one residual P2** (#76) + 3 P3 (#77). **Merged on a recorded DRI override** (the DRI's call) — George's P2 is a device-behaviour question routed to the iOS pass, not a blind unverifiable fix. Every round triaged on #74 with dispositions + head SHA.
- **Process trap hit:** editing the tree during George's round-4 run corrupted it (George reads files from disk) — cost a wasted round. Don't touch the worktree while George runs.

### Blockers / needs a human

- **The iOS on-device pass is the field gate before `staging → main`.** Front-load **#76**: record → background Safari → return — does the VU strip go empty (should read _unavailable_/hatched)? Also unverified on WebKit: the strip actually moves, the take is **not** silenced by the clone/destination edge, erase from both menus, sub-250 ms take. **Android never run** (#58/#59).
- **#12** PCM storage strategy — decision owed before October (22 050 Hz + `persist()` still open).
- **Cloudflare Workers Builds** auto-deploy is slow/opaque (wrangler version-list lagged the actual deploy) and the **#72** dashboard drift is still open (dashboard-only toggle).

### Next steps

1. **iOS on-device pass on staging** (`v0.1.2`) — the open T1/T2 gate; #76 first, then the standing checks. Android too.
2. **B7 (#33)** — Template Library (OBS + Bible book) and Share Chapter/Book. Subsumes #18 (export) and most of #20 (non-OBS path).
3. **B8 (#34)** — MP3 on Finished + encoder off the main thread (T1).
4. Deferred nits: #73, #75, #77. Resolve **#12** with the requirements owner before October. Then `staging → main` once B6 is device-verified.

---

## 2026-08-26 — Day 8: B5 waveform editing, two recorder P3s, build stamp, staging deploy

**Branch:** `develop` · **PRs merged:** [#64](https://github.com/unfoldingWord/tc-mobile/pull/64) (#60/#61), [#65](https://github.com/unfoldingWord/tc-mobile/pull/65) (B5), [#70](https://github.com/unfoldingWord/tc-mobile/pull/70) (build stamp), promotions [#69](https://github.com/unfoldingWord/tc-mobile/pull/69)/[#71](https://github.com/unfoldingWord/tc-mobile/pull/71) (develop→staging) · **On `staging`** (`c75cf01`), deployed and serving `v0.1.1 · c75cf01` · **Closed:** #60, #61, #31, #66 · **Open/new:** #67, #68

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
- **Build-identity footer stamp** (#70, `66cf125`) — `v{version} · {sha}` at the
  shell bottom (`__BUILD_SHA__` added beside the existing `__APP_VERSION__`
  define). Bumped to **0.1.1** — the first stamped build; bump per testable
  release. Lets a tester name their build and confirm the PWA SW updated.
- **Promoted `develop` → `staging` twice** (#69 B5+P3s, #71 the stamp).
  **B5 + the stamp are live on `staging`** (`c75cf01`, `v0.1.1 · c75cf01`),
  verified in the served bundle. **Production untouched** (`main` at `3464a30`,
  serving its own pre-B5 bundle).

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
- **Cloudflare Workers Builds config has drifted from AGENTS.md (two dashboard
  settings, DRI to toggle).** The repo config is correct (`wrangler.jsonc`
  top-level `tc-mobile`, `[env.staging]` → `tc-mobile-staging`; `deploy:staging`
  uses `--env staging`). But in the dashboard: (1) `tc-mobile` appears to have
  **non-production branch builds ON** — every develop/staging push fires a wasted
  `tc-mobile` preview build (should be OFF; only `tc-mobile-staging` keeps them
  on). (2) `tc-mobile-staging`'s **Deploy command is `npx wrangler deploy`**,
  missing `--env staging` — currently lands on staging via Cloudflare's per-Worker
  scoping, but a bare `wrangler deploy` _names_ the production Worker, so it is a
  latent footgun. **Production was verified clean throughout** (previews never
  touch the production URL). Fix both in the Cloudflare dashboard.

### Next steps

1. **On-device B5 smoke on staging** (`v0.1.1 · c75cf01`), iOS + Android — the
   open T1 gate. High-value cases automated tests can't reach: cut the WHOLE clip
   then close/reopen (reads never-recorded, not a silent take); cut→record→
   background mid-save (the superseded-stop path). Plus the still-open #59/#58
   Android checks and the two day-1 cases.
2. **Toggle the two Cloudflare dashboard settings** (see Blockers) — `tc-mobile`
   non-prod builds OFF; `tc-mobile-staging` deploy command → `--env staging`.
3. **B6 (#32)** — VU meter, the recorder `≡` menu's Erase Segment (G4; the
   `clearSegmentTake` store op B5 added is its foundation), erase confirmation.
4. `staging → main` (the production gate) once B5 is device-verified, esp. Android.
   Consider `git tag v0.1.1` for greppable release history.

---

## 2026-08-25 — Day 7: the pivot foundation (B1–B4), built and hardened under review

**Branch:** `feat/pivot-b1-b4` → `develop` → **`staging`** · **PRs:** [#57](https://github.com/unfoldingWord/tc-mobile/pull/57) (B1–B4), [#62](https://github.com/unfoldingWord/tc-mobile/pull/62) (#59 fix), [#63](https://github.com/unfoldingWord/tc-mobile/pull/63) (promotion) all merged · **On staging** (`c7ef2af`) and device-smoked on iOS · **Open:** #59/#58 (Android), #60/#61 (P3)

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
  mid-take keeps recording; **an incoming call mid-take
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
- **The requirements owner: the recorder sheet has no Play control** — the mockups'
  own omission, and the requirements owner's own correction. The centerline annotation already says playback happens there, so
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

- **#23 merged** (`0d9ee9d`) — the product mockups (22 Aug 2026) archived, the gap
  analysis, and **ADR 0004's broad half rejected**: one generic
  `Book → Chapter → Segment (→ Take)` taxonomy, no pluggable division scheme.
  Docs-only, merged on green, with the reviewer exemption recorded on the PR
  rather than skipped silently.
- **Gate 1 of `ux-then-ui` run against the mockups and passed.** Three screens —
  Books, Segments, Recorder — as jobs and states, deliberately unstyled. Off-repo artifact.
- **The plan became the plan of record** (#35). It had been written before the requirements owner's
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
  mockups carry no colour beyond the VU meter. They do: play is green, record is
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
confirmation with B6, and Share Segment is a scope the requirements owner did not ask for — A4
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

- **More than half the controls in the mockups are software convention**, not
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

## 2026-08-22 — Day 2: review rounds, the family survey, and the product mockups

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
  thing. Published as an artifact.
- **Four false claims corrected in canonical docs** (#22) — ADR 0007's "no OBS
  audio on DCS" (98 entries / 92 languages exist), prior-art's over-claim about
  a uW Scripture Burrito prototype's journal (no fold, no merge, no licence), AGENTS.md naming
  `lucide-react` as the icon library when nothing imports it, and the tracker's
  own claim that nothing had run on hardware.
- **`knip` on the merge gate** and an **Engineering bar** section in AGENTS.md.
  knip found `zustand` and `lucide-react` unused and three dead barrel files on
  its first run. `e930161`, `c395cc9`
- **Review round cap set at 4**, with an ask-the-DRI rule rather than an
  automatic stop. The docs had invoked "the round cap" in four places without
  ever defining a number.
- **The product mockups received, archived and analysed** (#23), and **all five
  blocking questions answered** by the requirements owner the same evening.
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

- **#24 (new)** — a Book can be exported but not saved or restored. Needs the requirements owner to
  say whether a device is expected to survive the training holding the only copy
  of a translation.
- **#14** — lamejs LGPL-3.0. Open-sourcing the repo resolves the hard part;
  notice obligations remain and want a licensing sign-off before October.
  _Superseded 2026-08-23: keep lamejs, settled (ADR 0003). #14 is closed and
  the notice work is #36 — do not re-ask the requirements owner._
- **Uncommitted parallel work** — `docs/design/pivot-plan.md`,
  `docs/spec-transcription-p3-p4.md` and `docs/mockups/` exist untracked in the
  `fix/…` worktree, written before the requirements owner's answers arrived. They are complementary
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

**Branch:** `develop` · **Commits:** 18 · **Repo created:** private, on a personal account (transferred to `unfoldingWord/tc-mobile` on 2026-09-02)

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
- **#13** No OBS timing data exists anywhere; blocks record-along. Ask the requirements owner
  and the Scripture Burrito maintainer at uW.
- **#14** lamejs LGPL-3.0 in an MIT repo.
- **#15** Are OBS-derived recordings CC BY-SA? Affects export and the data model.
- **`CLOUDFLARE_API_TOKEN`** is deliberately _not_ a GitHub secret — Actions no
  longer deploys. The token lives in Cloudflare's build settings. Do not "fix".
- **Cloudflare repo linking** is a manual step in the dashboard: connect the
  repo to both Workers, `main`→`tc-mobile`, `staging`→`tc-mobile-staging`
  (`--env staging`), non-production builds on **one** only.

### Not covered by tests, honestly

MediaRecorder and `decodeAudioData` can only be verified on-device.

**Updated 2026-08-22, narrowed and then answered 2026-08-24:** the maintainer and the
requirements owner had both run the staging deploy and reported it functional, but **no device, OS
or browser was recorded**, and a staging URL runs in a desktop browser as
readily as on a phone — so that did not establish MediaRecorder had been
exercised on a phone at all.

**It has now. 2026-08-24, a tester's iPhone / iOS 27 beta 6 / Safari:** a recording
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
   the maintainer and the requirements owner. What is still unverified is the interruption path — background
   the app immediately after tapping Stop on a _long_ take and confirm the
   recording still lands — and the save-failure path, which needs a device
   with no room left.
