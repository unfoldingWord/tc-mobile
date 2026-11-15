# Run sheet: v11 recordings survive the upgrade to v12 and later (#1464)

This is the Android half of #1464, written for a Claude Code session driving a
phone over adb with the DRI beside it. It is the same shape as the card-spike
run sheet (`docs/native/card-spike-sheet.md` on `spike/card-store`, #1472).
**The iOS half and the web two-copy case stay open.** Nothing here covers an
iPhone or a browser, and an Android pass does not close #1464.

**Nothing below has been run on a device.** Every results cell starts empty and
is filled by whoever holds the phone. Anything marked **ASSUMPTION** is the
author's reading, not something observed: check it, and record what you found
instead. Where a step says **HUMAN**, stop and ask the DRI to do it with their
hands and wait for the answer. Do not guess a result; write `cannot-tell` with
the reason.

## What this checks, and why it is a data-safety run

`DB_VERSION` in `src/lib/storage/db.ts` is 14 on `develop` and was 14 in
`tester-build-v1.2.2` (read with `git show tester-build-v1.2.2:src/lib/storage/db.ts`).
`tester-build-v1.1.0` was 11. So one open of 1.2.2 on a phone holding 1.1.x data
runs the v12 (#1462), v13 (#38) and v14 (#1433) steps in a single start-up.
That is the first time those steps meet a real phone. The migrations were run
in automated tests and in a desktop browser, and not on a phone
(`tester-build-v1.2.2` release notes say so).

The schema only goes up. IndexedDB refuses to open a database at a lower
version, so after this run the phone **cannot** be put back on 1.1.0 (AGENTS.md,
"A rollback is not free once a phone has opened a build with a newer database
schema"). That makes the run one-way for the phone's data. Two rules follow, and
they override everything below:

1. **Never uninstall the app.** Uninstalling deletes the recordings.
2. **No upgrade until a safe copy exists, or the data is disposable and the
   DRI has said so.**

## Open points the DRI sets

- Which phone: one Android phone, ideally the one the project's testers use.
  The issue's scope also asks for an iPhone (TestFlight); that is a separate
  run and is not covered here.
- Whether the phone's current books are real work or throwaway (see "Data
  safety gate").

## Prerequisites

Run each check and paste its output into the notes.

1. **Tools.** `adb version`, `gh --version` (to download the APKs), `sha256sum`.
   An Android SDK is optional (only for the optional signer check below).
2. **Phone connected.** `adb devices -l` must list exactly one device in state
   `device`. `unauthorized` means the DRI must accept the USB debugging prompt
   (**HUMAN**). If more than one device is listed, pass `-s <serial>` to every
   adb command. Keep the serial in local scratch notes only.
3. **Phone facts.** `adb shell getprop ro.product.manufacturer`,
   `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`.
   Also the WebView: `adb shell dumpsys package com.google.android.webview | grep versionName`.
   **ASSUMPTION:** that is the WebView's package name; on some phones it is
   `com.android.webview` or a Trichrome package, so check `adb shell pm list packages | grep -i webview` first.
4. **Free space.** `adb shell df /data | tail -1`. The app writes a few hundred
   MB at most; if the phone has under about 1 GB free, stop and tell the DRI
   (**ASSUMPTION** on the figure; a full phone changes what the upgrade does
   and is a different test).
5. **The app's current state.** `adb shell dumpsys package org.unfoldingword.tcmobile | grep -E "versionName|versionCode|firstInstallTime|lastUpdateTime"`.
   Package name `org.unfoldingword.tcmobile` is from `capacitor.config.ts`.
   Four outcomes:
   - not installed: continue to S0 below, after the "Data safety gate"
     (Route A, since there is nothing to copy);
   - installed with `versionName` `1.1.0` (or another 1.1.x): the phone is
     already at the starting point; go to "Data safety gate";
   - installed with any `versionName` below 1.1.0 (for example 1.0.x), or any
     other value that is not 1.1.x: **stop**. This sheet's only copy procedure
     (the "Data safety gate") runs on a phone that is already at 1.1.x, and the
     install over a 1.0.x phone would raise its schema before any copy exists.
     Report it and use another phone. Pre-v9 behaviour stays `couldn't reach`
     here, with no procedure in this sheet.
   - installed with `versionName` 1.2.x or later: **stop**. The phone has
     already opened a v14 database, so there is nothing to upgrade. Report that
     and use a different phone.

## Builds, and the order they go on

Both are on the GitHub releases page. They are signed with the same
release certificate, so each installs over the one before it in place.

| Order | Release tag           | APK SHA-256 (from the release notes)                               | `DB_VERSION` |
| ----- | --------------------- | ------------------------------------------------------------------ | ------------ |
| 1     | `tester-build-v1.1.0` | `74274a4047e549eeccf296abcfcf1ed2e84596e76d3454b5f4afe4e1647ac844` | 11           |
| 2     | `tester-build-v1.2.2` | `5092fcfea1163eb80853f95d671dfc38a654876c0ccf9f78d7ec1889a0955744` | 14           |

Both releases state the signing certificate SHA-256
`eed23e1bccf9fbad8b69f2f9598fd8d97e094d23e544b71b9e91dd21c934baf2`.

Download into a fresh scratch directory, never inside the repo:

```
mkdir -p /tmp/run-1464/v1.1.0 /tmp/run-1464/v1.2.2
gh release download tester-build-v1.1.0 --repo unfoldingWord/tc-mobile --pattern app-release.apk --dir /tmp/run-1464/v1.1.0
gh release download tester-build-v1.2.2 --repo unfoldingWord/tc-mobile --pattern app-release.apk --dir /tmp/run-1464/v1.2.2
sha256sum /tmp/run-1464/v1.1.0/app-release.apk /tmp/run-1464/v1.2.2/app-release.apk
```

The two hashes must equal the table. A mismatch means stop; do not install.
Optional, if the Android SDK build-tools are present:
`apksigner verify --print-certs <apk>` and compare the SHA-256 digest line with
the certificate above (**ASSUMPTION:** `apksigner` is on the PATH).

**The `develop` head cannot be tested this way.** A build made on the machine
is debug-signed (or signed with a key the DRI holds), and a different signing
key cannot update the release-signed app; the only way forward would be an
uninstall, which is forbidden. `develop`'s `DB_VERSION` equals 1.2.2's (14), so
1.2.2 covers "v12 and later" as of 2026-11-02. When a later tester build
(v1.3.0 is the planned sprint-end cut) changes the schema, repeat the second
install of this sheet with that build on a phone that holds v14 data and that
build's own `DB_VERSION`.

`adb install -r` replaces an installed app and keeps its data. **Never** pass
`-d` (allows a downgrade) and never run `adb uninstall`.

## Data safety gate (before any install over existing data)

`android:allowBackup="false"` is set in the manifest (`docs/native/README.md`
§5), and a release APK is not debuggable, so `adb backup` and
`adb shell run-as org.unfoldingword.tcmobile` cannot copy the app's IndexedDB.
**ASSUMPTION** (read from the README and the build, not tried on this phone):
there is no adb route to a full copy of the app's data. So the safe copy is
made from inside the app, or the data is disposable. The DRI picks one.

**Route A: disposable data (preferred).** The DRI confirms (**HUMAN**) that the
app on this phone holds nothing that matters, or that the app is not installed.
Then the run makes its own recordings on 1.1.0 (steps S1 to S6 below) and the
upgrade is then run over those. Note "disposable, per the DRI" and the
date.

**Route B: the phone holds real v11 recordings.** Before the second install:

1. **HUMAN:** in the app on 1.1.0, use Share Book for every book and save each
   zip to **Files > Downloads** on the phone. If "Share your work" is offered,
   use it too. A Drive or messaging-app destination is allowed only after the
   DRI accepts that destination in writing (it puts real oral-translation
   audio in another service), and even then the zip must still be pulled to the
   machine and counted (steps 2 and 5) before row G can pass. **ASSUMPTION:**
   Share Book writes MP3 per chapter in a zip, so this keeps the audio but may
   not keep chapter names, shelf order, colours or the PCM of unfinished
   segments. It is a rescue copy of the sound, not a restore point.
   **Watch for the share notice.** At `tester-build-v1.1.0`, Share Book shows a
   notice whenever `bookShare.missing > 0 || bookShare.partialSegments > 0`
   (`src/components/books-screen.tsx:1442`, `src/lib/export/book.ts`): "N
   chapters could not be included." and/or "N segments could not be included."
   (`shareBookMissing` and `shareMissing` in `src/lib/strings.ts`, as at that
   tag). A chapter file is written even when some of its segments are missing,
   so a file per chapter does not prove the copy is complete. Write down, per
   book, whether the notice appeared.
2. Pull the zips: `adb shell ls /sdcard/Download | grep -i zip` and
   `adb pull /sdcard/Download/<file> ~/tc-mobile-rescue-copies/` (run
   `mkdir -p ~/tc-mobile-rescue-copies` first). That folder is outside `/tmp` and
   outside the scratch directory on purpose: it may hold the only off-phone copy
   of real recordings, and no cleanup step in this sheet touches it.
   Open each zip on the machine (`unzip -l`) and count the chapter MP3s against
   what the phone's Books screen shows. Names of books stay in local notes only.
   **A short count means the copy is not confirmed** for that book: do not
   treat "we counted them" as enough, and go to step 4.
3. **HUMAN:** for every recording that matters, play it from the zip on the
   machine (extract to a folder under `~/tc-mobile-rescue-copies`) and check it
   by ear against what the phone plays. Note which recordings were checked.
4. If the DRI cannot produce a confirmed off-phone copy for every book that
   matters, **stop**. Do not upgrade. Report on #1464 that no safe copy was
   possible.
5. **A zip is not enough on its own to pass row G.** Route B passes only when
   all of these hold: every book that matters is Finished audio and was counted
   in the zips (step 2); Share Book showed **no** "could not be included" notice
   for any book (step 1); and every recording the DRI cares about was checked by
   ear off the phone (step 3). If any of those fails, row G is a **stop** and
   U1 is not run, unless the DRI writes in row G the specific loss (which
   book, chapter or segment, and what is lost: no PCM of unfinished segments,
   no chapter or segment names, no shelf order, no colours, the notice's
   missing chapters or segments, or an unchecked recording) and says, in their
   own words, that they accept losing it (**HUMAN**).
6. Keep `~/tc-mobile-rescue-copies` until the DRI confirms the recordings are
   safe elsewhere (**HUMAN**); only the DRI deletes it.

## Capturing output

Start before the first install and leave it running in a second shell:

```
mkdir -p /tmp/run-1464
adb logcat -c
adb logcat -v threadtime -e 'Capacitor|tcmobile|AndroidRuntime|FATAL|chromium|IndexedDB' > /tmp/run-1464/logcat-all.txt &
# the capture is already filtered to these tags; narrow further any time:
grep -E 'AndroidRuntime|FATAL' /tmp/run-1464/logcat-all.txt
```

The capture keeps only lines matching those tags, which can still include other
apps' lines. Keep `logcat-all.txt` local and never attach or paste it; quote only the filtered lines a result needs. **ASSUMPTION:** this phone's `logcat` supports `-e`; if it refuses the flag, say so in the notes and capture without it, kept local.

`AndroidRuntime` or `FATAL EXCEPTION` lines are a crash. The release APK's
WebView is not inspectable (only a diagnostic build is, README §5a), so the
in-app failure log is the main record of what the migration did: Books `≡`, a
red mark means a failure was logged, then the send-log row (**HUMAN**; it goes
out through the share sheet as a text file). Photograph the mark's presence or
absence at each stage.

## Steps

Mark every cell `pass`, `fail`, `cannot-tell` or `n/a` with a note.

### S0 Starting point

If the app is not installed (fresh phone), install 1.1.0
(`adb install -r /tmp/run-1464/v1.1.0/app-release.apk`). If it is already 1.1.x,
do not install. If a **newer** 1.1.x build is installed, Android refuses the
1.1.0 APK (`INSTALL_FAILED_VERSION_DOWNGRADE`): stay on the installed 1.1.x
build, record its `versionName`, and carry on from it. That is not a failed
upgrade and "must read 1.1.0" is not a pass condition then. Never `-d`.
Confirm with `adb shell dumpsys package org.unfoldingword.tcmobile | grep versionName`
(`1.1.0`, or the 1.1.x you recorded). HUMAN: open the app; the build stamp at
the foot of Books must start with that `v1.1.x`.

### S1 to S6 Seed the data on 1.1.0 (Route A, or add to Route B)

The issue's scope calls for: at least two books, several chapters, Finished
(MP3) and unfinished (PCM) segments, a named chapter and a named segment.
HUMAN does these in the app on 1.1.0 (allow the microphone at the first prompt):

- S1 Make two books, one given a name of the DRI's choosing (use a plain name
  like `Test A`, no real names), one left with the default.
- S2 Reorder the two books on the shelf (press and hold), so the order is not
  the creation order. Note the order.
- S3 Add three chapters to book 1 and two to book 2. Rename one chapter.
- S4 Record at least four segments, each a few seconds. Rename one segment.
  Say a different word in each (for example the numbers one to four) so playback
  can be told apart. Leave at least two segments unfinished.
- S5 Mark at least two segments Finished. Wait about 15 seconds for the
  conversion; the Books `≡` must show no red mark.
- S6 Write the **before-inventory**: one table, filled after S1 to S5 and
  before U1, listing **every book on the shelf, including books that were
  already there** (not only the ones from S1), in shelf order, with: name, cover
  colour, number of chapters, chapter and segment counts, the renamed chapter
  and segment, which segments are Finished and which are not, and what each
  plays. A book that was on the shelf and is missing from this inventory is a
  **stop**: fix the inventory before U1. On Route B, take the screenshots of
  this same shelf now (`adb exec-out screencap -p > /tmp/run-1464/before-books.png`
  and one for each Segments screen). Look at each image before keeping it;
  delete any that shows a person's name or a place. Route B images show real
  book and chapter titles, so they stay local (Recording the result step 3).

Also note the free storage figure (`adb shell df /data | tail -1`).

### U1 Upgrade in place

1. Close the app fully (**HUMAN**, swipe it from recents).
2. `adb install -r /tmp/run-1464/v1.2.2/app-release.apk`. Expect `Success`.
   A signature error or `INSTALL_FAILED_UPDATE_INCOMPATIBLE` means stop; do
   **not** uninstall. Report it.
3. `adb shell dumpsys package org.unfoldingword.tcmobile | grep -E "versionName|versionCode"`:
   `versionName` must be `1.2.2`; `versionCode` must be higher than before.
4. **HUMAN** opens the app once. The first open runs the migration. Note how
   long Books took to appear and whether it showed an error screen (for example
   "This copy is out of date" would be a fail). Build stamp must start `v1.2.2`.

### U2 What survived

HUMAN walks the app with the before-inventory from S6:

| Check                                                                               | How                        |
| ----------------------------------------------------------------------------------- | -------------------------- |
| Every book is on the shelf, same order, same names                                  | compare with the inventory |
| Cover colours unchanged                                                             | compare with the inventory |
| Every chapter is there, the renamed one keeps its name                              | open each book             |
| Every segment is there, the renamed one keeps its name                              | open each chapter          |
| Finished marks unchanged                                                            | compare with the inventory |
| Every segment plays and says the word it said before (Finished and unfinished both) | tap Play on each, by ear   |
| Close the app fully, reopen: nothing changes                                        | force-stop and reopen      |
| Books `≡` shows no red mark (or, if one appears, send the log; Recording step 3)    | look; send log if marked   |

Cross-check from the machine, without touching data: `adb shell dumpsys diskstats | grep -i tcmobile`
for app data size before and after (**ASSUMPTION:** this output shape varies by
Android version; if it is empty, mark `cannot-tell`). The size should not
shrink.

### U3 The app still works on upgraded data

HUMAN: (a) record a new segment in an existing chapter; it saves and plays;
(b) delete one segment you made in S4 (use the segment's menu); it goes and the
others stay; (c) mark the new segment Finished and wait; (d) add a new chapter.
Books `≡` must show no new red mark.

### U4 Share still works (smoke)

HUMAN: Share Chapter once. The Android share sheet must open with a file.
(Not a restore check; a sanity check after the migration.)

### U5 What is not done here (record as open)

- iPhone (TestFlight): the issue asks for it separately. Open.
- Web two-copy case (an old tab open while a new one upgrades): open.
- Rollback: forbidden in practice (see above); this sheet never installs an
  older APK over a newer one.
- Any start below schema 11, including #974's #964 row (v8 to v9): open. This
  run starts at 11, and `src/lib/storage/db.ts` runs the v9, v10 and v11 steps
  only when `oldVersion` is below them, so nothing here exercises them. Do not
  mark #974's row U passed from this sheet for that part. If the phone is
  already on 1.0.x, stop: see prerequisite 5.

## Results

One table per phone. Header: model, Android release and sdk, WebView version,
route (A or B), build versions installed in order, date.

| Row | What                                              | pass / fail / cannot-tell | Evidence | Notes        |
| --- | ------------------------------------------------- | ------------------------- | -------- | ------------ |
| G   | Data safety gate passed (route and evidence)      |                           |          |              |
| S0  | Phone on 1.1.x, stamp matches (versionName noted) |                           |          |              |
| S6  | Before-inventory written, every book listed       |                           |          |              |
| U1  | Install over succeeded, versionName 1.2.2         |                           |          |              |
| U1  | First open: no error screen                       |                           |          |              |
| U2  | Books, order, names unchanged                     |                           |          |              |
| U2  | Cover colours unchanged                           |                           |          |              |
| U2  | Chapters and the renamed chapter                  |                           |          |              |
| U2  | Segments and the renamed segment                  |                           |          |              |
| U2  | Finished marks unchanged                          |                           |          |              |
| U2  | Every segment plays (Finished and unfinished)     |                           |          |              |
| U2  | Reopen: nothing changes                           |                           |          |              |
| U2  | `≡` shows no red mark                             |                           |          |              |
| U3  | New recording saves and plays                     |                           |          |              |
| U3  | Delete works                                      |                           |          |              |
| U3  | New chapter works                                 |                           |          |              |
| U4  | Share Chapter opens the share sheet               |                           |          |              |
| U5  | iPhone and web two-copy case                      | open                      |          | not run here |

## Safety and stop rules

- **Never** run `adb uninstall`, `pm clear`, `pm uninstall`, a factory reset,
  "Clear storage" or "Clear data" in Settings, or `adb install -d`. Clearing
  the cache is also out of scope here.
- Never install an older APK over a newer one. A refusal is the answer, not a
  problem to work around.
- Stop and ask the DRI if: the phone holds real recordings and no confirmed
  copy exists; the install reports any error; the app shows "This copy is out
  of date", a database error screen, or a book from the before-inventory missing;
  the phone shows a low-battery warning or under 1 GB free.
- If a recording is missing after the upgrade: **do not retry, reinstall or
  roll back.** Leave the phone as it is, send the failure log through the
  app's own share row, take a screenshot, and report on #1464 (on Route B the
  log and the screenshot stay local; Recording the result step 3). Roll forward
  with a fix; the recordings are not deleted by a refused open (AGENTS.md).
- No names, no places. Refer to people by role ("the DRI") and to phones by
  model and Android version. Do not post the adb serial, a volume label, a
  Wi-Fi name, or a screenshot that shows a contact or a location. Book and
  segment names in the test data are plain labels (`Test A`).

## Recording the result

1. **A dated comment on #1464**, `YYYY-MM-DD` (the user's date, not the
   container clock). Include: the results table with the phone model, Android
   version and the two build versions; the route used; which rows are
   `cannot-tell` and why; which **ASSUMPTION** lines turned out wrong; and a
   plain line that the iPhone and web halves are still open. Claim only what
   was observed.
2. **A tracker line through a docs PR.** Add one dated entry at the top of
   `docs/progress_tracker.md` (newest first, one entry per session; never edit
   an older entry) stating what was run, on which phone model and Android
   version, the builds, and a link to the #1464 comment. Open it as a docs PR
   from `develop` with the Sprint 6 milestone and `release-notes: N/A`. Run
   `npm run check:pr-body` first.
3. **Screenshots and the failure log.** On Route A, attach the before and
   after screenshots of `Test A` to the #1464 comment, after reviewing each for
   names and places. On Route B, the #1464 comment gets the counts and the
   results table only: no shelf or Segments screenshot and no failure log.
   They show real book and chapter titles (the log may quote them), and #1464
   is on a public repository. Attach one only after the DRI writes, for that
   specific file, that it shows no book or chapter title, person, place or
   audio (**HUMAN**). On a Route B loss the before images are the metadata the
   zip may not hold: move them, and the log, into `~/tc-mobile-rescue-copies`
   before cleanup. Do not commit logs, screenshots or the APKs. Delete
   `/tmp/run-1464` when done, after the comment is posted, and never
   `~/tc-mobile-rescue-copies` (Route B step 6).
4. Do not close #1464 from this run; it needs the iPhone entry and the web
   two-copy case.

## Cleanup

1. Stop the logcat capture.
2. Leave the app installed at 1.2.2. Do not uninstall and do not roll back.
3. Delete the downloaded APKs and any screenshots from the machine's scratch
   directory once the results are posted. Never delete
   `~/tc-mobile-rescue-copies` before the DRI confirms the recordings are safe
   elsewhere. The DRI removes, in the app, only
   the books created in S1 (on a Route B phone, never any other book); on a
   Route A phone they may stay unless the DRI asks.
