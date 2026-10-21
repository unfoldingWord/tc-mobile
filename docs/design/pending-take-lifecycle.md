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

It decides five things: the revision (§1) and its migration (§2), the one
owning transaction (§3), the one ownership verdict that replaces the per-case
arms (§4), what every state does under every operation, with a test per cell
(§5), and the order of the rebuild PRs (§8). §6 checks every #1546 finding
against the design, and §7 disposes of the open follow-ups.

## Terms

- **Copy:** one running instance of the app (a tab, an installed PWA window,
  a native shell). Two copies on one phone share one IndexedDB database.
- **Slot:** the one take a copy holds in memory (`PendingTake`,
  `src/lib/takes/pending-take.ts:55-95`; held by `useSaveTake`,
  `src/hooks/use-save-take.ts:332-514`).
- **Row:** the take's safety copy in `pendingTakes`, keyed by `segmentId`
  (`src/types/domain.ts`, `StoredPendingTake`).
- **Hold:** the transaction that writes the row before the save
  (`writePendingTake` today, `src/lib/storage/pending-takes.ts:174-231`).
- **Commit:** the transaction that writes the clip and the take
  (`saveTake`, `src/lib/storage/takes.ts:241-296`).
- **Settle:** a transaction that ends a row without a commit: Discard, giving
  the row up after a quota failure, or marking it refused.
- **Ordinary save:** a Save or Retry of a take this copy recorded. It commits
  unconditionally, as today.
- **Conditional commit:** the launch replay's commit, and every Retry of a
  replayed take. It commits only if §4's verdict is `free`.

## 1. The audio revision

### The field

`Segment.audioRevision: number`, stored on the segment row. It starts at `0`
when a segment is created. It counts changes to the segment's audio and means
nothing else: two reads with the same value saw the same audio, and two reads
with different values did not.

The pending row records the revision its take was made against:
`StoredPendingTake.baseRevision: number`. A conditional commit succeeds only
while `segment.audioRevision === row.baseRevision` (with the rest of §4's
verdict). This replaces the pointer comparison and every exception #1546 built
around it.

### What moves it

Every write that changes which audio a segment holds, in the transaction that
makes the change, as `audioRevision + 1`:

| Write                           | Where                                               | Moves it                                             |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Save (first take, insert, edit) | `writeTakeInTx`, `takes.ts:121-179`                 | Yes, always                                          |
| Replayed save                   | the conditional commit (§3)                         | Yes, always                                          |
| Erase, and cut-to-empty close   | `clearSegmentTake`, `takes.ts:313-350`              | Yes, when a take was removed; no when none was there |
| Delete segment, delete book     | `deleteSegment`, `books.ts:1186-1260`; `deleteBook` | The row goes; absence is final (below)               |
| Finished toggle                 | `setSegmentFinished`, `takes.ts:362-400`            | No                                                   |
| Transcode to MP3                | `commitTranscode`, `transcode.ts:143-195`           | No                                                   |
| Rename, reorder, cover colour   | `books.ts`                                          | No                                                   |

Why each "no" (tactical, decided here):

- **A clear of an empty segment does not move it.** `clearSegmentTake` is
  documented as idempotent (`takes.ts:309-311`). A no-op erase changes no
  audio, and moving the revision would refuse a valid first-take replay for
  nothing.
- **The Finished toggle and the transcode do not move it.** Neither changes
  which take the segment holds. A transcode changes the clip's bytes under
  the same take and clip id, and a `stored` pending base already guards that
  with `generation` (`pending-takes.ts:340-347`).
- **Rename, reorder and cover colour** change no audio.

**Delete.** `deleteSegment` and `deleteBook` remove the segment row. Segment
ids are minted by `crypto.randomUUID()` (`books.ts:38`, `:966`) and are never
reused, so a missing segment never comes back: absence is a revision no
pending row can match. §3 also has the delete remove the segment's row in the
same transaction.

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
same case (AGENTS.md, "Confirming a deploy and rolling one back").

Raising `DB_VERSION` to 13 shuts them out (inference from `src/lib/storage/db.ts`):

- an older build gets `DatabaseDowngradeError` and writes nothing;
- an older copy that is open is asked to yield its connection. It refuses
  while it holds unsaved audio (#221, `db.ts`, `blocking()`), and the upgrade
  waits until it lets go.

So after v13, every writer that can move `activeTakeId` also moves
`audioRevision`. The version bump is what makes the revision trustworthy.

**Why not fold it into v12.** v12 is not released: `DB_VERSION` is 11 on
`origin/staging` and 9 on `origin/main` (read with `git show` at the time of
writing). But a develop build may already have opened a database at 12 on a
development machine or a preview origin (inference; not checked), and a
database at 12 never runs a changed v12 step again. Append-only means a step
that may have run is never edited. v12 and v13 can ship in the same release,
so the cost is one more `if` block, and #1464's device check on that release
can cover both (recommendation).

### The step

In the one `upgrade` callback, after v12's block:

```ts
// v13 (#1564): the audio revision. Keyed on absence; no clock; one put per
// row at most. Takes, clips and pendingTakes are not read.
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

- **Append-only.** No store is created or dropped. No field is renamed. No
  existing value is rewritten.
- **Idempotent, keyed on absence** (`in`, not a value test). A rerun after the
  #1421 abort writes nothing a first run already wrote.
- **No clock read.** `0` is not a time.
- **Every existing segment starts at `0`**, recorded or not. That is safe:
  the revision only has to differ between the two ends of one pending row's
  life, and every row written after v13 reads the value it starts from.
- **Rows written before v13 have no `baseRevision`.** They come from develop
  builds of #38 slice 2 (`35820cbc`, #1540), which never reached
  `origin/staging` or `origin/main` (the #1546 round-3 triage checked this
  with `git branch -r --contains`). The step does not guess one. The replay
  refuses such a row as `legacy`, keeps it, and reports it once (§5, cell
  DL-replay and the classification in §3).
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

Also: a v11 and a v9 shelf each climb to 13 in one open; a fresh install
opens at 13 and `addSegment` writes `audioRevision: 0`; a database at 13
opened by a build at 12 rejects with `DatabaseDowngradeError`, and a raw
`openDB` then shows every row and clip byte unchanged.

### Red-first tests for the writers (PR 1)

New `tests/audio-revision.test.ts`, over the real stores:

| Id  | Mutation                                           | Killed by                                                                      |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| W1  | `writeTakeInTx` does not move the revision         | "a save moves the revision by one"                                             |
| W2  | `clearSegmentTake` does not move it                | "an erase that removes a take moves the revision by one"                       |
| W3  | `clearSegmentTake` moves it unconditionally        | "clearing a segment with no take leaves the revision"                          |
| W4  | `setSegmentFinished` moves it                      | "the Finished toggle leaves the revision"                                      |
| W5  | `commitTranscode` moves it                         | "a transcode leaves the revision"                                              |
| W6  | the move is written outside the take's transaction | "a save whose take write fails leaves the revision" (fault on the `takes` put) |

## 3. One owning transaction

### What "one transaction" can and cannot mean

The row exists to survive a kill during the commit. So the row's put cannot
be inside the commit's transaction: a kill there rolls the row back with the
clip. The hold has to commit on its own, before the commit starts. That fact
fixes the shape.

So the owner is one **transaction scope** that every other step of the row's
life opens, plus the hold, whose scope is a subset of it. IndexedDB starts a
read-write transaction only after every earlier-created transaction with an
overlapping scope has finished (the IndexedDB specification's transaction
scheduling; the existing pin `tests/pending-takes-store.test.ts:289` relies on
fake-indexeddb doing the same). So every step below is ordered against every
other in creation order, by the database, without call-order arguments. This
is the reading of the DRI's "one transaction owns read, put and delete
ordering" that this note builds on.

### The owning transaction

`openTakeTx` (`takes.ts:53-63`) gains `pendingTakes`:

```
["segments", "takes", "clipMeta", "clipData", "chapters", "books", "pendingTakes"]
readwrite, durability "strict"
```

Every step below opens it, and nothing else touches a `pendingTakes` row
except the hold:

| Step               | Function (rebuild name)            | Reads                        | Writes                                                            |
| ------------------ | ---------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| Ordinary commit    | `saveTake`                         | segment, prior take, own row | clip, take, segment (revision + 1), deletes own row               |
| Conditional commit | `saveReplayedTake`                 | segment, active take, row    | on `free` as above; otherwise per §4, nothing but the row         |
| Clear (erase)      | `clearSegmentTake`                 | segment, prior take          | segment (revision + 1 if a take went), take and unreferenced clip |
| Discard            | `settlePendingTake(…, "discard")`  | row, takes                   | deletes own row; deletes the orphan clip only if no take names it |
| Give up (quota)    | `settlePendingTake(…, "give-up")`  | row                          | deletes own row                                                   |
| Refuse (mark)      | `settlePendingTake(…, { refuse })` | row                          | puts own row with `refusal` set                                   |

`deleteSegment` and `deleteBook` keep their own store lists
(`books.ts:1117`, `:371`), which already name `segments`. They gain
`pendingTakes` and delete the row of each segment they delete, in the same
transaction. That is what "a delete moves the revision" means in practice:
the segment and its row go together.

Own row means the row whose `clipId` is this take's. Every write to a row is
conditional on `clipId`, as `deletePendingTake` already is
(`pending-takes.ts:240-268`).

### The hold

```
["segments", "takes", "pendingTakes"]
readwrite, durability "relaxed"
```

Relaxed, as slice 1 decided: the protected case is a process kill, and a
strict flush here would compete with the commit's (`pending-takes.ts:62-68`).
Its scope is a subset of the owning scope, so the two are ordered.

Inside that one transaction, with nothing awaited before it except `getDb()`:

1. Read the segment. Missing: write nothing, return `segment-gone`. The
   commit will then fail as a missing segment, the existing `stale` path.
2. Read the active take. If its `clipId` is this take's, the commit already
   landed: write nothing, return `saved`.
3. Read the row. Own row: return `kept` (a Retry carries the same recipe
   under the same `clipId`). A row for another clip: **do not overwrite it**,
   return `kept-foreign`. That row is another take's only copy, or a refused
   row kept on purpose.
4. Otherwise put the row with `baseRevision = segment.audioRevision`, and
   return `written`.

The read in steps 1 and 2 is inside the transaction. That closes George r6
(a read awaited before the transaction opened let a Discard commit first) and
George r5 (a target written in a second transaction) by construction.

`kept-foreign` costs this take its safety copy. It is reported under the
existing `"pending-take-write"` context, whose runbook meaning, "could not
keep a safety copy", is then literally true. The trade, decided here: a live
take loses kill protection in a rare case, rather than any take's only copy
being overwritten.

### Ordering against the clip write

Within one copy, every later step for a take (its commit, give-up and
Discard) starts **after the take's hold has settled**, committed or aborted.
The hook keeps a per-`clipId` map of hold promises (the shape of the bench's
`97354e76` `pendingWrites` map on #1546) and chains on it. Without the chain,
the order would rest on two calls awaiting the same `getDb()` promise in call
order, which #1536's round-1 review already called practice, not a lock (#38,
comment of 2026-10-21 14:03).

What this costs: the commit waits for one short hold. It would queue behind
the hold anyway, since their scopes overlap and the hold is created first.
What it buys: a commit, a give-up or a Discard can never be created before
its own hold, so a hold can never put a row after its take was saved or
discarded. Step 2 of the hold also catches a commit that somehow landed first
(defence in depth, not the mechanism).

Across copies, the scopes do the ordering. A hold in one copy and a commit,
clear or delete in another are serialized by `segments`.

**This changes a slice-1 pin.** `tests/pending-takes-store.test.ts:205` pins
"asks IndexedDB for pendingTakes only, so saveTake is never queued behind
it". The DRI already replaced that property when the round-6 fix was picked
(verbatim): "The pin that the pending write names only `pendingTakes` is
replaced by the property it protected: the clip write never waits on a quota
failure of the pending put." PR 2 replaces the pin with that property (next
heading). `:184`, "replaces an older row for the same segment with a
different take", and `:175`, the `createdAt` rule, are replaced by the
never-overwrite rule in step 3.

### Ordering against a quota failure of the pending put

- **The hold's own put fails** (quota or anything else). The hold
  transaction aborts by itself. Nothing else is in it, so nothing else rolls
  back. The hold settles `ok: false`, the hook reports
  `"pending-take-write"`, and the commit starts. The take saves without a
  safety copy. Test (PR 2): "a hold whose put runs out of room aborts alone,
  and the save after it lands".
- **The commit fails for quota.** The row may be what used the space. The
  hook settles a give-up (owning transaction, own row deleted) and records
  the `clipId` in the existing `pendingGivenUp` set
  (`use-save-take.ts:81`), so a Retry does not hold again. Unchanged from
  #1540, except that the delete now runs in the owning scope. The take stays
  in the slot.
- **A replayed take's commit fails for quota.** PR 3 keeps the row (no
  give-up), so the replayed take keeps its condition and its copy on disk.
  PR 4 adds the give-up for replayed takes together with the screen it needs
  (§7, #1562 item 1). See §8 for why the split falls there.

### The replay's own reads

The replay lists rows in one read-only transaction (`listPendingTakes`,
`pending-takes.ts:271-278`), sorts by `createdAt`, and takes them one at a
time. For each row it first **classifies without reading audio**:

- `refusal` set: skip quietly (it was reported when it was marked);
- no `baseRevision` (`legacy`), or `sampleRate` not the current rate: settle
  a refusal mark and report once under `"pending-take-refused"`.

Only then does it read the recipe (`loadPendingRecipe`, read-only, now also
naming `pendingTakes`). A read only advises: whatever it saw, the commit
re-decides inside the owning transaction (§4). This also answers George r7's
Low: a kept refused row is no longer copied out of `clipData` on every
launch.

## 4. The ownership verdict

One pure function, evaluated inside the owning transaction from what that
transaction read. It folds in #1557, whose three answers are three of its
outcomes.

```ts
type Verdict = "gone" | "done" | "moved" | "claimed" | "free";

function judgePending(
  segment: Segment | undefined,
  activeClipId: ClipId | null, // the active take's clip, or null
  row: StoredPendingTake | undefined, // the segment's row now
  take: { clipId: ClipId; baseRevision: number },
  rowGivenUp: boolean // this copy gave this take's row up for quota
): Verdict;
```

Evaluated in this order. The first that holds wins:

| Verdict   | Holds when                                                                                     | #1557's answer                                        |
| --------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `gone`    | `segment` is missing                                                                           | —                                                     |
| `done`    | `activeClipId === take.clipId`                                                                 | "this clip is already the active take"                |
| `moved`   | `segment.audioRevision !== take.baseRevision`                                                  | —                                                     |
| `claimed` | not `rowGivenUp`, and the row is missing, is another clip's, or is own but carries a `refusal` | "this row now belongs to another clip"                |
| `free`    | otherwise: the revision is unchanged, and the row is own and unmarked, or this copy gave it up | "this row was deliberately given up because of quota" |

What each verdict does in a conditional commit:

| Verdict   | Writes (same transaction)                                          | Slot                                                                                                                    | Failure log                    |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `free`    | clip, take, revision + 1, delete own row                           | freed (`succeedSave`), `onSaved`                                                                                        | none                           |
| `done`    | delete own row if present; nothing else                            | freed, `onSaved`                                                                                                        | none                           |
| `moved`   | own row present: mark it `refusal: "superseded"`; no clip, no take | own row present: freed. Row given up: stays held, failed, kind `superseded` (PR 4)                                      | once, `"pending-take-refused"` |
| `claimed` | nothing                                                            | freed                                                                                                                   | once, `"pending-take-refused"` |
| `gone`    | delete own row if present                                          | first attempt: freed (the coordinator's #38 reading: delete on `segment-gone`). A Retry: failed, kind `stale`, as today | once, `"pending-take-refused"` |

**Why `claimed` frees the slot.** Under §3, a hold never overwrites a row for
another clip, and only these steps remove a row that was not given up: this
take's commit in another copy (`done`, unless the segment then moved:
`moved`), a delete of the segment (`gone`), and this take's Discard in
another copy. So `claimed` means another copy discarded this take, which a
person confirmed there. Freeing the slot honours that. This list of removers
is read from the code paths in §3, not proven by a test; a new writer of
`pendingTakes` would have to be checked against it (inference).

**Why `rowGivenUp` ignores the row.** After a quota give-up, another copy may
hold the segment with its own take (its own row). That does not make this
take stale: if the revision is unchanged, nothing has replaced the audio yet.
This is George r7's Medium: a foreign row must not park the only copy on a
screen with no Retry. Here it does not park it at all.

**The ordinary commit** does not ask for permission (today's contract,
#1551). It deletes its own row in its transaction and moves the revision. It
uses the verdict only for `done` (a hold that found its own take, step 2).

## 5. State table

### The states

| State          | On disk                                                                                                  | In a slot                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Never recorded | segment, `activeTakeId: null`, revision `r`; no row                                                      | nothing                                                                             |
| Recorded       | segment, `activeTakeId: t`, revision `r`; no row                                                         | nothing                                                                             |
| Erased         | segment, `activeTakeId: null`, revision `r` ≠ any revision a row was written at before the erase; no row | nothing                                                                             |
| Deleted        | no segment row (tombstone); no row, or a row a pre-rebuild build left                                    | nothing                                                                             |
| Replay pending | segment at revision `s`; an unmarked row: clip `c`, `baseRevision: b`                                    | no copy holds `c` (after a kill)                                                    |
| Retry pending  | segment at revision `s`; own row (a non-quota failure) or none (given up for quota)                      | failed take `c`, attempts ≥ 1. Fresh (ordinary) or replayed (`b` carried in memory) |

### The operations

Save, erase and delete are by either copy. Replay is the launch replay's
first attempt on a row. Retry and Discard are taps on the recovery screen.
Launch recovery is what the next launch does if the app is killed in that
state.

### The matrix

Each cell's code is defined in the table after it.

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

Test files: PR 1 `tests/audio-revision.test.ts`; PR 2
`tests/pending-lifecycle-store.test.ts` (store) and
`tests/use-save-take-pending.test.ts` (existing file, hook); PR 3 and PR 4
`tests/recover-pending-takes.test.ts`, and `tests/save-failed-superseded.test.ts`
(render harness) for PR 4. "Red against" says where the new test must be seen
failing first.

| Cell   | What happens                                                                                                                                                                                                                                                                                                                                                                                                        | Red-first test                                                                                                                                                                                                                                                                                                                                                                                                    | Red against                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NONE   | No row and no slot: the replay finds nothing, and a launch writes nothing.                                                                                                                                                                                                                                                                                                                                          | PR 3: "a launch with no rows makes no write"                                                                                                                                                                                                                                                                                                                                                                      | a mutation that writes a log row on an empty list                                                                                                                                                                                                                                     |
| NOSLOT | No slot: Retry and Discard have nothing to act on.                                                                                                                                                                                                                                                                                                                                                                  | existing: `tests/pending-take.test.ts:154` "has nothing to do with an empty slot", `:318` "names nothing when there is nothing held"                                                                                                                                                                                                                                                                              | existing pins                                                                                                                                                                                                                                                                         |
| NR-S   | Hold writes the row at `b = r`. The commit writes clip and take, moves the revision to `r + 1`, and deletes the row, in one strict transaction.                                                                                                                                                                                                                                                                     | PR 2: "a save moves the revision and deletes its own row in the commit's transaction"                                                                                                                                                                                                                                                                                                                             | develop (the delete is a separate relaxed transaction)                                                                                                                                                                                                                                |
| NR-E   | `clearSegmentTake` on a segment with no take: nothing removed, revision unchanged.                                                                                                                                                                                                                                                                                                                                  | PR 1: W3 "clearing a segment with no take leaves the revision"                                                                                                                                                                                                                                                                                                                                                    | mutation W3                                                                                                                                                                                                                                                                           |
| NR-D   | `deleteSegment` removes the segment and writes its tombstone; there is no row to remove.                                                                                                                                                                                                                                                                                                                            | existing: `tests/delete-segment.test.ts`                                                                                                                                                                                                                                                                                                                                                                          | existing pins                                                                                                                                                                                                                                                                         |
| RC-S   | As NR-S. The prior take goes and its clip is deleted only if unreferenced (`deleteClipIfUnreferenced`, `takes.ts:195-203`).                                                                                                                                                                                                                                                                                         | PR 1: W1 "a save moves the revision by one"; existing `tests/take-clip-refcount.test.ts`                                                                                                                                                                                                                                                                                                                          | mutation W1                                                                                                                                                                                                                                                                           |
| RC-E   | The take and its unreferenced clip go; the revision moves.                                                                                                                                                                                                                                                                                                                                                          | PR 1: W2 "an erase that removes a take moves the revision by one"                                                                                                                                                                                                                                                                                                                                                 | develop (no field)                                                                                                                                                                                                                                                                    |
| RC-D   | As NR-D, with the take and clip deleted as today.                                                                                                                                                                                                                                                                                                                                                                   | existing: `tests/delete-segment.test.ts`                                                                                                                                                                                                                                                                                                                                                                          | existing pins                                                                                                                                                                                                                                                                         |
| DL-S   | The hold finds no segment and writes no row. The commit fails as a missing segment: the `stale` recovery screen, Discard only (#607, existing).                                                                                                                                                                                                                                                                     | PR 2: "a hold for a deleted segment writes no row"                                                                                                                                                                                                                                                                                                                                                                | develop (the write puts a row for any `segmentId`)                                                                                                                                                                                                                                    |
| DL-E   | `clearSegmentTake` throws; the erase reports `"erase-segment"`, and a cut-to-empty close returns `"stale"` (existing).                                                                                                                                                                                                                                                                                              | existing: `tests/use-erase-segment.test.ts`                                                                                                                                                                                                                                                                                                                                                                       | existing pins                                                                                                                                                                                                                                                                         |
| DL-D   | Idempotent: `deleteSegment` returns `null` and writes nothing (existing).                                                                                                                                                                                                                                                                                                                                           | existing: `tests/delete-segment.test.ts`                                                                                                                                                                                                                                                                                                                                                                          | existing pins                                                                                                                                                                                                                                                                         |
| DL-P   | A row left by a build before PR 2 for a segment that is gone: verdict `gone`. The row is deleted in the owning transaction and reported once. Same at launch recovery.                                                                                                                                                                                                                                              | PR 3: "a row whose segment was deleted is removed and reported once"                                                                                                                                                                                                                                                                                                                                              | PR 2's head (no replay)                                                                                                                                                                                                                                                               |
| DL-R   | A held take whose segment was deleted: Retry finds `gone`, writes nothing, and shows the `stale` screen, as an ordinary save does today.                                                                                                                                                                                                                                                                            | PR 3: "Retry of a replayed take whose segment was deleted writes nothing and shows the deleted-segment screen"                                                                                                                                                                                                                                                                                                    | PR 2's head                                                                                                                                                                                                                                                                           |
| DL-X   | Discard settles: own row deleted if present; the orphan clip deleted only if no take names it.                                                                                                                                                                                                                                                                                                                      | PR 2: "Discard deletes its own row, and an orphan clip only when no take names it"                                                                                                                                                                                                                                                                                                                                | develop (`deleteClip` is unconditional, `clips.ts:91-101`)                                                                                                                                                                                                                            |
| RP-S   | A new take on the same segment before the replay reaches the row. Its hold finds a row for another clip: `kept-foreign`, no safety copy, reported. Its commit is ordinary: revision `s + 1`. The replay then finds `moved`: the row is marked `superseded`, kept, reported once.                                                                                                                                    | PR 2: "a hold never overwrites another take's row"; PR 3: "a row whose segment was saved after it was written is kept, marked and not saved"                                                                                                                                                                                                                                                                      | develop (`:184` replaces the row)                                                                                                                                                                                                                                                     |
| RP-E   | The segment is erased (by either copy) after the row was written: revision `s ≠ b`. The replay finds `moved`, marks and keeps the row, writes nothing. **Frank r6's sequence** (a first-take row at `b`, another copy saves then erases, both pointers `null`).                                                                                                                                                     | PR 3: "a first-take row is not replayed onto a segment another copy saved and then erased"; and its pair, "a first-take row is replayed onto an empty segment nobody changed"                                                                                                                                                                                                                                     | PR 2's head (no replay); then the mutation "the verdict compares `activeTakeId` with the row's take instead of the revision" (#1546's check) must kill the first                                                                                                                      |
| RP-D   | The delete removes the segment and its row in one transaction; nothing is left to replay.                                                                                                                                                                                                                                                                                                                           | PR 2: "deleting a segment removes its pending row in the same transaction"; "deleting a book removes the pending rows of its segments"                                                                                                                                                                                                                                                                            | develop                                                                                                                                                                                                                                                                               |
| RP-P   | Classify, read the recipe, install into the slot only if the live slot is empty (George r1), commit conditionally. `free`: write, revision `s + 1`, delete the row, one transaction. Another copy already finished it: `done`, nothing written. A newer save between the read and the commit: `moved`.                                                                                                              | PR 3: "replays a row whose revision is unchanged, and deletes it in the commit's transaction"; "a row another copy already finished reports saved and writes nothing" (#1557); "a newer save between the recipe read and the commit survives" (Frank r1); "an old row beside a newer take saved before launch is not replayed" (Frank r3); "a replay never displaces a take already in the live slot" (George r1) | PR 2's head                                                                                                                                                                                                                                                                           |
| RP-R   | No slot holds the take, so there is no Retry until the replay's attempt fails. A failed attempt (not quota) leaves the slot failed with `attempts: 1` and stops the run: the state becomes Retry pending.                                                                                                                                                                                                           | PR 3: "a failed replay shows the recovery screen, keeps the row and stops the run"                                                                                                                                                                                                                                                                                                                                | PR 2's head                                                                                                                                                                                                                                                                           |
| RP-X   | A quiet row has no Discard control. A refused row has none until #1562 item 2 is decided.                                                                                                                                                                                                                                                                                                                           | existing NOSLOT pins; no new test                                                                                                                                                                                                                                                                                                                                                                                 | n/a                                                                                                                                                                                                                                                                                   |
| RP-L   | Killed mid-replay. The commit is one transaction: either take, revision and row delete all landed (the next launch finds no row), or none did (the row is replayed again).                                                                                                                                                                                                                                          | PR 3: "a replay whose commit did not land replays once on the next launch"                                                                                                                                                                                                                                                                                                                                        | PR 2's head                                                                                                                                                                                                                                                                           |
| TP-S   | This copy: refused, the slot is held (existing pin). Another copy saves the segment: revision moves. A fresh take's Retry still commits unconditionally (today's contract, #1551). A replayed take's Retry finds `moved`: own row marked and kept, slot freed.                                                                                                                                                      | existing: `tests/pending-take.test.ts:77`; PR 3: "Retry of a replayed take after another copy saved writes nothing and keeps the row" (Frank r3)                                                                                                                                                                                                                                                                  | PR 2's head                                                                                                                                                                                                                                                                           |
| TP-E   | Another copy erases: revision moves. A replayed take's Retry finds `moved`. With its row (PR 3): marked and kept, slot freed. **With its row given up for quota (PR 4): this is Frank r7's sequence**: copy A's first-take replay fails on quota and gives the row up, copy B saves and erases, A taps Retry. The verdict is `moved`, nothing is written, and the take stays held as failed with kind `superseded`. | PR 3: "Retry after another copy saved and erased the segment writes nothing and keeps the row"; PR 4: "a quota Retry after another copy saved and erased the segment writes nothing and keeps the take held", and its pair, "a quota Retry on an empty segment nobody changed still saves"                                                                                                                        | PR 3's head (a replayed take never gives its row up); then the mutation "a given-up Retry is `free` whenever the row is absent" (#1546's rule) must kill Frank r7's test                                                                                                              |
| TP-D   | Another copy deletes the segment and its row. Retry finds `gone`: nothing written, `stale` screen.                                                                                                                                                                                                                                                                                                                  | PR 3: as DL-R                                                                                                                                                                                                                                                                                                                                                                                                     | PR 2's head                                                                                                                                                                                                                                                                           |
| TP-P   | This copy's replay stops at a held slot (`"busy"`). Another copy's replay of the same row commits `free`; this copy's Retry then finds `done`: nothing written, slot freed. Discard after that deletes no clip a take names (Frank r4).                                                                                                                                                                             | PR 3: "Retry after another copy's replay saved the same take reports saved and writes nothing"; PR 2's DL-X test covers the clip                                                                                                                                                                                                                                                                                  | PR 2's head                                                                                                                                                                                                                                                                           |
| TP-R   | The verdict decides; `free` writes, moves the revision and deletes the own row in one transaction. A quota failure again: the take stays failed; a fresh take's row is not rewritten after a give-up (existing #1540 rule).                                                                                                                                                                                         | PR 3: "a Retry of a replayed take keeps the replay's condition"; existing quota pins in `tests/use-save-take-pending.test.ts`                                                                                                                                                                                                                                                                                     | PR 2's head                                                                                                                                                                                                                                                                           |
| TP-X   | Discard settles in the owning transaction, chained after the take's hold settled. **George r6's stalled sequence**: the hold's transaction is stalled, the save fails, Discard is tapped, the stall is released. The Discard's delete starts only after the hold settled, so the row is absent at the end and a launch keeps the kept take.                                                                         | PR 2: "Discard waits for the take's hold to settle before its delete starts" (asserts the settle has not been called while the hold is stalled); "a Discard during a stalled hold leaves no row, and the launch keeps the kept take"                                                                                                                                                                              | mutations, since develop's write asks for `pendingTakes` only and cannot be stalled this way: "Discard settles without waiting for the hold" must kill the first; "the hold awaits its segment read before opening its transaction" (the #1546 `94a969a6` shape) must kill the second |
| TP-L   | Killed while held. Own row present: next launch is Replay pending for it. Row given up for quota: nothing on disk, the take is lost. That is the limit #38 has recorded since 2026-09-03: the row protects the kill-and-relaunch case, not the quota case.                                                                                                                                                          | PR 3: "a take killed while held with its row is replayed on the next launch"; PR 2: "a take whose row was given up leaves no row" (pins the documented limit)                                                                                                                                                                                                                                                     | PR 2's head; develop                                                                                                                                                                                                                                                                  |

### The two required sequences, step by step

**Frank r7** (cell TP-E, PR 4). Segment `S` is never recorded, revision `r`.

1. Copy A launches and replays a first-take row for `S` (`baseRevision: r`).
   Its commit fails on quota. A gives the row up (owning transaction) and
   adds the `clipId` to `pendingGivenUp`. The take stays held.
2. Copy B saves `S` (revision `r + 1`), then erases it (revision `r + 2`).
   `activeTakeId` is `null` again.
3. A taps Retry. The conditional commit reads segment revision `r + 2`, no
   active take, no row. Verdict: not `gone`, not `done`, `moved`
   (`r + 2 ≠ r`). Nothing is written.

Under #1546 at `c3a4f4feb` the same steps saved A's take, because both
pointers were `null` and no row was required on a Retry. The pair test runs
steps 1 and 3 with no step 2 and expects the save.

**George r6** (cell TP-X, PR 2). A kept take `K` is active on `S`.

1. An edit of `S` is saved. Its hold is created but stalled: the test holds a
   read-write transaction on `segments` open, so the hold cannot start.
2. The commit fails at once (injected), and the take is held as failed.
3. Discard is confirmed. Under the chain, its settle is not yet created.
4. The stall is released. The hold runs: it puts the row. Then the settle
   runs: it deletes the row.
5. No row remains. A launch makes no write and `K` is still active.

Under #1546 at `94a969a6` the hold awaited a segment read before opening its
transaction, the Discard's delete committed in that gap, and the delayed put
brought the row back.

## 6. Every #1546 finding against this design

| Round, lens, finding                                                                 | Where it lands here                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| r1/r2 Frank: a newer save between the recipe read and the commit is overwritten      | `moved` (RP-P)                                                                                                     |
| r1 George: the replay saved a take it never installed in the slot                    | carried as is: `writeSlot` and the `installed` check (RP-P)                                                        |
| r3 Frank: an old row beside a newer take saved before launch                         | `moved` (RP-P): `b` is from the row's write, not from the replay's read                                            |
| r3 Frank: Retry dropped the condition                                                | the replayed take carries `baseRevision`; every Retry is conditional (TP-R)                                        |
| r4 Frank: Discard deleted a clip another copy had made active                        | Discard's settle deletes only an unreferenced clip (DL-X, TP-P)                                                    |
| r5 George: the target was written after the row                                      | the hold reads the revision and puts the row in one transaction (§3, "The hold")                                   |
| r5 George (Medium, #1557): a full inline row rewritten after another copy deleted it | `done` before anything else, and no verdict writes a new row (§4)                                                  |
| r6 George: a read awaited before the hold's transaction let a Discard win            | no read outside the hold's transaction, and the per-take chain (TP-X)                                              |
| r6 Frank / r7 Frank: an erase undone by a first-take replay or a quota Retry         | the revision (RP-E, TP-E)                                                                                          |
| r7 George (Medium): a foreign row parks the only copy on the no-Retry screen         | a hold never overwrites a row; `rowGivenUp` ignores a foreign row; `claimed` only means "discarded elsewhere" (§4) |
| r7 George (Low): a kept refused row is re-read from `clipData` every launch          | classification before any recipe read (§3, "The replay's own reads")                                               |

## 7. The open follow-ups

- **#1557 (one ownership predicate): folded in.** §4's `judgePending` is that
  predicate, and its three answers are `done`, `free` with `rowGivenUp`, and
  `claimed`. Its red-first test is in RP-P. Recommendation: close #1557 when
  PR 3 merges, citing this note.
- **#1548 (a discarded take must not come back): folded in, without the
  mark.** A mark written by the Discard is a write with the same window as
  the delete it would precede: a kill before it commits leaves the row
  unmarked. The two real windows close differently. A put that lands after
  the delete is closed by the per-take chain (TP-X). The relaxed delete is
  replaced by a strict settle in the owning transaction. What is left is a
  kill between the Discard tap and that one transaction's commit, which every
  write in the app has. Recommendation: close #1548 when PR 2 merges, citing
  this note and naming that residual.
- **#1549 (a recording refused while the replay holds the slot): stays
  separate.** It is the recorder's and the slot's behaviour, not the row's
  lifecycle, and needs no schema. This design narrows its window: the replay
  installs into the slot only after the recipe read, and frees it at the
  commit. It should follow PR 3, which creates the window.
- **#1562 item 1 (the screen a lost race shows): partly folded in, one
  decision open.** Most lost races show nothing now: a `moved` take with its
  row is marked and kept on disk, and `claimed` honours a Discard. One case
  still needs a screen: a replayed take whose row was given up for quota and
  whose segment then moved (Frank r7's sequence). Its only copy is in memory,
  and saving it would replace newer audio. The words, and what Try again
  does there, are the requirements owner's (§9). PR 4 builds it.
- **#1562 item 2 (refused rows keep their audio forever): stays separate.**
  It decides when refused audio may go, which is the requirements owner's
  call. This design adds a reason to decide it: a hold never overwrites a
  row, so a kept row also takes the safety copy away from the next save on
  that segment (§3, `kept-foreign`). Deleting a segment or a book now drops
  its rows (RP-D).
- **#1551 (should an ordinary Save check its target): stays separate.** It
  changes what a person's own Save does. The revision makes it cheap: the
  recorder would carry the revision it read when it loaded the segment's
  audio, and the ordinary commit would ask §4's verdict too. This note does
  not decide it.
- **#1545 (the recorder passes a stored-clip `source`): unaffected.** A
  `stored` base is still guarded by `generation` and `frameCount` at the
  recipe read, and the revision covers a base replaced by a save.

## 8. The rebuild, in order

Each PR is cut from develop, cites this note, and stays under the 500-line
production cap. The line counts are estimates, scaled from #1546, whose
storage and hook changes measured +514 / -134 in `src/` (inference).

| PR  | Delivers                                                                                                                                                                                                                                                                                                                                                                                      | Tier       | Estimate | Cells                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------- |
| 1   | v13: `Segment.audioRevision`, the migration step, the creators, and the moves in `writeTakeInTx` and `clearSegmentTake`. The living sentences that name the schema change move from "11 to 12" to "11 to 13": `AGENTS.md` (the rollback paragraph), `docs/release/promotion-v1.0.0.md` §5, and the facilitator runbook if it names 12.                                                        | T1         | ~150     | NR-E, RC-S, RC-E; §2's tests                                                            |
| 2   | The owning transaction for ordinary saves: the hold reads the revision in its transaction and never overwrites a row; `saveTake` deletes its own row; Discard and give-up settle in the owning scope, chained after the hold; `deleteClip`'s callers go through the unreferenced check; `deleteSegment` and `deleteBook` drop rows; `baseRevision` on the row. Replaces the pins named in §3. | T1, T2     | ~300     | NR-S, DL-S, DL-X, RP-D, TP-X, TP-L                                                      |
| 3   | The launch replay: classification, `judgePending`, `saveReplayedTake`, the replay loop, the slot guard (`writeSlot`, `installed`), the quiet first attempt, conditional Retry. A replayed take keeps its row on quota. The AGENTS.md failure-log list gains `"pending-take-refused"` and `"pending-take-read"`, and the runbook §5 says what the quiet finish does.                           | T1, T2     | ~400     | DL-P, DL-R, RP-S, RP-E, RP-P, RP-R, RP-L, TP-S, TP-E (row kept), TP-D, TP-P, TP-R, NONE |
| 4   | A replayed take gives its row up on quota, and the held `superseded` state with its screen. Waits for §9's decision.                                                                                                                                                                                                                                                                          | T1, T2, T3 | ~120     | TP-E (Frank r7)                                                                         |

**Why the split falls between 3 and 4.** The only state that needs new words
on screen is a replayed take whose row was given up and whose segment then
moved. Without the give-up, that state cannot happen, and PR 3 ships no new
UI. Keeping the row on a quota failure costs space, not audio: the Retry
needs room for the row and the new clip together, so on a full phone it
fails again until space is freed (inference; not measured).

If PR 3 measures over 500, its split point is the loop: the store half
(`judgePending`, `saveReplayedTake` and the classification, with their Node
tests) and the hook half. The store half then needs a consumer in the same
PR, so the split is only worth it if the count is well over.

## 9. Open for the requirements owner

1. **A take whose segment changed while its only copy was in memory**
   (#1562 item 1; PR 4). Saving it would replace the newer audio, or put
   audio back into a segment someone erased. Recommended default, until
   decided otherwise: keep it held; Discard deletes it; Try again stores it
   to the side as a kept refused row (the same place a `moved` take with its
   row already goes) and never over the newer audio. The words for this
   screen are part of the decision.
2. **How long a refused row keeps its audio** (#1562 item 2). Unchanged by
   this note, and more pressing because of `kept-foreign` (§7).

Neither blocks PR 1, 2 or 3.

## Residuals

Each is inferred from the code and this design. None has been seen.

1. **A kill inside the Discard's own commit window** brings the discarded
   take back on the next launch. Every write has this window (§7, #1548).
2. **Two copies replay the same row; one gives it up for quota and the other
   discards it.** The first copy's Retry, finding the revision unchanged,
   saves the take the second copy discarded. `rowGivenUp` cannot tell this
   apart from the case it exists for.
3. **`kept-foreign` costs a safety copy.** A save on a segment that holds a
   kept refused row, or another copy's live row, has no kill protection.
4. **A refusal mark rewrites the whole row.** A `put` of a row with a
   20-minute take re-serialises its audio. A quota failure there aborts the
   mark, and the next launch reports the row again: a repeated log line,
   never a lost row.
5. **Store-level ordering.** Adding `pendingTakes` to the owning scope means
   a commit in one copy can wait behind a hold for a different segment in
   another copy. Holds are one short transaction each, but a long take's
   inline row is large (inference; not measured).
6. **A fresh take's Retry is still unconditional** (#1551).
