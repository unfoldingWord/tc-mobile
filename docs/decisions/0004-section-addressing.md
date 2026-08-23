# 0004 — Address sections with Scripture Burrito scope strings

**Status:** Accepted (narrow part) · **Rejected** (broad part) · Amended 2026-08-23
**Date:** 2026-08-22

## Accepted: scope strings, not a bespoke chapter/section pair

`SectionRef` was originally `{ book, chapter: number, section: number }`. It is
now `{ book, scope: string }` using the Scripture Burrito ingredient-scope
grammar — `""`, `"2"`, `"2-4"`, `"2:1"`, `"2:1-13"`, `"2:1-3:4"`.

**Why:** that grammar is what the audio interchange standard actually keys on,
and section-granular scopes are already emitted by shipping software — SIL's
Audio Project Manager splits Ruth 2 into `"2:1-13"` and `"2:14-22"`. tC Mobile's
section granularity is therefore already legal burrito. Adopting the grammar
now costs nothing; retrofitting it later is a data migration.

The grammar is parsed in one place, `src/lib/scripture/scope.ts`, and
unit-tested, because a malformed scope must fail loudly rather than become a
plausible-looking wrong reference.

## Rejected: make "Section" a pluggable division scheme

Tim's inception notes sketch a fixed hierarchy:

```
Book → Chapter → Section → Segment → Take
```

This repo implements that hierarchy faithfully, because it is Tim's spec and
changing it is his call, not ours.

**However**, Shema Studio — which has already shipped essentially all of tC
Mobile's v1 feature list — models it differently, and the difference looks
important. In Shema, a recording binds to a **Passage**, and _how a book is
divided into passages_ is a separate, pluggable dimension: BSB pericopes,
FIA pericopes, chapter, project-defined sections, or user-custom
(docs/research/prior-art.md §1).

**Why it may matter here:** the notes call for both "OBS frames" and "Bible
pericope" as section types. A fixed `Chapter → Section` parent-child forces
those to be two different shapes. A division scheme layered over the book makes
them one shape with two schemes — and maps directly onto burrito scope strings.

**What we would change if Tim agrees:**

```
Project (division scheme)
└─ Passage        ← unit of work; produced by the scheme; carries {book, scope}
   └─ Recording   (purpose, status)
      ├─ Section[]  (ordered, reorderable, individually re-recordable)
      ├─ Marker[]   (ms offsets; mirrored into WAV cue points on export)
      └─ Take[]
```

**Decided 2026-08-22 by Tim: no.** Asked directly what divides a book that is
not OBS, he answered:

> "Scripture passages will fit the B → C → S (T) taxonomy, either tied to the
> Biblical canon, or as a collection of stories."

And, on whether segments carry references at all:

> "A segment is not wired to a Scripture reference or an OBS 'frame' or anything
> else... but it can accommodate them. The structure is generic, intended to
> shape the UI for any resource that can use the Book → Chapter → Segment
> (→ Take) taxonomy. This is not an 'OBS recorder' or 'Scripture recorder' app.
> It is an 'audio notebook and pencil' app that needs just enough structure to
> be able to accommodate both OBS and Scripture."

One generic taxonomy, no second dimension. A pluggable division scheme solves a
problem this product does not have: OBS frames and Bible pericopes are both
just segments, and the difference between them is what a template puts in them,
not a different shape.

**What this changes in the accepted half.** Scope strings stay — they are still
the right way to say "this segment is Ruth 2:1-13" when something knows that.
But they become **optional metadata**, not the addressing model. A segment
created by hand carries no reference and is identified by its ordinal within
its chapter. `SectionRef` should therefore be nullable on the segment rather
than required, and export must be correct for a book that has no references at
all.

**The consequence, stated rather than discovered later:** a book the user made
up exports as ordered audio with no scripture addressing. Only a
template-derived book carries references that another tool could resolve. That
is the right trade for an audio notebook, and it is also the quiet resolution of
the interop question — worth naming here so nobody later mistakes it for an
oversight.

**Also settled by the same conversation:** the `Section` layer is removed
entirely. The 19 Aug spec had `Chapter → Section → Segment`; the 22 Aug mockups
have `Chapter → Segment`. Section was the OBS-story / pericope layer, and it
goes with the OBS framing. See `docs/design/mockups-gap-analysis.md`.
