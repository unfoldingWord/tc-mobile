# 0004 — Address sections with Scripture Burrito scope strings

**Status:** Accepted (narrow part) · Proposed (broad part, needs Tim's decision)
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

## Proposed: make "Section" a pluggable division scheme — NEEDS A DECISION

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

**Decision needed from Tim before this is built out.** The current model is not
wrong for Phase 1 — it just makes the OBS-vs-pericope case more work later.
