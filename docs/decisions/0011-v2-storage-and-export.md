# 0011 — v2: recordings on the microSD card, projects exported as Scripture Bundle

**Status:** Accepted · **Date:** 2026-10-19 · **Decided by:** the requirements
owner, through the v2 decisions recorded in
[`../design/v2-plan.md`](../design/v2-plan.md#decisions-recorded-2026-10-19)
(D2-microsd, D3-export, Q11-backup) and the same day's
[Round 2 answers](../design/v2-plan.md#round-2-decisions-recorded-2026-10-19)
(R3, R4, R5, R9, R11, R16, R17)

Revisits [ADR 0005](0005-no-backend-in-phase-1.md) for v2. ADR 0005 is not
superseded: its decision stands, and one of its consequences changes.

## Context

ADR 0005 shipped no backend and kept all state in IndexedDB on the device. Its
first consequence reads: "IndexedDB is the system of record, not a cache."
Pivot-plan decision D4 (23 Aug) kept microSD to the share sheet and left ADR
0005 unchanged.

The v2 plan (2026-10-19) asks for two things that ADR 0005 did not foresee:

- On Android, record straight onto the microSD card and back up all projects to
  it.
- Export a whole book as a working project, in Scripture Bundle format (the
  plan's "Scripture Burrito"; see the naming note in the v2 plan).

Its open question 10 asks the team to read ADR 0005 and record the decision that
replaces D4. This ADR is that record.

## Decision

### What still stands from ADR 0005

- **No backend.** No Worker script, no auth, no API and no KV; `dist/` still
  deploys as static assets.
- **Sharing off the device is still a file the user hands on** — the OS share
  sheet or a file written to storage the user controls — not an upload.
- **Cloud sync is not decided.** Google Drive and iCloud sync are "desired" in
  the v2 plan, not required. Nothing here commits to them, and building either
  would need its own decision, because it is the "Phase 2 sync" ADR 0005 said
  would need that decision revisited.

### What changes for v2

1. **IndexedDB is no longer the only system of record.** On Android, a
   recording may live on removable storage — the microSD card — rather than in
   IndexedDB (D2-microsd: "Record straight onto the card, and back up to it").
   On iOS, and on Android without a card, IndexedDB stays where recordings
   live.
2. **Projects leave the device as a Scripture Bundle.** A book can be exported
   as a project in Scripture Bundle format (D3-export: "Export in v2, import
   later"). The backup to the card uses the same format, by the product
   owner's note on Q11-backup: "Default to including everything, all metadata,
   in a Scripture Bundle format with a robust manifest. We can process it
   later." That the export and the backup therefore share one writer is an
   inference from those two decisions, not a decision in its own right.
   Round 2 settles four details of that export, quoted from the record:
   - **Format (R9):** "Scripture Bundle only in v2"; the note adds "Shema
     Studio import/export will be v3-required."
   - **Where it runs (R3):** "The installed app only; the web build shows a
     message pointing to the app". Export and Share Book on Android are the
     installed app's job; the web build does not need to carry them.
   - **Backup and restore (R4):** "Backup only in v2; restoring on a phone comes
     with import". The note: "Restore is v2-desired, not required. At a
     minimum, we need to be able to archive the data off the device. We'll
     figure out import after that." So a v2 backup can be written and need not
     be restorable by the app; restore is v2-desired, not required.
   - **Done (R11):** "Valid against the published spec and read back by our own
     test; we ask the translationCore 4 team to add audio". The note:
     "translationCore 4 Desktop development is on a merger path to support all
     the above in future releases."
3. **The card is an Android-app feature, off by default, and unencrypted.**
   - **App only (R5):** "Yes: card recording and backup are Android-app
     features". iOS and the web build have no card path.
   - **Off by default, with a prompt (R16):** the option is "Off by default; a
     facilitator switches it on". The note adds: "On launch, when the app notes
     that a micro SD card is available, it should prompt the user if they want
     to record directly to the card. Default is to record to internal." The
     note's launch prompt goes beyond the option; the default is internal
     either way, and how the prompt and the facilitator's switch combine is not
     decided.
   - **Plain files (R17):** "No: plain audio files the app owns". Nothing on the
     card is encrypted.
   - **The mode this records.** R17 asked "Should recordings on the card be
     encrypted?" and the requirements owner decided `no`. So recordings the app
     writes to the card are **plaintext audio files, with no encryption and no
     access control added by the app**; anyone who can read the card can play
     them. The card path (E7) is built to that mode. This is the only mode
     decided for card recordings.
   - **What this does not decide.** R17 is about whether card files are
     encrypted. It is not the `confidential` flag in the exported project's
     metadata, which [ADR 0014](0014-scripture-bundle-profile.md) sets to
     `false` on the requirements owner's S8 answer, "Not confidential". Whether
     `confidential` also says anything about how backup copies on the card or in
     the cloud are protected is an **open technical question to the DRI,
     [#1580](https://github.com/unfoldingWord/tc-mobile/issues/1580)**. It is
     not answered here. When it is, the answer is recorded in ADR 0014 and,
     once the backup destination is decided, in this ADR.
4. **Card removal is warned against, not designed around.** The product
   owner's note on D2-microsd: "Removing a card mid-recording is highly
   unlikely, so should be warned against, but not worried about."

Share Chapter and Share Book are unchanged (pivot-plan A4).

## Consequences

- **This is T1 storage work.** Data loss in the field is unrecoverable, and
  this decision moves recordings off the one store the storage tests, the
  quota handling and the transaction discipline were built around. Splitting
  the record between IndexedDB and a removable card adds failure modes the
  current code does not have — a card that is missing, full, read-only or
  swapped between sessions, a database row that points at a file that is no
  longer there, and a partial file left on the card when the app is killed
  mid-write while that file is the only copy. Each needs a defined behaviour
  and a test before it ships.
  The product owner's note settles that a card pulled mid-recording gets a
  warning, not recovery design; it does not settle the rest.
- **Nothing is built yet.** No code writes to removable storage, no code
  writes a Scripture Bundle, and no device has run either. This ADR records a
  decision, not a capability.
- **The web build does not follow.** Recording to the card is a native
  (Android) path, beside the IndexedDB path the web build keeps (R5: "Yes: card
  recording and backup are Android-app features"); export and Share Book are
  the installed app's too, and the web build shows a message pointing to the
  app (R3). That this is possible in an Android browser at all has not been
  checked, and is no longer needed.
- **Uninstall and the Android backup setting.** `docs/native/README.md` says
  uninstall deletes every recording because IndexedDB is the system of record.
  Once recordings can live on the card, that sentence needs rewriting — after
  the code exists, not before, so the runbook does not describe a capability
  the shipped app lacks.

## Closed by Round 2

These were open when the ADR was first written; the requirements owner closed
them on 2026-10-19 (the record is in
[the v2 plan](../design/v2-plan.md#round-2-decisions-recorded-2026-10-19)).

- **Can a v2 backup be restored?** Closed by R4. A v2 backup is written and the
  app need not restore it; restore comes with import and is v2-desired, not
  required.
- **Which share path the project export uses on Android.** Closed by R3. The
  installed app only; the web build shows a message pointing to the app. The
  open Android-browser defect
  ([#272](https://github.com/unfoldingWord/tc-mobile/issues/272)) is no longer
  a prerequisite for the export.
- **Whether the web build follows the card path.** Closed by R5. It does not;
  card recording and backup are Android-app features.
- **What "done" means while translationCore 4 cannot open audio bundles.**
  Closed by R11: valid against the published spec and read back by our own
  test.

## Open questions

These are for the requirements owner. This ADR does not decide them.

- **Where a backup goes on a phone with no card.** iPhones have no microSD
  slot, and some Android phones have none. Where a backup goes on those phones,
  short of the desired cloud sync, is not decided. R4 says only that data must
  be archivable off the device.
- **Whether a backup of card-resident audio onto the same card is off-device.**
  R4's minimum is "archive the data off the device". A backup written to the
  card that also holds the recordings does not leave the device, and a lost or
  broken card would take both. Which destination meets the minimum is not
  decided.
- **How the card prompt and the facilitator's switch combine (R16).** The
  option and the note both stand; how often the launch prompt shows, and
  whether the facilitator's switch remembers a "no", is not decided.
- **What translationCore 4 Desktop needs to open the package.** The D3-export
  note says "tC Desktop does/will read/write Scripture Bundle format." Which
  flavour and which manifest fields it reads is not recorded; R11 sets the bar
  at the published spec and our own read-back test, not at a desktop app.
- **When import lands.** R4 says "We'll figure out import after that"; no date
  or version is recorded.
