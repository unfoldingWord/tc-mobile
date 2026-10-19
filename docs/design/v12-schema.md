# Design: the v12 schema freeze (#1461)

**Status:** frozen for the migration (#1462) and its write paths (#1463), pending
merge of this document · **Date:** 2026-10-19 · **Tracking:**
[#1461](https://github.com/unfoldingWord/tc-mobile/issues/1461), lead issue
[#174](https://github.com/unfoldingWord/tc-mobile/issues/174)

> **This document is planning output.** Nothing in `src/` or `tests/` changed
> to produce it. Every file:line below was read at develop `3ebd6b97`. No
> device has run anything described here. Inference is labelled as inference.

## Why this document exists

v12 is one migration over recordings that cannot be made again. Its design is
spread across #174's comments (2026-09-03 proposal, 2026-09-28 and 2026-10-19
DRI picks), the v2 scope crawl, and the v2 decisions. Several fields the
2026-09-03 proposal named were later replaced by DRI picks. This document puts
the result in one place, so the migration author builds from it and does not
re-decide anything.

## Decisions that govern it (verbatim)

- **Q4-chapters:** "Yes: a segment stores a start and an end chapter:verse".
- **D5-licence:** "Books made from a template are CC BY-SA 4.0; other books
  choose". Tim's note: "All OBS recordings are CC BY-SA 4.0 (as per the
  license); recordings of Scripture propose CC BY-SA 4.0 as the default".
- **Q11-backup:** "Default to including everything, all metadata, in a
  Scripture Bundle format with a robust manifest. We can process it later."
- **P4-dataset-home:** "Its own Servant.Bible repo and owner; tC Mobile reads a
  published template package".
- **#174, 2026-09-28:** D1 "Include it now (Recommended)"; D2 "Exclude it,
  reference clipData (Recommended)".
- **#174, 2026-10-19, amending those two for v12:** pending takes "Amend: base =
  stored | inline (Recommended)"; deletions "Yes, a tombstone store
  (Recommended)", recorded as "no `deletedAt` column, no take timestamps".

## The field list

Types live where the onion puts them: pure types in `src/types/`. The two
template types belong to #1465 (`src/types/template.ts`); if #1462 merges
first, it creates them and #1465 extends the file.

```ts
// src/types/template.ts (owned by #1465)
export type TemplateKind = "obs" | "bible-book" | "collection";
export interface TemplateRef {
  readonly id: string; // stable forever: "obs", "bible:MRK", "collection:<slug>"
  readonly version: string; // the package's content version (semver)
  readonly kind: TemplateKind;
}
/** SPDX ids where one exists; all-rights-reserved has none. */
export type LicenceId =
  | "CC-BY-SA-4.0"
  | "CC-BY-4.0"
  | "CC0-1.0"
  | "all-rights-reserved";

// src/types/domain.ts (changed by #1462)
export interface SegmentRef {
  readonly book: string; // USFM code, or "OBS" (story:frame as chapter:verse)
  readonly startChapter: number;
  readonly startVerse: number | null; // null = whole chapter(s)
  readonly endChapter: number;
  readonly endVerse: number | null;
}
export type BookProvenance =
  | { readonly kind: "blank" }
  | {
      readonly kind: "template";
      readonly template: TemplateRef;
      readonly attribution: string; // snapshot at creation
    };

Book    += provenance: BookProvenance; licence: LicenceId | null;
           modifiedAt: number;
Chapter += createdAt: number | null; modifiedAt: number;
           templateKey: string | null; sourceNumber: number | null;
Segment += createdAt: number | null; modifiedAt: number;
           templateKey: string | null;
           (reference keeps its name; its type is the reshaped SegmentRef)
Take    unchanged
```

### New stores

```ts
// tombstones: out-of-line autoIncrement key, no index
export interface Tombstone {
  readonly entity: "book" | "segment";
  readonly entityId: string; // the deleted row's id
  readonly parentId: string | null; // null for a book; the chapterId for a segment
  readonly deletedAt: number;
}

// pendingTakes: keyPath "segmentId", no index
export interface StoredPendingTake {
  readonly segmentId: SegmentId;
  readonly ordinal: number | null;
  readonly clipId: ClipId; // the clip id the save will write
  readonly base: PendingTakeBase;
  readonly recorded: ArrayBuffer; // Int16 PCM, copied through a fresh buffer
  readonly sampleRate: number;
  readonly offset: number;
  readonly finished: boolean;
  readonly editOnly: boolean;
  readonly createdAt: number;
}
export type PendingTakeBase =
  | {
      readonly kind: "stored";
      readonly clipId: ClipId;
      readonly generation: number;
      readonly frameCount: number;
    }
  | { readonly kind: "inline"; readonly samples: ArrayBuffer };
```

`TcMobileDb` gains `tombstones: { key: number; value: Tombstone }` and
`pendingTakes: { key: SegmentId; value: StoredPendingTake }`. A fresh install
then has nine stores.

### Why each field has the shape it has

- **`provenance`** (J1, below) records how the app made the book, not what was
  typed into it. A non-null union, so a reader never meets `undefined` or
  `null` — the rule the v5, v8, v9 and v11 backfills follow
  (`src/types/domain.ts`, `Book.coverColourKey` and `Book.shelfPosition`
  docblocks). `attribution` is a snapshot: a later package version may reword
  it, and export (ADR 0006, implication 1) needs the text that applied when the
  book was made. It is a legal notice, not UI copy, so it is not the
  frozen-English problem #169 is about (inference).
- **`licence`** (J2, below) is the one value a share or a backup reads. For a
  template book it is written `"CC-BY-SA-4.0"` at creation. The lock is
  derived from `provenance.kind === "template"`; there is no separate `locked`
  flag. The invariant `provenance.kind === "template"` ⇒
  `licence === "CC-BY-SA-4.0"` is held by the writers (template creation, and
  #1455's licence setter, which refuses a change on a template book) and
  asserted by their tests. `"all-rights-reserved"` has no SPDX id, so it is a
  plain token; the file-name tag ("Mark - Chapter 1 (CC BY-SA 4.0).mp3") is a
  display mapping owned by the share step, not a stored string.
- **`SegmentRef` as numbers.** This is Q4's wording, and the cross-chapter
  question (which chapter shows a segment that runs from Psalm 17 into 18)
  compares `startChapter` and `endChapter` as numbers. The shape is
  `ParsedScope` from `tests/scope.ts:28-34`, so the grammar's tests keep
  checking the same thing. A stored span is exactly what `parseScope` returns
  for a non-empty scope string, so a future `formatScope` round-trips it. The
  whole-book scope `""` is not representable, on purpose: a segment is never a
  whole book. The Scripture Bundle scope string becomes an output, written
  when the export writes ingredients; nothing in `src/` parses one. No stored
  row needs converting: the only writer of `Segment.reference` writes `null`
  (`src/lib/storage/books.ts:901`), and the one branch that wrote a non-null
  reference (draft PR #257) closed unmerged. This revises ADR 0004's accepted
  "scope strings, not a bespoke pair" for storage while keeping its point,
  "speak the Bundle grammar on export"; #1462 amends ADR 0004 to say so.
- **`templateKey`** on chapters and segments is the package's own stable key
  ("01", "01-07", "MRK.1.1-8"), or `null` on a blank book. It lets a title be
  rendered at read time in the phone's language, the way `Book.name`/`number`
  already avoid frozen English (v10), and still allows writing a title into
  `Chapter.name`/`Segment.label`. Either answer to "store the words or render
  them" fits with no further schema change. A collection's intro segment has
  `reference: null` and still needs a title, which is why this is a separate
  field.
- **`Chapter.sourceNumber`** (nullable) is the number the chapter stands for in
  its source: the Bible chapter, the OBS story, or a number the translator
  typed. `Chapter.number` stays the position it is today (`books.ts:588-609`),
  so export file names and reorder do not change. It serves either answer to
  #1272 (R7): if the typed number is kept, Add-chapter writes it; if not, only
  template creation does. No v13 either way. It is kept even though
  `templateKey` could look it up, so an exported book is readable without its
  package (inference).
- **`createdAt: number | null`**, backfilled `null`. A pre-v12 chapter's or
  segment's true creation time is unknown; stamping the upgrade time would
  write a false fact into the manifest Q11 asks for.
- **`modifiedAt: number`** (J6, below), backfilled with the upgrade time `T`.
  That is an upper bound: a backup or a sync treats every old row as "changed
  no later than T", which is the safe direction.

### The tombstone store

Each delete writes one row in the **same** transaction as the delete:
`deleteBook` writes `{entity: "book", entityId, parentId: null}`, which implies
the book's chapters, segments and takes; `deleteSegment` writes
`{entity: "segment", entityId, parentId: chapterId}`.

- **A tombstone is written only when the row was there and is removed.**
  `deleteSegment` already returns early when the segment is gone
  (`books.ts:1116-1120`); `deleteBook` deliberately runs its cascade even with
  the `books` row missing (`books.ts:446-453`), to reclaim an orphaned tree. In
  that case it writes no tombstone, because no book was deleted by this call.
  A repeated delete therefore writes no second row.
- **An autoIncrement key, not the entity id.** The store is a log: insertion
  order is deletion order, and nothing in v2 looks a tombstone up by id. A
  keyed store would make a second delete silently overwrite the first one's
  `deletedAt`.
- **No index.** There is no reader in v2 unless backup (E7) or sync (E11)
  reads the store; an index with no reader is the speculative structure
  AGENTS.md "No sprawl" forbids, and adding one later is a version bump that
  creates an index, not a backfill of the audio.
- **No chapter or take kinds.** No `deleteChapter` exists. Takes are hidden and
  1:1, and every re-record deletes one, so take tombstones would grow without
  limit and mean nothing to a person. Adding a member to `entity` later is a
  type change, not a version bump: IndexedDB does not know a value's type.
- **Growth:** one small row per deletion a person makes; no cap is planned.

### The pending-takes store

The 2026-10-19 amendment: the base is `stored` when the editor's buffer is the
stored clip unchanged, and `inline` otherwise. The three cases that make
`stored` wrong:

1. **Edits this session.** The splice base is the editor's working buffer,
   "any cut/paste this session came first"
   (`src/components/recorder.tsx:2532-2535`). The stored clip lacks those
   edits, and `offset` was measured against the working length.
2. **Edit-only saves.** `recorded` is empty and the whole edited buffer is in
   `existing` (`src/lib/takes/pending-take.ts:84-90`), so nothing in
   `clipData` holds it.
3. **A Finished segment's clip is an MP3.** The editor holds decoded PCM; a
   replay would decode again, and nothing guarantees the same sample count.

Shape calls inside that decision (tactical, made here):

- **`stored` carries `generation` and `frameCount`.** A transcode keeps the
  clip id and bumps `generation` (`src/lib/storage/transcode.ts:189`). If a
  segment's PCM clip is transcoded between the pending write and the replay,
  `clipData` under that id is an MP3, and splicing it as PCM corrupts the
  audio. The replay must check that `clipMeta` exists for `clipId`, is
  `"pcm"`, and matches both numbers. A base that fails the check is never
  spliced; what the recovery screen offers instead is #38's call.
- **A first take writes `inline` with an empty buffer**, not a third kind:
  zero bytes, and the union stays the two the DRI picked.
- **`sampleRate` is stored.** The save path uses `CANONICAL_SAMPLE_RATE`
  (`src/hooks/use-save-take.ts:4`, `:86`), and the 22 050 Hz mitigation is
  deferred, not rejected (AGENTS.md "Known open items", 2). A row written under
  one rate must not be replayed under another after an update.
- **`recorded` and `inline.samples` are `ArrayBuffer`s copied through a fresh
  buffer**, the `clipData` precedent: `saveTake` does the same so a trimmed
  view does not serialise its whole backing buffer (`src/lib/storage/takes.ts`,
  `saveTake` docblock).
- **Not stored:** `state`, `kind`, `attempts`. They describe the current
  session's save attempt, not the audio.
- **keyPath `segmentId`:** the app holds one save slot
  (`src/hooks/use-save-take.ts`), and a retry for the same segment must
  overwrite, not duplicate.

The 2026-09-03 limits stand and belong to #38: on a quota failure this write
usually fails too, so the store protects the kill-and-relaunch case, not the
quota case; and the write is best-effort and must not delay or gate
`saveTake`.

## The judgments

Each is either decided here, with the reason, or listed under "Open for the
DRI". The test: a shape call inside recorded decisions is tactical; a product
call or a change to a DRI pick is not.

- **J1 — provenance is a non-null union, backfilled `{kind: "blank"}`.
  Decided (tactical).** "Blank" is true of every book on a phone today: no
  shipped build has a template writer (`books.ts:901`; #257 unmerged). A
  facilitator who typed OBS story 1 into a blank book by hand still has a
  `blank` book; its licence is theirs to choose under D5.
- **J2 — licence is stored per book; no history of shares. Decided
  (tactical).** D5's lock is a property of the book; Q11's backup and the
  export need a licence on the book, which a per-share-only choice would not
  leave; the file-name tag reads one value at share time. Whether the share
  step asks every time or once per book is a UI question that does not change
  storage (it stays with the share work). Backfill `null`, "not chosen yet".
  What a _new_ non-template book is written with is a product question; see
  "Open for the DRI".
- **J4 — no new field on `Take`. Decided by the record.** The 2026-10-19
  tombstone pick was recorded as "no take timestamps". The reason holds in the
  code: a take row is written once (`src/lib/storage/takes.ts:144`, the only
  `takes` put) and a transcode changes only `clipMeta`/`clipData`, so a take
  `modifiedAt` would always equal its `createdAt`.
- **J5b — the `pendingTakes` store is in v12. Decided by the record.** The
  2026-10-19 amendment was made "for the v12 migration", #174's body lists the
  store in the v12 payload, and #38 (its writer) is milestoned Sprint 7, so no
  release ships the store unused for more than one sprint. A new store needs
  no backfill and costs nothing on upgrade (the v6 precedent); adding it later
  would cost a v13 and a second device check. **Stop rule:** if #38 leaves v2
  before #1462 merges, #1462 drops the store and #38 brings its own bump. Once
  v12 has shipped, the store stays (append-only).
- **J6 — the new field is `modifiedAt`, not `updatedAt`. Decided
  (tactical).** `Book.updatedAt` means "activity": reorders deliberately do not
  bump it (`books.ts:750`, `:786`, `:821`; pinned by
  `tests/reorder-storage.test.ts:159` and `tests/books-shelf-order.test.ts:110`).
  The new field means "this row was last written". One name with two meanings
  on adjacent rows is a trap: a backup or sync reader comparing `updatedAt`
  across stores would miss every reorder. A different name makes the
  difference visible at each call site, and the type checker refuses
  `book.modifiedAt` written where `book.updatedAt` was meant, and the reverse.
  No DRI pick named the field; #174's body and the 2026-09-03 proposal said
  `updatedAt`, so the write-back says this departs from their wording.
  - **Meaning, exactly:** every put of a book, chapter or segment row sets
    `modifiedAt` to the write's time, in that same put. A write that puts
    nothing (a rename to the same value, a delete of a missing row) does not
    change it. Renumbering on reorder and delete (`moveChapter`,
    `renumberSegments`), a change to `segmentIds`, a take saved or cleared,
    a Finished toggle, a shelf move and a cover-colour change all put rows, so
    all of them set it. A transcode puts no book, chapter or segment row, so it
    sets nothing.
  - **`Book.modifiedAt` is added for the same reason.** The issue's list put
    the new timestamp on chapters and segments only; with the J6 meaning, a
    book row moved on the shelf (`moveBook`, which leaves `updatedAt` alone)
    would otherwise be the one metadata row whose last write nobody can see.
    It has writers on every book put, so it is not a stub. Backfill `T`, like
    the others. `Book.updatedAt` keeps its meaning and its writers, unchanged.

## Backfill: what every existing row gets

One `if (oldVersion < 12)` block in the one `upgrade` callback
(`src/lib/storage/db.ts`). The version-change transaction is the one
transaction: all of it lands or none of it (the #1421 abort, `db.ts:855-894`).

| Store                               | Field                         | Backfill                                                  | Keyed on                      |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------- | ----------------------------- |
| (structure)                         | `tombstones`, `pendingTakes`  | `createObjectStore`, beside v6's create, before any await | `oldVersion < 12`             |
| books                               | `provenance`                  | `{ kind: "blank" }`                                       | `!("provenance" in row)`      |
| books                               | `licence`                     | `null`                                                    | `!("licence" in row)`         |
| books                               | `modifiedAt`                  | `T`                                                       | absent or not a finite number |
| chapters                            | `createdAt`                   | `null`                                                    | `!("createdAt" in row)`       |
| chapters                            | `modifiedAt`                  | `T`                                                       | absent or not a finite number |
| chapters                            | `templateKey`, `sourceNumber` | `null`                                                    | `!(key in row)`               |
| segments                            | `createdAt`                   | `null`                                                    | `!("createdAt" in row)`       |
| segments                            | `modifiedAt`                  | `T`                                                       | absent or not a finite number |
| segments                            | `templateKey`                 | `null`                                                    | `!("templateKey" in row)`     |
| segments                            | `reference`                   | untouched (every stored value is `null`)                  | n/a                           |
| takes, clipMeta, clipData, failures | —                             | not read, not written                                     | n/a                           |

Rules the migration holds:

- **Append-only.** No store is dropped, no field renamed or removed, no
  existing value rewritten.
- **Idempotent, keyed on absence.** Every field is written only when it is
  missing. For a nullable field, "missing" is `!(key in row)`: a value test
  (`row.x == null`, `!row.x`) reads a deliberate `null` as missing. The
  `modifiedAt` test also treats a non-finite value as missing, the v11
  `shelfPosition` precedent (`db.ts:737-754`).
- **One put per row at most, and none for a row that needs nothing.** The
  fields a row lacks are added in one `cursor.update`; a row that already
  carries every v12 field is not written.
- **Cursor walks** for books, chapters and segments, one row at a time, as v5,
  v8 and v9 do. Segments are the largest metadata store on a phone; the
  `getAll` that v10 and v11 use was argued for `books` only (inference on
  memory).
- **One `T`.** `Date.now()` is read once, before the first walk, so every row
  of one upgrade carries the same upper bound. `Date.now()` is not a DOM API;
  `lib/` may use it.
- **Structure first.** Both `createObjectStore` calls sit with v6's
  `failures` create, before any await (`db.ts:556-577`, "ORDER IS
  LOAD-BEARING"); the backfill block goes after v11's.
- **Creators change in the same PR**, because the fields are required and
  TypeScript forces it: `createBook` writes `provenance: {kind: "blank"}`,
  `licence` per the open question below (default `null`) and `modifiedAt`;
  `addChapter` and `addSegment` write `createdAt` and `modifiedAt` as the write
  time and `templateKey: null` (and `sourceNumber: null` for a chapter).
  Bumping `modifiedAt` and writing tombstones on the other write paths is
  #1463, and must ship in the **same release** as #1462, so no promoted build
  stamps `modifiedAt` once and then leaves it stale.

## What v12 deliberately does not carry

Each item below has no writer in the release that ships v12. Each would be a
v13 if a writer appears, and only then.

- **The microSD clip location** (backup epic). A v13 only if that epic proves
  a writer.
- **A normalization stage id or version on `ClipMeta`** (#1433). A v13 only if
  the loudness work proves a writer.
- **A store for downloaded template packages.** Packages can live in Cache
  Storage or OPFS, which need no `DB_VERSION` bump (inference).
- **A `deletedAt` column, and timestamps on takes** (the 2026-10-19 pick).
- **A history of shares or licence changes** (J2).
- **A licence on header images.** Q13 says images generated on the app are
  CC0 and preferably embedded in the MP3; that is not a book field.
- **Verse parts** ("3a"). See "Risks".
- **Indexes on the new stores.**

A new **store or index** needs a version bump. A new **member of a value
union** (`LicenceId`, `TemplateKind`, `Tombstone.entity`) does not.

## Downgrade: roll forward only

Once a phone has opened the v12 build, older code cannot open its database: a
Worker rollback, a stale service worker, an older APK or an older TestFlight
build. `getDb()` rejects with `DatabaseDowngradeError`, nothing is written
(`db.ts:247-254`, `:943-965`), and the database panel shows `dbOutOfDate` and
`dbOutOfDateTeach`. The recordings are safe but out of reach until a v12 build
is served or installed again. Uninstalling deletes them.

On Android, a lower `versionCode` will not install over a newer one
(`docs/native/README.md` §5a), so a native rollback is a new build with a
higher `versionCode`, never a reinstall. Whether a tester can pick an older
TestFlight build on iOS was not checked here.

**The migration PR body must say:** "v1.2.0 raises the schema 11 → 12. Roll
forward with a fix; do not roll back. Tell facilitators never to uninstall to
clear the 'out of date' screen." It must not claim that any device has seen the
v12 panel.

**The migration PR must update these living sentences** (named here, not edited
here):

1. `AGENTS.md`, "Confirming a deploy and rolling one back", the paragraph "A
   rollback is not free once a phone has opened a build with a newer database
   schema": "v1.1.0 is the current instance: it moves the schema from 9 to 11
   (v10 and v11 in #1346 and #1367)." In the same paragraph, "The Node run that
   showed this (staging's `db.ts` against a v11 database) is the only run; no
   device has seen it." stays a statement about v11 or is deleted; it is not
   restated with a v12 run (AGENTS.md: a run's output belongs in a PR comment
   or the progress tracker). "On staging (`3b5e098d`, schema 9)" names a build
   and stays.
2. `docs/release/promotion-v1.0.0.md` §5: "v1.1.0 moves the schema from 9 to
   11."
3. `docs/training/facilitator-runbook.md`: "Once a phone has updated to 1.1.0,
   do not put an older build back on it." and "until a 1.1.0 or newer build is
   installed over it", with its source comment "src/lib/storage/db.ts
   DB_VERSION 11".
4. `src/lib/storage/db.ts`'s header docblock gains a "v12" section, and the
   `SegmentRef` docblock in `src/types/domain.ts` stops describing a scope
   string.
5. `docs/decisions/0004-section-addressing.md` gains an amendment for the
   numeric span.

## Red-first test plan

Node unit tests over `fake-indexeddb`. Red first: set `APP_VERSION` to 12 in
`tests/db-migration.test.ts:16`, `tests/db-upgrade-throw.test.ts:24` and
`tests/db-open.test.ts:20`, add the v11 → v12 cases before the step exists, and
watch them fail. Each mutation below must be killed by the named test; the PR
body records which test died.

**Migration (#1462):**

| Id  | Mutation                                                                                                   | Killed by                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Stamp `createdAt: null` with no absence check                                                              | "leaves a row that already carries createdAt alone" (seed `createdAt: 5`)                                                                       |
| M2  | Test a nullable field's absence by value (`row.templateKey == null`) instead of `in`, then restamp the row | "a row carrying every v12 field, nullable ones `null`, is left identical" (seed `createdAt: 5`, `modifiedAt: 7`, `templateKey: null`)           |
| M3  | Move `createObjectStore("tombstones")` below the first cursor                                              | `refuseStructureChangeAfterYield` (`tests/db-migration.test.ts:630`), extended to assert both new stores on a fresh install and on a v3 upgrade |
| M4  | Delete the segments walk                                                                                   | the v11 → v12 segment case                                                                                                                      |
| M5  | Touch `clipMeta` (spread and put)                                                                          | the whole-shelf byte and row identity (below)                                                                                                   |
| M6  | Remove the #1421 abort                                                                                     | `tests/db-upgrade-throw.test.ts`'s `describe.each` (`:123`), extended with `{ from: 11, step: "v12" }` and a fault on the Nth `segments` put    |
| M7  | Backfill provenance as `{kind: "template", …}`, or omit it                                                 | the whole-shelf `provenance` assertion                                                                                                          |
| M8  | `pendingTakes` keyPath `clipId`                                                                            | "two puts for one segment leave one row"                                                                                                        |
| M13 | Read `Date.now()` per row instead of once                                                                  | "every backfilled row carries the same modifiedAt", under a strictly increasing fake clock                                                      |

**Write paths (#1463):**

| Id  | Mutation                                                    | Killed by                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| M9  | Drop one writer's `modifiedAt` bump (`renameSegment`)       | a table-driven test over every write function, asserting which rows' `modifiedAt` moved and that no other row's did |
| M10 | Write the tombstone after `tx.done`, in its own transaction | fault injection: fail the `chapters` put inside `deleteSegment`; no tombstone, segment still present                |
| M11 | Write a tombstone on the already-gone path                  | a repeated delete of a missing id writes no second row (`books.ts:1116-1120`; `deleteBook` with the row gone)       |
| M12 | Bump `Book.updatedAt` in `moveChapter`                      | the existing pin, `tests/reorder-storage.test.ts:159`                                                               |

(M1–M12 come from the v2 scope crawl; M2 is restated here, because the crawl's
wording tested `=== undefined`, which already leaves a deliberate `null` alone.
M13 is new.)

**Also required:**

- A v9 and a v10 shelf each climb to 12 in one open.
- A fresh install opens at 12 with nine stores; both new stores are empty
  after any upgrade.
- **Downgrade, in both states:** a database at 12 holding a real shelf, opened
  by a build at 11, rejects with `DatabaseDowngradeError`; then a raw `openDB`
  with no version shows every row and clip byte unchanged and the stored
  version still 12. The same harness with a database at 11 opens cleanly at 12.

### Narrowing the whole-shelf test, field by field

`tests/db-migration.test.ts:1388-1480` (#1428) asserts
`expect(await snapshotNonBookStores(db)).toEqual(before)`. At v12 it goes red by
design, because every chapter and segment row gains fields. It is narrowed,
not loosened:

1. Add a v11 seed (an `openLegacyV11` beside `openLegacyV10` at `:1057`, books
   carrying `shelfPosition`) and a v11 → v12 case. The v9 and v10 cases climb
   to 12 and get the same narrowing.
2. For every chapter and segment row, first assert its key set exactly:
   `Object.keys(after).sort()` equals the before-row's keys plus exactly the v12
   keys (`createdAt`, `modifiedAt`, `templateKey`, `sourceNumber` for a chapter;
   `createdAt`, `modifiedAt`, `templateKey` for a segment). A missing or extra
   key fails here.
3. Then assert the v12 values exactly: `createdAt === null`,
   `modifiedAt === T` (the fake clock's one reading), `templateKey === null`,
   `sourceNumber === null`.
4. Then remove exactly those keys and compare the rest with `toEqual(before)`.
5. `takes`, `clipMeta` and `clipData` keep the full `toEqual` with no
   projection (M5 dies here).
6. The book rows' `toMatchObject` block (`:1437-1446`) becomes a `toEqual` of
   the whole expected row (seeded fields, the v10/v11 fields, and
   `provenance: {kind: "blank"}`, `licence: null`, `modifiedAt: T`), because
   `toMatchObject` passes an unexpected extra field.
7. `getAll("tombstones")` and `getAll("pendingTakes")` are `[]`.

Not allowed: `toMatchObject`, `expect.objectContaining`, or dropping a store
from the snapshot. Each would let M5 through.

The ~18 test files that build rows by hand need the new required fields; one
shared row builder in `tests/` keeps the template and licence work (#1450, #1455) from editing them all
again (recommendation).

**Device check:** #1464, on the v1.2.0 tester build, before `staging -> main`.

## Risks

- **Verse parts and verse 0.** `startVerse: number` cannot say "3a". If any
  dataset chunk starts mid-verse, or Psalm titles are verse 0, the span needs
  another field: a v13. Not checked; the dataset repo (P4) does not exist yet.
  Before #1462 merges, someone reads the ULT `\ts` chunk boundaries; if a
  mid-verse start exists, this document comes back to the DRI.
- **Upgrade time on a large shelf.** The cursor walks run inside the
  version-change transaction on a low-end phone. No field shelf size is known
  here; the #1428 seed has 36 segments, and a template-made Psalms book will
  have hundreds. #1464 is the only real measure.
- **iOS WebKit.** The structure-before-await rule is enforced by a model of
  WebKit's refusal (`refuseStructureChangeAfterYield`), not by WebKit. #1464 is
  the only real check.
- **Tombstones have no v2 reader** unless backup or sync reads them. D1
  accepted that ("Include it now").
- **A non-null `Segment.reference` on a dev phone** that ran #257's branch
  would keep the old shape, because the backfill leaves `reference` untouched.
  No tester phone is expected to hold one (inference).

## Open for the DRI

Neither item changes the frozen shape, so neither blocks #1462.

1. **What licence does a new non-template book get when it is created?**
   (Tim's call: D5 and his note.)
   - (A) `null` until the person chooses; the share step pre-selects
     CC BY-SA 4.0 as Tim's proposed default. **Recommended:** D5 says "other
     books choose", and a stored value nobody chose would read as a choice in
     a backup.
   - (B) `"CC-BY-SA-4.0"` at creation, changeable until shared.
   - Either way, books that exist before v12 are backfilled `null`. Writing a
     licence onto existing work is a licensing position taken on a
     facilitator's behalf; ADR 0006 records that such positions are not
     engineering's to take quietly.
2. **Who authors the migration.** #174's 2026-10-19 question to
   @deferredreward is still open. This document is shared input; it does not
   take the migration from them.

Not open here, and routed elsewhere: #1272 (R7, chapter numbers) and the title
strategy (store the words or render them). The schema fits every answer to
both.
