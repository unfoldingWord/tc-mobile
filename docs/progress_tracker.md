# Progress tracker — tC Mobile

Newest first. One entry per working session.

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

**Updated 2026-08-22, and narrowed 2026-08-24:** Seth and Tim have both run
the staging deploy and report it functional. That is the whole of the evidence
— **no device, OS or browser was recorded**, and a staging URL runs in a
desktop browser as readily as on a phone. So it does not establish that
MediaRecorder has been exercised on Android or iOS, and the general
on-device check stays open until a run is recorded with the device named.
What a working happy path would not exercise even then is the failure and
interruption behaviour — a write that actually rejects, and
`pagehide` landing inside a pending `decodeToCanonical`. Both P1s of review
round 2 were exactly that second case. The remaining on-device check is
therefore specific rather than general: **background the app immediately after
tapping Stop on a long take, and confirm the recording still lands.** iOS is
still the platform most likely to break here.

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
