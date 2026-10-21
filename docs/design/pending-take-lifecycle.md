# Design: the pending-take lifecycle (#1564)

**Status:** proposed, for review by both lenses · **Date:** 2026-10-21 ·
**Tracking:** [#1564](https://github.com/unfoldingWord/tc-mobile/issues/1564),
part of [#38](https://github.com/unfoldingWord/tc-mobile/issues/38) · **Builds
on:** [v12-schema.md](v12-schema.md), "The pending-takes store"

> **This document is planning output.** Nothing in `src/` or `tests/` changed
> to produce it, and nothing it describes has been run, in Node or on a device.
> Every file:line below was read at develop `739e18db`. Every test named below
> is a test to write; none exists yet unless it is marked "existing". Inference
> is labelled as inference.

## Why this note exists

PR #1546 built #38 slice 3: on launch, finish a save the app was closed in the
middle of. The bench reviewed it seven times. Each round found a new
interleaving, and each fix added one more guard for one operation: a newer
save between the recipe read and the commit (Frank r1, r2), an old row beside
a newer take (Frank r3), Retry without the condition (Frank r3), a Discard
deleting a clip another copy had made active (Frank r4), a target written
after the row (George r5), a row put that a Discard had already beaten
(George r6), and an erase that the replay could not see (Frank r6, r7).

Frank r7 named the cause. The replay compared `activeTakeId` with the take the
row was written against, and `activeTakeId === null` means both "never
recorded" and "recorded, then erased". His exit condition asked for "a durable
audio revision that changes on saves **and clears**", not another arm.

The DRI's rule when the round-6 fix was picked (verbatim): "if round 7 finds
any High or Medium, the PR is parked. A short design note for the pending-row
lifecycle comes first (one transaction owns read, put and delete ordering),
and the rebuild is a fresh PR." Round 7 found a P2 (Frank) and a Medium
(George). This is that note.

The first two review rounds on this note found the same shape again, in a
second place: four paths read a **missing row** as permission to free a slot
or to save over a kept take (George r1's High and second Medium, Frank r1,
Frank r2). So the note has two primitives, one for each ambiguity:

- **the audio revision** (§1) says whether the segment's audio changed;
- **the take disposition** (§3) says why a take's row is gone.

Neither is inferred from what is missing. The rest follows: the migration that
makes both trustworthy (§2), the one owning transaction (§3), the one verdict
(§4), every state under every operation with a test per cell (§5), every
finding mapped (§6), the follow-ups (§7), the rebuild order and the
compatibility boundary (§8), and what is open (§9).

## Terms

- **Copy:** one running instance of the app (a tab, an installed PWA window,
  a native shell). Two copies on one phone share one IndexedDB database.
- **Slot:** the one take a copy holds in memory (`PendingTake`,
  `src/lib/takes/pending-take.ts:55-95`; held by `useSaveTake`,
  `src/hooks/use-save-take.ts:332-514`).
- **Row:** the take's safety copy in `pendingTakes`, keyed by `segmentId`
  (`src/types/domain.ts`, `StoredPendingTake`).
- **Disposition:** the durable record of why a take stopped being pending,
  keyed by its `clipId` (§3).
- **Hold:** the transaction that writes the row before the save
  (`writePendingTake` today, `src/lib/storage/pending-takes.ts:174-231`).
- **Commit:** the transaction that writes the clip and the take
  (`saveTake`, `src/lib/storage/takes.ts:241-296`).
- **Settle:** a transaction that ends a take's row without a commit: Discard,
  giving the row up after a quota failure, or marking it refused.
- **Ordinary save:** a Save or Retry of a take this copy recorded. It commits
  unconditionally, as today.
- **Conditional commit:** the launch replay's commit, and every Retry of a
  replayed take. It commits only if §4's verdict is `free`.

## 1. The audio revision

### The field

`Segment.audioRevision: number`, stored on the segment row. It starts at `0`
when a segment is created. **It tracks which take is active**: every write
that changes `activeTakeId`, or replaces the active take, moves it. Two reads
with the same value saw the same active take; two reads with different values
did not.

It does not track the clip's bytes. A transcode replaces the active clip's
PCM with an MP3 under the same take and clip id, on purpose without moving
the revision. That case is out of band here, and it is guarded where it
matters, by `generation` at the recipe read of a `stored` base (§3, "The
replay's own reads").

The pending row records the revision its take was made against:
`StoredPendingTake.baseRevision: number`. A conditional commit succeeds only
while `segment.audioRevision === row.baseRevision` (with the rest of §4's
verdict). This replaces the pointer comparison and every exception #1546 built
around it.

### What moves it

Every write that changes the active take, in the transaction that makes the
change, as `audioRevision + 1`:

| Write                           | Where                                               | Moves it                                             |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Save (first take, insert, edit) | `writeTakeInTx`, `takes.ts:121-179`                 | Yes, always                                          |
| Replayed save                   | the conditional commit (§3)                         | Yes, always                                          |
| Erase, and cut-to-empty close   | `clearSegmentTake`, `takes.ts:313-350`              | Yes, when a take was removed; no when none was there |
| Delete segment, delete book     | `deleteSegment`, `books.ts:1186-1260`; `deleteBook` | The segment goes; absence is final (below)           |
| Finished toggle                 | `setSegmentFinished`, `takes.ts:362-400`            | No                                                   |
| Transcode to MP3                | `commitTranscode`, `transcode.ts:143-195`           | No (out of band, above)                              |
| Rename, reorder, cover colour   | `books.ts`                                          | No                                                   |

Why each "no" (tactical, decided here):

- **A clear of an empty segment does not move it.** `clearSegmentTake` is
  documented as idempotent (`takes.ts:309-311`). A no-op erase changes no
  take, and moving the revision would refuse a valid first-take replay for
  nothing.
- **The Finished toggle and the transcode do not move it.** Neither changes
  which take is active.
- **Rename, reorder and cover colour** change no take.

**Delete.** `deleteSegment` and `deleteBook` remove the segment row. Segment
ids are minted by `crypto.randomUUID()` (`books.ts:38`, `:966`) and are never
reused, so a missing segment never comes back: absence is a revision no
pending row can match.

### Why not something already stored

- **`activeTakeId`:** the defect itself. `null` is two states.
- **`Segment.modifiedAt` (v12, J6):** it moves on every put of the row,
  including rename, reorder and the Finished toggle (v12-schema.md, J6
  "Meaning, exactly"), so it would refuse innocent rows. It is a clock value,
  so a clock that steps back can repeat it. It is `null` on every pre-v12 row.
- **A tombstone per erase:** v12 chose no take tombstones, because every
  re-record deletes a take and the log would grow without limit
  (v12-schema.md, "No chapter or take kinds").
- **A sentinel take for "erased":** `activeTakeId !== null` means "recorded"
  across the tree (`books.ts:1309`, `src/types/view.ts:32`, `:85`). A sentinel
  would change that meaning at every reader.

## 2. v13: the migration

### It is a schema step

An optional field that readers treat as `0` when absent needs no version bump
in IndexedDB. It would still be wrong here, because a build that does not
know the field can open the same database and move `activeTakeId` without
moving the revision. A conditional commit would then pass on a segment that
changed. Such builds exist: every build with `DB_VERSION = 12` (develop since
#1462). A copy left open on an older service worker, or a rollback, is the
same case (AGENTS.md, "Confirming a deploy and rolling one back"). The
disposition store (§3) is a new store, which needs a version step in any case.

Raising `DB_VERSION` to 13 shuts the older builds out (inference from
`src/lib/storage/db.ts`):

- an older build gets `DatabaseDowngradeError` and writes nothing;
- an older copy that is open is asked to yield its connection. It refuses
  while it holds unsaved audio (#221, `db.ts`, `blocking()`), and the upgrade
  waits until it lets go.

So after v13, every writer that can change the active take also moves
`audioRevision`, and every act that ends a take's row writes its disposition.
The version bump is what makes both trustworthy. §8, "The compatibility
boundary", says what this requires of the build that brings v13.

**Why not fold it into v12.** v12 is not released: `DB_VERSION` is 11 on
`origin/staging` and 9 on `origin/main` (read with `git show` at the time of
writing). But a develop build may already have opened a database at 12 on a
development machine or a preview origin (inference; not checked), and a
database at 12 never runs a changed v12 step again. Append-only means a step
that may have run is never edited. v12 and v13 can ship in the same release,
so the cost is one more `if` block, and #1464's device check on that release
can cover both (recommendation).

### The step

In the one `upgrade` callback. The store is created with the other
`createObjectStore` calls, before any await (`db.ts`, the "ORDER IS
LOAD-BEARING" block beside v6's and v12's creates); the backfill goes after
v12's block:

```ts
// Structure, before any await:
if (oldVersion < 13) {
  db.createObjectStore("takeDispositions", { keyPath: "clipId" });
  // A row's stored base is a use of its clip (§3). Rows with an inline base
  // have no such key path, so the index holds only stored bases.
  tx.objectStore("pendingTakes").createIndex(
    "bySourceClip",
    "base.sourceClipId"
  );
}

// Backfill, after v12's block. Keyed on absence; no clock; one put per row
// at most. Takes, clips, pendingTakes and takeDispositions are not read.
if (oldVersion < 13) {
  let cursor = await tx.objectStore("segments").openCursor();
  while (cursor) {
    if (!("audioRevision" in cursor.value)) {
      await cursor.update({ ...cursor.value, audioRevision: 0 });
    }
    cursor = await cursor.continue();
  }
}
```

Rules, the same ones v12 holds (v12-schema.md, "Rules the migration holds"):

- **Append-only.** One store and one index are created; none is dropped. No
  field is renamed. No existing value is rewritten.
- **Idempotent, keyed on absence** (`in`, not a value test). A rerun after the
  #1421 abort writes nothing a first run already wrote.
- **No clock read.** `0` is not a time.
- **Every existing segment starts at `0`**, recorded or not. That is safe:
  the revision only has to differ between the two ends of one pending row's
  life, and every row written after v13 reads the value it starts from.
- **The disposition store starts empty.** No take before v13 has one, which
  §4 reads as "unexplained", never as consent (§4).
- **Rows written before v13 have no `baseRevision`.** They come from develop
  builds of #38 slice 2 (`35820cbc`, #1540), which never reached
  `origin/staging` or `origin/main` (the #1546 round-3 triage checked this
  with `git branch -r --contains`). The step does not guess one. The replay
  has exactly one outcome for each such row, decided by its segment (§3,
  "The replay's own reads"): segment gone, cell **DL-P** (the row is
  deleted and reported once); segment present, cell **RP-P**'s `legacy`
  classification (the row is marked, kept and reported once).
- **A row whose `stored` base clip is already gone before v13** cannot be
  protected after the fact. Inference from the code: none should exist,
  because no caller passes the `source` that makes a base `stored`
  (`src/hooks/use-save-take.ts:64` calls `writePendingTake(take)` with no
  options; #1545 is the change that would). If one does, the replay reads it
  as `base-missing`: the row is marked refused, kept with its recorded audio,
  reported once, never installed and never `free` (§3, cell RP-P).
- **Creators write `audioRevision: 0`**: `addSegment` (`books.ts:966-973`) and
  the template writer (`src/lib/storage/template-book.ts:124`). The field is
  required on `Segment`, so TypeScript finds every creator.

### Red-first tests for the step (PR 1)

In `tests/db-migration.test.ts`, with `APP_VERSION` set to 13 there and in
`tests/db-upgrade-throw.test.ts` and `tests/db-open.test.ts` before the step
exists:

| Id  | Mutation                                                | Killed by                                                                                             |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| R1  | Stamp `audioRevision: 0` with no absence check          | "v13 leaves a segment that already carries audioRevision alone" (seed `audioRevision: 5`)             |
| R2  | Delete the segments walk                                | "v12 → v13 gives every segment audioRevision 0"                                                       |
| R3  | Backfill `Date.now()`                                   | the same case, under a fake clock that returns a finite number                                        |
| R4  | Put a changed `takes`, `clipMeta` or `pendingTakes` row | the whole-shelf identity: those stores keep a full `toEqual`, and a segment row gains exactly one key |
| R5  | Remove the #1421 abort                                  | `tests/db-upgrade-throw.test.ts`'s `describe.each`, extended with `{ from: 12, step: "v13" }`         |
| R6  | Create `takeDispositions` after the first await         | `refuseStructureChangeAfterYield`, extended to assert the store on a fresh install and a v3 upgrade   |
| R7  | Omit the `bySourceClip` index                           | "v13 indexes a stored base's clip and leaves inline rows out of the index"                            |

Also: a v11 and a v9 shelf each climb to 13 in one open; a fresh install
opens at 13 with an empty `takeDispositions` and `addSegment` writes
`audioRevision: 0`; a database at 13 opened by a build at 12 rejects with
`DatabaseDowngradeError`, and a raw `openDB` then shows every row and clip
byte unchanged.

### Red-first tests for the revision writers (PR 1)

New `tests/audio-revision.test.ts`, over the real stores:

| Id  | Mutation                                           | Killed by                                                                      |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| W1  | `writeTakeInTx` does not move the revision         | "a save moves the revision by one"                                             |
| W2  | `clearSegmentTake` does not move it                | "an erase that removes a take moves the revision by one"                       |
| W3  | `clearSegmentTake` moves it unconditionally        | "clearing a segment with no take leaves the revision"                          |
| W4  | `setSegmentFinished` moves it                      | "the Finished toggle leaves the revision"                                      |
| W5  | `commitTranscode` moves it                         | "a transcode leaves the revision"                                              |
| W6  | the move is written outside the take's transaction | "a save whose take write fails leaves the revision" (fault on the `takes` put) |

## 3. One owning transaction, and the disposition it writes

### What "one transaction" can and cannot mean

The row exists to survive a kill during the commit. So the row's put cannot
be inside the commit's transaction: a kill there rolls the row back with the
clip. The hold has to commit on its own, before the commit. That fact fixes
the shape.

So the owner is one **transaction scope** that every other step of the row's
life opens, plus the hold, whose scope is a subset of it. IndexedDB
**serializes** read-write transactions whose scopes overlap: one runs to the
end before the other starts. It does not promise which of two copies goes
first. Two copies are two connections, and the specification's ordering by
creation is a property of one connection's queue, not a lock across tabs
(#1536's round-1 review made the same point about call order). So nothing
below depends on which of two transactions runs first. Each step re-reads,
inside its own transaction, everything it decides from. This is the reading
of the DRI's "one transaction owns read, put and delete ordering" that this
note builds on.

### The disposition record

One new store, created by v13 (§2):

```ts
// takeDispositions: keyPath "clipId", no index
interface TakeDisposition {
  readonly clipId: ClipId;
  readonly segmentId: SegmentId;
  readonly kind: "given-up" | "discarded" | "saved";
  readonly at: number; // write time, for the bound below
}
```

- **`saved`:** the take committed (ordinary or conditional).
- **`discarded`:** a person confirmed Discard of that take, in any copy.
- **`given-up`:** a quota failure dropped the take's row. The audio may still
  be needed: some copy may hold it in memory.

**Written in the same transaction as the act that ends ownership**, never in a
second one: the commit writes `saved` with the clip and take; the Discard
settle writes `discarded` with the row delete; the give-up settle writes
`given-up` with the row delete. A kill can therefore never leave a row gone
without the reason, or the reason without the row gone.

**Monotone and idempotent.** A `clipId` is minted once per take
(`newClipId()`, `src/lib/storage/clips.ts:10-12`), so a record never speaks
for two takes. A write of the kind already stored is a no-op. The only
change allowed is `given-up` to `saved` or `discarded`; `saved` and
`discarded` are final, and a later write of any kind over them is a no-op.
So a late or repeated settle can never weaken what is recorded.

**Erase writes no record.** An erase removes a take that committed, so that
take already has `saved`; the revision move is what refuses any later
conditional commit against it (§4, `moved`).

**Bounded.** One small record per take that ends (tens of bytes; inference).
The launch replay (PR 3) deletes records older than 30 days whose `clipId`
has no row, in the owning transaction. That is the only delete, and it can
only move a verdict towards keeping: a take whose record has been aged out
reads as `unexplained` (§4), which keeps the audio and never frees or
overwrites. The 30 days is tactical, chosen here: far longer than any save
attempt, and short enough that the store stays small.

### A pending row's base clip is a use of that clip

A `stored` base holds only a clip id (`src/types/domain.ts:277-285`), not
samples. The row is a complete recipe only while that clip's bytes exist, as
PCM, at the `generation` and `frameCount` the row names. Frank r3 on this
note: if the replay loads the base, another copy replaces the active take
(so `writeTakeInTx` deletes the prior clip as unreferenced,
`takes.ts:156-162`), and the replay then finds `moved`, marks the row and
frees the slot, the row names audio that no longer exists.

So **preservation is defined by the whole recipe's dependencies**: the row,
its `recorded` samples, and its `stored` base clip. The rule, at the store:

- **A clip that a pending row's `stored` base names is in use**, exactly as a
  clip a take names is. `deleteClipIfUnreferenced` (`takes.ts:195-203`)
  becomes the one check for both: no take names the clip, **and**
  `pendingTakes.index("bySourceClip").count(clipId)` is `0`, read in the same
  transaction as the delete. The index (v13, §2) makes that a key count, not
  a read of rows that may hold minutes of audio.
- **Every path that deletes a clip goes through it**: `writeTakeInTx`'s
  replace, `clearSegmentTake`, `deleteSegment`, `deleteBook` (each of which
  deletes a clip today, `books.ts:1205-1220` and the book walk), and the
  Discard settle's orphan delete. Each of those transactions gains
  `pendingTakes`.
- **A transcode never replaces the bytes of a clip a row's base names.**
  `commitTranscode` (`transcode.ts:143-195`) gains `pendingTakes` and returns
  `"stale"` for such a clip without writing. The Finished sweep does not read
  that return value (`src/hooks/finish-transcode.ts:568`), so the turn ends
  with no error and the PCM is kept; a later sweep lists finished PCM
  segments again (`transcode.ts:84`) and converts it once the row has ended
  (inference from the code). Without this, the transcode
  would not delete the base but would make it `base-changed`: the same loss
  by another road.
- **The clip is released when the row ends.** Every transaction that deletes
  a row (the commit, a Discard, a give-up, a segment or book delete) runs the
  check on that row's `stored` base clip after the row delete, in the same
  transaction, and deletes the clip if nothing names it any more. Nothing
  leaks: the last user to let go deletes it.

**Why the reference and not an inline copy.** Rewriting the base inline
before freeing the slot would also satisfy Frank's exit condition. It is
rejected because it writes a second copy of the segment's existing audio
into the row, which is the cost the DRI's 2026-10-19 pick, "base = stored |
inline", exists to avoid (v12-schema.md, "The pending-takes store"), and it
would need that extra room on exactly the phone that is short of it. The
reference rule keeps one copy of the audio.

**Today every row is `inline`** (inference: no caller passes `source`,
above), so this rule changes nothing a person can see until #1545 lands. It
still ships in PR 1, because it is a rule a v13 writer must obey (§8).

### The owning transaction

`openTakeTx` (`takes.ts:53-63`) gains `pendingTakes` and `takeDispositions`:

```
["segments", "takes", "clipMeta", "clipData", "chapters", "books",
 "pendingTakes", "takeDispositions"]
readwrite, durability "strict"
```

Every step below opens it, and nothing else writes a `pendingTakes` row or a
disposition except the hold (which writes only the row):

| Step               | Function (rebuild name)           | Reads                                  | Writes                                                                                |
| ------------------ | --------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Ordinary commit    | `saveTake`                        | segment, prior take, own row           | clip, take, segment (revision + 1), deletes own row, `saved`                          |
| Conditional commit | `saveReplayedTake`                | segment, active take, row, disposition | on `free` as above; otherwise per §4                                                  |
| Clear (erase)      | `clearSegmentTake`                | segment, prior take                    | segment (revision + 1 if a take went), take and unreferenced clip                     |
| Discard            | `settlePendingTake(…, "discard")` | row, takes, disposition                | deletes own row, `discarded`; deletes the orphan clip only if no take names it        |
| Give up (quota)    | `settlePendingTake(…, "give-up")` | row, disposition                       | deletes own row, `given-up`                                                           |
| Refuse or park     | `settlePendingTake(…, { keep })`  | row                                    | puts own row with `refusal` set; or, with no row, puts one from the slot (§4, "keep") |

`deleteSegment` and `deleteBook` keep their own store lists
(`books.ts:1117`, `:371`), which already name `segments`. PR 2 adds
`pendingTakes` to them and deletes the row of each segment they delete, in
the same transaction. A row left behind for a gone segment is safe without
that change: the replay reads it as `gone` (cell DL-P).

Own row means the row whose `clipId` is this take's. Every write to a row is
conditional on `clipId`, as `deletePendingTake` already is
(`pending-takes.ts:240-268`).

### The hold

```
["segments", "takes", "pendingTakes", "takeDispositions"]
readwrite, durability "relaxed"
```

Relaxed, as slice 1 decided: the protected case is a process kill, and a
strict flush here would compete with the commit's (`pending-takes.ts:62-68`).

Inside that one transaction, with nothing awaited before it except `getDb()`:

1. Read the segment. Missing: write nothing, return `segment-gone`. The
   commit will then fail as a missing segment, the existing `stale` path.
2. Read the take's disposition. Any record: write nothing, return its kind.
   The take was saved, discarded or given up already, by this copy or
   another. (This replaces the in-memory `pendingGivenUp` set,
   `use-save-take.ts:81`, as the reason a Retry after a give-up does not
   hold again.)
3. Ask the hook, synchronously, whether a Discard of this take has been
   requested in this copy. Yes: write nothing, return `discarded`. The hook
   sets that flag in the same turn as the confirmed Discard tap, before the
   Discard's own transaction is even created.
4. Read the active take. If its `clipId` is this take's, the commit already
   landed: write nothing, return `saved`.
5. Read the row. Own row: return `kept` (a Retry carries the same recipe
   under the same `clipId`). A row for another clip: **do not overwrite it**,
   return `kept-foreign`. That row is another take's only copy, or a refused
   row kept on purpose.
6. Otherwise put the row with `baseRevision = segment.audioRevision`, and
   return `written`.

All of it is inside the transaction. That closes George r6 on #1546 (a read
awaited before the transaction opened let a Discard commit first) and George
r5 on #1546 (a target written in a second transaction). Steps 2 and 3 close
George r1's High on this note: a Discard confirmed while the hold is stalled
means the hold, when it runs, writes nothing, so there is no row for a kill
to leave behind. The order of the hold and the Discard's settle no longer
matters: whichever runs second finds what the first one did.

`kept-foreign` costs this take its safety copy. It is reported under the
existing `"pending-take-write"` context, whose runbook meaning, "could not
keep a safety copy", is then literally true. The trade, decided here: a live
take loses kill protection in a rare case, rather than any take's only copy
being overwritten. Whether a person should also see something is open (§9).

### Ordering against the clip write

The commit does not wait for the hold to finish, and nothing needs it to. If
the commit runs first, it writes `saved`, and the hold then writes nothing
(step 2). If the hold runs first, the commit deletes the row it put, in its
own transaction. The scopes overlap on `segments`, so the two never
interleave.

**This changes slice-1 pins.** `tests/pending-takes-store.test.ts:205` pins
"asks IndexedDB for pendingTakes only, so saveTake is never queued behind
it". The DRI already replaced that property when the round-6 fix on #1546
was picked (verbatim): "The pin that the pending write names only
`pendingTakes` is replaced by the property it protected: the clip write never
waits on a quota failure of the pending put." PR 1 replaces the pin with that
property (next heading). `:184`, "replaces an older row for the same segment
with a different take", and `:175`, the `createdAt` rule, are replaced by the
never-overwrite rule in step 5.

### Ordering against a quota failure of the pending put

- **The hold's own put fails** (quota or anything else). The hold
  transaction aborts by itself. Nothing else is in it, so nothing else rolls
  back. The hook reports `"pending-take-write"`, and the commit proceeds. The
  take saves without a safety copy. Test (PR 1): "a hold whose put runs out
  of room aborts alone, and the save after it lands".
- **The commit fails for quota.** The row may be what used the space. The
  hook settles a give-up (owning transaction: own row deleted, `given-up`
  written). The take stays in the slot, and a Retry does not hold again
  (hold step 2).
- **A replayed take's commit fails for quota.** PR 3 keeps the row (no
  give-up), so the replayed take keeps its condition and its copy on disk.
  PR 4 adds the give-up for replayed takes together with the screen it needs
  (§7, #1562 item 1).

### The replay's own reads

The replay lists rows in one read-only transaction (`listPendingTakes`,
`pending-takes.ts:271-278`), sorts by `createdAt`, and takes them one at a
time. For each row it first **classifies without reading audio**, in this
order, the first match deciding:

1. **segment missing** (any row, with or without `baseRevision`): `gone`.
   The row is deleted in the owning transaction and reported once (cell
   DL-P);
2. `refusal` set: skip quietly (it was reported when it was marked);
3. **no `baseRevision`** (`legacy`), or `sampleRate` not the current rate:
   mark the row refused and report once under `"pending-take-refused"`
   (cell RP-P).

Only then does it read the recipe (`loadPendingRecipe`, read-only, now also
naming `pendingTakes` and `takeDispositions`). A `stored` base whose clip is
missing, or whose `encoding`, `generation` or `frameCount` no longer matches
(`pending-takes.ts:337-347`), is `base-missing` or `base-changed`: the row
is marked refused, kept and reported once, and **the take is never installed
in the slot, so it never reaches the verdict and can never be `free`**
(George r1's second question). A read only advises: whatever it saw, the
commit re-decides inside the owning transaction (§4). This also answers
George r7's Low on #1546: a kept refused row is no longer copied out of
`clipData` on every launch.

## 4. The ownership verdict

One pure function, evaluated inside the owning transaction from what that
transaction read. It folds in #1557.

```ts
type Verdict = "gone" | "done" | "discarded" | "moved" | "unexplained" | "free";

function judgePending(
  segment: Segment | undefined,
  activeClipId: ClipId | null, // the active take's clip, or null
  row: StoredPendingTake | undefined, // the segment's row now
  disposition: TakeDisposition | undefined, // this take's record, if any
  take: { clipId: ClipId; baseRevision: number }
): Verdict;
```

`ownRow` below means `row?.clipId === take.clipId` with no `refusal` set.
Evaluated in this order; the first that holds wins:

| Verdict       | Holds when                                                                     | #1557's answer                                        |
| ------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `gone`        | `segment` is missing                                                           | —                                                     |
| `done`        | `activeClipId === take.clipId`, or the disposition is `saved`                  | "this clip is already the active take"                |
| `discarded`   | the disposition is `discarded`                                                 | —                                                     |
| `moved`       | `segment.audioRevision !== take.baseRevision`                                  | —                                                     |
| `free`        | `ownRow`, or no own row and the disposition is `given-up`                      | "this row was deliberately given up because of quota" |
| `unexplained` | anything else: no own row and no record saying why, or another clip's row only | "this row now belongs to another clip"                |

**The rule behind the order: absence is never consent.** A missing row frees
the slot only when a record says the take was saved (`done`) or discarded
(`discarded`), and allows a save only when a record says the row was given
up for quota with the take still wanted (`free`). A missing row with no
record, or a row that belongs to another clip, is `unexplained`, and
`unexplained` keeps. This replaces the earlier draft's `claimed` verdict
and its in-memory `rowGivenUp`, which could see only this copy.

What each verdict does in a conditional commit:

| Verdict       | Writes (same transaction)                                         | Slot                                                                                                     | Failure log                    |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `free`        | clip, take, revision + 1, delete own row if present, `saved`      | freed (`succeedSave`), `onSaved`                                                                         | none                           |
| `done`        | delete own row if present, `saved` (idempotent); no clip, no take | freed, `onSaved`                                                                                         | none                           |
| `discarded`   | delete own row if present; no clip, no take                       | freed                                                                                                    | once, `"pending-take-refused"` |
| `moved`       | keep (below)                                                      | freed once the audio is on disk; held if not (below)                                                     | once, `"pending-take-refused"` |
| `unexplained` | keep (below)                                                      | freed once the audio is on disk; held if not (below)                                                     | once, `"pending-take-refused"` |
| `gone`        | delete own row if present                                         | first attempt: freed (the coordinator's #38 reading: delete on `segment-gone`). A Retry: failed, `stale` | once, `"pending-take-refused"` |

**Keep, exactly.** Nothing is saved over the segment, and no copy of the
audio is let go before another is on disk:

- an own row is present **and every dependency of its recipe is on disk in
  this transaction** (for a `stored` base: the clip exists, is PCM, and
  matches the row's `generation` and `frameCount`; §3, "A pending row's base
  clip is a use"): mark it (`refusal: "superseded"` for `moved`,
  `"unexplained"` for `unexplained`) and free the slot. If a dependency is
  missing (a row written before the rule held), the row is rewritten with an
  `inline` base from the slot's samples, marked, and only then is the slot
  freed; if that put fails, the take stays held as below;
- no own row (given up, or removed without a record): **park** it, in the
  same transaction, by putting a marked row built from the slot's recipe, if
  the segment's row key is free. Then free the slot. If the key holds another
  clip's row, or the put fails (quota), the transaction aborts and the take
  **stays held**, failed with kind `unknown` (the existing recovery screen,
  Retry and Discard). Retry runs the verdict again; it never falls through to
  a save while the verdict is `moved` or `unexplained`.

So George r1's first Low (the `moved` branch with the row already gone) has
one answer: the slot keeps the audio until it is parked, and nothing is
saved. When a row is gone because another copy saved the take and the
segment then moved, the record says `saved`, the verdict is `done`, and the
slot is freed with nothing written: the person's erase stands.

PR 4 replaces the held `unknown` state of a `moved` take with its own words
(§9). Until then, Retry is the honest action: it parks the take as soon as
there is room.

**The ordinary commit** does not ask for permission (today's contract,
#1551). It deletes its own row, writes `saved` and moves the revision, in one
transaction.

## 5. State table

### The states

| State          | On disk                                                                                                  | In a slot                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Never recorded | segment, `activeTakeId: null`, revision `r`; no row                                                      | nothing                                                                             |
| Recorded       | segment, `activeTakeId: t`, revision `r`; no row                                                         | nothing                                                                             |
| Erased         | segment, `activeTakeId: null`, revision `r` ≠ any revision a row was written at before the erase; no row | nothing                                                                             |
| Deleted        | no segment row (tombstone); no row, or a row left by a build before PR 2                                 | nothing                                                                             |
| Replay pending | segment at revision `s`; an unmarked row: clip `c`, `baseRevision: b`                                    | no copy holds `c` (after a kill)                                                    |
| Retry pending  | segment at revision `s`; own row (a non-quota failure) or none (given up, record `given-up`)             | failed take `c`, attempts ≥ 1. Fresh (ordinary) or replayed (`b` carried in memory) |

### The operations

Save, erase and delete are by either copy. Replay is the launch replay's
first attempt on a row. Retry and Discard are taps on the recovery screen.
Launch recovery is what the next launch does if the app is killed in that
state.

### The matrix

Each cell's code is defined in the list after it.

| State \ operation | save | erase | delete | replay | Retry  | Discard | launch recovery |
| ----------------- | ---- | ----- | ------ | ------ | ------ | ------- | --------------- |
| Never recorded    | NR-S | NR-E  | NR-D   | NONE   | NOSLOT | NOSLOT  | NONE            |
| Recorded          | RC-S | RC-E  | RC-D   | NONE   | NOSLOT | NOSLOT  | NONE            |
| Erased            | NR-S | NR-E  | NR-D   | NONE   | NOSLOT | NOSLOT  | NONE            |
| Deleted           | DL-S | DL-E  | DL-D   | DL-P   | DL-R   | DL-X    | DL-P            |
| Replay pending    | RP-S | RP-E  | RP-D   | RP-P   | RP-R   | RP-X    | RP-L            |
| Retry pending     | TP-S | TP-E  | TP-D   | TP-P   | TP-R   | TP-X    | TP-L            |

"Erased" behaves as "Never recorded" for every operation on its own. What
sets it apart is a row written before the erase, which is cell RP-E (and
TP-E for a held take).

### The cells

Test files: `tests/audio-revision.test.ts` (PR 1);
`tests/pending-lifecycle-store.test.ts` (store, PR 1 and PR 2);
`tests/use-save-take-pending.test.ts` (existing file, hook, PR 1);
`tests/recover-pending-takes.test.ts` (PR 3 and PR 4);
`tests/save-failed-superseded.test.ts` (render harness, PR 4). Each new test
names where it must be seen red first, and the mutation that must kill it.

- **NONE.** No row and no slot: the replay finds nothing; a launch writes
  nothing. Test (PR 3): "a launch with no rows makes no write". Red: the
  mutation "the replay writes a log row on an empty list".
- **NOSLOT.** No slot: Retry and Discard have nothing to act on. Existing
  pins: `tests/pending-take.test.ts:154` "has nothing to do with an empty
  slot", `:318` "names nothing when there is nothing held".
- **NR-S.** The hold writes the row at `b = r`. The commit writes clip and
  take, moves the revision to `r + 1`, deletes the row and writes `saved`, in
  one strict transaction. Test (PR 1): "a save moves the revision, deletes
  its own row and records saved in the commit's transaction". Red: develop
  (the delete is a separate relaxed transaction, no record exists).
- **NR-E.** `clearSegmentTake` on a segment with no take: nothing removed,
  revision unchanged. Test (PR 1): W3. Red: mutation W3.
- **NR-D.** `deleteSegment` removes the segment and writes its tombstone;
  there is no row. Existing pins: `tests/delete-segment.test.ts`.
- **RC-S.** As NR-S. The prior take goes and its clip is deleted only if
  unreferenced (`deleteClipIfUnreferenced`, `takes.ts:195-203`). Test (PR 1):
  W1; existing `tests/take-clip-refcount.test.ts`. Red: mutation W1. If a
  pending row's `stored` base names the prior clip, the clip is kept. Tests
  (PR 1): "a save keeps the prior clip while a pending row's stored base
  names it, and deletes it when that row ends"; "erase, segment delete, book
  delete and a Discard's orphan delete each keep a clip a row's stored base
  names"; "a transcode leaves a clip a row's stored base names as PCM". Red:
  develop (`deleteClipIfUnreferenced` reads `takes` only, `takes.ts:199`);
  then the mutation "clip clean-up does not count `bySourceClip`" must kill
  them.
- **RC-E.** The take and its unreferenced clip go; the revision moves. Test
  (PR 1): W2. Red: develop (no field).
- **RC-D.** As NR-D, with the take and clip deleted as today. Existing pins.
- **DL-S.** The hold finds no segment and writes no row. The commit fails as
  a missing segment: the `stale` recovery screen, Discard only (#607,
  existing). Test (PR 1): "a hold for a deleted segment writes no row". Red:
  develop (the write puts a row for any `segmentId`).
- **DL-E.** `clearSegmentTake` throws; the erase reports `"erase-segment"`,
  and a cut-to-empty close returns `"stale"`. Existing pins:
  `tests/use-erase-segment.test.ts`, `tests/use-save-take.test.ts`.
- **DL-D.** Idempotent: `deleteSegment` returns `null` and writes nothing.
  Existing pin: `tests/delete-segment.test.ts:136`.
- **DL-P.** A row whose segment is gone, with or without `baseRevision`:
  classified `gone` before anything else. The row is deleted in the owning
  transaction and reported once. Same at launch recovery. Test (PR 3): "a
  row whose segment was deleted is removed and reported once, with or without
  a baseRevision". Red: PR 2's head (no replay); then the mutation "classify
  `legacy` before `gone`" must kill the no-`baseRevision` case (George r1's
  first Medium).
- **DL-R.** A held take whose segment was deleted: Retry finds `gone`,
  writes nothing, and shows the `stale` screen, as an ordinary save does
  today. Test (PR 3): "Retry of a replayed take whose segment was deleted
  writes nothing and shows the deleted-segment screen". Red: PR 2's head.
- **DL-X.** Discard settles: own row deleted if present, `discarded`
  written, the orphan clip deleted only if no take names it. Test (PR 1):
  "Discard records discarded with its row delete, and deletes an orphan clip
  only when no take names it". Red: develop (`deleteClip` is unconditional,
  `clips.ts:91-101`; no record).
- **RP-S.** A new take on the same segment before the replay reaches the
  row. Its hold finds a row for another clip: `kept-foreign`, no safety copy,
  reported. Its commit is ordinary: revision `s + 1`. The replay then finds
  `moved` with its own row: marked `superseded`, kept, reported once. Tests:
  (PR 1) "a hold never overwrites another take's row"; (PR 3) "a row whose
  segment was saved after it was written is kept, marked and not saved". Red:
  develop (`tests/pending-takes-store.test.ts:184` replaces the row).
- **RP-E.** The segment is erased (by either copy) after the row was
  written: `s ≠ b`. The replay finds `moved`, marks and keeps the row, writes
  nothing. **Frank r6's sequence on #1546.** Tests (PR 3): "a first-take row
  is not replayed onto a segment another copy saved and then erased", and
  its pair, "a first-take row is replayed onto an empty segment nobody
  changed". Red: PR 2's head (no replay); then the mutation "the verdict
  compares `activeTakeId` with the row's take instead of the revision"
  (#1546's check) must kill the first.
- **RP-P.** Classify (`legacy`, wrong `sampleRate`, `base-missing` and
  `base-changed` are marked, kept and reported once, and never installed),
  read the recipe, install into the slot only if the live slot is empty
  (George r1 on #1546), commit conditionally. `free`: write, revision
  `s + 1`, delete the row, `saved`, one transaction. Tests (PR 3):
  - "replays a row whose revision is unchanged, and deletes it in the
    commit's transaction";
  - "a row another copy already finished reports saved and writes nothing"
    (#1557);
  - "a newer save between the recipe read and the commit survives" (Frank r1
    on #1546);
  - "an old row beside a newer take saved before launch is not replayed"
    (Frank r3 on #1546);
  - "a replay never displaces a take already in the live slot" (George r1 on
    #1546);
  - "a stored base whose generation moved is kept and never saved" (George
    r1's second question);
  - **mixed build** (§8, "The compatibility boundary"): "a hold by another
    copy during the replay never takes the row, and the replay saves its
    take". A PR-1 store writer holds D on the segment after the replay has
    loaded C and before it commits; the row stays C's, the verdict is `free`,
    and C is saved.

  - **Frank r3 on this note**: "a kept row's stored base survives another
    copy replacing the take, and its recipe rebuilds". The replay loads a row
    with a `stored` base (the segment's active clip X); another copy saves a
    new take over the segment, which would delete X as unreferenced; the
    replay's commit finds `moved`, marks the row and frees the slot. Then X's
    `clipMeta` and `clipData` still exist and `loadPendingRecipe` on the
    marked row rebuilds the same samples. A pair: "the base clip is deleted
    when that kept row ends", so nothing leaks.
  - "a pre-rule row whose stored base is gone is kept with its recorded
    audio, reported once and never saved" (`base-missing`).

  Red: PR 2's head; then the mutation "the hold replaces a row for another
  clip when its `createdAt` is newer" (develop's rule,
  `pending-takes.ts:213-222`) must kill the mixed-build test (C is not saved,
  and with the earlier draft's verdict it was freed); and the mutation "clip
  clean-up does not count `bySourceClip`" must kill Frank r3's test.

- **RP-R.** No slot holds the take, so there is no Retry until the replay's
  attempt fails. A failed attempt (not quota) leaves the slot failed with
  `attempts: 1` and stops the run: the state becomes Retry pending. Test
  (PR 3): "a failed replay shows the recovery screen, keeps the row and stops
  the run". Red: PR 2's head.
- **RP-X.** A quiet row has no Discard control. A refused row has none until
  #1562 item 2 is decided. Existing NOSLOT pins; no new test.
- **RP-L.** Killed mid-replay. The commit is one transaction: either take,
  revision, row delete and `saved` all landed (the next launch finds no row),
  or none did (the row is replayed again). Test (PR 3): "a replay whose
  commit did not land replays once on the next launch". Red: PR 2's head.
- **TP-S.** This copy: refused, the slot is held (existing pin,
  `tests/pending-take.test.ts:77`). Another copy saves the segment: the
  revision moves. A fresh take's Retry still commits unconditionally (today's
  contract, #1551). A replayed take's Retry finds `moved`: kept. Test (PR 3):
  "Retry of a replayed take after another copy saved writes nothing and keeps
  the audio" (Frank r3 on #1546). Red: PR 2's head.
- **TP-E.** Another copy erases: the revision moves. A replayed take's Retry
  finds `moved` and keeps. **Frank r7's sequence on #1546** is this cell with
  the row given up (PR 4). Tests: (PR 3) "Retry after another copy saved and
  erased the segment writes nothing and keeps the audio"; (PR 4) "a quota
  Retry after another copy saved and erased the segment writes nothing and
  keeps the take", and its pair, "a quota Retry on an empty segment nobody
  changed still saves". Red: PR 3's head (a replayed take never gives its
  row up); then the mutation "a given-up Retry is `free` whatever the
  revision" (#1546's rule) must kill Frank r7's test.
- **TP-D.** Another copy deletes the segment (and, from PR 2, its row).
  Retry finds `gone`: nothing written, `stale` screen. Test (PR 3): as DL-R.
- **TP-P.** This copy's replay stops at a held slot (`"busy"`). Another
  copy's replay of the same row commits `free` and writes `saved`; this
  copy's Retry then finds `done`: nothing written, slot freed. A Discard
  after that deletes no clip a take names (Frank r4 on #1546). Tests (PR 3):
  "Retry after another copy's replay saved the same take reports saved and
  writes nothing"; PR 1's DL-X test covers the clip. Red: PR 2's head.
- **TP-R.** The verdict decides; `free` writes, moves the revision, deletes
  the own row and writes `saved`, in one transaction. A quota failure again:
  the take stays failed, and a fresh take's row is not rewritten after a
  give-up (hold step 2). Tests: (PR 3) "a Retry of a replayed take keeps the
  replay's condition"; existing quota pins in
  `tests/use-save-take-pending.test.ts`. Red: PR 2's head.
- **TP-X.** Discard sets this copy's in-memory discard flag in the tap's
  turn, then settles in the owning transaction (row deleted, `discarded`
  written). Tests:
  - (PR 1) **George r6's stalled sequence on #1546**: "a Discard confirmed
    during a stalled hold leaves no row, and the launch keeps the kept take"
    (steps below). Red: the mutation "the hold awaits its segment read before
    opening its transaction" (the #1546 `94a969a6` shape).
  - (PR 1) **George r1's kill on this note**: "a kill after the hold commits
    and before the Discard's settle leaves nothing to replay". The hold is
    stalled, Discard is confirmed, the stall is released, the hold
    transaction commits, and the Discard's settle is then aborted (the kill).
    The hold wrote nothing (step 3), so no row exists; a launch writes
    nothing and K is still active. Red: the mutation "the hold does not ask
    for a requested Discard" must kill it (the hold puts the row, the launch
    finds `free` and replaces K).
  - (PR 3) **Frank r2's pair on this note**: copy A holds C (ordinary save)
    and copy B has loaded C for replay. (a) A's save fails for quota and A
    gives the row up (`given-up`), A is killed, B commits: the verdict is
    `free` and C is saved, "a cross-copy quota give-up keeps C and saves it".
    (b) A confirms Discard instead (`discarded`), B commits: the verdict is
    `discarded`, B's slot is freed and nothing is written, "a cross-copy
    Discard frees C". Red: the mutation "a missing own row with no record is
    read as `free` or as a discard" (the earlier draft's `claimed`, which
    freed C in (a)) must kill (a); the mutation "the verdict ignores the
    disposition" must kill (b).
  - (PR 4) **Residual 2 of the earlier draft** (George r1's second Medium):
    copy A's replayed take is given up for quota (`given-up`), copy B, also
    holding it, confirms Discard (`given-up` becomes `discarded`), then A
    taps Retry: the verdict is `discarded`, nothing is written, A's slot is
    freed. Test: "a Retry after another copy discarded a given-up take saves
    nothing". Red: PR 3's head (no replayed give-up); then the mutation "a
    `given-up` record is never upgraded" must kill it.
- **TP-L.** Killed while held. Own row present: the next launch is Replay
  pending for it. Row given up for quota: nothing on disk; the take is lost.
  That is the limit #38 has recorded since 2026-09-03: the row protects the
  kill-and-relaunch case, not the quota case. Tests: (PR 3) "a take killed
  while held with its row is replayed on the next launch"; (PR 1) "a take
  whose row was given up leaves no row and a given-up record" (pins the
  documented limit). Red: PR 2's head; develop.

### The required sequences, step by step

**Frank r7 on #1546** (cell TP-E, PR 4). Segment `S` is never recorded,
revision `r`.

1. Copy A launches and replays a first-take row for `S` (`baseRevision: r`).
   Its commit fails on quota. A gives the row up (owning transaction,
   `given-up`). The take stays held.
2. Copy B saves `S` (revision `r + 1`), then erases it (revision `r + 2`).
   `activeTakeId` is `null` again.
3. A taps Retry. The conditional commit reads revision `r + 2`, no active
   take, no row, record `given-up`. Verdict: `moved` (`r + 2 ≠ r`). Nothing
   is saved; the take is parked or stays held.

Under #1546 at `c3a4f4feb` the same steps saved A's take, because both
pointers were `null` and no row was required on a Retry. The pair test runs
steps 1 and 3 with no step 2 and expects the save.

**George r6 on #1546, and George r1's kill on this note** (cell TP-X, PR 1).
A kept take `K` is active on `S`.

1. An edit of `S` is saved. Its hold is created but stalled: the test holds a
   read-write transaction on `segments` open, so the hold cannot start.
2. The commit fails at once (injected), and the take is held as failed.
3. Discard is confirmed. The hook sets the discard flag in that turn and
   creates the settle.
4. The stall is released. The hold runs: step 3 finds the flag and writes
   nothing. The settle runs (row absent, `discarded` written).
5. No row remains. A launch makes no write and `K` is still active.
6. The kill variant aborts the settle in step 4. Step 5 still holds, because
   the hold wrote nothing.

Under #1546 at `94a969a6` the hold awaited a segment read before opening its
transaction, the Discard's delete committed in that gap, and the delayed put
brought the row back. Under this note's first draft the hold put the row
before the settle deleted it, and a kill between those two commits left a
row that replayed over `K`.

## 6. Every finding against this design

| Round, lens, finding                                                                     | Where it lands here                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #1546 r1/r2 Frank: a newer save between the recipe read and the commit is overwritten    | `moved` (RP-P)                                                                                   |
| #1546 r1 George: the replay saved a take it never installed in the slot                  | carried as is: `writeSlot` and the `installed` check (RP-P)                                      |
| #1546 r3 Frank: an old row beside a newer take saved before launch                       | `moved` (RP-P): `b` is from the row's write, not from the replay's read                          |
| #1546 r3 Frank: Retry dropped the condition                                              | the replayed take carries `baseRevision`; every Retry is conditional (TP-R)                      |
| #1546 r4 Frank: Discard deleted a clip another copy had made active                      | Discard's settle deletes only an unreferenced clip (DL-X, TP-P)                                  |
| #1546 r5 George: the target was written after the row                                    | the hold reads the revision and puts the row in one transaction (§3, "The hold")                 |
| #1546 r5 George (Medium, #1557): a full inline row rewritten after another copy saved it | `done`, from the active clip or the `saved` record, before anything else (§4)                    |
| #1546 r6 George: a read awaited before the hold's transaction let a Discard win          | no read outside the hold's transaction (TP-X)                                                    |
| #1546 r6 Frank / r7 Frank: an erase undone by a first-take replay or a quota Retry       | the revision (RP-E, TP-E)                                                                        |
| #1546 r7 George (Medium): a foreign row parks the only copy on the no-Retry screen       | a hold never overwrites a row; a foreign row is `unexplained`, which keeps and offers Retry (§4) |
| #1546 r7 George (Low): a kept refused row is re-read from `clipData` every launch        | classification before any recipe read (§3)                                                       |
| this note, Frank r1: a PR-1 writer overwrites a row a PR-3 replay holds                  | §8, "The compatibility boundary"; mixed-build test (RP-P)                                        |
| this note, George r1 High: a Discard during the hold, then a kill, replays over K        | hold steps 2 and 3 (§3); kill test (TP-X)                                                        |
| this note, George r1 Medium: a legacy row for a deleted segment is kept and deleted      | one rule: `gone` first, then `legacy` (§2, §3, DL-P)                                             |
| this note, George r1 Medium: residual 2, a given-up take discarded elsewhere is saved    | the disposition: `given-up` becomes `discarded`, and `discarded` wins (§4, TP-X)                 |
| this note, George r1 Low: `moved` with the row gone does not say what the slot does      | "Keep, exactly" (§4)                                                                             |
| this note, George r1 Low: the revision's definition disagrees with the transcode row     | the definition tracks the active take; transcode is out of band (§1)                             |
| this note, George r1 Low: "creation order" across copies                                 | "serialization", and nothing depends on which runs first (§3)                                    |
| this note, George r1 questions: `kept-foreign`'s signal; a `generation` mismatch         | open for the requirements owner (§9); refused, kept, never installed (§3)                        |
| this note, Frank r3: a kept row's `stored` base clip is deleted by another copy's save   | a row's base clip is a use: clip clean-up and transcode check `bySourceClip` (§3); test in RP-P  |
| this note, Frank r2: a cross-copy quota delete reads as `claimed` and frees C            | `unexplained` and `free`-on-`given-up` replace `claimed`; paired test (TP-X)                     |

## 7. The open follow-ups

- **#1557 (one ownership predicate): folded in.** §4's `judgePending` is that
  predicate. Its red-first test is in RP-P. Recommendation: close #1557 when
  PR 3 merges, citing this note.
- **#1548 (a discarded take must not come back): folded in, with a durable
  record instead of the mark it proposed.** The Discard writes `discarded`
  and deletes the row in **one** transaction; the hold refuses to put a row
  for a take whose Discard is recorded or requested; and the verdict never
  saves a `discarded` take, in any copy. That closes the three paths the
  first draft left open: a hold landing after a Discard (George r6 on #1546),
  a kill between the hold's commit and the Discard's (George r1's High), and
  a Discard in one copy of a take another copy gave up (residual 2). Each
  has a test in TP-X. What remains is a kill **before the Discard's own
  single transaction commits**, after the tap: the row is still there and
  unrecorded, so the next launch saves the take. No design can record a tap
  that was never committed; it is not a two-commit gap. Recommendation:
  close #1548 when PR 1 merges, with TP-X's tests green and this window named
  in the close comment. Owner until then: #1548 itself, against PR 1.
- **#1549 (a recording refused while the replay holds the slot): stays
  separate.** It is the recorder's and the slot's behaviour, not the row's
  lifecycle, and needs no schema. This design narrows its window: the replay
  installs into the slot only after the recipe read, and frees it at the
  commit. It should follow PR 3, which creates the window.
- **#1562 item 1 (the screen a lost race shows): partly folded in, one
  decision open.** Most lost races show nothing now: a `moved` or
  `unexplained` take with a row is marked and kept on disk, and `discarded`
  honours a Discard. A take whose only copy is in memory and cannot be
  parked stays on the existing recovery screen, kind `unknown`, until PR 4.
  The words for that case, and what Try again does there, are the
  requirements owner's (§9).
- **#1562 item 2 (refused rows keep their audio forever): stays separate.**
  It decides when refused audio may go, which is the requirements owner's
  call. This design adds a reason to decide it: a hold never overwrites a
  row, so a kept row also takes the safety copy away from the next save on
  that segment (§3, `kept-foreign`). Deleting a segment or a book drops its
  rows from PR 2 (RP-D).
- **#1551 (should an ordinary Save check its target): stays separate.** It
  changes what a person's own Save does. The revision makes it cheap: the
  recorder would carry the revision it read when it loaded the segment's
  audio, and the ordinary commit would ask §4's verdict too. This note does
  not decide it.
- **#1545 (the recorder passes a stored-clip `source`): unblocked by PR 1.**
  It is the change that makes `stored` bases exist. PR 1's rule that a row's
  base clip is a use (§3) is what makes them safe to keep; the recipe read
  still checks `generation` and `frameCount`. #1545 should not land before
  PR 1.

## 8. The rebuild, in order

Each PR is cut from develop and cites this note. The line counts are
estimates, scaled from #1546, whose storage and hook changes measured
+514 / -134 in `src/` (inference; not measured for this design).

| PR  | Delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Tier       | Estimate | Cells                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | v13 and every rule a v13 writer must obey (next heading): `Segment.audioRevision` and the `takeDispositions` store, the migration step, the creators, the moves in `writeTakeInTx` and `clearSegmentTake`; the hold (all six steps, `baseRevision`); the owning transaction for the commit, Discard and give-up, each writing its record; clip clean-up (`deleteClipIfUnreferenced`, `deleteClip`, the segment and book deletes) counts a row's `stored` base as a use, through the v13 `bySourceClip` index, and `commitTranscode` skips such a clip. Replaces the pins named in §3. The living sentences that name the schema change move from "11 to 12" to "11 to 13": `AGENTS.md` (the rollback paragraph), `docs/release/promotion-v1.0.0.md` §5, and the facilitator runbook if it names 12. | T1, T2     | ~510     | NR-S, NR-E, RC-S, RC-E, DL-S, DL-X, TP-X (PR 1 tests), TP-L; the hold half of RP-S; §2's tests                  |
| 2   | `deleteSegment` and `deleteBook` drop the rows of the segments they delete, and release those rows' base clips by PR 1's check. Not a rule the verdict relies on (next heading).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | T1         | ~60      | RP-D                                                                                                            |
| 3   | The launch replay: classification, `judgePending`, `saveReplayedTake`, park, the bounded record clean-up, the replay loop, the slot guard (`writeSlot`, `installed`), the quiet first attempt, conditional Retry. A replayed take keeps its row on quota. The AGENTS.md failure-log list gains `"pending-take-refused"` and `"pending-take-read"`, and the runbook §5 says what the quiet finish does.                                                                                                                                                                                                                                                                                                                                                                                              | T1, T2     | ~470     | NONE, DL-P, DL-R, RP-S, RP-E, RP-P, RP-R, RP-L, TP-S, TP-E (row kept), TP-D, TP-P, TP-R, TP-X (Frank r2's pair) |
| 4   | A replayed take gives its row up on quota, and the words for a take that cannot be parked. Waits for §9's decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | T1, T2, T3 | ~100     | TP-E (Frank r7), TP-X (residual 2)                                                                              |

The disposition record moved lines from PR 2 into PR 1 and added some to PR
1 and PR 3: the estimates were ~300 / ~150 / ~400 / ~120 before it, and
~450 / ~60 / ~450 / ~100 before the base-clip rule (Frank r3), which adds the
index, the check at five clean-up sites and the transcode skip to PR 1, and
the dependency check in "Keep, exactly" to PR 3. PR 1 is now estimated just
over the 500-line cap. **It is not split if it runs over**: every item in
it is a rule the compatibility boundary needs in the build that first opens
v13, so a split would reopen Frank r1's finding. If it measures over 500, it
ships with a declared `size-exception` naming that reason.

### The compatibility boundary

Frank r1 on this note: if PR 1 raised the version and a later PR brought a
rule the verdict depends on, a PR-1 build and a PR-3 build could share a v13
database and break it. His case: a PR-1 hold replacing another clip's row
whenever its `createdAt` is newer (develop's rule, `pending-takes.ts:213-222`)
would leave a PR-3 replay holding C with D's row on disk, and the earlier
draft's verdict freed C's last copy.

The premise is the one §2 uses against editing v12: a develop build can open
a real database (a development machine or a preview origin; inference, not
checked). So the rule is: **the build that first opens a v13 database obeys
every rule §4's verdict relies on.** Those rules are:

1. every write that changes the active take moves the revision (§1);
2. the hold reads the revision, the disposition and this copy's Discard
   request inside its own transaction, writes nothing for a take that is
   saved, given up, discarded or being discarded, and never overwrites a row
   for another clip (§3, "The hold");
3. every act that ends a take's row (the commit, a Discard, a give-up)
   writes its disposition in the same transaction as the row delete; a row
   is removed in no other way, except with its segment;
4. a clip is deleted only when no take names it **and no pending row's
   `stored` base names it**, checked in the deleting transaction, and a
   transcode never replaces the bytes of a clip a row's base names (§3, "A
   pending row's base clip is a use"). So a Discard in a copy without the
   replay cannot delete a clip a replay in another copy has made active
   (Frank r4 on #1546), and no copy can delete or convert the base a kept
   row still needs (Frank r3 on this note).

All four ship in PR 1, with the version step. PRs 2, 3 and 4 change none of
them, so they need no further version step: any mix of PR-1-or-later builds
on one v13 database keeps the verdict sound, and every earlier build is shut
out by v13 itself (§2). A PR-1 copy without PR 2 leaves at worst a row for a
deleted segment, which the replay reads as `gone`.

**A later change to any of the four rules is a new version step**, for the
same reason v13 is: it is the only thing that keeps a build without the
change from writing the same database.

The mixed-build test is in cell RP-P.

**Why the split falls between 3 and 4.** The only state that needs new words
on screen is a take whose only copy is in memory and cannot be parked. PR 3
reaches it only through rare cross-copy paths, and shows it on the existing
recovery screen (§4, "Keep, exactly"). PR 4 adds the give-up for replayed
takes, which makes it reachable on one copy, so the words come with it.
Keeping a replayed take's row on a quota failure costs space, not audio: the
Retry needs room for the row and the new clip together, so on a full phone it
fails again until space is freed (inference; not measured).

## 9. Open for the requirements owner

1. **A take whose segment changed while its only copy was in memory**
   (#1562 item 1; PR 4). Saving it would replace the newer audio, or put
   audio back into a segment someone erased. Recommended default, until
   decided otherwise: keep it held; Discard deletes it; Try again stores it
   to the side as a kept refused row (park, §4) and never over the newer
   audio. The words for this screen are part of the decision.
2. **How long a refused row keeps its audio** (#1562 item 2). Unchanged by
   this note, and more pressing because of `kept-foreign` (§7).
3. **Whether `kept-foreign` shows anything** (George r1's first question).
   Today's design reports it to the failure log only. A kill after that
   loses the take the person just made, because it had no safety copy.
   Recommended default: no on-screen signal, because the save itself
   normally lands within moments and a warning would ask a person who may
   not read to act on a rare internal state. This is a product call, not
   decided here.

None of the three blocks PR 1, 2 or 3.

## Residuals

Each is inferred from the code and this design. None has been seen.

1. **A kill before the Discard's own transaction commits**, after the tap,
   brings the discarded take back on the next launch (§7, #1548). One
   transaction, not two.
2. **`kept-foreign` costs a safety copy.** A save on a segment that holds a
   kept refused row, or another copy's live row, has no kill protection
   (§9, item 3).
3. **A refusal mark or a park rewrites the whole row.** A `put` of a row with
   a 20-minute take re-serialises its audio. A quota failure there aborts the
   transaction: a mark is retried on the next launch (a repeated log line,
   never a lost row); a park leaves the take held.
4. **Store-level serialization.** Adding `pendingTakes` and
   `takeDispositions` to the owning scope means a commit in one copy can wait
   behind a hold for a different segment in another copy. Holds are one short
   transaction each, but a long take's inline row is large (inference; not
   measured).
5. **An aged-out record.** A copy that still holds a take more than 30 days
   after its record was written reads `unexplained` and keeps; it can no
   longer learn that another copy saved or discarded it.
6. **A fresh take's Retry is still unconditional** (#1551).
7. **A kept row with a `stored` base pins its clip as PCM.** The clip is not
   deleted or transcoded while the row lives, so a refused row (#1562 item 2)
   also holds that clip's PCM, about ten times its MP3 size (AGENTS.md, "Known open items" 2: ~660 MB of PCM to ~66 MB of MP3), until the row ends.
