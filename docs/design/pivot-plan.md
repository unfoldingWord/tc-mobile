# Pivot to the product mockups — the plan

**Date:** 2026-08-22, rewritten 2026-08-23 · **Status:** **Gate 1 passed**
2026-08-23. G1–G5 decided; build may proceed.
**Tracking:** [#25](https://github.com/unfoldingWord/tc-mobile/issues/25)

> **"The pivot", for a reader meeting the word here first.** The data model and
> the three screens were set from the product mockups on 22 Aug 2026, about an
> hour after work on the app began, and the initial scaffold was replaced rather
> than evolved. This document and the issues call that replacement "the pivot".

**Sources.** The product mockups (22 Aug 2026) and the requirements owner's
answers to the questions they raised. The decisions taken from those answers are
in the table below.

> **This document is the plan of record.** The G-list below is the only
> open-question list anyone should work from; any earlier list is superseded by
> it, and where another document disagrees, this file wins.

## The decision this plan assumes

**The product mockups are the first principles for the UI.** Where Pass A or
Pass B disagrees with a mockup, the mockup wins unless there is evidence — not
preference — for the other way. The mockups were drawn by the requirements owner
from first-hand work with oral-only communities; Pass A and Pass B were drawn
from one page of criteria and a Mobbin sweep. That is a difference in evidence
class, and it settles the default.

Two consequences, stated plainly so they are not rediscovered later as surprises:

1. This reverses decisions Pass A and Pass B made deliberately (C1–C4 below).
   They were decided by the requirements owner rather than re-argued, and that
   is legitimate here.
2. Improving on a mockup is still allowed. The bar is evidence, and the change is
   recorded in this repo before it is built, not after.

## What is already decided

Nothing below is open. It is here so no batch re-litigates it.

| Ref          | Decision                                                                                                  | Source                                       |
| ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **A1**       | A segment is generic. A Scripture or OBS reference is optional metadata a template may attach.            | Requirements owner, 22 Aug                   |
| **A2**       | Takes are out of Phase 1. One recording per segment, edited in place.                                     | Requirements owner, 22 Aug                   |
| **A3**       | Segments are added one at a time, from a `+` in the Segments menu bar. Templates supply them in bulk.     | Requirements owner, 22 Aug                   |
| **A4**       | Share Chapter = one concatenated MP3 to the share sheet. Share Book = a zip of chapter MP3s. No Burrito.  | Requirements owner, 22 Aug                   |
| **A5**       | Minimal text is fine for Phase 1. Zero-text is an aspiration to test, not a constraint to design against. | Requirements owner, 22 Aug                   |
| **D1**       | `Take` stays in the schema, hidden, 1:1 with its segment.                                                 | 23 Aug                                       |
| **D2**       | Undo is an operation log, not buffer copies.                                                              | 23 Aug                                       |
| **D3**       | MP3 on Finished. PCM while editing, 64 kbps after. ~660 MB becomes ~66 MB.                                | 23 Aug                                       |
| **D4**       | MicroSD via the share sheet only. No wrapper, ADR 0005 unchanged.                                         | 23 Aug                                       |
| **D6**       | Artwork becomes an optional per-segment illustration, not the thing that decides the browse layout.       | 23 Aug                                       |
| **ADR 0004** | The broad half is **rejected**. One generic `Book → Chapter → Segment (→ Take)` taxonomy.                 | Requirements owner, 22 Aug; merged `0d9ee9d` |

**D5 was split.** Its first half — reference audio is out of Phase 1 — stands.
Its second half said the timing seam stays built and inert, contradicting B0.
**G1 resolved that against D5: the seam is deleted.**

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
keeping the previous buffer."_ The engine the mockups' recording UI needs is
built and tested. The pivot is overwhelmingly a UI and data-model job, not an
audio one.

The whole app was **3,261 lines** when this was written — `e0ed78d`, 2026-08-23.
At `07b927d` the same count is **4,752**. Measured both times with
`git ls-files src | grep -E '\.tsx?$' | xargs wc -l`; the figure excludes `tests/`
and `src/**/*.css`. This is still a large change to a small codebase, which is the
cheapest version of this change we will ever get — but the codebase has grown
about 46% since the sizing argument was made, and the number will keep drifting,
so re-measure rather than quoting either figure.

### Overturned: decisions that must be reversed

| #   | Pass A/B decided                                                                | The mockup requires                                                                                      |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| C1  | Status is **derived**, never set by the user (Pass A, "The thing cut: #6")      | An explicit per-segment **Complete** toggle, in the row _and_ in the recording sheet, counted as `19/21` |
| C2  | **One control per row** — "two controls would double the decision on every row" | A transport button and a `⋮` overflow menu, plus a draggable position dot on the waveform                |
| C3  | Hierarchy `Book → Chapter → Section → Segment → Take`                           | `Book → Chapter → Segment → (Takes)` — no Section level                                                  |
| C4  | Take-based capture: record a section, judge it, keep or redo                    | One editable waveform per segment: insert at centerline, select, cut, paste, undo/redo                   |

C1 and C4 are settled — C1 by the counter drawn on the mockups, C4 by A2. C3 is
settled by ADR 0004. C2 is settled by **G5**: the `⋮` ships, with a first-guess
set of
contents, and Pass A's one-control-per-row position is overturned outright.

### Removed: what the pivot orphans

The instruction driving this section is _no stale stubby code left behind_.

| What                                                                                                                                     | Lines | Why it goes                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/timing/**` + `types/timing.ts` — **blocked on G1**                                                                                  | ~372  | Nothing outside the folder imports it; grep confirms, and the only callers of `loadChapterTiming` are its own tests. Built for record-along, which no mockup shows.                                                           |
| Reference-audio / narration path (`audio-io.ts`, `use-audio-session.ts`, `section-view.tsx`, `App.tsx`, `use-chapter.ts`, `view.ts`)     | ~90   | D5's surviving half. No mockup shows reference audio. Closes #9 by deletion. `ChapterCard.referenceAudioUrl` and the arbiter's narration wiring go with it.                                                                   |
| **OBS media cache** — accessor code (`hooks/obs-media.ts`, `lib/storage/media.ts`) and the `CachedMedia` export — **added to B0 24 Aug** | ~180  | Q4 answered no. Zero live consumer, no mockup shows artwork, no batch scheduled to wire it. Closes #1 as moot. The **`media` object store stays** (empty, unread) so B0 changes no schema; B1's drop-and-recreate removes it. |
| Image-first browse — `section-browser.tsx`'s grid/list conditional, `ChapterCard.hasArtwork`                                             | ~60   | D6. The artwork survives as an optional per-segment illustration; artwork deciding the layout does not. **B2/B3, not B0.**                                                                                                    |

**Corrected 2026-08-24 — the field named here was wrong.** This row said
`ChapterCard.thumbUrl`. There is no such field. The field that actually forks the
browse layout is `ChapterCard.hasArtwork` (`src/types/view.ts:39`, whose own
docblock calls it "the single conditional the whole screen turns on"), read at
`components/section-browser.tsx:29` and computed at `hooks/use-chapter.ts:97` as
`cards.some((c) => c.thumbUrl !== null)`. `thumbUrl` is a **`SectionCard`** field
(`src/types/view.ts:22`) — the per-section thumbnail, which D6 keeps as the
optional illustration. Deleting it is not what this row describes, and no issue
named `hasArtwork` before now.

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
The short answer is **no — the mockups draw the domain norm**, with three
exceptions worth naming.

Norm-confirming, with evidence:

- **The fixed centerline** is not unusual: `ui-patterns.md` records ElevenLabs
  shipping "a bar waveform with a fixed centre playhead and the audio scrolling
  past it… it keeps the point of interest in one predictable place." Our own
  research flagged it before the mockups arrived.
- **Insert-at-marker, select, cut, trim** are all shipped by Shema Studio today
  (`prior-art.md` §1, confidence HIGH, published guide).
- **An explicit status flag** matches Shema's separate purpose/status enums.
  The mockups' binary Complete toggle is lighter than the five-value enum
  already in `types/domain.ts`.
- **Per-chapter progress counters** and **per-row overflow menus** are ordinary
  list patterns.

The exceptions:

- **N1 — A clipboard, not just a cut.** The mockups label _"cuts selection to
  clipboard"_ and _"toggles Paste icon on @ centerline"_. Shema cuts within a
  passage; a
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

None of these argue against the mockups' design.

## Gate 1 decisions — taken 2026-08-23

All five answered by the DRI. Four followed the recommendation; **G5 did not**,
and the disagreement is recorded rather than smoothed over.

| #      | Decision                                                                                                    | Unblocks | Note                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| **G1** | **Delete the timing seam.** `lib/timing/**`, `types/timing.ts`, `tests/timing.test.ts`. Supersede ADR 0007. | B0       | Overrides D5's second half. Must land after #21.                                   |
| **G2** | **First run is the empty Books screen**, template library one tap away in the menu.                         | B2       | The app reads as a notebook, not a catalogue of other people's content.            |
| **G3** | **The clipboard reaches across a chapter and is lost on close.**                                            | B5       | In memory only. No IndexedDB home, and no way to accumulate audio nothing can see. |
| **G4** | **Erase Segment erases the audio and keeps the row.**                                                       | B6       | The segment returns to its never-recorded state. Chapter numbering is untouched.   |
| **G5** | **The `⋮` row menu ships**, with Erase Segment and Share Segment as a first guess.                          | B3       | Against the recommendation to hold it. See the two consequences below.             |

### What G5 commits us to

Recorded here because the option was taken with these named, and neither is a
reason to revisit it — they are work items.

1. **Erase Segment now exists in two places** — the row menu and the recorder
   menu. Both must do the same thing, which G4 defines, and both need the same
   wordless confirmation. B3 and B6 have to agree rather than each solving it.
2. **Share Segment is a scope the requirements owner did not ask for.** A4
   specifies sharing at the chapter and book level only. A single-segment MP3 to
   the share sheet is a small addition to a path B7 is building anyway, but it
   is the build's addition, not a requirement — **confirm with the requirements
   owner before B7 settles the share semantics.**

### Open questions — the standing register

**Working principle: it is easier to steer a moving car than a parked one.** Each
open question below has a **best-effort default** we build against so work does
not stall. The defaults are chosen to be cheap to reverse, and the question stays
open until someone answers it — a default is not an answer, and none of these are
closed by having been guessed at.

| #      | Question                                                             | Status                                                              | Owner              | Best-effort default while it is open                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Q1** | Does **Share Segment** exist? A4 specifies chapter and book only.    | **Pending the requirements owner**                                  | Requirements owner | Build share as one code path with a scope parameter. Ship chapter and book; segment stays behind a flag. Adding or dropping it is one line.                                                                                                                        |
| **Q2** | Is a template a **content pack** or a **structure generator**?       | **Waiting**                                                         | Requirements owner | Model it as a structure generator that _may_ carry content. OBS is structure + content; a Bible book is structure only. One interface, optional payload — the union, not a guess between them.                                                                     |
| **Q3** | lamejs is LGPL-3.0 in an MIT repo.                                   | **Decided 23 Aug**                                                  | —                  | **Keep lamejs.** ADR 0003 carries the five obligations; #36 tracks the two outstanding. Closed #14.                                                                                                                                                                |
| **Q4** | Where does per-segment artwork go? No mockup places it anywhere.     | **Answered no — B0 (#26), 24 Aug**                                  | DRI                | The OBS media cache is **removed** and #1 closed as moot. No mockup places artwork and no batch was scheduled to wire it, so a kept-for-later cache was the sprawl the bar rejects. Per-segment artwork is greenfield if a later phase asks; recoverable from git. |
| **Q5** | Can a **finished** segment be edited once D3 has dropped its PCM?    | **Pending — built against the default, B8 / ADR 0009 (2026-09-02)** | DRI                | Allow it, re-decoding from the MP3, and record a generation count on the clip. A translator who cannot fix a mistake after marking it done will stop marking things done — which breaks the progress model _and_ the storage saving D3 exists for.                 |
| **Q6** | Does Phase 1 need a **project archive**, distinct from share? (#24)  | **Pending**                                                         | Requirements owner | Build no archive, but give the Share Book zip predictable folder names and a small manifest, so a future import is possible without changing the export format. Roughly twenty lines now against a format migration later.                                         |
| **Q7** | Do **spoken prompts** carry the instructional load instead of icons? | **Pending**                                                         | Requirements owner | Do not build a prompt recorder. Route every chrome string through one table — which the ten-odd strings need anyway — so a prompt layer can attach later. See the note below on why this is not another timing seam.                                               |

**Q7 is a string table, not a seam.** G1 has just deleted one speculative
provider registry, and the reasoning there applies here: a seam built for a
feature nobody has asked for is dead code. The difference is that a single place
for the app's handful of strings is needed whether or not spoken prompts ever
happen, and it is where they would attach if they did. If that ever grows a
provider registry before someone commits to prompts, it has become the same
mistake and should be deleted the same way.

### Also carried in their batches

- **The `⋮` menu's real contents.** G5 shipped a first guess. Whatever replaces
  it is a B3 change, not a re-run of the gate.
- **Icon recognition.** More than half the controls the mockups draw are
  software convention rather than hardware-derived, and `ui-patterns.md` records
  that no
  reviewed product achieves a text-free path. Proposed as its own ADR, with a
  ten-minute recognition check at the October training as the evidence that
  turns it from opinion into a finding.

## Batches

Sequenced so the deletion happens **first** rather than being promised, and so no
batch leaves the app in a state it cannot render. One lane at a time,
`develop`-cut branches, both reviewers per `AGENTS.md`.

The original ordering rule was "nothing is built on a shape a later batch
changes." B1's re-sequencing on 2026-08-24 traded it away deliberately; the note
under the table says what that costs and why the trade is worth taking.

| Batch  | Issue                                                       | Contents                                                                                                                                                   | Depends on  | Tier    |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------- |
| **B0** | [#26](https://github.com/unfoldingWord/tc-mobile/issues/26) | Delete the timing seam, the narration path, and the OBS media cache accessors. Supersede ADR 0007.                                                         | #21 merging | T2      |
| **B1** | [#27](https://github.com/unfoldingWord/tc-mobile/issues/27) | Segment is the unit of work. Section removed, Project→Book, finished flag, roll-up, drop-and-recreate migration (drop the v2 `media` store B0 left behind) | B2, B3      | **T1**  |
| **B2** | [#28](https://github.com/unfoldingWord/tc-mobile/issues/28) | Books screen — list, expand/collapse, counters, New Book, New Chapter, menu shell                                                                          | —           | T3      |
| **B3** | [#29](https://github.com/unfoldingWord/tc-mobile/issues/29) | Segments screen — three row states, finished checkbox, scrub dot, transport, `+`, `⋮` menu                                                                 | —           | T3      |
| **B4** | [#30](https://github.com/unfoldingWord/tc-mobile/issues/30) | Recorder sheet — breadcrumb, Finished toggle, fixed centerline, swipe, insert-record, pause                                                                | B3          | T1 / T2 |
| **B5** | [#31](https://github.com/unfoldingWord/tc-mobile/issues/31) | Selection frame, cut to clipboard, paste at centerline, undo + redo, zoom                                                                                  | B4          | **T1**  |
| **B6** | [#32](https://github.com/unfoldingWord/tc-mobile/issues/32) | VU meter with show/hide, recorder `≡` menu, Erase Segment with confirmation                                                                                | B4          | T2      |
| **B7** | [#33](https://github.com/unfoldingWord/tc-mobile/issues/33) | Template Library (OBS, Book of the Bible) and Share Chapter / Share Book                                                                                   | B1, B2      | T2      |
| **B8** | [#34](https://github.com/unfoldingWord/tc-mobile/issues/34) | MP3 on Finished, and the encoder off the main thread                                                                                                       | B1          | **T1**  |

### B1 migration — append-only waived (ADR 0008, 2026-08-25)

#27 called for a data-preserving v2→v3 migration ("still append-only"). On the
review of PR #57 the DRI took the **one-time destructive recreate** instead:
pre-alpha, no field data, so a Section-flattening transform would be ceremony
for data that cannot exist in the field. Append-only resumes from v3. This
supersedes #27's append-only line for that one transition only; the decision of
record is [`docs/decisions/0008-pivot-destructive-recreate.md`](../decisions/0008-pivot-destructive-recreate.md).

### B1 was re-sequenced behind B2 and B3 — 2026-08-24

The table above originally ran B1 first, on the principle that the model settles
before the screens are drawn on top of it. That was the wrong order here, and the
dependency is now inverted: **B2 and B3 land first, then B1 changes the model
underneath them.**

Removing `Section` breaks every screen the app currently renders, including
`app/App.tsx`, all four `components/section-*` files, `types/view.ts`,
`hooks/use-chapter.ts` and `hooks/use-audio-session.ts` — the last of these is
typed on `SectionCard`. The storage and type layers carry it too
(`types/domain.ts`, `lib/storage/db.ts`, `lib/storage/projects.ts`), which is
B1's own work rather than collateral.
#27's Done-when named only the store, the index, the roll-up and the migration, so
B1 could have been signed off with the UI left broken. B2 and B3 were written as
additive, which meant the prior-UI files could have survived both batches — every
issue closed, and the replaced UI still in the tree. Building the replacement
screens first means B1 deletes files that nothing renders any more.

Recorded on [#27](https://github.com/unfoldingWord/tc-mobile/issues/27),
[#28](https://github.com/unfoldingWord/tc-mobile/issues/28) and
[#29](https://github.com/unfoldingWord/tc-mobile/issues/29); the full reasoning is on
#27.

The cost of this order is named rather than absorbed: B2 and B3 are composed
before the model they will finally sit on exists, so B1 has to reach back into
them. That is a smaller job than the alternative, which was a batch that leaves
the app unrenderable and an issue that lets it be signed off anyway.

## What this plan does not decide

- **The visual system.** Pass B's **token work** — section B0 of
  [`section-screen-pass-b.md`](section-screen-pass-b.md) — is not overturned. The
  mockups are wireframes and carry no type or spacing. They do carry semantic
  colour, and it agrees with the tokens: green for play, red for record, which is
  the existing `--s-live` split. Composition is Gate 2.

  **The composition does not survive.** Pass B's B2 specifies one control per
  row, an image-first grid and a reference-audio control, all three now
  overturned — by G5, D6 and D5/G1 respectively. Its B4 motion rules and its
  unresolved Gate 3 residuals do carry forward; the Pass B banner is the list. Both Pass documents carry a
  `**Status:**` banner as of 2026-08-24 saying what is superseded and by what;
  they are kept as dated records of how the decisions were reached, not as
  specifications to build from.

- **Whether the five-value `RecordingStatus` enum stays** beneath a binary UI
  toggle. Probably yes; Phase 2 needs it and ADR 0004's migration reasoning applies.
- **The register's pending items.** Q1, Q2, Q5, Q6 and Q7 each have a default,
  not an answer. Building against a default does not close the question.
- **Issue #19 (provenance)** is now required rather than insurance: the
  requirements owner confirmed on 22 Aug that OBS-derived recordings **are** CC
  BY-SA derivative works (#15), so the model must be able to tell an OBS-derived
  recording from a user-authored
  one. The pivot does not resolve it and A1 makes it more load-bearing, because a
  hand-made book and a template-derived one now look identical apart from what the
  template left behind.
