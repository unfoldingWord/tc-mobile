# Gate chart — where the project stands against its intent, 2026-09-04

**Date:** 2026-09-04 (Friday, evening) · **Status:** planning snapshot, not a
plan of record. [`pivot-plan.md`](pivot-plan.md) remains the plan of record;
where the two disagree, that file wins. · **Tree:** `develop` `0ba3687`,
`staging` `afdfa6e` (v0.1.12), `main` `3464a30` (pre-pivot).

## The intent, in one paragraph

An offline-first PWA for oral Bible translation on shared Android and iOS
phones, used by people who may not read: record a segment, edit the waveform in
place, mark it Finished, share a chapter or a book as MP3. Production-ready by
2026-09-30 (`v0.2.0`), in facilitators' hands at the East Africa training in the
first week of October (`v0.3.0`). Everything else is `v1.0.0`.

## What is built against that intent

| Goal (from the mockups and A1–A5)        | State                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Book → Chapter → Segment model, 1:1 Take | Built (B1), schema v4, migrations tested                                          |
| Books, Segments, Recorder screens        | Built (B2–B4), on staging                                                         |
| Waveform editing, undo/redo, zoom        | Built (B5)                                                                        |
| VU meter, recorder menu, Erase           | Built (B6)                                                                        |
| Share Chapter / Share Book               | Built (B7 half), **share sheet never observed on a phone**                        |
| MP3 on Finished, encoder in a Worker     | Built (B8, ADR 0009), **never run on a phone**                                    |
| Template Library                         | **Not built.** The only B-batch item outstanding; Q2 still open                   |
| Runs on Android                          | **Never run.** Every on-device note is iOS Safari; one is a beta                  |
| Production URL serving the pivot         | **No.** `main` is the 2026-08-22 tree                                             |
| Storage that survives the field          | `persist()` in draft (#214); no backup or restore exists (#24, Q6)                |
| Errors have a channel                    | Sink built (#188); destination not (#205)                                         |
| Text-free for non-readers                | Aspiration (A5); no evidence gathered; no protocol to gather it                   |
| Licence obligations (LGPL, CC BY-SA)     | Notice in draft (#144); provenance and export attribution unbuilt (#19, ADR 0006) |

## Unrealized goals → issues filed today

Each carries a difficulty tier for the model best suited (`difficulty: fable` /
`opus` / `sonnet`, new labels) and a suggested owner in the body. Owners are
suggestions drawn from the lanes in `CONTRIBUTING.md` and this week's PRs.

| #    | Goal                                                                  | Milestone | Tier   | Suggested owner                             |
| ---- | --------------------------------------------------------------------- | --------- | ------ | ------------------------------------------- |
| #243 | Decisions register for the requirements owner (Q1, Q2, Q5, Q6, Q7, …) | v0.2.0    | sonnet | the maintainer routes; requirements owner   |
| #244 | v0.2.0 production-gate checklist                                      | v0.2.0    | opus   | the maintainer                              |
| #245 | Android first on-device pass: protocol and evidence sheet             | v0.2.0    | sonnet | the maintainer runs; recorder lane triages  |
| #253 | Template Library, storage half (sub-issue of #33)                     | v0.2.0    | fable  | export/provenance lane                      |
| #246 | Template Library, UI half (sub-issue of #33)                          | v0.2.0    | sonnet | export/provenance lane, or recorder lane    |
| #247 | Storage-pressure marker (`estimate()`), the half of #12 #214 leaves   | v0.3.0    | sonnet | export/provenance lane (storage moved here) |
| #248 | Facilitator runbook for the training                                  | v0.3.0    | sonnet | the maintainer; requirements owner reviews  |
| #249 | Icon-recognition check at the training: ADR 0010 draft and protocol   | v0.3.0    | opus   | the maintainer drafts; requirements owner   |
| #250 | Public flip, part 2 (AGENTS.md, transfer plan, bot comments, trees)   | v0.2.0    | sonnet | the maintainer                              |
| #251 | Headless-Chromium smoke for the browser-only paths                    | v0.3.0    | opus   | export/provenance lane (owns the gates)     |
| #252 | Attribution out of the phone: ID3 frames + manifest entry             | v1.0.0    | sonnet | export/provenance lane                      |

Deliberately **not** filed: a merge-order issue for the open draft queue
(`CONTRIBUTING.md` says merge order is decided on the PR threads, and the QA
reviews posted today already map every collision), and anything already carried
by one of the 67 open issues.

## Who is on which path (observed, 2026-09-02 → 2026-09-04)

- **The maintainer (@sethstoll3)** — orchestrator since 2026-09-04: merge
  trains, releases, Cloudflare, the review harness, EOD entries, routing
  decisions to the requirements owner. Owns the gate.
- **@jag3773** — recorder and audio lane by assignment (#166, #168, #58, #106,
  #134, #203 …), accessibility issues filed from the recovery path (#198, #199),
  the LGPL notice (#144). Today: a QA review on every open code PR (seventeen,
  18:33–18:59Z), and the #207 hand-off.
- **@deferredreward** — export, provenance and archive lane by assignment, but
  this week's seventeen draft PRs span storage (#214, #218, #236, #240), the save
  seam (#213, #230, #239), lint and tooling gates (#216, #232, #234, #237),
  release hygiene (#215, #217) and export (#191). Develops on Windows (#189).
- **The requirements owner** — every open Q in the register, #134, #116, the
  public flip, packaging. **The project manager** — tC4 convergence, Shema
  Studio contact.

## Risks worth naming

- **R1 — Seventeen drafts from one lane, stacked and colliding.** #213 → #218 /
  #230 / #239; #236 → #240; #214 ↔ #235 on `books-screen.tsx`; #215 ↔ #217 on
  `vite.config.ts`. Each merge stales the next lane's sign-offs
  (`docs/review/dual-review.md`). Suggested order: #190 → #231 → #213 → #230 →
  #239 → #218 → #235 → #214 → #236 → #240 → #191 → #216 → #232 → #234 → #215 →
  #217 → #237, one at a time, rebasing after each.
- **R2 — Android is the long pole and needs a phone, not a PR.** The
  maintainer's device arrives 2026-09-05. #245 is the run sheet.
- **R3 — No backup exists and the training is the first field data.** Q6 is the
  highest-stakes row in #243.
- **R4 — The dual review is under capacity** (grok slow or stalling all
  afternoon; the org ran out of credits once this week). The QA reviews posted
  today are input, not the dual review, and every PR still needs both lenses.
- **R5 — The Template Library is gate-milestoned and unstarted**, with its
  design question open. Either Q2 is answered next week or #33 moves to
  `v0.3.0` explicitly.
