# 0011 — v2: recordings on the microSD card, projects exported as Scripture Bundle

**Status:** Accepted · **Date:** 2026-10-19 · **Decided by:** the requirements
owner, through the v2 decisions recorded in
[`../design/v2-plan.md`](../design/v2-plan.md#decisions-recorded-2026-10-19)
(D2-microsd, D3-export, Q11-backup)

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
3. **Card removal is warned against, not designed around.** The product
   owner's note on D2-microsd: "Removing a card mid-recording is highly
   unlikely, so should be warned against, but not worried about."

Share Chapter and Share Book are unchanged (pivot-plan A4).

## Consequences

- **This is T1 storage work.** Data loss in the field is unrecoverable, and
  this decision moves recordings off the one store the storage tests, the
  quota handling and the transaction discipline were built around. Splitting
  the record between IndexedDB and a removable card adds failure modes the
  current code does not have — a card that is missing, full, read-only or
  swapped between sessions, and a database row that points at a file that is
  no longer there. Each needs a defined behaviour and a test before it ships.
  The product owner's note settles that a card pulled mid-recording gets a
  warning, not recovery design; it does not settle the rest.
- **Nothing is built yet.** No code writes to removable storage, no code
  writes a Scripture Bundle, and no device has run either. This ADR records a
  decision, not a capability.
- **Share Book must work on Android first.** The project export rides the same
  share path, and Share Book on Android is an open defect
  ([#272](https://github.com/unfoldingWord/tc-mobile/issues/272)).
- **The web build probably cannot follow.** Recording to the card is expected
  to be a native (Android) path, beside the IndexedDB path the web build
  keeps. That is an inference, not something the decisions say, and it has
  not been checked against what an Android browser allows.
- **Uninstall and the Android backup setting.** `docs/native/README.md` says
  uninstall deletes every recording because IndexedDB is the system of record.
  Once recordings can live on the card, that sentence needs rewriting — after
  the code exists, not before, so the runbook does not describe a capability
  the shipped app lacks.

## Open questions

These are for the requirements owner. This ADR does not decide them.

- **Can a v2 backup be restored?** D3-export puts import after v2. If a backup
  uses the same Scripture Bundle format and v2 cannot import, then a v2 backup
  can be written but not restored by the app (inference). Whether that is the
  intent — a copy kept safe for later processing, as "We can process it later"
  may suggest — or whether restore is needed in v2 is open.
- **Where a backup goes on a phone with no card.** iPhones have no microSD
  slot, and some Android phones have none. Where a backup goes on those phones,
  short of the desired cloud sync, is not decided.
- **What tC Desktop needs to open the package.** The D3-export note says "tC
  Desktop does/will read/write Scripture Bundle format." Which flavour and
  which manifest fields it reads is not recorded.
