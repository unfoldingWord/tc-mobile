# translationCore Mobile — Initial Inception (transcription)

> Source: `A06-tC-Mobile.pdf` in this directory — 1 page of handwritten notes by Tim Jore, dated **19 Aug 2026**.
> The PDF is image-only — `pdftotext` returns nothing. This file is a manual transcription
> so the content is greppable. **Verify against the PDF before relying on any detail.**
> Items marked `[?]` were ambiguous in the handwriting.

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
