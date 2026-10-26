# Unreleased

User-facing changes since the last promotion to staging. A PR that changes
what a tester or facilitator sees adds a line here, under the heading that
fits, and cites its PR number. The `chore(release)` PR moves this block into
its body and empties it.

## Added

- Export project asks once what language a book is in, from a searchable list of languages, and writes it into the book and its export (#1630).

## Changed

- A segment marked Finished has its loudness evened out before it is stored, so finished segments play back at a similar level; segments finished before this change are left as they were (#1679).

## Fixed

- A recording that was being saved when the app closed is saved on the next launch, and one another copy already saved is not saved twice (#38, #1557).
- A recording finished in the first moments after the app opens, while that save is still running, is saved once it is done instead of being lost (#1549, #1683).
- On iPhone, the app declares playback again on each Play, so the silent switch should not mute it; not yet checked on a phone (#1518, #1521).
- After an update, an action that needs a part of the app loaded later (such as Share Book or Export project) no longer just fails: the app restarts once to pick up the new version, unless a recording is open or unsaved. If it fails again, it is written to the problem log; not yet checked on a phone (#1421).

## Removed

## Security
