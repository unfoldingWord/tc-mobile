# Progress tracker — tC Mobile

Newest first. One entry per working session.

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

MediaRecorder, `decodeAudioData`, and the share sheet are verified on-device
only. **Nothing has been tested on real hardware yet** — and iOS is the
platform most likely to break here.

### Next steps

1. Fix branch off `develop` addressing **#1–#10** in one pass; **#11** stays filed.
2. PR to `develop`, run both reviewers, loop to clean or capped-and-escalated.
3. First real device test — Android and iOS — on the staging URL.
