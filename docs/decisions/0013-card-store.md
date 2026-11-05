# 0013 — How recordings live on the microSD card

**Status:** Accepted 2026-11-04 · **Date:** 2026-10-29 · **DRI:** the dev lead
drafts; the DRI decides · **Issue:**
[#1473](https://github.com/unfoldingWord/tc-mobile/issues/1473), part of the
card epic [#1456](https://github.com/unfoldingWord/tc-mobile/issues/1456)

This ADR is **Accepted**. On 2026-11-04 the DRI answered the S1 question put on
#1473, verbatim: "accept S1 - we have run card test with a real phone and card,
find these results and make sure they are linked". The same day the DRI picked
where a held take lives when the card store is on, verbatim: "Phone storage,
as today (Recommended)", the option that keeps held takes in IndexedDB and
sends only saved clips to the card. Both are in the
[decision record](https://github.com/unfoldingWord/tc-mobile/issues/1473#issuecomment-6639160618).
What the acceptance covers is S1, the contract the plugin work builds against,
and the held-take answer. Coordinator reading, not the DRI's words: the S1
question as asked described this ADR's file layout, its location and checksum
on `clipMeta` and its never-delete-on-doubt rule, so the decision below is read
as accepted with it.

**The real-phone results** are the
[#1472 findings comment](https://github.com/unfoldingWord/tc-mobile/issues/1472#issuecomment-6639193400)
(run 2026-11-02, posted 2026-11-04), called "the results" below. They come
from one phone, called phone (a): a Samsung Galaxy A17 5G (SM-A176B) on
Android 16, with one 128 GB exFAT card, running the spike probe from the
never-merged branch `spike/card-store` (PR
[#1532](https://github.com/unfoldingWord/tc-mobile/pull/1532)). Where a fact
below needed a phone and the results observe it, the sentence now says what
phone (a) did and cites the results' row. Where they do not, it is still
marked **owed to #1472 Pn**, where Pn is the run sheet's row. Phone (b), an
Android 7 to 10 phone, has not run, so nothing below says what an older phone
does. What Android's documentation is expected to show is quoted from #1472's
scope, not from a fetched document, and is labelled as such. Inference and
assumptions are labelled.

Revised 2026-11-02 to close the four residuals tracked on #1473 (three named
when [#1785](https://github.com/unfoldingWord/tc-mobile/pull/1785) merged, one
added after): the state table now decides every delete, a checked `.part` that
is the only copy is kept, backup recovery records its winner, and a checked
read-back precedes any delete of `clipData` or release of a held take. Status
stayed Proposed after that revision, with the #1472 spike gating acceptance.

Revised again 2026-11-02 for the residuals #1826's round 5 left on #1473
(<https://github.com/unfoldingWord/tc-mobile/issues/1473#issuecomment-6583624665>):
case (b) was cited for deletes its definition excludes. The delete predicate
gains three cases, each with its own durable trigger: (d) RELEASED for a clip
an erase, a delete or a replacing save let go of, (e) UNCOMMITTED-OUTPUT for a
transcode's MP3 that no row ever named, and (f) WINNER-RECORD for the backup a
new one replaces. Every alternative a `.part` or an unnamed final is matched
against must match its bytes, a pending row included, and a final that failed
step 1a is kept when it is the only copy outside memory. Status stayed
Proposed after that revision.

Accepted 2026-11-04, as recorded above, with the results linked and the owed
lines they answer rewritten. Every test name below is still a planned test,
not a test that exists.

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
  (`clip-bytes.ts:14-16`). This ADR records that contract.
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
- **The plugin work is no longer held.** [ADR 0016](0016-capacitor-or-expo.md)
  was Accepted on 2026-11-04 and lifted the 2026-10-22 hold. This ADR gives the
  plugin a contract to be built against. ADR 0016 also records that the same
  Java would carry into an Expo module.

## Options

### Where a clip's bytes live (from #1472's scope)

| Option                         | What it means                                                                              | Meets "record straight onto the card"?                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **O1** Mirror on Finished      | IndexedDB stays the home of every clip; a Finished MP3 is copied to the card.              | No. The working PCM still fills the phone (inference).                  |
| **O2** Card is the clip's home | With the card switched on, a clip's bytes are a file on the card; `clipMeta` points at it. | Yes.                                                                    |
| **O3** Capture spool           | Audio streams to the card while recording.                                                 | Out of scope: streaming during capture is #1093.                        |
| **O4** Write-through           | Every clip is written to IndexedDB and to the card.                                        | In part; it doubles the writes and does not free the phone (inference). |

**O2**, the recommendation #1472 and #1456 already make, and the shape of the
S1 contract the DRI accepted (coordinator reading). Whether it holds is still
owed to #1472: its acceptance criterion 2 passes O2 only when P1, P4, P5 and P6
pass on an Android 11+ phone and an Android 7–10 phone, and a 20-minute save
finishes within 25 seconds (the DRI's threshold, 2026-11-04: "15-23s is
acceptable", then "25 seconds (Recommended)";
[record](https://github.com/unfoldingWord/tc-mobile/issues/1472#issuecomment-6640952051)).
On phone (a), the results report P1 passing except the adopted-card row (not
run), P4 passing except the sync and read-back isolation (a weak pass: the
checked file had about 13 s to flush), P5 passing only with the probe patched
to close its file on a write error (§4), P6 passing, and twelve 20-minute saves taking 15.7 to
23.2 s. Phone (b) has not run, so criterion 2 is not settled (the results,
"Acceptance criteria"). If O2 fails, the fallback is O1, and that is a question
for the requirements owner, because O1 does not meet "record straight onto the
card" (#1472, acceptance criterion 4).

### Android storage access paths

Each path below is described from #1472's scope and the spike's run sheet,
which state what Android's documentation leads us to expect. The last column
says what phone (a) showed, from the results; nothing here has run on an
Android 7–10 phone.

| Path                                                                                                    | Permission               | On uninstall                                                 | Use                                                | Phone (a), from the results                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. The app's own folder on the card** (`getExternalFilesDirs(null)`, the removable entry)             | None expected            | Expected deleted; `hasFragileUserData` may offer to keep it  | Clip bytes (O2)                                    | P1: found, removable, mounted. P7: a plain uninstall deleted it; Android 16 offered "Keep app data", which kept it                                                                                                    |
| **B. A folder the user picks** (Storage Access Framework, `ACTION_OPEN_DOCUMENT_TREE`, persisted grant) | The user's pick          | Expected to stay; the grant on a different card is owed (P8) | The backup only                                    | P7: untouched by uninstall. P8: the grant survived a restart, a reboot and the card out and in; a different card is cannot-tell                                                                                       |
| **C. `@capacitor/filesystem` with a full card path**                                                    | Unknown                  | As A, if it writes into A                                    | Decides whether A needs a custom plugin for writes | P11: with `encoding: "utf8"`, a direct call wrote and read back with no prompt (Filesystem 8.1.4); the probe's own call, with no `encoding`, failed. Whether it can carry the commit protocol (§3) is not what it ran |
| **D. A browser folder picker** (`showDirectoryPicker()` in Chrome on Android)                           | The user's pick          | Unknown                                                      | None in v2: R5 makes the card an app feature       | P10: not run (optional)                                                                                                                                                                                               |
| **E. Broad storage access** (`MANAGE_EXTERNAL_STORAGE`) or MediaStore                                   | A special grant, or none | MediaStore files outlive the app (assumption)                | Not proposed                                       | Not in #1472                                                                                                                                                                                                          |

Why A for the clips (inference, from the scope): it needs no permission prompt,
it is private to the app on the phone, and it goes away on uninstall the way
IndexedDB does, so the index and the bytes share one fate. R17's "plain audio
files the app owns" fits it. Anyone holding the card in a reader can still read
the files; R17 accepts that.

Why B only for the backup (inference): a backup is meant to outlive the app,
and a user-picked folder is the path expected to survive uninstall; on phone
(a) it did (results, P7). #1472 P8 expected that on Android 11 and later the
card's root cannot be picked. On phone (a) it could not: the picker shows
"Can't use this folder" at the card's top level and disables its button, so a
backup needs a subfolder (results, P8).

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
| **S1** Two phases around the transaction (accepted) | Bytes move outside any transaction: staged and made durable before it, deleted after it under §3's delete predicate. Inside it, the seam records and reads only a **location** on `clipMeta`. The IndexedDB backend keeps today's in-transaction path. | Every write, read and delete site in the #1768 table changes shape: read the location in the transaction, move bytes outside it. |
| **S2** Keep the card behind the existing methods    | `write` etc. call the plugin from inside the transaction.                                                                                                                                                                                              | Breaks the transaction (above). Rejected.                                                                                        |
| **S3** Card bytes in IndexedDB first, moved later   | Every save lands in `clipData`, and a sweep moves it to the card.                                                                                                                                                                                      | The phone still has to hold every take at least once, which is what #339's field evidence says it cannot (inference).            |

**Accepted: S1** (the DRI, 2026-11-04, verbatim: "accept S1 - we have run card
test with a real phone and card, find these results and make sure they are
linked"; [record](https://github.com/unfoldingWord/tc-mobile/issues/1473#issuecomment-6639160618)).
It keeps #1751's rule that only the seam knows where bytes live, and it keeps
the take row, the metadata and the pending-row change in one transaction,
which is the #38 property.

## Decision

### 1. Where the files go

On a phone where the card store is switched on, a clip's bytes are one file in
the app's own folder on the card (path A), named `<clipId>.<n>.pcm` while the
segment is being worked on and `<clipId>.<n>.mp3` once it is Finished, where
`<n>` belongs to one write attempt (§3). A file never holds anything else. On
phone (a), `@capacitor/filesystem` reached a full card path with no prompt when
given `encoding: "utf8"` (results, P11); whether it can carry §3's sync,
read-back and rename is not what P11 ran, so the plugin child decides whether a
custom plugin does the writes. P11's call is evidence that the path is
reachable, not a write path for clip bytes: `encoding: "utf8"` writes a text
string, and `.pcm` and `.mp3` are binary, so a utf8 write is not allowed for
them (inference: a text encoding would alter the bytes; not checked against
Capacitor's documentation here). No binary write through
`@capacitor/filesystem` to the card has run. On phone (a) the probe found the folder's volume
and it reported removable and mounted (results, P1).

### 2. The schema: where a clip lives

`clipMeta` gains a location: IndexedDB, or the card, naming the card's volume
by its UUID, and the exact file (§3). On phone (a) the UUID was the same across
a reboot and across a remove and reinsert (results, P1); phone (b) has not run. A card location also carries the file's CRC32, by which this ADR means
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
- If the volume UUID turns out not to be stable on another phone (P1 on phone
  (b) is owed), the location names the volume some other way, and this section
  is rewritten before the schema child is built.
- The release record that case (d) needs (§3) is part of the same step: a
  durable record, written in the transaction that deletes a card-located
  `clipMeta` row, naming that row's volume and file. No such record exists
  today. It is required; where it lives and its exact shape are the schema
  child's to decide.

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
  may fold case, and two names differing only in case would then be one file.
  Phone (a)'s exFAT card folded case: `spike-case.txt` then `SPIKE-CASE.txt`
  gave one file (results, P1). A FAT32 card has not run, so that it folds case
  is an assumption.
- The `.part` is created exclusively (it fails if its name exists), and the
  rename to `<name>` never replaces an existing file. If the `.part` cannot be
  created, the attempt fails as in row S1. If `<name>` exists at the rename,
  the check has already passed, so the attempt fails as in row S1c: it keeps
  its `.part` and reports it: Keep (c), then S2 or S2b at the next sweep.
- A `clipId` is a `crypto.randomUUID()` (`clips.ts:14`), one safe path segment.

Tests (commit-protocol child), read off the rule above: "a retry in a later
launch does not reuse a name a row already names, or the name of a file the
sweep kept (S1c, S1d, S1e, S2b, S3b, S4, S5b, S6b, S6c, T2b)" and "a restarted attempt refuses to rename onto a
name clipMeta already stores".

**The ownership rule.** A card file belongs to a row only through the full pair
the row stores: the volume and the file name `<clipId>.<n>.<ext>` (§2).
"Names", everywhere in this ADR, means that pair. From it:

- Steps 3 and 4 delete only a pair this attempt created (step 1) or read in its
  own transaction (step 2), and only as Delete (a), Delete (b), Delete (d) or
  Delete (e) (the delete predicate, below). Nothing deletes by `clipId` or by
  file name alone: case (d) deletes the pair a release record names.
- A row whose location names **another volume** than the inserted card may own
  any file on the inserted card that carries its `clipId`: the volume id may
  not be stable on every phone (it was stable on phone (a), results P1; other
  phones are owed), the card may be a different one, or a reader may
  have rewritten the id. So every such file is a possible copy of that row's
  take, so it is Keep (c) while the mismatch lasts (V1, V2). This covers a `.part` as well as a final file: a `.part`
  carrying that `clipId` may be a checked copy of the take. The app reports
  "card not present" or "card changed" (§4).
- The sweep deletes an unnamed final file only as Delete (b) (S3, S7, T3),
  Delete (e) (T2) or Delete (d) (E2), by the state table's row for it. No
  sentence in this section adds a condition.
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
six cases, defined once here, and every delete in this ADR cites a case by
its label. **State-table rows carry no delete condition of their own.** A
row's When-cell selects the situation, and its Outcome says only "Delete (a)",
"Delete (b)", "Delete (d)", "Delete (e)" or "Keep (c), report", who acts (this
attempt, the transaction's caller, or the next sweep), and any non-delete
effect. Case (f) is the backup folder's (§5) and is cited there. **Any delete
in this ADR that does not cite a case label is a defect, and the file is kept
and reported.** Each delete cites exactly one case; a row whose When-cell
allows two (S2) names both, and the attempt or sweep records which one held.

> - **(a) DETERMINATE-FAIL.** A defined check ran to completion against a
>   durable reference and failed. The defined checks are the write's own
>   completion status and the length and CRC32 read-back against the bytes the
>   attempt holds. An interrupted, unavailable or I/O-errored check is **not**
>   this case. A previous-launch `.part` has no durable reference (open,
>   below), so (a) is not available to the sweep for one until that question
>   is decided. A final-named clip file that failed step 1a is (a) only while
>   its take has a durable copy outside memory: a complete pending row, or
>   `clipData` bytes for its clip. Without one it is (c) (row S1e): that file
>   passed step 1's check before the rename, so it may hold the take's bytes
>   more faithfully than its failed read suggests, and a kill after deleting
>   it would leave nothing outside memory (inference).
> - **(b) DURABLE-COPY.** For **every** dependent take of the file, a durable
>   copy exists, and the set of dependents is not empty. A durable copy is a
>   complete pending row, a final disposition, or a named file, and a pending
>   row or a named file counts only when its bytes **match** (below). A
>   same-`clipId` file or a pending row with different bytes is not a copy. An
>   empty dependent set is not (b). Bytes held only in memory are not a copy.
>   **A final disposition is not bytes and is never byte-matched.** It is a
>   `saved` or `discarded` row in `takeDispositions` (`db.ts:294`; `given-up`
>   is not final), written by `recordDisposition` (`takes.ts:253`) on the
>   transaction that settled the take (`takes.ts:372`, `:474`, `:499`,
>   `:648`). What it proves is that the pending take is settled and needs no
>   bytes from this file: `saved` means the transaction that committed the
>   take's own bytes also wrote it, and `discarded` means the take was given
>   up. It proves nothing about this file's bytes, so it is a copy only for
>   that pending dependent; any other dependent still needs its own copy.
> - **(c) KEEP.** Everything else. The file is kept and reported to the
>   failure log. A check that cannot be evaluated, a state table that is
>   silent or ambiguous, and a file that meets none of (a), (b), (d), (e) or
>   (f) are all (c). A file that is the only copy is never deleted under (c).
> - **(d) RELEASED.** A recorded, durable intent to let go of a clip. The
>   trigger is a **release record**: the transaction that removes a clip's
>   last use and its card-located `clipMeta` row, through
>   `deleteClipIfUnreferenced` (`clips.ts:149`; an erase, a segment or book
>   delete, a save that replaced the take with another clip, or a pending row
>   ending), reads the row's location before deleting it and writes, in the
>   same transaction, a record naming that volume and file. The file is then
>   deleted by the record's location, and the record is deleted after the
>   file is gone, shown by a completed delete or by a completed listing of the
>   inserted card's folder without that name; an I/O error or an unavailable
>   card is not "gone", and leaves the record (E1, E2). At the delete, (d) holds only while the record's volume is
>   the inserted card's, no `clipMeta` location names the pair, and no
>   unsettled pending take's `clipId` or `stored` base names the clip;
>   otherwise the file and the record are (c). A file no release record names
>   is never (d): an unexplained orphan is not a release (S4). The record does
>   not exist today; it is **required**, and its schema belongs to the schema
>   child (§2), not to this ADR.
> - **(e) UNCOMMITTED-OUTPUT.** A transcode output that no row ever named. The
>   file is an `.mp3` final; no `clipMeta` location names it; and the
>   committed row for its `clipId` names a `.pcm` file on the same volume that
>   passes the length and CRC32 stored in that row, checked to completion at
>   the delete. (e) does not rest on the dependent set: the committed take for
>   its clip reads the named PCM, which has just passed its check, so deleting
>   the MP3 removes no take's only bytes, and the transcode can make them again
>   from that PCM. The trigger needs no new
>   record, because it is read from the committed row and the card: only
>   `commitTranscode` writes MP3 bytes (`transcode.ts:209`), and every save
>   builds its clip as `pcm` (`buildClipMeta`, `clips.ts:53`), so an unnamed
>   `.mp3` beside a named `.pcm` of the same clip is a transcode's output. If
>   the named PCM fails its check or the check cannot finish, the MP3 is (c)
>   (row T2b), because it may then be the clip's only readable audio. (e) covers
>   finals only; a transcode's previous-launch `.part` is decided by S2 or S2b
>   like any other `.part`.
> - **(f) WINNER-RECORD.** The backup folder only (§5). The file is the
>   previous backup of a book, named as the superseded file by that book's
>   winner record, and the file the record names as the winner passes the
>   length and CRC32 the record holds when the delete runs. A backup has no
>   dependent take, and the new bytes differ from the old by design, so this
>   is neither (a) nor (b). A file the record does not name, a record whose
>   winner is missing or fails its check, and a record whose superseded name
>   equals its winner name are (c).
>
> **What "match" means.** For a `.part`, and for an unnamed final that no row
> records (rows S1c, S1d, S2, S2b, S3, S3b, S4, S5, S6, S6b, S6c), every
> alternative that is bytes, a pending row as much as a named file, must have
> that file's own length and CRC32. For a pending row, that is the length and
> CRC32 of the bytes its save would write (the take it rebuilds). A final
> disposition is not bytes and is not matched; (b) says what it proves. For a
> final that a committed row has superseded (rows S7, S7b, T3, T3b, T4, T4b),
> the dependents are the takes the rows record, and the copy is the file the
> committed row names, which must pass the length and CRC32 stored in that row
> (§2): a transcode's MP3 differs in bytes from the PCM it replaces, and that
> is why the row, not the old file, is the reference. A same-extension final
> that a save superseded under the same `clipId` holds the same take's bytes
> (inference: every take mints a fresh `clipId`, `clips.ts:139`, so only a
> retry of one take shares it), so S7 also requires its length and CRC32 to
> equal the named file's; one that differs is a losing attempt's file (S6c).
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
(§5), when it is Delete (f); a new backup that fails its read-back, run to
completion, is Delete (a).

A save to the card, in order:

1. **Before any transaction**, the plugin writes `<name>.part`, syncs it, reads
   it back, checks the length and CRC32 of what it read against the bytes it
   was given, and renames it to `<name>`. A final-named file has therefore
   passed that check before the rename. On phone (a) a force-stop and a forced
   power-off mid-write each left a `.part` or nothing, never a partial file
   under a final name, and a file committed before the power-off was still
   whole (results, P4). That the sync and the read-back reach the card rather
   than a cache is still owed to P4: phone (a)'s run is a weak pass, because
   the file it checked was committed about 13 s before the power loss, long
   enough for an ordinary flush, so it does not isolate the sync. The outcomes of a failure in step 1 are the state
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
   Delete (a) when the read-back ran to completion and mismatched and the take
   has a durable copy outside memory (S1b), Keep (c) when it mismatched and
   the take has none (S1e), and Keep (c) when it could not finish (S1d).
   Whether the read at 1a reaches the card and not a cache is owed to P4
   (phone (a)'s weak pass, step 1, does not settle it).

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
   table: Delete (b) when a matching durable copy exists (S5, S6), Delete (e)
   for a transcode's MP3 whose named PCM passes its check (T0, T1),
   otherwise Keep (c), report (S5b, S6b, T2b). The take stays held in its `pendingTakes` row if it has one, as a
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
   dependent. On the card, its transaction writes the release record (case
   (d)) beside the `clipMeta` delete, and after that transaction commits its
   caller deletes the file the record names, as Delete (d), then the record
   (row E1). A delete that fails, or that ends as Keep (c), leaves the file
   for the sweep, never a dangling row; a kill before the file delete leaves
   the record for the sweep (E2).

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
  writes nothing, the PCM file stays named, and the new MP3 goes through step 3:
  Delete (e) when the named PCM passes its check (row T0), Keep (c) when it
  fails or the check cannot finish (T2b).
- If the transaction fails, step 3 acts on the new MP3 by the state table:
  Delete (e) when the named PCM passes its row's check (T1), Keep (c) when it
  fails or the check cannot finish (T2b).
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
(b)", "Delete (d)", "Delete (e)" or "Keep (c), report", who acts, and any
non-delete effect. "Named" means
a `clipMeta` location names that volume and file. "Killed" covers a
force-stop and a power-off; on phone (a) each left a `.part` or nothing under
the attempt's name, never a partial final (results, P4). All
tests belong to the commit-protocol child. The When-cells do not overlap, with
one stated exception: S7 and T3 describe one shape (an unnamed final
superseded by a committed row) from two causes, and both give the same case
per dependent, so a file matching both is not a conflict. T2 is not that
shape: its MP3 was never named, so nothing superseded it, and S7's When-cell
excludes it. S6c is not that shape either: a losing attempt's file differs in
bytes from the same-extension file the row names, and S7's When-cell excludes
it. Every
sweep row below holds only for a file whose `clipId` has no row naming another
volume; V1 and V2 own that case. A file a release record names is decided by
E1 to E3 and by no other row.

| Row | Path      | When                                                                                                                                                                                                                                                                                                                                                           | Card file                              | Case       | Outcome                                                                                                                                                                                                                                                                                                                                       | Test                                                                                                                                                                                                                                 |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | save      | Alive. The write failed or was refused (missing, full, read-only, write error, create refused), or the step 1 read-back ran to completion and mismatched                                                                                                                                                                                                       | `.part` this attempt created, or none  | (a)        | This attempt: Delete (a) the `.part` it created. When creation was refused it created nothing, so it deletes nothing (the blocker may be an S1c or S2b file). Take held; §4's card rows apply                                                                                                                                                 | "a failed step 1 deletes its own .part and keeps the take held, and a refused create deletes nothing"                                                                                                                                |
| S1d | save      | Alive. A read-back, step 1's of the `.part` or step 1a's of the final name, could not finish (I/O error, card unavailable, interrupted)                                                                                                                                                                                                                        | `.part` or final, not named, unchecked | (c)        | This attempt: Keep (c), report. No transaction opens; the take stays held. The next sweep decides the file as S2, S2b, S3, S3b or S4                                                                                                                                                                                                          | "an interrupted read-back, of the .part at step 1 or of the final at step 1a, keeps that file and opens no transaction"                                                                                                              |
| S1c | save      | Alive. Step 1's read-back passed and the rename failed (including: the name exists)                                                                                                                                                                                                                                                                            | `.part`, checked                       | (c)        | This attempt: Keep (c), report; never played as audio. The next sweep decides it as S2 or S2b                                                                                                                                                                                                                                                 | "this attempt keeps a checked .part whose rename failed and reports it; only the next sweep may delete it, as S2"                                                                                                                    |
| S1b | save      | Alive. Step 1a's read-back of the final name ran to completion and mismatched, and the take has a durable copy outside memory: a complete pending row, or `clipData` bytes for its clip                                                                                                                                                                        | Final, not named, failed its check     | (a)        | This attempt: Delete (a) that final file. No transaction opens; `clipData` and the held take are untouched                                                                                                                                                                                                                                    | "a failed read-back after the rename opens no transaction, deletes only that file, and leaves clipData and the held take"                                                                                                            |
| S1e | save      | As S1b, but the take has no complete pending row and no `clipData` bytes: its only copy outside the card file is in memory                                                                                                                                                                                                                                     | Final, not named, failed its check     | (c)        | This attempt: Keep (c), report. No transaction opens; the save can be retried under a new name. The next sweep decides the file as S3, S3b or S4                                                                                                                                                                                              | "a failed read-back of a take held only in memory keeps the final and opens no transaction"                                                                                                                                          |
| S2  | save      | A previous launch's `.part`; (a) holds, or (b) holds with a complete pending row or a named file, either of whose length and CRC32 match the `.part`'s                                                                                                                                                                                                         | `.part`                                | (a) or (b) | Next sweep: Delete (a) or Delete (b). "The take is lost" applies only under (a) when no row holds it, as today                                                                                                                                                                                                                                | "a .part from a previous launch is deleted only under (a) or (b)"; "an older committed file with different bytes does not count as (b)"; "a pending row whose take has different bytes does not count as (b)"                        |
| S2b | save      | A previous launch's `.part` for which neither (a) nor (b) holds (it passes its check, cannot be checked, nothing depends on it, or only a different-bytes file or pending row exists)                                                                                                                                                                          | `.part`                                | (c)        | Next sweep: Keep (c), report, as S4; never played as audio. What a sweep checks a `.part` against is open (below)                                                                                                                                                                                                                             | "a .part that is the only copy is kept and reported"                                                                                                                                                                                 |
| S3  | save      | A previous launch's unnamed final; no committed row for its `clipId`; a complete pending row carries its `clipId`, and the take it rebuilds matches the file's length and CRC32                                                                                                                                                                                | Final, not named                       | (b)        | Next sweep: Delete (b). The take's PCM stays in its IndexedDB row and the replay saves it                                                                                                                                                                                                                                                     | "a kill after the rename leaves the take held when a complete pending row holds it, and the sweep removes the file"                                                                                                                  |
| S3b | save      | As S3, but the row's `stored` base is missing or corrupt, so the row is not complete, or the take it rebuilds does not match the file's length and CRC32                                                                                                                                                                                                       | Final, not named                       | (c)        | Next sweep: Keep (c), report; it may be the only complete copy                                                                                                                                                                                                                                                                                | "a completed orphan whose pending base is missing or corrupt is kept and reported"; "an orphan whose pending row rebuilds different bytes is kept and reported"                                                                      |
| S4  | save      | A previous launch's unnamed final with no pending row, no committed row for its `clipId`, and no release record naming it: an unexplained orphan. Step 1's check passed; step 1a may not have run, or failed (S1e)                                                                                                                                             | Final, not named                       | (c)        | Next sweep: Keep (c), report                                                                                                                                                                                                                                                                                                                  | "an unexplained orphan (no pending row, no clipMeta row, no release record) is kept and reported"                                                                                                                                    |
| S5  | save      | Alive. Step 2 failed, or found the take discarded or saved with this attempt's own bytes, and either a final disposition for the take exists (not byte-matched, (b)), or a complete pending row or a named file exists whose bytes match this attempt's length and CRC32                                                                                       | This attempt's final, not named        | (b)        | This attempt (step 3): Delete (b) its own file only                                                                                                                                                                                                                                                                                           | "a failed save deletes only its own file"                                                                                                                                                                                            |
| S5b | save      | Alive. Step 2 failed, and none of the three durable copies in S5 exists                                                                                                                                                                                                                                                                                        | This attempt's final, not named        | (c)        | This attempt: Keep (c), report. The save can be retried under a new name                                                                                                                                                                                                                                                                      | "a failed save with no complete held copy keeps its file"                                                                                                                                                                            |
| S6  | save      | Alive. Step 2 found another attempt's file named under the same `clipId`. The winner's named file matches this attempt's length and CRC32                                                                                                                                                                                                                      | Loser's final, not named               | (b)        | The losing attempt: Delete (b) its own file only; the winner's file is untouched                                                                                                                                                                                                                                                              | "two attempts under one clipId: the losing one deletes only its own file"                                                                                                                                                            |
| S6b | save      | As S6, but the winner's named file does not match this attempt's length and CRC32, or its check cannot be completed                                                                                                                                                                                                                                            | Loser's final, not named               | (c)        | The losing attempt: Keep (c) its own file, report; the winner's file is untouched                                                                                                                                                                                                                                                             | "two attempts under one clipId with different bytes: the losing one keeps its file and reports it"                                                                                                                                   |
| S6c | sweep     | A previous launch's unnamed final whose `clipId`'s committed row names another file with the same extension, and whose length or CRC32 differs from that named file's, or whose comparison cannot finish: the S6b shape after a kill                                                                                                                           | Loser's final, not named               | (c)        | Next sweep: Keep (c), report                                                                                                                                                                                                                                                                                                                  | "after a kill, a losing attempt's file with different bytes from the named file is kept and reported, not deleted as superseded"                                                                                                     |
| S7  | save      | After step 2 commits, a superseded final is not named and the committed row names the new final; every dependent has its durable copy. A same-extension superseded file has the named file's length and CRC32. Not an unnamed `.mp3` beside a named `.pcm` (T2), and not the S6c shape                                                                         | Superseded final, not named            | (b)        | This attempt (step 4), or the next sweep after a kill: Delete (b)                                                                                                                                                                                                                                                                             | "a kill before the superseded delete leaves it for the next sweep"                                                                                                                                                                   |
| S7b | save      | As S7, but a pending `stored` base on the superseded bytes has no durable copy                                                                                                                                                                                                                                                                                 | Superseded final, not named            | (c)        | Keep (c), report                                                                                                                                                                                                                                                                                                                              | "a superseded file a pending stored base still reads is kept"                                                                                                                                                                        |
| T0  | transcode | Alive. The guard returned `"stale"` (a pending `stored` base names this clip); the transaction wrote nothing; the named PCM's check against its row's length and CRC32 ran to completion and passed                                                                                                                                                            | New MP3 final, not named               | (e)        | This attempt (step 3): Delete (e) the new MP3. The PCM stays named; a later sweep retries                                                                                                                                                                                                                                                     | "a pending stored base blocks the transcode and the PCM stays named"                                                                                                                                                                 |
| T1  | transcode | Alive. The transaction failed; the named PCM's check against its row's length and CRC32 ran to completion and passed                                                                                                                                                                                                                                           | New MP3 final, not named               | (e)        | This attempt (step 3): Delete (e) the new MP3 only; the PCM stays named; a later sweep turn retries (ADR 0009)                                                                                                                                                                                                                                | "a failed transcode deletes only the new MP3 and keeps the PCM named"                                                                                                                                                                |
| T2  | transcode | A previous launch's unnamed MP3 beside a named PCM whose check against its row's length and CRC32 ran to completion and passed                                                                                                                                                                                                                                 | New MP3 final, not named               | (e)        | Next sweep: Delete (e); the transcode runs again                                                                                                                                                                                                                                                                                              | "a kill before the transcode commit leaves the PCM and removes the MP3"                                                                                                                                                              |
| T2b | transcode | As T0, T1 or T2, but the named PCM fails its row's length and CRC32, or the check cannot finish (I/O error, card unavailable, interrupted)                                                                                                                                                                                                                     | New MP3 final, not named               | (c)        | This attempt (step 3) or the next sweep: Keep (c) the MP3, report; the PCM stays named                                                                                                                                                                                                                                                        | "a transcode output is kept when the named PCM fails or cannot finish its check"                                                                                                                                                     |
| T3  | transcode | A previous launch, killed after commit: an unnamed PCM beside a named MP3 that passes its row's length and CRC32; no pending `stored` base names the clip                                                                                                                                                                                                      | PCM final, not named; MP3 named        | (b)        | Next sweep: Delete (b) the PCM; the MP3 stays named                                                                                                                                                                                                                                                                                           | "a restart after a transcode removes the PCM and keeps the MP3 named when no stored base needs it"                                                                                                                                   |
| T3b | transcode | As T3, but a pending `stored` base names the clip; a Finished MP3 never satisfies a splice                                                                                                                                                                                                                                                                     | PCM final, not named; MP3 named        | (c)        | Next sweep: Keep (c) the PCM, report; the MP3 stays the named file                                                                                                                                                                                                                                                                            | "a restart after a transcode keeps the PCM, with the MP3 still named, when a stored base still splices onto it"                                                                                                                      |
| T4  | transcode | Alive. The transaction committed; an unnamed PCM beside the named MP3; no pending `stored` base names the clip                                                                                                                                                                                                                                                 | PCM final, not named; MP3 named        | (b)        | This attempt (step 4): Delete (b) the PCM by its exact location, in this session                                                                                                                                                                                                                                                              | "a committed transcode deletes the PCM in the same session"                                                                                                                                                                          |
| T4b | transcode | As T4, but a pending `stored` base names the clip                                                                                                                                                                                                                                                                                                              | PCM final, not named; MP3 named        | (c)        | This attempt: Keep (c) the PCM, report, as T3b                                                                                                                                                                                                                                                                                                | "a committed transcode keeps the PCM in the same session when a stored base still splices onto it"                                                                                                                                   |
| V1  | sweep     | The inserted card's volume is not the one a row names for this final's `clipId`                                                                                                                                                                                                                                                                                | Final carrying that row's `clipId`     | (c)        | Next sweep: Keep (c); report "card not present" or "card changed"                                                                                                                                                                                                                                                                             | "a volume mismatch does not delete the files on the inserted card"                                                                                                                                                                   |
| V2  | sweep     | As V1, but the file is a `.part`                                                                                                                                                                                                                                                                                                                               | `.part` carrying that row's `clipId`   | (c)        | Next sweep: Keep (c); report "card not present" or "card changed"                                                                                                                                                                                                                                                                             | "a volume mismatch does not delete a .part on the inserted card"                                                                                                                                                                     |
| E1  | release   | Alive. A transaction that removed a clip's last use and its card-located `clipMeta` row (erase, segment or book delete, a save that replaced the take, a pending row ending) committed with a release record naming the volume and file; the volume is the inserted card's; no `clipMeta` location names the pair and no unsettled pending take names the clip | Final the record names                 | (d)        | That transaction's caller, after the commit: Delete (d) the file, then delete the record. When the file is absent, the record is deleted only after the inserted card's folder was listed to completion and the name was not in it; an I/O error, an unavailable card, an unfinished listing or a failed file delete leaves the record for E2 | "an erased clip's card file is deleted by its release record, and the record goes after it"; "a book delete deletes each released clip's card file by its record"; "a release record survives when the card folder cannot be listed" |
| E2  | sweep     | A previous launch's release record survives (a kill between the commit and the file delete, or between the file delete and the record delete); the rest as E1                                                                                                                                                                                                  | Final the record names, or none        | (d)        | Next sweep: Delete (d) the file if the completed listing shows it; then remove the record, which is record cleanup, not a card-file delete. The absence rule is E1's: no completed listing, no removal                                                                                                                                        | "a kill between an erase's commit and its file delete is finished by the next sweep"                                                                                                                                                 |
| E3  | release   | A release record whose volume is not the inserted card's, or whose pair a `clipMeta` location names, or whose clip an unsettled pending take names                                                                                                                                                                                                             | Final the record names                 | (c)        | The caller or the next sweep: Keep (c) the file and the record, report; on a volume mismatch the record waits for its card                                                                                                                                                                                                                    | "a release record for another card deletes nothing on the inserted card"; "a release record whose file a row names again keeps the file"                                                                                             |

**The orphan sweep** applies the delete predicate to each file in the card
folder, by the state table. It runs once per launch, before that launch's
first card write, or not at all, so no `.part` or final file of this launch
exists when it runs. It adds no condition of its own.

1. A file, `.part` or final, whose `clipId` has a row naming **another
   volume**: Keep (c), report (V1, V2). This runs first.
2. Each surviving release record: Delete (d) the file it names, then the
   record (E2), or Keep (c) both (E3). A file no release record names is
   never deleted by this step.
3. A `.part`: Delete (a) or Delete (b), or Keep (c) (S2, S2b).
4. A final file that a `clipMeta` location names (volume and file): Keep (c).
5. Any other final file: Delete (b), Delete (e) or Keep (c), by the row that
   matches it (S3, S7, T3 are (b); T2 is (e); S3b, S4, S6c, S7b, T2b, T3b
   are (c)).
6. Every (c) is reported to the failure log. How a kept file is offered back
   to the user is not decided (open, below).

That one page at a time writes the card folder is an assumption (the Android
app has one WebView), for the commit-protocol child to check.

**Where a held take lives.** The `pendingTakes` row holds the take's PCM in
IndexedDB (`domain.ts:312`). So even with the card store on, a take is held on
the phone until its save commits, and a phone with no free space may be unable
to hold it (inference, from #339's field evidence). Whether the held copy moves
to the card was out of #1751's scope by its own words. **Decided 2026-11-04:**
it stays in IndexedDB. The DRI's pick, verbatim: "Phone storage, as today
(Recommended)", whose option read "Keep held takes in IndexedDB like now; only
saved clips go to the card. Smaller change, proven path."
([record](https://github.com/unfoldingWord/tc-mobile/issues/1473#issuecomment-6639160618)).

**Before Stop.** While recording, MediaRecorder's slices are held in memory
(`chunksRef`, `src/hooks/use-recorder.ts:366`, filled at `:714-715`), and
nothing reaches storage. A card pulled then touches nothing on the card. A kill
then loses the take, as it does today; that is not this ADR's to change.

**Bridge throughput.** The plugin is called through Capacitor's bridge. Writing
a 20-minute take (about 106 MB: mono 16-bit PCM at 44.1 kHz,
`src/lib/audio/format.ts:4`, `:15`, is 5.3 MB a minute) in 384 KiB chunks
was measured on phone (a) (results, P2): 111.3 MB in 15.7 to 23.2 s over
twelve runs, median 18.7 s, five of them over 20 s, with the cause of the
spread not established. The JS heap, sampled over devtools during one
20-minute write, was 2.4 to 13.7 MB. The results' inference, untested, is that
the base64 bridge, not the card, limits the save: a raw 1 GiB write and sync
ran at about 73 MB/s against the save path's about 7 MB/s. Reading a file back
(results, P3) gave identical bytes both ways, taking about 22.5 s by base64
chunks and about 2 s by `fetch(Capacitor.convertFileSrc(path))`, and the
results recommend the second. The second goes through the WebView's local
server, so the plugin child prefers a read into the app process unless P3
shows that server answers only this app and the path cannot be guessed; P3's
run measured speed and bytes, not that, so it stays open, for the plugin
child. If P2 misses the 25-second threshold, ADR 0016's trigger 2 fires
(`0016-capacitor-or-expo.md:84-88`).

### 4. Failure behaviours

Each behaviour below needs a test in the build child named, before it ships
(ADR 0011). The tests are named here; the children that carry them are not
filed yet (#1456's child list).

| Failure (ADR 0011's list)                                    | Behaviour                                                                                                                                                                                                                                                                                                                                        | Test, and the child that carries it                                                                                                                                                                                                                                | Phone (a), from the results                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Card missing** at save                                     | Step 1 fails with a typed code before any transaction. The take stays held, the app says so in place, and it offers to save on the phone (#1456's "held, not lost, and can be saved on the phone instead").                                                                                                                                      | "a failed step 1 deletes its own .part and keeps the take held, and a refused create deletes nothing" (row S1) — card missing, full or different                                                                                                                   | P5: a pull mid-save gave the typed `UNMOUNTED` code about 30 ms after it, with Books unchanged, but only once the probe closed its file on the error (below). Phone (b) is owed |
| **Card full**                                                | A free-space read before step 1 predicts it; if the write still fails, the typed "full" code takes the same path as a missing card.                                                                                                                                                                                                              | "a full card is refused before the write and the take stays held" — same child                                                                                                                                                                                     | P6: the typed `FULL` code (`ENOSPC`), and the free-space read predicted it. The probe left its `.part`; step 1 here deletes it (S1)                                             |
| **Card read-only**                                           | The same path, with its own code if the plugin can tell it apart. The spike's codes (`FULL`, `UNMOUNTED`, `IO`, `NO_SESSION`, `NOT_FOUND`, `GRANT`) name none for it.                                                                                                                                                                            | "a read-only card keeps the take held" — same child                                                                                                                                                                                                                | Not probed by #1472; needs a row added                                                                                                                                          |
| **Card swapped** between sessions                            | A row whose location names another volume reads as "card not present", never as lost. No row is deleted, no file is written to the other card's folder for that clip, and the sweep deletes **nothing** on the inserted card that carries the row's `clipId` (§3, the ownership rule; rows V1, V2).                                              | "a clip on another card reads as not present and its row survives" — same child; "a volume mismatch does not delete the files on the inserted card" (row V1) and "a volume mismatch does not delete a .part on the inserted card" (row V2) — commit protocol child | P1: the UUID was stable for one card. P9: events seen (below). A second card was not run, so the swap itself is owed                                                            |
| **Row pointing at a missing file** (card present, file gone) | The segment shows its audio as missing, the read reports to the failure log (as `"playback-dangling"` does today, `src/hooks/use-audio-session.ts:550`), and the row is never deleted automatically.                                                                                                                                             | "a missing or CRC-mismatched card file leaves the row and reports it" — commit protocol child                                                                                                                                                                      | Not run. P1 found the card                                                                                                                                                      |
| **Partial file after a kill** while it was the only copy     | Read off §3's sweep rows by case: a `.part` is Delete (a) or Delete (b) (S2) or Keep (c) (S2b); an unnamed final is Delete (b) (S3, S7, T3), Delete (e) (T2), Delete (d) when a release record names it (E2), or Keep (c) (S3b, S4, S6c, S7b, T2b, T3b, E3). The alive rows' kept files (S1c, S1d, S1e, S5b, S6b) reach the sweep as these rows. | The tests of rows S1, S1b to S1e, S2, S2b, S3, S3b, S4, S5, S5b, S6 to S6c, S7, S7b, T0 to T4b (T2b included), V1, V2 and E1 to E3 — commit protocol child                                                                                                         | P4: a force-stop and a power-off each left a `.part` or nothing                                                                                                                 |
| **Card pulled mid-recording**                                | Nothing is written while recording, so storage is untouched. The facilitator is warned against it when the card store is switched on, per D2-microsd's note.                                                                                                                                                                                     | None beyond the missing-card test; the warning is copy                                                                                                                                                                                                             | Not run: P5 pulled the card mid-save                                                                                                                                            |

**Close every open card file on the first write error.** This is a
requirement on the plugin work under #1456, from the results ("Requirements
for the real card store", item 1, and row P5). With the probe as written,
pulling the card mid-save got the app killed: Android's `vold` killed it about
0.8 s after the pull because the `.part` was still open, since the probe's
`writeChunk` catch never closed it. With `closeQuietly()` added to the catch in
`writeChunk` and `writeCommit`, the app survived the pull and returned the
typed `UNMOUNTED` code. Closing on the first `EIO` was enough on phone (a).
Closing on `MEDIA_EJECT` too, which arrived about 0.8 s before the kill, is
the results' inference and is untested. The plugin child carries a test that
a write error closes the file before the error is returned.

Where the card's state changes while the app runs, the events phone (a) saw
(results, P9) were, on a physical pull with no eject in Settings,
`MEDIA_EJECT`, `MEDIA_UNMOUNTED` and `MEDIA_BAD_REMOVAL`, with no
`volumeCallback`; on insert, `volumeCallback` reporting mounted twice,
`MEDIA_CHECKING` and `MEDIA_MOUNTED`. The same events arrived while the app was
in the background, and on resume the card read as mounted with the same UUID.
The rule stands: check the volume before every card write and read, and do not
rely on an event (inference: a listener on `volumeCallback` alone would have
missed the removal on phone (a)).

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
  step, the previous backup is Delete (f) only once the new one has passed its
  read-back and the winner record below names it, and Keep (c) until then, so
  at every moment one checked backup exists under some name. A new backup whose
  read-back ran to completion and failed is Delete (a); one whose read-back
  could not finish is Keep (c). How the replace is done through the grant is
  still owed to P8: phone (a) ran only the sheet's `rwt` overwrite, which left
  no tail (a 1 MB overwrite of a 50 MB file read back as exactly 1000000
  bytes; results, P8), and this design does not use `rwt`, so the sheet needs
  a rename-and-replace step added.
- **Recovery records its winner.** Once the new file passes its read-back, and
  before the previous backup is deleted (inference: a delete first would leave
  a kill with no record naming either file), the backup writes a small record that survives a
  kill. It holds the new file's expected length and CRC32 (the variant in §2),
  the name the file has at that moment, and the name of the previous backup it
  supersedes, which is what case (f) deletes and nothing else. After a kill,
  recovery picks the file the record names, if that file passes its check, and
  the superseded file it names is then Delete (f). A second file that also passes its CRC is
  **kept, not chosen**, until the record names the winner; a CRC pass alone
  meets none of (a), (b) or (f), so it is Keep (c), and it stays (c) unless a
  record names it as the superseded file.
  A file that passes its CRC is therefore not
  by that fact "the archive". Where the record lives and how it is replaced
  without the same hazard (a kill while it is half-written) are open (below).
  Tests (backup child): "recovery picks the file the record names", "a second
  backup file that passes its CRC is kept until the record names the winner",
  "a kill before the record is written leaves the previous backup as the
  archive", and "only the file the record names as superseded is deleted, and
  another file in the backup folder is kept".
- The grant is persisted. On phone (a) it survived an app restart, a reboot,
  and the card out and in: with the card out the grant is listed but does not
  resolve, and with it back it resolves and the file is still there (results,
  P8). Whether it stops resolving on a different card is cannot-tell there,
  with only one card, and stays owed to P8.
- A failed backup leaves the recordings untouched; it is a report, not a loss.

Where a backup goes, and whether a backup on the same card that holds the
recordings counts as "off the device", are not decided (below).

### 6. Android settings

**`allowBackup="false"` stays.** The reason in the manifest
(`AndroidManifest.xml:4-6`) still holds: Android's backup would let recordings
leave the device through a channel the app does not control. #1473's scope
adds that "some manufacturers cannot disable device-to-device migration on
Android 12 and later"; that is Android's note as #1473 quotes it, not checked
here, and it is not this epic's to fix. The backup this ADR describes is the
user's own folder, not Android's backup.

**`hasFragileUserData` is not decided.** #1532 adds it to the spike's manifest
only. What the "keep app data" choice keeps on uninstall, for the card folder
and for IndexedDB, mattered because if it keeps one and not the other, the
index and the bytes part company. This ADR ships it only if P7 shows both are
kept together, or neither. On phone (a), Android 16 offered "Keep app data",
and after a reinstall the card file and an IndexedDB marker were both still
there (results, P7). No earlier Android version has run, so whether to ship it
stays open (below).

**Uninstall.** With path A, the card folder goes on uninstall along with
IndexedDB: on phone (a) a plain `adb uninstall` removed the app's folders on
the card and internally, and left the user-picked folder untouched (results,
P7). So `docs/native/README.md:77-79` stays
true. That sentence is rewritten when the code exists, not before (ADR 0011).

## Consequences

- **This is T1 storage design.** It changes where the only copy of a recording
  lives. The schema child, the plugin child and the commit-protocol child each
  carry T1's bar.
- **The seam's interface changes** in the commit-protocol child. Every site in
  #1768's table moves from "bytes inside the transaction" to "location inside,
  bytes outside" for the card backend. The IndexedDB backend keeps its
  in-transaction path, so iOS and the web build are unchanged.
- **A held take still needs room on the phone.** The DRI's 2026-11-04 pick
  keeps it in IndexedDB (§3, "Where a held take lives").
- **The plugin closes card files on the first write error** (§4), a
  requirement the results add.
- **Nothing is built.** The spike's probe ran on one phone (the results); this
  design has not run on any phone. This ADR records a design, not a
  capability.

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

- **When a phone misses the limit, which runs first:** O2 fails and the
  fallback is O1, a question for the requirements owner, or ADR 0016's trigger
  2 fires and a move is planned. At 25 seconds every run on the first phone is
  inside the limit, so the fork is not reached today.
- **The recovery path for rows S1e, S3b, S4, S5b, S6b and S6c.** The sweep keeps a
  card file that passed step 1's check (step 1a may not have run, or failed
  on a take held only in memory) and may be the only copy of a take, and
  reports it. How the app offers it back to the user is open, for a later
  child.
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
- **`hasFragileUserData`.** P7 has reported for phone (a) only: both the card
  file and IndexedDB were kept (§6). Whether to ship it is not decided.
- **What the backup's `confidential` flag says about card copies**:
  [#1580](https://github.com/unfoldingWord/tc-mobile/issues/1580), open in ADR 0011.
- **How the plugin child reads a card file back.** Keep the read-back, and P3's
  measurement, on a plugin read into the app process, not a
  `fetch(Capacitor.convertFileSrc(path))` through the WebView's local server,
  unless P3 shows that server answers only this app and the path cannot be
  guessed. The results recommend `fetch(convertFileSrc)` on speed (about 11
  times faster, identical bytes); P3 did not test who else that server
  answers, so this stays open.

### Decided 2026-11-04

Both in the
[decision record](https://github.com/unfoldingWord/tc-mobile/issues/1473#issuecomment-6639160618)
on #1473.

- **S1**, the DRI, verbatim: "accept S1 - we have run card test with a real
  phone and card, find these results and make sure they are linked".
- **Where a held take's bytes live** when the card store is on, the DRI's pick,
  verbatim: "Phone storage, as today (Recommended)". Held takes stay in
  IndexedDB; only saved clips go to the card.

### Still owed to #1472's run sheet

The results answer P1 to P9 and P11 on phone (a) and are cited where they are
used above. Still owed:

- **Phone (b), an Android 7–10 phone:** every row, and with it criterion 2.
  The 25-second bar is on the slowest phone, which has not been named.
- **Phone (c), with no card slot; a small FAT32 card; a second card.** None
  has run. The second card is what P8's different-card row and the card
  swapped behaviour (§4) need.
- **P1, an adopted card:** not run on phone (a).
- **P2, the spread:** five of twelve 20-minute saves over 20 s, cause not
  established.
- **P4, whether the sync and the read-back reach the card:** a weak pass on
  phone (a), not isolated.
- **P8, the backup's rename-and-replace:** not on the sheet; only `rwt` ran.
- **P10, the browser picker:** not run (optional).
- **A read-only card:** not a row on the sheet; it should be added before the
  next run.
