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

| Contract                                            | What changes                                                                                                                                                                                                               | Cost                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **S1** Two phases around the transaction (proposed) | Bytes move outside any transaction: staged and made durable before it, deleted after it. Inside it, the seam records and reads only a **location** on `clipMeta`. The IndexedDB backend keeps today's in-transaction path. | Every write, read and delete site in the #1768 table changes shape: read the location in the transaction, move bytes outside it. |
| **S2** Keep the card behind the existing methods    | `write` etc. call the plugin from inside the transaction.                                                                                                                                                                  | Breaks the transaction (above). Rejected.                                                                                        |
| **S3** Card bytes in IndexedDB first, moved later   | Every save lands in `clipData`, and a sweep moves it to the card.                                                                                                                                                          | The phone still has to hold every take at least once, which is what #339's field evidence says it cannot (inference).            |

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
and the exact file (§3). A card location also carries the file's CRC32.
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
`<clipId>.<n>.<pcm|mp3>`, with `<n>` fresh for that attempt, and the `clipMeta`
location names that exact file. A save may be retried under the same `clipId`
(`takes.ts:307-308`), so a shared name would let a failed retry overwrite or
delete the bytes an earlier attempt committed; per-attempt names rule that out.
A `clipId` is a `crypto.randomUUID()` (`clips.ts:14`), one safe path segment.

A save to the card, in order:

1. **Before any transaction**, the plugin writes `<name>.part`, syncs it, reads
   it back, checks the length and CRC32 of what it read against the bytes it
   was given, and renames it to `<name>`. A final-named file is therefore never
   partial. That the sync and the read-back reach the card rather than a cache,
   and that the rename holds after a kill or a power-off, is owed to P4.
2. **One strict IndexedDB transaction** writes the take row, the `clipMeta`
   row with its card location and CRC32, and the pending-row change, the scope
   today's `saveTake` opens (`openTakeTx`, `takes.ts:65-76`). If it replaces a
   `clipMeta` row that named another file, it reads that file's name in the
   same transaction, so step 4 knows exactly which file it superseded.
3. **If that transaction ends without naming `<name>`** (it failed, or found
   the take already saved or discarded), the attempt deletes `<name>` and
   nothing else; no committed row names it. The take stays held in its
   `pendingTakes` row if it has one, as a failed save is today (`"save-take"`,
   #456).
4. **After it commits**, the attempt deletes the exact file step 2 read as
   superseded, and a superseded clip goes through the same reference check
   `deleteClipIfUnreferenced` makes (`clips.ts:149`). A delete that fails
   leaves an orphan for the sweep, never a dangling row.

Steps 3 and 4 delete only a file the attempt itself named or read. No attempt
deletes by `clipId`, so a failed attempt cannot remove the bytes another
attempt committed under the same `clipId` (row S6 of the state table below).

A read checks the file's length and CRC32 against its row; a mismatch takes
the missing-file path in §4 (reported, row kept, not played as audio).

The transcode on Finished (`commitTranscode`, `transcode.ts:153`) follows the
same steps, writing a new `<clipId>.<n>.mp3` beside the PCM file. Today it
replaces the PCM under the same key in one transaction (`transcode.ts:202`); on
the card the PCM and the MP3 briefly coexist, so the card needs room for both.
This path has no `pendingTakes` row and does not consult one: if its
transaction fails, step 3 deletes the new MP3 only, and `clipMeta` still names
the PCM file. Once it commits, no row names the PCM file, so step 4 or the
sweep deletes it (rows T1 to T3).

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
  step 2 commits, as it is today.
- `saveReplayedTake` (`takes.ts:433`): the launch replay saves a waiting take
  from its `pendingTakes` row, so that row is the durable copy (inference from
  its docblock, `takes.ts:396-408`).
- `commitTranscode` (`transcode.ts:153`): the PCM file the current `clipMeta`
  row names. ADR 0009's "the PCM is still there" holds until the commit.

A `pendingTakes` row carries the clip id its save will write (`clipId`,
`src/types/domain.ts:309`). That field is what the sweep reads below; no row
names a file.

**The state table.** Every failure row in §4 and every test named for the
commit protocol is read off this table. "Named" means a `clipMeta` location
names that exact file. "Killed" covers a force-stop and a power-off; what the
card holds after each is owed to P4. All tests belong to the commit-protocol
child.

| Row | Path      | When                                                  | Card file                                  | `clipMeta` for the `clipId` | Other durable copy                    | Outcome                                                                                                                     | Test                                                                           |
| --- | --------- | ----------------------------------------------------- | ------------------------------------------ | --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| S1  | save      | Step 1 fails, alive (missing, full, read-only)        | `.part` or none; the attempt deletes it    | Unchanged                   | `pendingTakes` row, if any            | Take held; §4's card rows apply                                                                                             | "a save with no card keeps the take held and writes no row"                    |
| S2  | save      | Killed during step 1                                  | `.part`, from a previous launch at restart | Unchanged                   | `pendingTakes` row, if any            | The next sweep deletes the `.part`. Without a row the take is lost, as it is today                                          | "a .part from a previous launch is deleted at the next launch"                 |
| S3  | save      | Killed after the rename, before step 2 commits        | Final, not named                           | Absent                      | `pendingTakes` row with this `clipId` | The sweep deletes the file; the replay saves the take from its row                                                          | "a kill after the rename leaves the take held, and the sweep removes the file" |
| S4  | save      | Killed after the rename, before step 2 commits        | Final, not named                           | Absent                      | None                                  | The file is the only copy. The sweep **keeps** it and reports it; it is never deleted automatically. Recovery is open (DRI) | "an unnamed final file with no row and no meta is kept and reported"           |
| S5  | save      | Step 2 fails or finds the take already settled, alive | Final, not named                           | Unchanged                   | `pendingTakes` row, if any            | Step 3 deletes this attempt's file only                                                                                     | "a failed save deletes only its own file"                                      |
| S6  | save      | Two attempts under one `clipId`; one commits          | Two finals; one named                      | Names the winner's file     | The winner's file                     | The loser deletes only its own file (step 3); the winner's file is untouched                                                | "two attempts under one clipId: the losing one deletes only its own file"      |
| S7  | save      | Killed after step 2 commits, before step 4            | New final named; superseded file not named | Names the new file          | The new file                          | The sweep deletes the superseded file                                                                                       | "a kill before the superseded delete leaves it for the next sweep"             |
| T1  | transcode | Transaction fails, alive                              | New MP3 final, not named                   | Names the PCM file          | The PCM file                          | Step 3 deletes the new MP3 only; no `pendingTakes` read; a later sweep turn retries (ADR 0009)                              | "a failed transcode deletes only the new MP3 and keeps the PCM named"          |
| T2  | transcode | Killed after the MP3 rename, before commit            | New MP3 final, not named                   | Names the PCM file          | The PCM file                          | The sweep deletes the MP3; the transcode runs again                                                                         | "a kill before the transcode commit leaves the PCM and removes the MP3"        |
| T3  | transcode | Killed after commit, before the PCM delete            | PCM final, not named; MP3 named            | Names the MP3 file          | The MP3 file                          | The sweep deletes the PCM and keeps the MP3                                                                                 | "after a restart, a superseded PCM is removed and the committed MP3 kept"      |

**The orphan sweep**, as the table needs it. It runs once per launch, before
that launch's first card write, or not at all, so no `.part` or final file of
this launch exists when it runs. For each file in the card folder:

1. A `.part` is from a previous launch. Delete it (S2). It never passed the
   read-back, so it is never kept as audio.
2. A final file a `clipMeta` location names exactly is kept.
3. A final file not named, whose `clipId` has a `clipMeta` row, was superseded
   by a committed file. Delete it (S7, T2, T3).
4. A final file not named, whose `clipId` a `pendingTakes` row carries, has a
   durable copy in that row. Delete it (S3).
5. Any other final file is the only copy of something. Keep it and report it
   to the failure log; never delete it (S4).

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

| Failure (ADR 0011's list)                                    | Proposed behaviour                                                                                                                                                                                                                            | Test, and the child that carries it                                                           | Owed to                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Card missing** at save                                     | Step 1 fails with a typed code before any transaction. The take stays held, the app says so in place, and it offers to save on the phone (#1456's "held, not lost, and can be saved on the phone instead").                                   | "a save with no card keeps the take held and writes no row" — card missing, full or different | P1, P5                                 |
| **Card full**                                                | A free-space read before step 1 predicts it; if the write still fails, the typed "full" code takes the same path as a missing card.                                                                                                           | "a full card is refused before the write and the take stays held" — same child                | P6                                     |
| **Card read-only**                                           | The same path, with its own code if the plugin can tell it apart. The spike's codes (`FULL`, `UNMOUNTED`, `IO`, `NO_SESSION`, `NOT_FOUND`, `GRANT`) name none for it.                                                                         | "a read-only card keeps the take held" — same child                                           | Not probed by #1472; needs a row added |
| **Card swapped** between sessions                            | A row whose location names another volume reads as "card not present", never as lost. No row is deleted and no file is written to the other card's folder for that clip.                                                                      | "a clip on another card reads as not present and its row survives" — same child               | P1, P9                                 |
| **Row pointing at a missing file** (card present, file gone) | The segment shows its audio as missing, the read reports to the failure log (as `"playback-dangling"` does today, `src/hooks/use-audio-session.ts:550`), and the row is never deleted automatically.                                          | "a missing or CRC-mismatched card file leaves the row and reports it" — commit protocol child | P1                                     |
| **Partial file after a kill** while it was the only copy     | Read off §3's state table: a `.part` is deleted at the next launch (S2); an unnamed final file is deleted when a committed file or a `pendingTakes` row holds the take (S3, S7, T2, T3), and kept and reported when it is the only copy (S4). | The tests of rows S2, S3, S4, S7, T2 and T3 — commit protocol child                           | P4                                     |
| **Card pulled mid-recording**                                | Nothing is written while recording, so storage is untouched. The facilitator is warned against it when the card store is switched on, per D2-microsd's note.                                                                                  | None beyond the missing-card test; the warning is copy                                        | P5                                     |

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
  step, the previous backup is deleted only after the new one has passed its
  read-back, so at every moment one checked backup exists under some name.
  How the replace is done through the grant is owed to P8; the run sheet's P8
  tests an `rwt` overwrite today, so it needs a rename-and-replace step added.
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
- **A take with no `pendingTakes` row, killed after its file was renamed and
  before its save committed** (row S4): the sweep keeps the file and reports
  it. How, or whether, the app offers it back is not decided.
- **`hasFragileUserData`**, once P7 reports.
- **What the backup's `confidential` flag says about card copies**:
  [#1580](https://github.com/unfoldingWord/tc-mobile/issues/1580), open in ADR 0011.
- **The plugin hold** on #1520 (ADR 0016).

### Owed to #1472's run sheet

P1 (finding the card, volume UUID stability, adopted cards), P2 (write time and
heap for 2, 10 and 20 minutes), P3 (read back), P4 (kill during write), P5
(card pulled mid-write), P6 (card full), P7 (uninstall and
`hasFragileUserData`), P8 (the backup folder's grant and overwrite), P9 (card
events), P10 (the browser picker, evidence for R5 only) and P11
(`@capacitor/filesystem` with a card path). A read-only card is not a row on
the sheet; it should be added before the run.
