# 0008 — Waive append-only for the pivot's one-time destructive recreate

**Status:** Accepted · **Date:** 2026-08-25 · **DRI:** the maintainer

Supersedes the append-only requirement stated for B1 in
[#27](https://github.com/unfoldingWord/tc-mobile/issues/27) ("Migration is still
required and still append-only") **for the v2→v3 transition only**. Append-only
discipline resumes from v3 onward.

## Context

The pivot (docs/design/pivot-plan.md) reshapes the IndexedDB schema: `Section`
is removed, `projects`→`books`, `segments` re-index on `chapterId`, and the
never-written `media` store is dropped. #27 called for this as an append-only,
data-preserving migration, on the standing rule that this database is the
system of record and a field device's recordings are unrecoverable.

## Decision

For v2→v3 only, the upgrade is a **one-time destructive recreate**: it drops
every existing store and rebuilds the pivot schema from scratch. No v2 data is
migrated.

This is a DRI decision (2026-08-25), taken on the review of PR #57 where
Frank raised the data loss as a P1 against #27's written stance. It is recorded
here — not only in a `db.ts` comment — because a code comment cannot waive a
repository rule; the authority is this decision.

## Why this is safe now, and only now

- **The app is pre-alpha with no field data.** The only v2 databases in
  existence hold the DRI's own dev/test recordings (one phone, staging). There
  are no users and no field recordings to lose. This is the cheapest moment a
  schema change will ever cost, and the pivot plan already named it as such.
- **A data-preserving migration would be ceremony for data that will never
  exist** — the "no speculative work" half of the engineering bar. Writing and
  testing a Section-flattening transform to protect throwaway dev recordings is
  work spent on a case that cannot arise in the field.

## Consequences

- `DB_VERSION` is 3. The recreate is gated on `oldVersion < 3`, so a future v4
  runs only its own additive step and never re-wipes real translator data —
  append-only holds from here.
- `DB_VERSION` must never be reset to 1: dev devices hold v2 and IndexedDB
  refuses to open at a lower version.
- `tests/db-migration.test.ts` asserts the destructive behaviour on purpose. It
  is testing an **intentional one-time pre-alpha wipe**, not endorsing data loss
  as a pattern — the comments there say so.
- This waiver does not generalise. Any schema change once there is field data
  owes a real migration path; that is the standing rule this ADR suspends for a
  single, named transition.
