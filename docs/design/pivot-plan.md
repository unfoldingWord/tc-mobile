# Pivot to the page 3–4 mockups — plan

**Date:** 2026-08-22 · **Status:** proposed, awaiting Seth's go
**Sources:** [`spec-transcription-p3-p4.md`](../spec-transcription-p3-p4.md) ·
images in [`docs/design/`](./) (`mockup-1..5-*.png`) · page 1 in
[`spec-transcription.md`](../spec-transcription.md)

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

## Reconciliation — the mockups against what exists

### Confirmed: build stays as designed

| Element                                                | Where it already is                                           |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Vertical segment list, ordinal + waveform per row      | `components/section-view.tsx`, `section-row.tsx`              |
| Waveform as the row's face; no waveform = not recorded | `components/waveform.tsx`, `lib/audio/peaks.ts`               |
| Recording as a distinct mode with the list receding    | Pass A "A2 — The states"; mockup dims the list behind a sheet |
| Cut / insert / paste / concat over raw PCM             | `lib/audio/edit.ts` — already pure, already sample-accurate   |
| PCM in IndexedDB, encode once on export                | ADR 0002, ADR 0003, `lib/storage/clips.ts`                    |
| Scripture Burrito scope strings                        | ADR 0004 (accepted part), `lib/scripture/scope.ts`            |

`lib/audio/edit.ts` deserves a specific note: its header already says _"an edit
window that can cut, an edit marker that can paste, and insert… undo is just
keeping the previous buffer."_ The engine Tim's recording UI needs is built and
tested. The pivot is overwhelmingly a UI and data-model job, not an audio one.

### Overturned: decisions that must be reversed

| #   | Pass A/B decided                                                                | The mockup requires                                                                                      |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| C1  | Status is **derived**, never set by the user (Pass A, "The thing cut: #6")      | An explicit per-segment **Complete** toggle, in the row _and_ in the recording sheet, counted as `19/21` |
| C2  | **One control per row** — "two controls would double the decision on every row" | Two: a transport button **and** a `⋮` overflow menu, plus a draggable position dot on the waveform       |
| C3  | Hierarchy `Book → Chapter → Section → Segment → Take` (ADR 0004, from page 1)   | Page 3 draws `Book → Chapter → Segment → (Takes)` — no Section level                                     |
| C4  | Take-based capture: record a section, judge it, keep or redo                    | One editable waveform per segment: insert at centerline, select, cut, paste, undo/redo                   |

C1 and C2 are UI reversals and cost little. C3 is a data-model question and is
**blocked on Q1**. C4 is the largest single change in this plan.

### Removed: what dies, and why it must die now

The instruction driving this section is _no stale stubby code left behind_. Each
item is either deleted in B0 or has a named owner and a date.

| What                                                                                                          | Lines | Why it goes                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/timing/**` (`parse.ts`, `providers.ts`, `registry.ts`, `index.ts`) + `types/timing.ts`                   | ~372  | Nothing outside the folder imports it — grep confirms. `providers.ts` says "None is registered by default." It was built for record-along, which no mockup shows, against timing files uW has not published (ADR 0007, issue #13). Dead on arrival and now unmotivated. |
| Reference-audio / narration UI in `components/section-view.tsx` (`referencePlaying`, story narration control) | ~40   | GATE 2 put story-level reference audio in v1. No mockup shows it. Keeping the control while the model behind it changes is exactly the stub this pivot is meant to avoid.                                                                                               |
| `hooks/obs-media.ts` + `lib/storage/media.ts` reference-media cache, **if** artwork leaves the rows           | ~148  | Conditional on Q4. Mockup rows carry ordinal + waveform, no art. Do not delete until Q4 is answered — deleting the OBS artwork path is not reversible cheaply.                                                                                                          |

Deleting the timing seam closes or obsoletes issues **#5** (the seam is inert),
**#7** (`validateFrameTimings` accepts NaN), **#6** (burrito parser drops the
chapter side), **#13** (ask uW for timing files) and **#9** (reference audio is
an uncached CDN `<audio>`). That is five open issues retired by one deletion,
which is the clearest signal available that the code was not load-bearing.

ADR 0007 is not deleted — it is superseded, with a note saying the seam was
removed and why, so the reasoning survives even though the code does not.

### New: what does not exist yet

| Area                                                                          | Nearest existing thing                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Content Mgmt screen** — books list, expand/collapse, chapter rows, counters | `components/section-browser.tsx` (59 lines)                     |
| **New Book / New Chapter** creation                                           | `lib/storage/projects.ts` repository                            |
| **Share Book**                                                                | nothing — and no format decided (Q5)                            |
| **Template Library** (OBS, Book of the Bible + chapter format)                | `lib/obs/catalog.ts` is a hard-wired OBS-only path (issue #20)  |
| **Per-segment Complete flag** and the `n/total` roll-up                       | `RecordingStatus` enum exists, unused in UI                     |
| **Recording sheet**: fixed centerline, swipe-to-move, insert vs append        | `hooks/use-recorder.ts` records whole clips                     |
| **Selection frame → cut → clipboard → paste at centerline**                   | `lib/audio/edit.ts` has the primitives, no UI                   |
| **Undo / redo stack**                                                         | nothing (see N4)                                                |
| **VU meter**                                                                  | nothing                                                         |
| **Zoom toggle** 100% / 25% in view                                            | `components/waveform.tsx` draws fixed peaks                     |
| **Erase Segment, with confirmation**                                          | nothing — and "confirm without words" is an open Pass A problem |

## Is any of this unusual for the domain?

Judged against `docs/research/prior-art.md` and `docs/research/ui-patterns.md`,
which are already in the repo. The short answer is **no — Tim is drawing the
domain norm**, with four exceptions worth naming.

Norm-confirming, with evidence:

- **The fixed centerline** is not unusual: `ui-patterns.md` records ElevenLabs
  shipping "a bar waveform with a fixed centre playhead and the audio scrolling
  past it… worth considering: it keeps the point of interest in one predictable
  place." Our own research flagged it before Tim's page arrived.
- **Insert-at-marker, select, cut, trim** are all shipped by Shema Studio today
  (`prior-art.md` §1, confidence HIGH, published guide). Tim is asking for a
  subset of what the closest comparable product already does.
- **An explicit status flag** matches Shema's separate purpose/status enums,
  which `prior-art.md` recommends cloning. Tim's binary Complete toggle is far
  lighter than the five-value enum already in `types/domain.ts`.
- **Per-chapter progress counters** and **per-row overflow menus** are ordinary
  list patterns (Nibble's inline per-row progress, Pillow's per-row state chips).

The four exceptions:

- **N1 — A clipboard, not just a cut.** Tim draws _"cuts selection to clipboard"_
  and _"toggles Paste icon on @ centerline"_. Shema cuts within a passage and
  copies a whole section; a general clipboard implies pasting **across** segments
  and possibly across chapters. Its scope, lifetime and behaviour on app restart
  are undefined. This is the one genuinely underspecified mechanism on the page.
- **N2 — Undo and redo over audio.** Normal in a desktop editor, non-trivial
  here: at ~5.3 MB per minute of PCM (ADR 0002), a naive undo stack that keeps
  previous buffers — which is exactly what `edit.ts` says undo is — multiplies
  the memory that issue #12 already flags as unresolved before October.
- **N3 — Text in a no-text design.** Page 1 asks for "low/no text (icon driven)".
  The mockups label breadcrumbs "Book 001 > Chapter 1 > 3" and use digits
  throughout. Probably placeholder, but `ui-patterns.md`'s headline finding is
  that **no** reviewed product achieves a text-free path, so this needs to be
  deliberate rather than assumed. See Q3.
- **N4 — A hidden menu as a primary surface.** Template Library lives in the
  hamburger; Redo, VU visibility and Erase live in the recording `≡`. For a
  non-reading user a hidden icon-only menu is a discovery problem, and the
  destructive action lives inside it — while "how a destructive action is
  confirmed without words" is listed in Pass A as real and unsolved.

None of these argue against Tim's design. N1 and N3 are questions for him; N2 and
N4 are engineering and UX problems we own.

## Open questions

Numbered for reference. Q1, Q3 and Q5 block work; the rest can be answered as
their batch comes up.

| #   | Question                                                                                                                                                                                                                                                  | Blocks | For  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| Q1  | Page 1 has `Chapter → Section → Segment`; page 3 has `Chapter → Segment`. Is **Segment** now the single unit of work, with Section retired? This is also the answer ADR 0004 has been waiting on.                                                         | B1     | Tim  |
| Q2  | Where do **Takes** live? Page 3 keeps them in the taxonomy, but the recording UI edits one waveform in place. Is a take a saved snapshot of the segment buffer, or is take history dropped for v1?                                                        | B1, B4 | Tim  |
| Q3  | Is the on-screen **text in the mockups placeholder**, or has "low/no text" relaxed to "words for structure, icons for actions"? Numerals specifically: are digits acceptable for a non-reading user?                                                      | B2     | Tim  |
| Q4  | Rows show ordinal + waveform and **no OBS artwork**. Is dropping artwork intended, or is it simply not drawn? `ui-patterns.md` argues art is the strongest non-textual row identity we have.                                                              | B3     | Tim  |
| Q5  | **Share Book** — share _what_, to _whom_, in what format? A file the user hands off (Web Share / download), or device-to-device? Note ADR 0005 says no backend in Phase 1, and Shema's answer is a signed zip bundle with typed purposes.                 | B7     | Tim  |
| Q6  | **Template Library** — is a template a _content_ pack (OBS's 50 stories with their frames) or a _structure_ generator (a Bible book's chapters and pericopes, no content)? It looks like both, which is the division-scheme model from `prior-art.md` §1. | B7     | Tim  |
| Q7  | Does the **clipboard** cross segments and chapters, and does it survive app restart? (N1)                                                                                                                                                                 | B5     | Tim  |
| Q8  | **Erase Segment** — erase the audio and keep the empty segment, or remove the segment from the chapter? Different data operations, same words.                                                                                                            | B6     | Tim  |
| Q9  | Does the repo stay at `sethstoll3/tc-mobile`? That account is being retired in the GitHub consolidation; `uw-ops` already moved off it.                                                                                                                   | —      | Seth |

## Batches

Sequenced so that nothing is built on a shape that a later batch changes, and so
the deletion happens **first** rather than being promised. One lane at a time,
`develop`-cut branches, both reviewers per `AGENTS.md`.

| Batch  | Name                          | Contents                                                                                                                                          | Depends on |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **B0** | Remove what the pivot orphans | Delete `lib/timing/**`, `types/timing.ts`, reference-audio UI in `section-view.tsx`. Supersede ADR 0007. Close #5, #6, #7, #9, #13. Re-scope #11. | —          |
| **B1** | Data model to match page 3    | Segment as the unit (Q1), per-segment `complete` flag, chapter roll-up counts, take decision (Q2), IndexedDB migration (T1 — tests required)      | Q1, Q2     |
| **B2** | Content Mgmt screen           | Books list, expand/collapse, chapter rows with `n/total`, New Book, New Chapter, menu shell                                                       | B1, Q3     |
| **B3** | Segments screen               | Three row states, checkbox toggle, mini-waveform with draggable position dot, transport play/pause, `⋮` menu                                      | B1, Q4     |
| **B4** | Recording sheet               | Sheet over dimmed list, breadcrumb, Finished toggle, fixed centerline, swipe-to-move, record inserts mid / appends at end, pause toggle           | B3         |
| **B5** | Waveform editing              | Selection frame, on-screen selector, cut to clipboard, paste at centerline, undo + redo, zoom 100% / 25%                                          | B4, Q7     |
| **B6** | Meter, menu, erase            | VU meter with show/hide, recording `≡` menu, Erase Segment with wordless confirmation                                                             | B4, Q8     |
| **B7** | Templates and sharing         | Template Library (OBS + Bible book/chapter), Share Book. Retires #20's hard-wiring.                                                               | Q5, Q6     |
| **B8** | Export                        | MP3 export path — issue #18. Unchanged by this pivot; sequenced last only because nothing else depends on it.                                     | B1         |

Risk tiers per `AGENTS.md`: B1 is **T1** (IndexedDB schema, migration path
required). B4 and B5 are **T1** for anything touching `lib/audio/**` and **T2**
for the hooks. B2, B3 and B6 are **T3**. B7 is **T2** (export/share path).

## What this plan does not decide

- The visual system. Pass B's token work (`section-screen-pass-b.md`) is not
  overturned by these mockups — they are wireframes, and carry no type, spacing
  or colour beyond the VU meter. Pass B's numeral system survives contact with
  N3 only if Q3 says digits are acceptable.
- Whether the five-value `RecordingStatus` enum stays in the model beneath a
  binary UI toggle. Probably yes — Phase 2 needs it, and ADR 0004's reasoning
  about migrations applies.
- Anything already open and unrelated: #12 (PCM storage), #14 (lamejs LGPL),
  #15 (OBS licensing), #18 (export), #19 (provenance). The pivot does not
  resolve them and does not make them worse, except that **N2 makes #12 more
  urgent**, not less.
