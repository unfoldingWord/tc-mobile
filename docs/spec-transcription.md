# translationCore Mobile — Initial Inception (transcription)

> Source: `A06-tC-Mobile.pdf` in this directory — 1 page of handwritten notes by Tim Jore, dated **19 Aug 2026**.
> The PDF is image-only — `pdftotext` returns nothing. This file is a manual transcription
> so the content is greppable. **Verify against the PDF before relying on any detail.**
> Items marked `[?]` were ambiguous in the handwriting.
>
> Companion to [`spec-transcription-p3-p4.md`](./spec-transcription-p3-p4.md),
> which transcribes pages **3 and 4** — the screen mockups, 22 Aug 2026.
> Several lines below have since been superseded. **The transcription is left
> exactly as Tim wrote it**; what changed is listed at the end of this file.

## Context

Nukak(?) training workshop #2

- No "pencil + paper" for oral communicators → **functional need**
- uW needs presence in OBT context → **strategic need**

Margin note: _"for uW NB:"_ (annotation next to Design Criteria)

## Design criteria (Phase 1)

- Oral communities need a **turnkey simple** audio recorder / editor
  - standalone, mobile (Android + iOS), **offline**, oral
- Visual **interface** — low/no text (icon driven — _"World's Simplest Mobile Audio Notebook / Editor"_)
- **Functions** — record passage, edit recording, manage sections of a recording, export to MP3
- **Waveform editing** (v1)
  - playback marker
  - edit window — cut
  - edit marker — paste
  - insert (Shema[?])
- Flexible + consistent **structure** for recordings:
  - **(A) Book** = collection of Chapters _(Resource? Collection? Project?)_
    - **(1) Chapter** = collection of Sections (stories, pericopes) — **ordered**
      - **(a) Segment** = contiguous speech unit (frames, spans / verses)
        - **(1) Takes**
- **Section-by-section** (UX), **vertical scroll** — OBS frames, Bible pericope
  - granular to section: editing, re-recording
  - ordered "by B:C:S" (book:chapter:section)
  - Margin annotation with arrow pointing at this bullet: **"the work happens here"**
- **Export** recording to MP3 — concatenation of sections

## Phase 2+

- Iterative (re)publishing w/ versioning
- Attach notes / comments (audio) **w/ export**
- Import / export other formats (Render, Shema[?], etc.)

## Constraints stated outside the PDF (from Zulip thread, quoted by the user)

- Wants a **PWA** that is easy to test on a phone.
- UI is expected to need "lots of changes" — direction not yet known. Treat v1 UI as disposable.
- Target: **in production by end of September 2026**.
- Driving event: most important E. Africa training to date, **first week of October 2026**.

## What has since been superseded — 2026-08-24

The page above is 19 Aug 2026 and is not edited to match later decisions. This
is what has changed since, so nobody builds from a line that no longer holds.
The plan of record is [`design/pivot-plan.md`](./design/pivot-plan.md);
[#25](https://github.com/sethstoll3/tc-mobile/issues/25) tracks it.

- **The structure loses a level.** Page 1 has Book → Chapter → **Sections** →
  Segment → Takes. Pages 3–4 show no Section level and ADR 0004 rejects it, so
  the taxonomy is `Book → Chapter → Segment (→ Take)`. Removing Section from
  the model is B1 (#27).
- **"Section-by-section" is segment-by-segment.** Not a rename: the Section
  level is removed, and the unit-of-work role moves down onto the Segment level
  that already exists beneath it. The margin annotation still points at the
  thing a translator records in one pass — that is now a segment.
- **Takes are out of Phase 1** (A2). `Take` stays in the schema, hidden and 1:1
  with its segment (D1), because Phase 2 brings takes back. There is no take
  list and no take screen.
- **Ordering "by B:C:S" is not the spine.** ADR 0004 keeps Scripture Burrito
  scope strings for a segment that _has_ a reference, but a segment with no
  reference is the normal case (A1): a Scripture or OBS reference is optional
  metadata a template may attach.
- **Export is Share, and it is MP3 plus zip** (A4). Share Chapter concatenates
  a chapter's segments into one MP3 and hands it to the OS share sheet; Share
  Book zips the chapter MP3s. Scripture Burrito is not in Phase 1. None of it
  is built — there is no export path at all (#18) — and B7 (#33) is where it
  lands.
- **"Low/no text" is an aspiration, not a constraint** (A5). Minimal text is
  fine for Phase 1, to be tested rather than designed against.
- **The waveform editing list stands.** Playback marker, cut, paste, insert are
  all in the mockups, drawn as a fixed centerline with a selection frame. B5
  (#31) builds them; today none of that UI exists.
