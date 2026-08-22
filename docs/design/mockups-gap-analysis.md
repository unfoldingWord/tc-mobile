# Tim's mockups — what they specify, and what we are missing

**Status:** Analysis, pending Tim's answers · **Date:** 2026-08-22

## What we have

Five hand-drawn wireframes, walked through on 2026-08-22. Three distinct
screens; the editor is drawn three times to show three states.

| Archived as                                                  | Page | Screen                                        |
| ------------------------------------------------------------ | ---- | --------------------------------------------- |
| [`mockup-1-content-mgmt.png`](mockup-1-content-mgmt.png)       | 3    | Content Mgmt — Book / Chapter tree            |
| [`mockup-2-segments-list.png`](mockup-2-segments-list.png)     | 4    | Segments Mgmt — segment list, fully annotated |
| [`mockup-3-recording-base.png`](mockup-3-recording-base.png)   | 4    | On-Screen Recording UI — base state           |
| [`mockup-4-recording-cut.png`](mockup-4-recording-cut.png)     | 4    | Same, with selection frame and cut            |
| [`mockup-5-recording-paste.png`](mockup-5-recording-paste.png) | 4    | Same, with paste at centerline                |

Originals were macOS screenshots; archived here because a wireframe that lives
only in someone's `temp/` folder is not a source anyone else can check.

**We are missing notebook pages 1 and 2.** Page 3 opens with the taxonomy
written out cold and no preamble, which reads like a continuation. If the
design criteria Tim said he was assembling exist anywhere, that is where they
are — and they may answer Q1 and Q5 below.

## What the mockups settle

Three questions that were open are now answered, one of them against a position
this repo had argued for.

**The waveform editor is core, not optional.** Directional idea O3 proposed
"takes, not edits — no waveform surgery," on the reasoning that oral drafters
redo a whole chunk naturally. The mockups draw a full editor: manual selection
with handles, cut to clipboard, paste at a centerline, undo, redo, and two zoom
levels. That settles it. The editing primitives in `lib/audio/edit.ts` are not
speculative after all.

**Recording inserts, it does not only append.** Verbatim: _"Begins recording @
the centerline — inserts new recording if in the middle of the waveform,
appends new recording if @ the end of the waveform."_ The playhead is fixed at
the centerline and the waveform moves under it on swipe. Today a recording
produces a whole take that replaces the previous one. Under this model a
recording splices into an existing buffer at a position.

**OBS is a template, not the app.** The Book list is user-created — `Book 001`,
`Book 002`, with a `+` to add another — and Tim's own "need" list on page 3 asks
for a _"Template Library — for menu, e.g. OBS, Book of the Bible (tC format)."_
This is issue #20 exactly as filed, and it matches his 2026-08-22 note about
"the option to pull in an OBS template, but not default to it."

The same "need" list asks for a **"Share Book" function** — which is issue #18,
the export path that does not exist.

## Taxonomy delta

Page 3 writes the model out directly:

```
Book
 └ Chapter
    └ Segment
       (└ Takes)
```

What is built:

```
Project
 └ Chapter
    └ Section
       └ Segment
          └ Take
```

Two differences, one cosmetic and one structural.

- **`Project` should be `Book`** — user-created and named, created from the
  list screen. Today exactly one project exists and `ensureObsChapter` creates
  it as a side effect of opening a story.
- **`Section` does not exist in Tim's model.** Segments hang off the chapter
  directly. This is the structural one: `Segment.sectionId` and
  `Chapter.sectionIds` both assume the intermediate layer, and the progress
  count on the Book screen (`19/21`) is stated as _"Segments Complete / Total
  Segments in Chapter"_ — chapter-scoped, not section-scoped.

## Screen inventory

### Content Mgmt — new

Nothing like it exists. Expandable book rows, per-book `+` (new chapter) and
share, per-chapter completion count, top-bar `+` (new book) and menu.

### Segments Mgmt — partially exists, different semantics

`SectionBrowser` is the closest thing, but it is image-first for OBS and lists
sections. The mockup lists segments with:

- a **three-state checkbox**: checked = toggled Complete; empty = recorded but
  not toggled; dashed and greyed = not yet recorded, no waveform drawn
- a **simplified waveform** per row for recorded segments
- a **playback position indicator** on that waveform the user can _slide_ to
  scrub, with play starting from the indicator
- a per-row transport that toggles play/pause, or opens the recording UI when
  the segment is empty
- a per-row overflow menu

The three-state checkbox matters: it distinguishes _recorded_ from _finished_,
and the completion count on the Book screen counts the second. `Segment.status`
already exists (`"not-started"` / `"draft"`) and `setSegmentStatus` is already
written — and currently unused, flagged by `knip`. It is the Finished toggle
waiting to be wired.

### On-Screen Recording UI — new, and the largest piece

Header is `Book 001 > Chapter 1 > 3` with the Finished toggle. Below it a
waveform with a fixed centerline, described as _"where the recording + playback
+ insertion (paste, new recording) occur."_ A VU meter strip sits under it.
Five controls:

| Control        | Behaviour                                                                 |
| -------------- | ------------------------------------------------------------------------- |
| Zoom toggle    | 100% in view ↔ 25% in view                                                |
| Selection frame | Shows on-screen selector and a Cut icon; cut sends the selection to the clipboard, drops the frame, and turns on a Paste icon at the centerline |
| Record         | Records at the centerline; toggles to Pause                               |
| Undo           | —                                                                          |
| Menu           | Redo · VU Meter show/hide · Erase Segment (confirm first)                 |

Paste: _"Paste icon appears @ centerline if clipboard is full. Pressing it
inserts clipboard @ centerline. Waveform right of centerline shifts right to
accommodate."_

## What already fits

Better than expected. `lib/audio/edit.ts` has the exact primitive set this
screen needs, and was written for it: `cut` returns both the removed range and
the remainder — explicitly designed as the clipboard — plus `insertAt` for
paste and record-insert, `replaceRange`, `sliceRange`, `concat` and `silence`.
Its header already says _"undo is just keeping the previous buffer."_

Also present: canonical PCM at a single sample rate, peak computation, the take
model, and the storage layer's generic `createProject` / `addChapter` /
`addSection` / `addTake` / `setActiveTake`, which carry no OBS coupling.

## Capability gaps

None of these exist anywhere in `src/`, verified by grep:

1. **VU meter.** No `AnalyserNode`, no time-domain or frequency reads. Needs a
   live input tap during recording, which means a node in `hooks/audio-io.ts`.
2. **Undo / redo.** No stack. `edit.ts` anticipated it; nothing implements it.
3. **Recorder pause / resume.** `MediaRecorder.pause()` is never called.
4. **Insert-record.** Recording currently yields a take that replaces. Splicing
   a new recording into an existing buffer at a sample offset is a different
   save path.
5. **Erase Segment.** No delete path for a segment or its clips.
6. **Waveform interaction.** `components/waveform.tsx` takes peaks and a
   playhead fraction and has no pointer handling at all. Swipe-to-scrub,
   zoom, and a draggable selection with handles are all new.
7. **Share Book.** See #18.
8. **Template Library.** See #20.

## Open questions

These block the pivot to different degrees. Q1 and Q5 change the data model and
the UI respectively; the rest can be assumed and corrected.

**Q1 — Does a segment carry a scripture reference, or is it only an ordinal?**
`SectionRef` is `{ book, scope }` in Scripture Burrito scope grammar, which is
what makes exported audio addressable by other tools. The mockups show bare
numbered segments inside a user-named `Book 001`. If books are arbitrary, the
grammar has nothing to bind to, and the interop question (O6, ADR 0004)
resolves by default to "numbered audio, not addressable Scripture." That is a
consequential default to arrive at silently.

**Q2 — Where do Takes appear?** The taxonomy lists them under Segment in
parentheses, but no screen shows take management. Does re-recording create a
take, or edit the buffer in place? The editor's undo/redo implies in-place; the
data model implies takes. Possibly the per-row overflow menu.

**Q3 — What creates the segments?** `19/21` implies a known total. A template
supplies it for OBS. For a blank book, does New Chapter ask for a count, or are
segments added one at a time?

**Q4 — What does Share Book produce?** MP3s, a zip, a Scripture Burrito? This
is Q1 wearing different clothes: the answer decides whether the output is
interoperable.

**Q5 — Is the zero-text requirement still live?** These wireframes contain a
lot of reading: `Book 001 > Chapter 1`, "New Book", a hamburger menu, an
overflow menu per row. O1 proposed no reading anywhere in the primary path, and
the Nukak observation is the reason. Wireframe shorthand, or a real change of
position?

## What we are not doing yet, and why

The screens are T3 and expected to churn, so building them before the answers
land would be wasted. The parts that do not depend on any answer above:

- Removing the `Section` layer, which the taxonomy settles outright.
- Making Book a user-created entity, which #20 already covers.
- The export path (#18), which Tim's own "need" list asks for.

Everything else waits on Q1–Q5, or on pages 1 and 2.
