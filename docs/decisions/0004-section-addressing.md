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

**Amended 2026-09-25 (reversal of this rationale, not a deletion):** the
"costs nothing" premise assumed the grammar would stay live in `src/`. It did
not — #818/#159 (2026-09-24) found no `src/` caller had ever used it and
moved it to `tests/scope.ts` per AGENTS.md's dead-export rule (see below).
Retrofitting is therefore back on the table as a real cost if #253 needs the
grammar in `src/` again, exactly what adopting it early was meant to avoid.

The grammar is parsed in one place and unit-tested, because a malformed scope
must fail loudly rather than become a plausible-looking wrong reference. It
lived at `src/lib/scripture/scope.ts` until #818/#159 (2026-09-24): no `src/`
caller ever existed, and #253's own text does not name its exports as
consumers, so per AGENTS.md ("an export with no issue behind it does not get
a tag; it gets deleted") the grammar moved to `tests/scope.ts`, kept there
because `tests/obs-catalog.test.ts` uses it as a real helper against
`obsFrameScope`'s output. #253 can reintroduce a `src/`-side version if the
Template Library actually needs one.

## Rejected: make "Section" a pluggable division scheme

The requirements owner's inception notes sketch a fixed hierarchy:

```
Book → Chapter → Section → Segment → Take
```

This repo implements that hierarchy faithfully, because it is the requirements
owner's spec and changing it is that owner's call, not engineering's.

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

**What we would change if the requirements owner agreed:**

```
Project (division scheme)
└─ Passage        ← unit of work; produced by the scheme; carries {book, scope}
   └─ Recording   (purpose, status)
      ├─ Section[]  (ordered, reorderable, individually re-recordable)
      ├─ Marker[]   (ms offsets; mirrored into WAV cue points on export)
      └─ Take[]
```

**Decided 2026-08-22 by the requirements owner: no.** Asked directly what
divides a book that is not OBS, the answer was that Scripture passages fit the
Book → Chapter → Segment (→ Take) taxonomy, either tied to the biblical canon or
as a collection of stories.

And, on whether segments carry references at all: a segment is not wired to a
Scripture reference, an OBS frame or anything else, but it can accommodate them.
The structure is generic, intended to shape the UI for any resource that can use
the Book → Chapter → Segment (→ Take) taxonomy. This is not an "OBS recorder" or
"Scripture recorder" app; it is an "audio notebook and pencil" app that needs
just enough structure to accommodate both OBS and Scripture.

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
goes with the OBS framing. See `docs/design/pivot-plan.md`.
