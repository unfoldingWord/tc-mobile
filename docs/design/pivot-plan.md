# Pivot to Tim's mockups — the plan

**Date:** 2026-08-22, rewritten 2026-08-23 · **Status:** Gate 1 published,
awaiting a human decision on G1–G5
**Tracking:** [#25](https://github.com/sethstoll3/tc-mobile/issues/25) ·
**Gate 1 artifact:** <https://claude.ai/code/artifact/2b4625a5-1a8c-4ad0-badd-5f045e2c0630>

**Sources.** Transcription: [`spec-transcription-p3-p4.md`](../spec-transcription-p3-p4.md)
(pages 3–4) and [`spec-transcription.md`](../spec-transcription.md) (page 1).
Images: `mockup-1..5-*.png` in this directory. Tim's answers and the decisions
taken from them: [`mockups-gap-analysis.md`](mockups-gap-analysis.md).

> **This document is the plan of record.** The gap analysis records how we got
> here and stays as that record — its "Open questions" section is superseded by
> the G-list below, which is the only open-question list anyone should work
> from. Where the two disagree, this file wins.

## The decision this plan assumes

**Tim's mockups are the first principles for the UI.** Where Pass A or Pass B
disagrees with a mockup, the mockup wins unless there is evidence — not
preference — for the other way. Tim has twenty years in the field and drew these
after a visit to an oral-only people group; Pass A and Pass B were drawn from one
page of criteria and a Mobbin sweep. That is a difference in evidence class, and
it settles the default.

Two consequences, stated plainly so they are not rediscovered later as surprises:

1. This overturns decisions Pass A and Pass B made deliberately (C1–C4 below).
   They are overturned on authority, not on argument, and that is legitimate here.
2. Improving on a mockup is still allowed. The bar is evidence, and the change is
   recorded in this repo before it is built, not after.

## What is already decided

Nothing below is open. It is here so no batch re-litigates it.

| Ref          | Decision                                                                                                  | Source                        |
| ------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **A1**       | A segment is generic. A Scripture or OBS reference is optional metadata a template may attach.            | Tim, 22 Aug                   |
| **A2**       | Takes are out of Phase 1. One recording per segment, edited in place.                                     | Tim, 22 Aug                   |
| **A3**       | Segments are added one at a time, from a `+` in the Segments menu bar. Templates supply them in bulk.     | Tim, 22 Aug                   |
| **A4**       | Share Chapter = one concatenated MP3 to the share sheet. Share Book = a zip of chapter MP3s. No Burrito.  | Tim, 22 Aug                   |
| **A5**       | Minimal text is fine for Phase 1. Zero-text is an aspiration to test, not a constraint to design against. | Tim, 22 Aug                   |
| **D1**       | `Take` stays in the schema, hidden, 1:1 with its segment.                                                 | 23 Aug                        |
| **D2**       | Undo is an operation log, not buffer copies.                                                              | 23 Aug                        |
| **D3**       | MP3 on Finished. PCM while editing, 64 kbps after. ~660 MB becomes ~66 MB.                                | 23 Aug                        |
| **D4**       | MicroSD via the share sheet only. No wrapper, ADR 0005 unchanged.                                         | 23 Aug                        |
| **D6**       | Artwork becomes an optional per-segment illustration, not the thing that decides the browse layout.       | 23 Aug                        |
| **ADR 0004** | The broad half is **rejected**. One generic `Book → Chapter → Segment (→ Take)` taxonomy.                 | Tim, 22 Aug; merged `0d9ee9d` |

**D5 is not in that table on purpose.** It said reference audio is out of Phase 1
— which stands — and also that the timing seam stays built and inert, which
contradicts this plan's B0. That half is unresolved and is now **G1**.

## Reconciliation — the mockups against what exists

### Confirmed: build stays as designed

| Element                                                  | Where it already is                                           |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| Vertical segment list, ordinal + waveform per row        | `components/section-view.tsx`, `section-row.tsx`              |
| Waveform as the row's face; no waveform = not recorded   | `components/waveform.tsx`, `lib/audio/peaks.ts`               |
| Recording as a distinct mode with the list receding      | Pass A "A2 — The states"; mockup dims the list behind a sheet |
| Cut / insert / paste / concat over raw PCM               | `lib/audio/edit.ts` — already pure, already sample-accurate   |
| PCM in IndexedDB, encode once on export                  | ADR 0002, ADR 0003, `lib/storage/clips.ts`                    |
| Scripture scope-string grammar, where a reference exists | ADR 0004 (accepted half), `lib/scripture/scope.ts`            |

`lib/audio/edit.ts` deserves a specific note: its header already says _"an edit
window that can cut, an edit marker that can paste, and insert… undo is just
keeping the previous buffer."_ The engine Tim's recording UI needs is built and
tested. The pivot is overwhelmingly a UI and data-model job, not an audio one.

The whole app is **3,261 lines**. This is a large change to a small codebase,
which is the cheapest version of this change we will ever get.

### Overturned: decisions that must be reversed

| #   | Pass A/B decided                                                                | The mockup requires                                                                                      |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| C1  | Status is **derived**, never set by the user (Pass A, "The thing cut: #6")      | An explicit per-segment **Complete** toggle, in the row _and_ in the recording sheet, counted as `19/21` |
| C2  | **One control per row** — "two controls would double the decision on every row" | A transport button and a `⋮` overflow menu, plus a draggable position dot on the waveform                |
| C3  | Hierarchy `Book → Chapter → Section → Segment → Take`                           | `Book → Chapter → Segment → (Takes)` — no Section level                                                  |
| C4  | Take-based capture: record a section, judge it, keep or redo                    | One editable waveform per segment: insert at centerline, select, cut, paste, undo/redo                   |

C1 and C4 are settled — C1 by the page-3 counter, C4 by A2. C3 is settled by
ADR 0004. **C2 is only half settled:** the transport and the position dot are
drawn and annotated; the `⋮` menu's contents are drawn nowhere. That is **G5**.

### Removed: what the pivot orphans

The instruction driving this section is _no stale stubby code left behind_.

| What                                                                                       | Lines | Why it goes                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/timing/**` + `types/timing.ts` — **blocked on G1**                                    | ~372  | Nothing outside the folder imports it; grep confirms, and the only callers of `loadChapterTiming` are its own tests. Built for record-along, which no mockup shows. |
| Reference-audio / narration path (`obs-media.ts`, `audio-io.ts`, `section-view.tsx`)       | ~40   | D5's surviving half. No mockup shows reference audio. Closes #9 by deletion.                                                                                        |
| Image-first browse — `section-browser.tsx`'s grid/list conditional, `ChapterCard.thumbUrl` | ~60   | D6. The artwork survives as an optional per-segment illustration; artwork deciding the layout does not.                                                             |

ADR 0007 is not deleted — it is superseded, with a note saying the seam was
removed and why, so the reasoning survives even though the code does not.

**Sequencing constraint:** B0 must land **after PR #21**, which touches
`lib/timing/parse.ts` and `types/timing.ts`. Deleting first throws away that
PR's fix for #7.

### New: what does not exist yet

| Area                                                        | Nearest existing thing                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| **Books screen** — books list, expand/collapse, counters    | `components/section-browser.tsx` (59 lines)                       |
| **New Book / New Chapter / New Segment**                    | `lib/storage/projects.ts` repository                              |
| **Share Chapter / Share Book**                              | nothing; specified by A4, needs a zip writer                      |
| **Template Library**                                        | `lib/obs/catalog.ts` is a hard-wired OBS-only path (#20)          |
| **Per-segment finished flag** and the `n/total` roll-up     | `Segment.status` + `setSegmentStatus` exist, unused, knip-flagged |
| **Recording sheet**: fixed centerline, swipe, insert-record | `hooks/use-recorder.ts` records whole clips                       |
| **Selection → cut → clipboard → paste at centerline**       | `lib/audio/edit.ts` has the primitives, no UI                     |
| **Undo / redo**                                             | nothing                                                           |
| **VU meter**                                                | nothing — no `AnalyserNode` anywhere in `src/`                    |
| **Recorder pause/resume**                                   | `MediaRecorder.pause()` is never called                           |
| **Zoom** 100% / 25%                                         | `components/waveform.tsx` draws fixed peaks, no pointer handling  |
| **Erase Segment**                                           | no delete path for a segment or its clips                         |

## Is any of this unusual for the domain?

Judged against `docs/research/prior-art.md` and `docs/research/ui-patterns.md`.
The short answer is **no — Tim is drawing the domain norm**, with three
exceptions worth naming.

Norm-confirming, with evidence:

- **The fixed centerline** is not unusual: `ui-patterns.md` records ElevenLabs
  shipping "a bar waveform with a fixed centre playhead and the audio scrolling
  past it… it keeps the point of interest in one predictable place." Our own
  research flagged it before Tim's page arrived.
- **Insert-at-marker, select, cut, trim** are all shipped by Shema Studio today
  (`prior-art.md` §1, confidence HIGH, published guide).
- **An explicit status flag** matches Shema's separate purpose/status enums.
  Tim's binary Complete toggle is lighter than the five-value enum already in
  `types/domain.ts`.
- **Per-chapter progress counters** and **per-row overflow menus** are ordinary
  list patterns.

The exceptions:

- **N1 — A clipboard, not just a cut.** Tim draws _"cuts selection to clipboard"_
  and _"toggles Paste icon on @ centerline"_. Shema cuts within a passage; a
  general clipboard implies pasting **across** segments. Scope, lifetime and
  restart behaviour are undefined. This is **G3**.
- **N2 — Undo and redo over audio.** Settled by D2 as an operation log rather
  than buffer copies, which is what makes it affordable at 5.3 MB per minute.
  No longer an open problem, but it is why D2 exists.
- **N3 — A hidden menu as a primary surface.** Template Library lives in the
  hamburger; Redo, VU visibility and Erase live in the recording `≡`. For a
  non-reading user a hidden icon-only menu is a discovery problem, and the
  destructive action lives inside it. A5 relaxes the text constraint, which makes
  this tractable; it does not make it solved.

None of these argue against Tim's design.

## Open — G1 to G5

The only open-question list. G1 and G2 block work; the rest can be answered as
their batch comes up. Recommendations are ours; the decision is Seth's, with
Tim's where marked.

| #      | Question                                                                                              | Blocks | Recommendation                                                                                              | For  |
| ------ | ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- | ---- |
| **G1** | Delete `lib/timing/**`, or keep it inert? This plan says delete; D5 says keep. Both are written down. | B0     | **Delete**, and supersede ADR 0007 rather than the code. A reviewer already filed the inertness.            | Seth |
| **G2** | What does a translator see on first run — an empty Books screen, or the template library?             | B2     | **Empty Books**, template library one tap away. Landing in a picker implies a catalogue.                    | Seth |
| **G3** | How far does the clipboard reach — segment, chapter, book — and does it survive a restart?            | B5     | **Within a chapter, lost on close.** Persisting it needs a home in IndexedDB and a way to see it.           | Tim  |
| **G4** | Erase Segment — erase the audio and keep the row, or remove the segment and renumber below it?        | B6     | **Erase the audio, keep the row.** Renumbering from a recorder menu is a large consequence for a small tap. | Tim  |
| **G5** | Does the per-row `⋮` menu ship, or wait until there is something to put in it?                        | B3     | **Hold it.** Its one obvious occupant already lives in the recorder menu.                                   | Tim  |

Two smaller ones, carried in their batches rather than blocking:

- **Where does artwork go?** D6 keeps it; no mockup draws it anywhere, including
  the editor. Answered inside B3/B4, and it is why #1 is a rework rather than a fix.
- **Can a finished segment be edited?** D3 drops the PCM on Finish, so editing
  afterwards either re-decodes from MP3 — lossy, twice — or is disallowed.
  Answered inside B8.

## Batches

Sequenced so nothing is built on a shape a later batch changes, and so the
deletion happens **first** rather than being promised. One lane at a time,
`develop`-cut branches, both reviewers per `AGENTS.md`.

| Batch  | Issue                                                    | Contents                                                                                      | Depends on          | Tier    |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------- | ------- |
| **B0** | [#26](https://github.com/sethstoll3/tc-mobile/issues/26) | Delete the timing seam and the narration path. Supersede ADR 0007.                            | G1, and #21 merging | T2      |
| **B1** | [#27](https://github.com/sethstoll3/tc-mobile/issues/27) | Segment is the unit of work. Section removed, Project→Book, finished flag, roll-up, migration | —                   | **T1**  |
| **B2** | [#28](https://github.com/sethstoll3/tc-mobile/issues/28) | Books screen — list, expand/collapse, counters, New Book, New Chapter, menu shell             | B1, G2              | T3      |
| **B3** | [#29](https://github.com/sethstoll3/tc-mobile/issues/29) | Segments screen — three row states, finished checkbox, scrub dot, transport, `+`              | B1                  | T3      |
| **B4** | [#30](https://github.com/sethstoll3/tc-mobile/issues/30) | Recorder sheet — breadcrumb, Finished toggle, fixed centerline, swipe, insert-record, pause   | B3                  | T1 / T2 |
| **B5** | [#31](https://github.com/sethstoll3/tc-mobile/issues/31) | Selection frame, cut to clipboard, paste at centerline, undo + redo, zoom                     | B4, G3              | **T1**  |
| **B6** | [#32](https://github.com/sethstoll3/tc-mobile/issues/32) | VU meter with show/hide, recorder `≡` menu, Erase Segment with confirmation                   | B4, G4              | T2      |
| **B7** | [#33](https://github.com/sethstoll3/tc-mobile/issues/33) | Template Library (OBS, Book of the Bible) and Share Chapter / Share Book                      | B1, B2              | T2      |
| **B8** | [#34](https://github.com/sethstoll3/tc-mobile/issues/34) | MP3 on Finished, and the encoder off the main thread                                          | B1                  | **T1**  |

## What this plan does not decide

- **The visual system.** Pass B's token work (`section-screen-pass-b.md`) is not
  overturned — the mockups are wireframes and carry no type or spacing. They do
  carry semantic colour, and it agrees with the tokens: green for play, red for
  record, which is the existing `--s-live` split. Composition is Gate 2.
- **Whether the five-value `RecordingStatus` enum stays** beneath a binary UI
  toggle. Probably yes; Phase 2 needs it and ADR 0004's migration reasoning applies.
- **Anything already open and unrelated:** #14 (lamejs LGPL), #19 (provenance),
  #24 (project archive). The pivot does not resolve them. It does make #14
  harder to defer, because D3 moves the encoder onto a required path.
