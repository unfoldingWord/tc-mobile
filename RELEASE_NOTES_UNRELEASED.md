# Unreleased

User-facing changes since the last promotion to staging. A PR that changes
what a tester or facilitator sees adds a line here, under the heading that
fits, and cites its PR number. The `chore(release)` PR moves this block into
its body and empties it.

## Added

- Export project asks once what language a book is in, from a searchable list of languages, and writes it into the book and its export (#1630).
- Share Chapter on a book with no licence chosen asks which licence first, with the same four choices as Share Book, then shares; a book is asked once, whichever share comes first (#1455).

- A book's menu has a Licence tile that reopens the licence choice with the saved licence selected and saves a new pick without sharing; books made from a template do not have it, because their licence is fixed; not yet checked on a phone (#1455).
- A Settings screen, opened by a gear in the Books header, holds the light and dark choice, an "Always show chapter numbers" switch, and a switch to even out the volume when a segment is done (on by default); not yet checked on a phone (#1623, #1685).
- Each book's menu has an Export project row that shares the book as a Scripture Bundle zip; its file name suffix follows the app language; not yet checked on a phone (#1624, #1646).
- Share Book asks which licence first when the book has none chosen (#1670). The licence is then part of the shared file name, and Share Book from the shelf names its files with it too; the file name in the share sheet is not yet checked on a phone (#1573, #1599).
- Each chapter row on the Books screen has a play button: tap to play the whole chapter, tap again to pause, tap again to resume; not yet checked on a phone (#1561).
- A Templates tile opens a list with one entry, Open Bible Stories; tapping it asks for a book name and creates the book from the template; not yet checked on a phone (#1655).
- A second book with a name another book already has is refused, and the sheet asks for a different name (#1633).
- The app opens in the phone's language for Spanish, French, Portuguese, Indonesian, Swahili, Hindi, Russian and Simplified Chinese (Traditional Chinese phones get the Simplified text). These texts are drafted by AI and not yet read by a speaker of each language. Arabic is not offered yet (#1541, #1586, #1592, #1602, #1622, #1626, #1631, #1639, #1667).
- On an iPhone, the microphone permission prompt appears in those same languages; not yet checked on a phone (#1705).
- On Android, the About screen shows a QR code for the Play listing so another person can scan it; not yet checked on a phone (#1668).
- When the microphone is refused again after Try again, the Android and iOS apps show the steps to turn it on in the phone's settings, and the refusal card shakes on each repeated refusal; not yet checked on a phone (#1571, #1672).
- Sharing a chapter shows progress while its recordings are read and joined; not yet checked on a phone (#1659).

## Changed

- A segment marked Finished has its loudness evened out before it is stored, so finished segments play back at a similar level; segments finished before this change are left as they were (#1679).
- Removing a segment's recording now says "Reset" everywhere, and the confirm button reads "Reset recording" (#1515).
- Shared chapter files put the chapter's number before its name, for example "Jonah - 03 Jonah runs.mp3", so they sort in chapter order (#1516).
- A long book, chapter or segment name is shown in full at the top of its menu, and the recorder's menu shows the full chapter name (#1617, #1673).
- While a take is recording, the first tile in the recorder menu is Stop (#1513).
- A chapter keeps its own number when it is moved, instead of taking its new position (#1634).
- The trim selection is its own blue, apart from the amber waveform (#1535).
- Numbers and timers always use the digits 0 to 9, whatever the language (#1650).
- If the microphone stops sending sound during a recording, for example when an alarm rings, the recorder stops and saves what it captured (#1511).
- Screen readers: switches in Settings are announced as on or off, full licence names and the language result count are read in the licence and language screens, a failed chapter play is named as a failure, a selection handle says its position in seconds, the delete-book question is read with Keep, a template's licence is read with its title, and the recorder's zoom button no longer claims the whole segment is on screen (#1722, #1718, #1721, #1723, #1716, #1717, #1621).

## Fixed

- A recording that was being saved when the app closed is saved on the next launch, and one another copy already saved is not saved twice (#38, #1557).
- A recording finished in the first moments after the app opens, while that save is still running, is saved once it is done instead of being lost (#1549, #1683).
- On iPhone, the app declares playback again on each Play, so the silent switch should not mute it; not yet checked on a phone (#1518, #1521).
- A take whose microphone was already lost as recording opened now stops at once instead of showing a running timer; not yet checked on a phone (#1447).
- A recording the phone could not finish no longer says no sound was recorded (#1677).
- Sharing a book whose name is only symbols names the file "Book.zip" instead of ".zip" (#1504).
- Long button captions in the book menu wrap instead of overlapping in Spanish, French, Portuguese and Russian (#1682); the Spanish and French microphone-off titles fit the refusal card at a small width (#1609).
- After an update, an action that needs a part of the app loaded later (such as Share Book or Export project) no longer just fails: the app restarts once to pick up the new version, unless a recording is open or unsaved. If it fails again, it is written to the problem log; not yet checked on a phone (#1421).

## Removed

## Security
