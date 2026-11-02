# 0013 — How recordings live on the microSD card

**Status:** Proposed · **Date:** 2026-10-29 · **DRI:** the dev lead drafts;
the DRI decides · **Issue:**
[#1473](https://github.com/unfoldingWord/tc-mobile/issues/1473), part of the
card epic [#1456](https://github.com/unfoldingWord/tc-mobile/issues/1456)

This ADR is **Proposed**. It is written **before** the spike that gates it.
[#1472](https://github.com/unfoldingWord/tc-mobile/issues/1472) holds no
findings comment, and `docs/progress_tracker.md` records no run of it. The
probe and its run sheet exist only on the draft, never-merged branch
`spike/card-store` (PR
[#1532](https://github.com/unfoldingWord/tc-mobile/pull/1532)), whose Java its
own body says has not been compiled.

So **no sentence below says what a phone does.** Each fact that needs a phone
is marked **owed to #1472 Pn**, where Pn is the row of #1472's run sheet that
would observe it. What Android's documentation is expected to show is quoted
from #1472's scope, not from a fetched document, and is labelled as such.
Inference and assumptions are labelled. Whoever accepts this ADR does so after
the findings comment exists, and rewrites each owed line from it.

Revised 2026-11-02 to close the four residuals tracked on #1473 (three named
when [#1785](https://github.com/unfoldingWord/tc-mobile/pull/1785) merged, one
added after): the state table now decides every delete, a checked `.part` that
is the only copy is kept, backup recovery records its winner, and a checked
read-back precedes any delete of `clipData` or release of a held take. Status
stays Proposed. The #1472 spike still gates acceptance, and every test name
below is a planned test, not a test that exists.

## Context

[ADR 0011](0011-v2-storage-and-export.md) records the decision that recordings
may live on the card (D2-microsd: "Record straight onto the card, and back up to
it") and its consequence that each failure mode "needs a defined behaviour and a
test before it ships". It does not say where on the card, in what form, or how a
save stays all-or-nothing across a file and the database. This ADR is that
record, so the build children of #1456 do not each decide it.

What ADR 0011 and the v2 plan already settle, quoted from the
[v2 plan](../design/v2-plan.md#round-2-decisions-recorded-2026-10-19) (the
requirements owner, 2026-10-19):

- **R5:** "Yes: card recording and backup are Android-app features". iOS and
  the web build keep IndexedDB only.
- **R16:** "Off by default; a facilitator switches it on", with the note "On
  launch, when the app notes that a micro SD card is available, it should
  prompt the user if they want to record directly to the card. Default is to
  record to internal."
- **R17:** "No: plain audio files the app owns". Card files are not encrypted.
- **R4:** "Backup only in v2; restoring on a phone comes with import".
- **D2-microsd's note:** "Removing a card mid-recording is highly unlikely, so
  should be warned against, but not worried about."

### What the code is today

Read at `origin/develop` `292611b6`.

- **The seam exists, with one backend.** `src/lib/storage/clip-bytes.ts`
  (#1751, PR #1768) is the only module that reads, writes, probes or deletes a
  clip's bytes. Its interface is `read`, `has`, `write` and `delete`
  (`clip-bytes.ts:50-72`), and its only implementation is the `clipData`
  object store (`clip-bytes.ts:75-84`). `tests/clip-bytes-seam.test.ts` keeps
  every other file off the store name.
- **The seam is bound to the caller's IndexedDB transaction.** Each method
  takes the transaction that also holds the take, segment or pending-row change
  (`clip-bytes.ts:11-16`). That is how a save's bytes land or roll back with its
  take row: "One transaction removes the half-written state entirely"
  (`takes.ts:301`), with the write at `takes.ts:364` (`saveTake`),
  `takes.ts:490` (`saveReplayedTake`) and `transcode.ts:206`
  (`commitTranscode`). The seam's own docblock says that a backend which
  cannot join an IndexedDB transaction "needs a different contract"
  (`clip-bytes.ts:14-16`). This ADR proposes that contract.
- **Reads happen inside a transaction too.** The segment walk reads bytes at
  `segment-audio.ts:112` and probes for them at `segment-audio.ts:115`;
  `getClip` reads at `clips.ts:83`; the pending-take paths read at
  `pending-takes.ts:284` and `:371`, and the replay's keep check at
  `takes.ts:243`.
- **The one delete** is `deleteClipIfUnreferenced` (`clips.ts:149`, the delete
  at `:156`), which keeps the reference check: "Every path that lets go of a
  clip goes through here" (`clips.ts:133`).
- **The index stays in IndexedDB.** `clipMeta` is not behind the seam
  (`clip-bytes.ts:18-19`). `ClipMeta` records the encoding and the byte length
  (`src/types/audio.ts:47`, `:56`) and nothing about where the bytes live.
- **The schema is at version 14** (`db.ts:180`). `clipData` is an
  `ArrayBuffer` keyed by `ClipId` (`db.ts:275`).
- **A held take keeps its audio in IndexedDB.** A `pendingTakes` row carries
  the take's PCM as `recorded` (`src/types/domain.ts:312`), written by
  `writePendingTake` (`pending-takes.ts:188`).
- **Android.** `allowBackup="false"`, with the reason in the comment above it
  (`android/app/src/main/AndroidManifest.xml:4-9`). The permissions are
  `INTERNET`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` only (`:45-53`).
  `minSdkVersion = 24` and `targetSdkVersion = 36`
  (`android/variables.gradle:2`, `:4`). `@capacitor/filesystem` is used for
  share staging in `Directory.Cache` only (`src/hooks/share-target.ts:388-393`),
  in chunks of `SHARE_CHUNK_BYTES = 384 * 1024` (`share-target.ts:50`).
- **Uninstall deletes every recording today**, because IndexedDB is the system
  of record and backups are off (`docs/native/README.md:77-79`).
- **The plugin work is held.** The DRI's 2026-10-22 pick on #1520 holds new
  Capacitor-native plugin work, "including #1456", until
  [ADR 0016](0016-capacitor-or-expo.md) reports (`0016-capacitor-or-expo.md:31-32`).
  ADR 0016 is Proposed and recommends lifting the hold. This ADR does not
  lift it; it gives the plugin a contract to be built against once it lifts.
  ADR 0016 also records that the same Java would carry into an Expo module.

## Options

### Where a clip's bytes live (from #1472's scope)

| Option                         | What it means                                                                              | Meets "record straight onto the card"?                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **O1** Mirror on Finished      | IndexedDB stays the home of every clip; a Finished MP3 is copied to the card.              | No. The working PCM still fills the phone (inference).                  |
| **O2** Card is the clip's home | With the card switched on, a clip's bytes are a file on the card; `clipMeta` points at it. | Yes.                                                                    |
| **O3** Capture spool           | Audio streams to the card while recording.                                                 | Out of scope: streaming during capture is #1093.                        |
| **O4** Write-through           | Every clip is written to IndexedDB and to the card.                                        | In part; it doubles the writes and does not free the phone (inference). |

**Proposed: O2**, the recommendation #1472 and #1456 already make. Whether it
holds is owed to #1472: its acceptance criterion 2 passes O2 only when P1, P4,
P5 and P6 pass on an Android 11+ phone and an Android 7–10 phone, and a
20-minute save meets a threshold the DRI has not set. If O2 fails, the fallback
is O1, and that is a question for the requirements owner, because O1 does not
meet "record straight onto the card" (#1472, acceptance criterion 4).

### Android storage access paths

Each path below is described from #1472's scope and the spike's run sheet,
which state what Android's documentation leads us to expect. None has been
observed on a phone.

| Path                                                                                                    | Permission               | On uninstall                                                  | Proposed use                                       | Owed to             |
| ------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- | -------------------------------------------------- | ------------------- |
| **A. The app's own folder on the card** (`getExternalFilesDirs(null)`, the removable entry)             | None expected            | Expected deleted; `hasFragileUserData` may offer to keep it   | Clip bytes (O2)                                    | P1, P7, P11         |
| **B. A folder the user picks** (Storage Access Framework, `ACTION_OPEN_DOCUMENT_TREE`, persisted grant) | The user's pick          | Expected to stay; whether the grant survives anything is owed | The backup only                                    | P8                  |
| **C. `@capacitor/filesystem` with a full card path**                                                    | Unknown                  | As A, if it writes into A                                     | Decides whether A needs a custom plugin for writes | P11                 |
| **D. A browser folder picker** (`showDirectoryPicker()` in Chrome on Android)                           | The user's pick          | Unknown                                                       | None in v2: R5 makes the card an app feature       | P10 (evidence only) |
| **E. Broad storage access** (`MANAGE_EXTERNAL_STORAGE`) or MediaStore                                   | A special grant, or none | MediaStore files outlive the app (assumption)                 | Not proposed                                       | Not in #1472        |

Why A for the clips (inference, from the scope): it needs no permission prompt,
it is private to the app on the phone, and it goes away on uninstall the way
IndexedDB does, so the index and the bytes share one fate. R17's "plain audio
files the app owns" fits it. Anyone holding the card in a reader can still read
the files; R17 accepts that.

Why B only for the backup (inference): a backup is meant to outlive the app,
and a user-picked folder is the path expected to survive uninstall. #1472 P8
expects that on Android 11 and later the card's root cannot be picked, and asks
what the user must do instead; owed to P8.

Path E is not proposed and is not probed. It is listed so its absence is a
choice, not an oversight. The assumption behind leaving it out is that a broad
storage grant is a store-review and trust cost the app does not need when A
and B cover the two uses; that is not checked here.

### The seam's contract for a card backend

The seam is transaction-bound (`clip-bytes.ts:11-16`). A native file write
cannot be a request inside an IndexedDB transaction. An IndexedDB transaction
also commits once no request of its own is pending, so awaiting a native call
inside one ends it (from the IndexedDB specification's auto-commit rule, not
observed here; #1768's PR body records a nearby case, a mutation that awaited
a dynamic import mid-transaction and failed 74 tests with `InvalidStateError`).

| Contract                                            | What changes                                                                                                                                                                                                                                           | Cost                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **S1** Two phases around the transaction (proposed) | Bytes move outside any transaction: staged and made durable before it, deleted after it under §3's delete predicate. Inside it, the seam records and reads only a **location** on `clipMeta`. The IndexedDB backend keeps today's in-transaction path. | Every write, read and delete site in the #1768 table changes shape: read the location in the transaction, move bytes outside it. |
| **S2** Keep the card behind the existing methods    | `write` etc. call the plugin from inside the transaction.                                                                                                                                                                                              | Breaks the transaction (above). Rejected.                                                                                        |
| **S3** Card bytes in IndexedDB first, moved later   | Every save lands in `clipData`, and a sweep moves it to the card.                                                                                                                                                                                      | The phone still has to hold every take at least once, which is what #339's field evidence says it cannot (inference).            |

**Proposed: S1.** It keeps #1751's rule that only the seam knows where bytes
live, and it keeps the take row, the metadata and the pending-row change in one
transaction, which is the #38 property.

## Decision (proposed)

### 1. Where the files go

On a phone where the card store is switched on, a clip's bytes are one file in
the app's own folder on the card (path A), named `<clipId>.<n>.pcm` while the
segment is being worked on and `<clipId>.<n>.mp3` once it is Finished, where
`<n>` belongs to one write attempt (§3). A file never holds anything else. Whether the folder is reachable without a custom plugin is
owed to P11; how it is found, and that its volume reports removable and
mounted, is owed to P1.

### 2. The schema: where a clip lives

`clipMeta` gains a location: IndexedDB, or the card, naming the card's volume
by the UUID that P1 is asked to show is stable across reboot and reinsertion,
and the exact file (§3). A card location also carries the file's CRC32, by which this ADR means
CRC-32/ISO-HDLC: polynomial 0x04C11DB7 (reflected, 0xEDB88320), initial value
0xFFFFFFFF, reflected input and output, final XOR 0xFFFFFFFF, the variant zlib
and `java.util.zip.CRC32` compute (from the algorithm's published definition,
not checked against the plugin). It is stored as unsigned 32 bits. The plugin
child pins the variant with a known-answer test: "the CRC32 of the ASCII string
123456789 is 0xCBF43926".
That is a schema step, `DB_VERSION` 15 at the earliest (`db.ts:180` is 14),
and it is the "Schema v13: where a clip's audio lives" child in #1456's list,
renumbered because v13 and v14 have shipped.

- The step is append-only: every existing row reads as IndexedDB, and no bytes
  move in the migration.
- A row's location changes only in the same transaction as the take row that
  makes the clip current, never on its own.
- AGENTS.md's rollback paragraph applies: once a phone has opened v15, an
  older build cannot open the database. The PR that raises the version adds
  the rollback line there.
- If the volume UUID is not stable (P1), the location names the volume some
  other way, and this section is rewritten before the schema child is built.

### 3. The commit protocol

**Every write attempt owns its file.** An attempt writes
`<clipId>.<n>.<pcm|mp3>`, and the `clipMeta` location names that exact file. A
save may be retried under the same `clipId` (`takes.ts:307-308`), so a shared
name would let a failed retry overwrite or delete the bytes an earlier attempt
committed. So the name is exclusive:

- `<n>` is one safe path segment, chosen so that `<name>` matches no file in
  the card folder (`.part` or final) and no `clipMeta` location, in this launch
  or any earlier one. A counter that restarts each launch does not meet this.
  Its alphabet is lowercase ASCII letters and digits, `[0-9a-z]`, one to 32
  characters, with no `.`, `-`, `/` or uppercase. No dot, so that
  `<clipId>.<n>.<ext>` splits unambiguously. Lowercase only, because a card
  formatted FAT or exFAT is expected to fold case, so two names differing only
  in case would be one file (inference, owed to P1).
- The `.part` is created exclusively (it fails if its name exists), and the
  rename to `<name>` never replaces an existing file. If the `.part` cannot be
  created, the attempt fails as in row S1. If `<name>` exists at the rename,
  the check has already passed, so the attempt fails as in row S1c: it keeps
  its `.part` and reports it: Keep (c), then S2 or S2b at the next sweep.
- A `clipId` is a `crypto.randomUUID()` (`clips.ts:14`), one safe path segment.

Tests (commit-protocol child), read off the rule above: "a retry in a later
launch does not reuse a name a row already names, or the name of a file the
sweep kept (S1c, S1d, S2b, S3b, S4, S5b)" and "a restarted attempt refuses to rename onto a
name clipMeta already stores".

**The ownership rule.** A card file belongs to a row only through the full pair
the row stores: the volume and the file name `<clipId>.<n>.<ext>` (§2).
"Names", everywhere in this ADR, means that pair. From it:

- Steps 3 and 4 delete only a pair this attempt created (step 1) or read in its
  own transaction (step 2), and only as Delete (a) or Delete (b) (the delete
  predicate, below). Nothing deletes by `clipId` or by file name alone.
- A row whose location names **another volume** than the inserted card may own
  any file on the inserted card that carries its `clipId`: the volume id may
  not be stable (owed to P1), the card may be a different one, or a reader may
  have rewritten the id. So every such file is a possible copy of that row's
  take, so it is Keep (c) while the mismatch lasts (V1, V2). This covers a `.part` as well as a final file: a `.part`
  carrying that `clipId` may be a checked copy of the take. The app reports
  "card not present" or "card changed" (§4).
- The sweep deletes an unnamed final file only as Delete (b), by the state
  table's row for it (S3, S7, T2, T3). No sentence in this section adds a
  condition.
- **Precedence, one rule.** The state table decides, by the case label in its
  Case cell. Where a sentence in this ADR reads differently from a row, the row
  decides and the sentence is a defect to repair. Where the table itself is
  silent or ambiguous (no row fits, or two rows fit with different cases), the
  file is Keep (c).

Tests (commit-protocol child): "a volume mismatch does not delete the files on
the inserted card" (V1) and "a volume mismatch does not delete a .part on the
inserted card" (V2).

**The delete predicate.** This is the only condition under which this ADR
deletes a card file. It has
three cases, defined once here, and every delete in this ADR cites a case by
its label. **State-table rows carry no delete condition of their own.** A
row's When-cell selects the situation, and its Outcome says only "Delete (a)",
"Delete (b)" or "Keep (c), report", who acts (this attempt, or the next
sweep), and any non-delete effect. **Any delete in this ADR that does not cite
a case label is a defect, and the file is kept and reported.**

> - **(a) DETERMINATE-FAIL.** A defined check ran to completion against a
>   durable reference and failed. The defined checks are the write's own
>   completion status and the length and CRC32 read-back against the bytes the
>   attempt holds. An interrupted, unavailable or I/O-errored check is **not**
>   this case. A previous-launch `.part` has no durable reference (open,
>   below), so (a) is not available to the sweep for one until that question
>   is decided.
> - **(b) DURABLE-COPY.** For **every** dependent take of the file, a durable
>   copy exists, and the set of dependents is not empty. A durable copy is a
>   complete pending row, a final disposition, or a named file whose length
>   **and** CRC32 match. A same-`clipId` file with different bytes is not a
>   copy. An empty dependent set is not (b). Bytes held only in memory are not
>   a copy.
> - **(c) KEEP.** Everything else. The file is kept and reported to the
>   failure log. A check that cannot be evaluated, a state table that is
>   silent or ambiguous, and a file that meets neither (a) nor (b) are all
>   (c). A file that is the only copy is never deleted under (c).
>
> **What "match" means.** For a `.part`, and for an unnamed final that no row
> records (rows S1c, S1d, S2, S2b, S3, S3b, S4), the copy's length and CRC32
> must equal that file's own. For a final that a committed row has superseded
> (rows S7, T0 to T4), the dependents are the takes the rows record, and the
> copy is the file the committed row names, which must pass the length and
> CRC32 stored in that row (§2): a transcode's MP3 differs in bytes from the
> PCM it replaces, and that is why the row, not the old file, is the
> reference.
>
> - **Takes that can depend on a file:** a committed take whose `clipMeta` row
>   is for the file's clip (the row may name this file or another), for a
>   superseded final only; an unsettled pending take whose `clipId` is the
>   file's clip (the file is its finished audio); and an unsettled pending
>   take whose `stored` base names the file's clip (`sourceClipId`,
>   `src/types/domain.ts:290`), because its recipe splices onto those bytes
>   (`pending-takes.ts:371-373`). A pending take whose disposition is final in
>   `takeDispositions` (`db.ts:294`), saved or discarded, is held by that
>   disposition, which is its durable copy.
> - **A durable copy counts only when that specific dependent can be rebuilt
>   without the file being deleted**, checked at the moment of the delete, one
>   dependent at a time:
>   - a committed take: the card file its own committed `clipMeta` row names
>     (volume and file, by the ownership rule) that passes its length and
>     CRC32 read-back, and that is not the file being deleted;
>   - a pending take whose `clipId` is the file's clip: its own row, when the
>     row is complete without this file (an `inline` base, or a `stored` base
>     whose bytes are satisfied as below);
>   - a pending take whose `stored` base names the file's clip: only bytes that
>     `baseClipIntact` (`pending-takes.ts:294`) accepts for that base, the
>     check the replay already makes (`pending-takes.ts:373`), held somewhere
>     other than this file. A Finished MP3 that passes its CRC never satisfies
>     a splice that needs the PCM.
>     A pending row is never the alternative for the file its own base reads.
> - A `.part` is never a durable copy for another file's delete, and no row
>   names one. One that passes its check, or whose check cannot be completed,
>   and meets neither (a) nor (b) is (c): kept and reported, never played as
>   audio. What a sweep checks a `.part` against is open (below).
> - Dependence reads through the ownership rule: while a row names another
>   volume, every file on the inserted card with that row's `clipId` is
>   possibly that row's file, so it is (c) while the mismatch lasts.
> - A file a committed `clipMeta` location names is its own take's only
>   committed copy, so it is (c) while that row names it.

The rule applies to the backup folder in the same way: the previous backup is
(c) until the new one has passed its read-back and the winner record names it
(§5), when it is Delete (b); a new backup that fails its read-back, run to
completion, is Delete (a).

A save to the card, in order:

1. **Before any transaction**, the plugin writes `<name>.part`, syncs it, reads
   it back, checks the length and CRC32 of what it read against the bytes it
   was given, and renames it to `<name>`. A final-named file has therefore
   passed that check before the rename. That the sync and the read-back reach
   the card rather than a cache, and that the rename holds after a kill or a
   power-off, is owed to P4. The outcomes of a failure in step 1 are the state
   table's, by case: the write failed or the read-back ran to completion and
   mismatched, Delete (a) (S1); the read-back could not finish, Keep (c)
   (S1d); the check passed and the rename failed, Keep (c) (S1c). A session's
   failed writes therefore do not fill the card, and a checked or unchecked
   `.part` is never deleted on doubt.

   **Step 1a, the checked read-back.** Still before any transaction, the
   plugin opens `<name>` by its final name, reads it whole, and checks its
   length and CRC32 against the bytes it was given. Step 1's read-back is of
   the `.part`, under another name and before the rename, so it does not show
   what the rename left. **Only a pass at 1a lets step 2 start.** No delete of
   a `clipData` row, no release of a held take, and no Delete (b) of a superseded
   file happens before it. The DRI's pick on #1473 (2026-10-29), verbatim:
   "4th residual on #1473 (Recommended)", which records that ADR 0013 must
   resolve this before it moves from Proposed to Accepted: a checked
   read-back of the card file (length and hash) comes before any delete of
   `clipData` or release of the held take. If 1a fails, no transaction opens
   and the held take and any `clipData` bytes are untouched. The file is then
   Delete (a) when the read-back ran to completion and mismatched (S1b), and
   Keep (c) when it could not finish (S1d).
   Whether the read at 1a reaches the card and not a cache is owed to P4.

2. **One strict IndexedDB transaction**, opened only after a pass at 1a, writes the take row, the `clipMeta`
   row with its card location and CRC32, and the pending-row change, the scope
   today's `saveTake` opens (`openTakeTx`, `takes.ts:65-76`). If it replaces a
   `clipMeta` row that named another file, it reads that file's name in the
   same transaction, so step 4 knows exactly which file it superseded. If the
   row it replaces located the clip in IndexedDB, the same transaction deletes
   that clip's `clipData` bytes through the seam (`clip-bytes.ts:81`), unless
   a pending `stored` base still reads them, and only as Delete (b): step 1a
   has passed, so the card file is the durable copy. The `clipData` delete and the release
   of the held take (the pending-row change) are the two steps that remove the
   only copy on the phone, so both belong to this transaction and to no
   earlier one.
3. **If that transaction ends without naming `<name>`** (it failed, or found
   the take already saved or discarded), the attempt reads `clipMeta` and
   `pendingTakes` again and acts on `<name>`, and nothing else, by the state
   table: Delete (b) when a durable copy exists (S5, S6), otherwise Keep (c),
   report (S5b). The take stays held in its `pendingTakes` row if it has one, as a
   failed save is today (`"save-take"`, #456).
4. **After it commits**, in the same session, the attempt deletes the exact
   file step 2 read as superseded, by that file's location: Delete (b) when
   every dependent has its durable copy (S7), Keep (c) when a pending `stored`
   base has none (S7b). This is not routed through `deleteClipIfUnreferenced`
   (`clips.ts:149`): after a transcode or a retry the `clipId` is still
   referenced, so a reference check would keep the file.
   `deleteClipIfUnreferenced` stays the path for a whole clip that nothing
   references any more (a take replaced by another clip, an erase, a delete).
   It already counts a pending `stored` base as a use (`bySourceClip`,
   `clips.ts:126`, `db.ts:286`), which is the predicate's third kind of
   dependent, and on the card it too deletes by the location its row names, as
   Delete (b). A delete that fails, or that ends as Keep (c), leaves the file for the
   sweep, never a dangling row.

Steps 3 and 4 delete only a file the attempt itself named or read. No attempt
deletes by `clipId`, so a failed attempt cannot remove the bytes another
attempt committed under the same `clipId` (row S6 of the state table below).

A read checks the file's length and CRC32 against its row; a mismatch takes
the missing-file path in §4 (reported, row kept, not played as audio).

The transcode on Finished (`commitTranscode`, `transcode.ts:153`) follows the
same steps, 1a included, so the PCM file is Delete (b) (T4) only after the new MP3 has
passed its own read-back at its final name and the transaction has committed.
It writes a new `<clipId>.<n>.mp3` beside the PCM file. That is for
a clip whose location is the card. A clip whose location is IndexedDB
transcodes as it does today, in one transaction that replaces its `clipData`
bytes (`transcode.ts:202`), and stays in IndexedDB; moving it to the card is
the separate "move existing recordings" child in #1456's list. Today it
replaces the PCM under the same key in one transaction (`transcode.ts:202`); on
the card the PCM and the MP3 briefly coexist, so the card needs room for both.

- **The guard stays.** Today a pending row whose `stored` base names this clip
  stops the transcode: it counts `bySourceClip` inside its transaction and
  returns `"stale"` without replacing the PCM (`transcode.ts:193-199`), and a
  later sweep converts the clip once the row has ended. On the card the same
  check runs inside step 2's transaction. When it fires, the step 2 transaction
  writes nothing, the PCM file stays named, and the new MP3 goes through step 3
  (row T0).
- If the transaction fails, step 3 acts on the new MP3 by the state table:
  Delete (b), the named PCM being the durable copy (T1).
- Once it commits, step 4 acts on the PCM by its exact location in the same
  session: Delete (b) when no pending base needs it (T4), Keep (c) when one
  does (T4b). The guard means no pending base needed it at the commit; a row
  that came later is checked again at the delete, and the MP3 is never its
  copy (T3b). The sweep is the crash path (T3,
  T3b).

**Where the durable copy is before step 1.** Each writer has a different one,
read from the code:

- `saveTake` (`takes.ts:310`): the take's `pendingTakes` row, if the hold kept
  one. The hook does not await the hold's promise (`use-save-take.ts:102`),
  but the database commit can still queue behind its transaction: the two
  share stores and the hold's is opened first, so IndexedDB orders the save's
  transaction after it (`use-save-take.ts:81-89`). Step 1's card write is not
  an IndexedDB request, so it is not ordered against the hold; whether the
  row is durable when step 1 starts is not guaranteed (inference). The hold
  can also keep nothing (another take's row holds the segment,
  `"pending-take-write"`). Without a row, the only copy is in memory until
  step 2 commits, as it is today. A row with a `stored` base is complete only
  while that base clip is present and intact (the delete predicate).
- `saveReplayedTake` (`takes.ts:433`): the launch replay saves a waiting take
  from its `pendingTakes` row, so that row is the durable copy, subject to the
  same base check (inference from its docblock, `takes.ts:396-408`).
- `commitTranscode` (`transcode.ts:153`): the PCM file the current `clipMeta`
  row names. ADR 0009's "the PCM is still there" holds until the commit.

A `pendingTakes` row carries the clip id its save will write (`clipId`,
`src/types/domain.ts:309`) and, for a `stored` base, the clip it splices onto
(`sourceClipId`, `:290`). The delete predicate reads both. No row names a file.

**The state table.** Every failure row in §4 and every test named for the
commit protocol is read off this table. **A row carries no delete condition of
its own.** Its When-cell selects the situation; its Case cell names which
delete-predicate case applies; its Outcome says only "Delete (a)", "Delete
(b)" or "Keep (c), report", who acts, and any non-delete effect. "Named" means
a `clipMeta` location names that volume and file. "Killed" covers a
force-stop and a power-off; what the card holds after each is owed to P4. All
tests belong to the commit-protocol child. The When-cells do not overlap, with
one stated exception: S7, T2 and T3 describe one shape (an unnamed final
superseded by a committed row) from three causes, and all three give the same
case per dependent, so a file matching more than one is not a conflict. Every
sweep row below holds only for a file whose `clipId` has no row naming another
volume; V1 and V2 own that case.

| Row | Path      | When                                                                                                                                                                                                          | Card file                              | Case       | Outcome                                                                                                                                                                                       | Test                                                                                                                                    |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | save      | Alive. The write failed or was refused (missing, full, read-only, write error, create refused), or the step 1 read-back ran to completion and mismatched                                                      | `.part` this attempt created, or none  | (a)        | This attempt: Delete (a) the `.part` it created. When creation was refused it created nothing, so it deletes nothing (the blocker may be an S1c or S2b file). Take held; §4's card rows apply | "a failed step 1 deletes its own .part and keeps the take held, and a refused create deletes nothing"                                   |
| S1d | save      | Alive. A read-back, step 1's of the `.part` or step 1a's of the final name, could not finish (I/O error, card unavailable, interrupted)                                                                       | `.part` or final, not named, unchecked | (c)        | This attempt: Keep (c), report. No transaction opens; the take stays held. The next sweep decides the file as S2, S2b, S3, S3b or S4                                                          | "an interrupted read-back keeps the .part"                                                                                              |
| S1c | save      | Alive. Step 1's read-back passed and the rename failed (including: the name exists)                                                                                                                           | `.part`, checked                       | (c)        | This attempt: Keep (c), report; never played as audio. The next sweep decides it as S2 or S2b                                                                                                 | "a checked .part whose rename failed is kept and reported unless a durable copy holds the take"                                         |
| S1b | save      | Alive. Step 1a's read-back of the final name ran to completion and mismatched                                                                                                                                 | Final, not named, failed its check     | (a)        | This attempt: Delete (a) that final file. No transaction opens; `clipData` and the held take are untouched                                                                                    | "a failed read-back after the rename opens no transaction, deletes only that file, and leaves clipData and the held take"               |
| S2  | save      | A previous launch's `.part`; (a) holds, or (b) holds with a complete pending row or a named file whose length and CRC32 match the `.part`'s                                                                   | `.part`                                | (a) or (b) | Next sweep: Delete (a) or Delete (b). "The take is lost" applies only under (a) when no row holds it, as today                                                                                | "a .part from a previous launch is deleted only under (a) or (b)"; "an older committed file with different bytes does not count as (b)" |
| S2b | save      | A previous launch's `.part` for which neither (a) nor (b) holds (it passes its check, cannot be checked, nothing depends on it, or only a different-bytes file exists)                                        | `.part`                                | (c)        | Next sweep: Keep (c), report, as S4; never played as audio. What a sweep checks a `.part` against is open (below)                                                                             | "a .part that is the only copy is kept and reported"                                                                                    |
| S3  | save      | A previous launch's unnamed final; no committed row for its `clipId`; a complete pending row carries its `clipId`                                                                                             | Final, not named                       | (b)        | Next sweep: Delete (b). The take's PCM stays in its IndexedDB row and the replay saves it                                                                                                     | "a kill after the rename leaves the take held when a complete pending row holds it, and the sweep removes the file"                     |
| S3b | save      | As S3, but the row's `stored` base is missing or corrupt, so the row is not complete                                                                                                                          | Final, not named                       | (c)        | Next sweep: Keep (c), report; it is the only complete copy                                                                                                                                    | "a completed orphan whose pending base is missing or corrupt is kept and reported"                                                      |
| S4  | save      | A previous launch's unnamed final with no pending row and no committed row for its `clipId`. Step 1's check passed; step 1a may not have run                                                                  | Final, not named                       | (c)        | Next sweep: Keep (c), report                                                                                                                                                                  | "an unnamed final file with no row and no meta is kept and reported"                                                                    |
| S5  | save      | Alive. Step 2 failed, or found the take discarded or saved with this attempt's own bytes, and a final disposition, a complete pending row, or a named file whose length and CRC32 match this attempt's exists | This attempt's final, not named        | (b)        | This attempt (step 3): Delete (b) its own file only                                                                                                                                           | "a failed save deletes only its own file"                                                                                               |
| S5b | save      | Alive. Step 2 failed, and none of the three durable copies in S5 exists                                                                                                                                       | This attempt's final, not named        | (c)        | This attempt: Keep (c), report. The save can be retried under a new name                                                                                                                      | "a failed save with no complete held copy keeps its file"                                                                               |
| S6  | save      | Alive. Step 2 found another attempt's file named under the same `clipId`. The winner's named file matches this attempt's length and CRC32                                                                     | Loser's final, not named               | (b)        | The losing attempt: Delete (b) its own file only; the winner's file is untouched. If the winner's file does not match, this attempt keeps it under (c)                                        | "two attempts under one clipId: the losing one deletes only its own file"                                                               |
| S7  | save      | After step 2 commits, a superseded final is not named and the committed row names the new final; every dependent has its durable copy                                                                         | Superseded final, not named            | (b)        | This attempt (step 4), or the next sweep after a kill: Delete (b)                                                                                                                             | "a kill before the superseded delete leaves it for the next sweep"                                                                      |
| S7b | save      | As S7, but a pending `stored` base on the superseded bytes has no durable copy                                                                                                                                | Superseded final, not named            | (c)        | Keep (c), report                                                                                                                                                                              | "a superseded file a pending stored base still reads is kept"                                                                           |
| T0  | transcode | Alive. The guard returned `"stale"` (a pending `stored` base names this clip); the transaction wrote nothing                                                                                                  | New MP3 final, not named               | (b)        | This attempt (step 3): Delete (b) the new MP3; the named PCM, which passes the length and CRC32 in its row, is the copy. The PCM stays named; a later sweep retries                           | "a pending stored base blocks the transcode and the PCM stays named"                                                                    |
| T1  | transcode | Alive. The transaction failed                                                                                                                                                                                 | New MP3 final, not named               | (b)        | This attempt (step 3): Delete (b) the new MP3 only; the PCM stays named; a later sweep turn retries (ADR 0009)                                                                                | "a failed transcode deletes only the new MP3 and keeps the PCM named"                                                                   |
| T2  | transcode | A previous launch's unnamed MP3 beside a named PCM that passes its row's length and CRC32                                                                                                                     | New MP3 final, not named               | (b)        | Next sweep: Delete (b); the transcode runs again                                                                                                                                              | "a kill before the transcode commit leaves the PCM and removes the MP3"                                                                 |
| T3  | transcode | A previous launch, killed after commit: an unnamed PCM beside a named MP3 that passes its row's length and CRC32; no pending `stored` base names the clip                                                     | PCM final, not named; MP3 named        | (b)        | Next sweep: Delete (b) the PCM; the MP3 stays named                                                                                                                                           | "a restart after a transcode removes the PCM and keeps the MP3 named when no stored base needs it"                                      |
| T3b | transcode | As T3, but a pending `stored` base names the clip; a Finished MP3 never satisfies a splice                                                                                                                    | PCM final, not named; MP3 named        | (c)        | Next sweep: Keep (c) the PCM, report; the MP3 stays the named file                                                                                                                            | "a restart after a transcode keeps the PCM, with the MP3 still named, when a stored base still splices onto it"                         |
| T4  | transcode | Alive. The transaction committed; an unnamed PCM beside the named MP3; no pending `stored` base names the clip                                                                                                | PCM final, not named; MP3 named        | (b)        | This attempt (step 4): Delete (b) the PCM by its exact location, in this session                                                                                                              | "a committed transcode deletes the PCM in the same session"                                                                             |
| T4b | transcode | As T4, but a pending `stored` base names the clip                                                                                                                                                             | PCM final, not named; MP3 named        | (c)        | This attempt: Keep (c) the PCM, report, as T3b                                                                                                                                                | "a committed transcode keeps the PCM in the same session when a stored base still splices onto it"                                      |
| V1  | sweep     | The inserted card's volume is not the one a row names for this final's `clipId`                                                                                                                               | Final carrying that row's `clipId`     | (c)        | Next sweep: Keep (c); report "card not present" or "card changed"                                                                                                                             | "a volume mismatch does not delete the files on the inserted card"                                                                      |
| V2  | sweep     | As V1, but the file is a `.part`                                                                                                                                                                              | `.part` carrying that row's `clipId`   | (c)        | Next sweep: Keep (c); report "card not present" or "card changed"                                                                                                                             | "a volume mismatch does not delete a .part on the inserted card"                                                                        |

**The orphan sweep** applies the delete predicate to each file in the card
folder, by the state table. It runs once per launch, before that launch's
first card write, or not at all, so no `.part` or final file of this launch
exists when it runs. It adds no condition of its own.

1. A file, `.part` or final, whose `clipId` has a row naming **another
   volume**: Keep (c), report (V1, V2). This runs first.
2. A `.part`: Delete (a) or Delete (b), or Keep (c) (S2, S2b).
3. A final file that a `clipMeta` location names (volume and file): Keep (c).
4. Any other final file: Delete (b) or Keep (c), by the row that matches it
   (S3, S3b, S4, S7, S7b, T2, T3, T3b).
5. Every (c) is reported to the failure log. How a kept file is offered back
   to the user is not decided (open, below).

That one page at a time writes the card folder is an assumption (the Android
app has one WebView), for the commit-protocol child to check.

**Where a held take lives.** The `pendingTakes` row holds the take's PCM in
IndexedDB (`domain.ts:312`). So even with the card store on, a take is held on
the phone until its save commits, and a phone with no free space may be unable
to hold it (inference, from #339's field evidence). Whether the held copy moves
to the card is out of #1751's scope by its own words, and is an **open
technical question for the DRI** (below).

**Before Stop.** While recording, MediaRecorder's slices are held in memory
(`chunksRef`, `src/hooks/use-recorder.ts:366`, filled at `:714-715`), and
nothing reaches storage. A card pulled then touches nothing on the card. A kill
then loses the take, as it does today; that is not this ADR's to change.

**Bridge throughput.** The plugin is called through Capacitor's bridge. Writing
a 20-minute take (about 106 MB: mono 16-bit PCM at 44.1 kHz,
`src/lib/audio/format.ts:4`, `:15`, is 5.3 MB a minute) in 384 KiB chunks, and
the JS heap that takes, is owed to P2. Reading it back by base64 chunks or
by `fetch(Capacitor.convertFileSrc(path))` is owed to P3. The second goes
through the WebView's local server, so the plugin child prefers a read into the
app process unless P3 shows that server answers only this app and the path
cannot be guessed (open, for the plugin child). If P2 misses the
threshold the DRI sets, ADR 0016's trigger 2 fires
(`0016-capacitor-or-expo.md:77-80`).

### 4. Failure behaviours

Each behaviour below needs a test in the build child named, before it ships
(ADR 0011). The tests are named here; the children that carry them are not
filed yet (#1456's child list).

| Failure (ADR 0011's list)                                    | Proposed behaviour                                                                                                                                                                                                                                                                                  | Test, and the child that carries it                                                                                                                                                                                                                                | Owed to                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **Card missing** at save                                     | Step 1 fails with a typed code before any transaction. The take stays held, the app says so in place, and it offers to save on the phone (#1456's "held, not lost, and can be saved on the phone instead").                                                                                         | "a failed step 1 deletes its own .part and keeps the take held, and a refused create deletes nothing" (row S1) — card missing, full or different                                                                                                                   | P1, P5                                 |
| **Card full**                                                | A free-space read before step 1 predicts it; if the write still fails, the typed "full" code takes the same path as a missing card.                                                                                                                                                                 | "a full card is refused before the write and the take stays held" — same child                                                                                                                                                                                     | P6                                     |
| **Card read-only**                                           | The same path, with its own code if the plugin can tell it apart. The spike's codes (`FULL`, `UNMOUNTED`, `IO`, `NO_SESSION`, `NOT_FOUND`, `GRANT`) name none for it.                                                                                                                               | "a read-only card keeps the take held" — same child                                                                                                                                                                                                                | Not probed by #1472; needs a row added |
| **Card swapped** between sessions                            | A row whose location names another volume reads as "card not present", never as lost. No row is deleted, no file is written to the other card's folder for that clip, and the sweep deletes **nothing** on the inserted card that carries the row's `clipId` (§3, the ownership rule; rows V1, V2). | "a clip on another card reads as not present and its row survives" — same child; "a volume mismatch does not delete the files on the inserted card" (row V1) and "a volume mismatch does not delete a .part on the inserted card" (row V2) — commit protocol child | P1, P9                                 |
| **Row pointing at a missing file** (card present, file gone) | The segment shows its audio as missing, the read reports to the failure log (as `"playback-dangling"` does today, `src/hooks/use-audio-session.ts:550`), and the row is never deleted automatically.                                                                                                | "a missing or CRC-mismatched card file leaves the row and reports it" — commit protocol child                                                                                                                                                                      | P1                                     |
| **Partial file after a kill** while it was the only copy     | Read off §3's state table by case: a `.part` is Delete (a) or Delete (b) (S2) or Keep (c) (S1c, S1d, S2b); an unnamed final is Delete (b) (S3, S7, T2, T3) or Keep (c) (S3b, S4, S5b, S7b, T3b).                                                                                                    | The tests of rows S1, S1b, S1c, S1d, S2, S2b, S3, S3b, S4, S5, S5b, S6, S7, S7b, T0 to T4b, V1 and V2 — commit protocol child                                                                                                                                      | P4                                     |
| **Card pulled mid-recording**                                | Nothing is written while recording, so storage is untouched. The facilitator is warned against it when the card store is switched on, per D2-microsd's note.                                                                                                                                        | None beyond the missing-card test; the warning is copy                                                                                                                                                                                                             | P5                                     |

Where the card's state changes while the app runs, which events reach the
plugin in the foreground and the background, and what is seen on resume, is
owed to P9. Until P9 reports, the proposed rule is to check the volume before
every card write and read, and not to rely on an event.

### 5. The backup folder

A backup is written to a folder the user picks (path B), never to the app's
own folder, which is expected to go on uninstall. Its content is the Scripture
Bundle that [ADR 0014](0014-scripture-bundle-profile.md) and #1474 define; this
ADR covers only where it is written and how.

- One file per book, written whole under a new name beside the previous
  backup, synced, read back and checked for length and CRC32, and only then
  put in the previous backup's place. The previous backup is never truncated
  first (`openFileDescriptor(uri, "rwt")` is not used), so a kill part-way
  leaves it whole. If the folder cannot replace one file with another in one
  step, the previous backup is Delete (b) only once the new one has passed its
  read-back and the winner record below names it, and Keep (c) until then, so
  at every moment one checked backup exists under some name. A new backup whose
  read-back ran to completion and failed is Delete (a); one whose read-back
  could not finish is Keep (c). How the replace is done through the grant is owed to P8;
  the run sheet's P8 tests an `rwt` overwrite today, so it needs a
  rename-and-replace step added.
- **Recovery records its winner.** Once the new file passes its read-back, and
  before the previous backup is deleted (inference: a delete first would leave
  a kill with no record naming either file), the backup writes a small record that survives a
  kill. It holds the new file's expected CRC32 (the variant in §2) and the name
  the file has at that moment. After a kill, recovery picks the file the record
  names, if that file passes its CRC. A second file that also passes its CRC is
  **kept, not chosen**, until the record names the winner; a CRC pass alone is neither (a) nor (b), so it is Keep (c).
  A file that passes its CRC is therefore not
  by that fact "the archive". Where the record lives and how it is replaced
  without the same hazard (a kill while it is half-written) are open (below).
  Tests (backup child): "recovery picks the file the record names", "a second
  backup file that passes its CRC is kept until the record names the winner",
  and "a kill before the record is written leaves the previous backup as the
  archive".
- The grant is persisted. Whether it survives an app restart, a reboot, and
  the card out and in, and that it stops resolving on a different card, is
  owed to P8.
- A failed backup leaves the recordings untouched; it is a report, not a loss.

Where a backup goes, and whether a backup on the same card that holds the
recordings counts as "off the device", are not decided (below).

### 6. Android settings

**`allowBackup="false"` stays.** The reason in the manifest
(`AndroidManifest.xml:4-6`) still holds: Android's backup would let recordings
leave the device through a channel the app does not control. #1473's scope
adds that "some manufacturers cannot disable device-to-device migration on
Android 12 and later"; that is Android's note as #1473 quotes it, not checked
here, and it is not this epic's to fix. The backup this ADR proposes is the
user's own folder, not Android's backup.

**`hasFragileUserData` is not decided.** #1532 adds it to the spike's manifest
only. What the "keep app data" choice keeps on uninstall, for the card folder
and for IndexedDB, is owed to P7. If it keeps one and not the other, the index
and the bytes part company. This ADR proposes shipping it only if P7 shows both
are kept together, or neither.

**Uninstall.** With path A, the card folder is expected to go on uninstall
along with IndexedDB (owed to P7), so `docs/native/README.md:77-79` stays
true. That sentence is rewritten when the code exists, not before (ADR 0011).

## Consequences

- **This is T1 storage design.** It changes where the only copy of a recording
  lives. The schema child, the plugin child and the commit-protocol child each
  carry T1's bar.
- **The seam's interface changes** in the commit-protocol child. Every site in
  #1768's table moves from "bytes inside the transaction" to "location inside,
  bytes outside" for the card backend. The IndexedDB backend keeps its
  in-transaction path, so iOS and the web build are unchanged.
- **A held take still needs room on the phone** until its owner decides
  otherwise (the open question below).
- **Nothing is built, and no phone has run any of it.** This ADR records a
  proposed design, not a capability.

## Open questions

### For the requirements owner

These are product calls. They are listed as open because no answer from the
requirements owner is recorded. The v2 plan records picks by other roles on
T1 to T3; picks are not answers.

- **T1 — "Restore in 1.2?"** R4 (final) says backup only in v2; T1 asks
  whether restore ships in 1.2. No answer from the requirements owner
  (`docs/design/v2-plan.md`, "T1, T2, T3 and T5 are not decided").
- **T2 — "Where does a backup go?"** Card and cloud, or card, cloud and an
  on-device copy. No answer from the requirements owner.
- **T3 — "Which cloud first?"** iCloud and Google Drive together, iCloud
  first, or Google Drive first. No answer from the requirements owner.
- **Where a backup goes on a phone with no card**, and **whether a backup on
  the card that also holds the recordings meets R4's "archive the data off the
  device"**. Both are open in ADR 0011 and stay open here.
- **How the launch prompt and the facilitator's switch combine (R16).** Open in
  ADR 0011 and the v2 plan.
- **O1 as a fallback.** Only if #1472 finds O2 fails. O1 does not meet "record
  straight onto the card", so it is the requirements owner's call.

### For the DRI

- **Accept S1**, or ask for another contract.
- **The 20-minute save threshold.** #1472 proposes 20 seconds; ADR 0016's
  trigger 2 shares it.
- **Where a held take's bytes live** when the card store is on: IndexedDB as
  today, or the card. #1751 left pending-take bytes out of scope for the
  commit-protocol child to decide.
- **The recovery path for rows S3b, S4 and S5b.** The sweep keeps a card file that
  passed step 1's check (step 1a may not have run) and is the only copy of a take and reports it. How the app offers it back
  to the user is open, for a later child.
- **What the sweep checks a `.part` against** (row S2b). A `.part` has no row,
  so the expected length and CRC32 are known only to the attempt that died.
  Options, none decided: record the expected length and CRC32 somewhere that
  survives a kill before step 1 starts; treat a `.part` with no alternative as
  the only copy whenever its length is plausible; or accept that a `.part`
  cannot be told apart and say so. Until decided, (a) is not available to the sweep for a
  previous-launch `.part`, so such a `.part` is Delete (b) (S2) or Keep (c)
  (S2b), and never deleted on doubt.
- **Which file is the archive when the winner record fails** (§5): the record
  names a file that is missing or fails its CRC, and the previous backup is
  still on the card. The pick rule covers only the pass path; nothing is
  deleted meanwhile.
- **Where the backup's winner record lives and how it is replaced** (§5)
  without a half-written record, through the grant (P8).
- **`hasFragileUserData`**, once P7 reports.
- **What the backup's `confidential` flag says about card copies**:
  [#1580](https://github.com/unfoldingWord/tc-mobile/issues/1580), open in ADR 0011.
- **The plugin hold** on #1520 (ADR 0016).
- **How the plugin child reads a card file back.** Keep the read-back, and P3's
  measurement, on a plugin read into the app process, not a
  `fetch(Capacitor.convertFileSrc(path))` through the WebView's local server,
  unless P3 shows that server answers only this app and the path cannot be
  guessed.

### Owed to #1472's run sheet

P1 (finding the card, volume UUID stability, adopted cards), P2 (write time and
heap for 2, 10 and 20 minutes), P3 (read back), P4 (kill during write), P5
(card pulled mid-write), P6 (card full), P7 (uninstall and
`hasFragileUserData`), P8 (the backup folder's grant and overwrite), P9 (card
events), P10 (the browser picker, evidence for R5 only) and P11
(`@capacitor/filesystem` with a card path). A read-only card is not a row on
the sheet; it should be added before the run.
