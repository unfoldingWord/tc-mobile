# Tim's mockups — what they specify, and what we are missing

**Status:** Answered by Tim 2026-08-22 · **Date:** 2026-08-22, updated 2026-08-23

## What we have

Five hand-drawn wireframes, walked through on 2026-08-22. Three distinct
screens; the editor is drawn three times to show three states.

| Archived as                                                    | Page | Screen                                        |
| -------------------------------------------------------------- | ---- | --------------------------------------------- |
| [`mockup-1-content-mgmt.png`](mockup-1-content-mgmt.png)       | 3    | Content Mgmt — Book / Chapter tree            |
| [`mockup-2-segments-list.png`](mockup-2-segments-list.png)     | 4    | Segments Mgmt — segment list, fully annotated |
| [`mockup-3-recording-base.png`](mockup-3-recording-base.png)   | 4    | On-Screen Recording UI — base state           |
| [`mockup-4-recording-cut.png`](mockup-4-recording-cut.png)     | 4    | Same, with selection frame and cut            |
| [`mockup-5-recording-paste.png`](mockup-5-recording-paste.png) | 4    | Same, with paste at centerline                |

Originals were macOS screenshots; archived here because a wireframe that lives
only in someone's `temp/` folder is not a source anyone else can check.

Page 3 opens with the taxonomy and no preamble, which looked like a
continuation from missing pages. It is not: page 1 of the same notebook is
`docs/A06-tC-Mobile.pdf`, already in this repo and transcribed in
`docs/spec-transcription.md`. Tim exported it separately as a PDF. **Nothing is
missing, and nothing further is sketched.**

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

## Tim's answers, 2026-08-22

All five, verbatim, with what each one changes.

### A1 — segments are generic; a reference is optional

> "No, a segment is not wired to a Scripture reference or an OBS 'frame' or
> anything else... but it can accommodate them. The structure is generic,
> intended to shape the UI for any resource that can use the Book → Chapter →
> Segment (→ Take) taxonomy."

And, clarifying:

> "This is not an 'OBS recorder' or 'Scripture recorder' app. It is an 'audio
> notebook and pencil' app that needs just enough structure to be able to
> accommodate both OBS and Scripture."

**Changes:** `SectionRef { book, scope }` stops being the spine and becomes
optional metadata a template may attach. ADR 0004's accepted half — "address
sections with Scripture Burrito scope strings" — needs revisiting: the grammar
is still the right thing to use _when there is a reference_, but a segment with
no reference is now the normal case rather than a degenerate one. The interop
consequence is explicit rather than accidental: a book the user made up exports
as ordered audio, and only a template-derived book carries addressing.

### A2 — Takes are out of Phase 1

> "In Phase 1, Takes are not supported. We'll figure that out in Phase 2,
> probably with a separate screen (Segment Takes Management, or the like)."

**Changes:** the largest simplification in this document. One recording per
segment, edited in place, which is exactly what a centerline editor with
undo/redo implies. Whether the `Take` record stays in the schema as an
invisible 1:1 or comes out entirely is a real decision — Phase 2 brings takes
back, so removing the layer now means migrating twice, while keeping it means
carrying a layer nothing reads. `DB_VERSION` is 2 and not yet in the field,
which is the cheapest moment either way.

### A3 — segments are added one at a time

> "Ah, I forgot to add the UI for that, but it should be included as (+) button
> in the menu bar of the 'Segments Management 1' sketch above."

**Changes:** no segment count at chapter creation. A `+` in the Segments
Management menu bar appends a segment. Templates supply them in bulk instead.

### A4 — Share is MP3 and zip, not Burrito

> "Sharing needs to happen at the book and the chapter level in Phase 1. 'Share
> Chapter' should concatenate all the segments into a single MP3 which is
> presented to the mobile OS's 'share' sheet. 'Share Book' concatenates all the
> segments for each chapter into MP3s, zips them together and sends the zip to
> the share sheet."

**Changes:** #18 is now fully specified, and Scripture Burrito is not in Phase 1
at all. Two share paths, both ending at `navigator.share`. Adds one dependency —
a zip writer; `fflate` is MIT and is what `tcorePSA` used, chosen there
explicitly for low-end Android. `concat` and `encodeMp3` already exist, and
`resolveChapterClipIds` already walks a chapter in export order.

### A5 — minimal text is fine for Phase 1

> "Zero text is a 'someday, when it's all growed up' dream, but we don't
> actually know if it is realistic. For Phase 1, minimal text is fine,
> especially as we are testing and validating the assumptions on which all of
> this is built."

**Changes:** removes the hardest constraint from Phase 1. O1 treated zero-text
as the thing that should drive every other decision; it is now an aspiration to
be tested rather than a requirement to design against. Breadcrumbs, menus and
labels in the mockups are intended, not shorthand.

## Decisions, 2026-08-23

Taken after the answers above. Each names what it closes.

| #      | Decision                                                 | Consequence                                                                                                                                                                                        |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | `Take` stays in the schema, hidden, 1:1 with its segment | Phase 2's Segment Takes Management is additive. One unused indirection now beats migrating twice against field audio.                                                                              |
| **D2** | Undo is an **operation log**, not buffer copies          | `cut(range)` / `insert(at, clipRef)` replayed from the original. "Undo is just keeping the previous buffer" costs ~16 MB per step on a 3-minute segment; a log costs bytes and survives a restart. |
| **D3** | **MP3 on Finished**                                      | PCM while a segment is being edited; transcode to 64 kbps and drop the PCM when the translator marks it Finished. ~660 MB becomes ~66 MB. Closes the storage strategy in #12.                      |
| **D4** | **MicroSD via the share sheet only**                     | No web API writes to removable media. The OS picker can target the card, so SD is an export destination rather than storage. No wrapper, ADR 0005 unchanged.                                       |
| **D5** | **Reference audio is out of Phase 1**                    | No mockup shows it. The timing seam (ADR 0007) stays built and inert; the narration control comes out of the section view.                                                                         |
| **D6** | **Artwork becomes optional per-segment illustration**    | Supplied by the OBS template rather than defining the browse layout. Picture-navigation survives for non-readers without making the app OBS-shaped. Revisits ADR 0006's image-first grid.          |

### What D3 pulls in

Transcoding on Finished puts the encoder on a user-visible path, which makes
ADR 0003's open item — MP3 encoding runs on the main thread — a blocker rather
than a known nuisance. A Web Worker is now required, not deferred.

### What D2 pulls in

An operation log means edits must be expressible as data: a range and a source.
`lib/audio/edit.ts` already works this way — `cut` takes a range, `insertAt`
takes a position and a buffer — so the log is a record of calls it already
accepts. Recorded inserts reference a clip id rather than inlining samples.

### What D5 and D6 free up — checked, and it is only half

Claimed initially that both #1 and #9 might be resolved by deletion. Checked
against the code; only one is.

**#9 — resolved by deletion.** The finding is that reference audio is an
uncached CDN `<audio>` with its errors swallowed. D5 removes reference audio
from Phase 1 outright, so the narration path goes with it: `narrationUrl` in
`hooks/obs-media.ts`, `startNarration` / `resetNarration` in `hooks/audio-io.ts`,
`toggleReference` in `hooks/use-audio-session.ts`, and the control in
`components/section-view.tsx`. Nothing left to fix.

**#1 — not resolved.** The finding is that the recording view loads artwork from
the CDN rather than the IndexedDB media cache. D6 keeps artwork, as an optional
per-segment illustration supplied by the OBS template — so "load it from the
cache, not the network" survives intact as a requirement. What D6 removes is the
image-first _browse_ (`section-browser.tsx`'s grid-versus-list conditional and
`ChapterCard.thumbUrl`), not the artwork itself.

There is a genuine gap here worth naming: **none of the five mockups shows
artwork anywhere**, including the segment editor. D6 says artwork stays; the
wireframes do not say where it goes. Until that is settled, #1 should be
reworked rather than fixed against a screen that is being replaced.

The image-first grid, the narration control, and the OBS-story browse do all
retire. That part stands.

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

The 19 Aug spec (`docs/spec-transcription.md`) had **both** layers —
`Chapter = collection of Sections (stories, pericopes)` containing
`Segment = contiguous speech unit (frames, spans / verses)`. The 22 Aug mockup
drops Section. That is a deliberate change over three days, and it follows from
Tim's framing: Section was the OBS-story / pericope layer, and this is not an
OBS app.

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

- insertion (paste, new recording) occur."_ A VU meter strip sits under it.
  Five controls:

| Control         | Behaviour                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom toggle     | 100% in view ↔ 25% in view                                                                                                                      |
| Selection frame | Shows on-screen selector and a Cut icon; cut sends the selection to the clipboard, drops the frame, and turns on a Paste icon at the centerline |
| Record          | Records at the centerline; toggles to Pause                                                                                                     |
| Undo            | —                                                                                                                                               |
| Menu            | Redo · VU Meter show/hide · Erase Segment (confirm first)                                                                                       |

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

> **Superseded.** This section is kept as the record of what Tim's answers opened
> up on 22–23 Aug. The live list is **G1–G5** in
> [`pivot-plan.md`](pivot-plan.md), which is the plan of record; its Q6/Q7/Q8 below
> are not the same questions as anything numbered there. Work from the plan.

All five originals are answered above. What Tim's answers open in their place:

**Q6 — does the `Take` record stay in the schema?** A2 removes takes from the
Phase 1 UI, not necessarily from storage. Keeping an invisible 1:1 take makes
Phase 2's Segment Takes Management additive; removing it now means migrating
twice. `DB_VERSION` is 2 and no field data exists, so this is the cheapest
moment to choose either way. **Recommendation: keep the record, hide the
concept** — the cost is one unused indirection, and the alternative is a
migration against irreplaceable audio later.

**Q7 — what does undo operate on?** The editor has undo, redo and destructive
edits over a single buffer. `lib/audio/edit.ts` says "undo is just keeping the
previous buffer," which is true and also means a per-edit copy of the segment's
PCM. At roughly 5.3 MB per minute that bounds how deep the stack can go, which
is a storage question (#12) as much as an editor one.

**Q8 — is reference audio still in Phase 1?** None of the five mockups shows
it, and A1 removes the OBS framing that motivated it. The timing seam (ADR 0007) is built and inert either way, so nothing breaks — but the section view
currently has a narration control that the new screens do not.

## What we are not doing yet, and why

The screens are T3 and expected to churn, so building them before the answers
land would be wasted. The parts that do not depend on any answer above:

- Removing the `Section` layer, which the taxonomy settles outright.
- Making Book a user-created entity, which #20 already covers.
- The export path (#18), which Tim's own "need" list asks for.

Everything else waits on Q1–Q5, or on pages 1 and 2.
