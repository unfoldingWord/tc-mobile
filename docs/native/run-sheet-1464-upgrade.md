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
in Node against a simulated database only (`tester-build-v1.2.2` release notes
say so).

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
   Three outcomes:
   - not installed: continue to "Build 1" below;
   - installed with `versionName` `1.1.0` (or another 1.1.x): the phone is
     already at the starting point; go to "Data safety gate";
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

1. **HUMAN:** in the app on 1.1.0, use Share Book for every book and send each
   zip somewhere off the phone (the share sheet's Drive, a messaging app, or
   Files > Downloads). If "Share your work" is offered, use it too. **ASSUMPTION:**
   Share Book writes MP3 per chapter in a zip, so this keeps the audio but may
   not keep chapter names, shelf order, colours or the PCM of unfinished
   segments. It is a rescue copy of the sound, not a restore point.
2. If the zips went to Files > Downloads, pull them:
   `adb shell ls /sdcard/Download | grep -i zip` and `adb pull /sdcard/Download/<file> ~/tc-mobile-rescue-copies/` (run
   `mkdir -p ~/tc-mobile-rescue-copies` first). That folder is outside `/tmp` and
   outside the scratch directory on purpose: it may hold the only off-phone copy
   of real recordings, and no cleanup step in this sheet touches it.
   Open each zip on the machine (`unzip -l`) and count the chapter MP3s against
   what the phone's Books screen shows. Names of books stay in local notes only.
3. Photograph or screenshot the Books and Segments screens as the "before"
   record (`adb exec-out screencap -p > /tmp/run-1464/before-books.png`). Look at
   each image before keeping it; delete any that shows a person's name or a
   place.
4. If the DRI cannot produce a confirmed off-phone copy for every book that
   matters, **stop**. Do not upgrade. Report on #1464 that no safe copy was
   possible.
5. **A zip is not enough on its own to pass row G.** Route B passes only when
   either every book that matters is Finished audio and was counted in the
   zips (step 2), or the DRI writes in row G what the copy lacks (no PCM of
   unfinished segments, no chapter or segment names, no shelf order, no
   colours) and says, in their own words, that they accept losing it
   (**HUMAN**). If an unfinished segment matters and the DRI does not accept
   that, row G is a **stop**: do not run U1.
6. Keep `~/tc-mobile-rescue-copies` until the DRI confirms the recordings are
   safe elsewhere (**HUMAN**); only the DRI deletes it.

## Capturing output

Start before the first install and leave it running in a second shell:

```
mkdir -p /tmp/run-1464
adb logcat -c
adb logcat -v threadtime > /tmp/run-1464/logcat-all.txt &
# filtered view, re-run any time:
grep -E 'Capacitor|tcmobile|AndroidRuntime|FATAL|chromium|IndexedDB' /tmp/run-1464/logcat-all.txt
```

`AndroidRuntime` or `FATAL EXCEPTION` lines are a crash. The release APK's
WebView is not inspectable (only a diagnostic build is, README §5a), so the
in-app failure log is the main record of what the migration did: Books `≡`, a
red mark means a failure was logged, then the send-log row (**HUMAN**; it goes
out through the share sheet as a text file). Photograph the mark's presence or
absence at each stage.

## Steps

Mark every cell `pass`, `fail`, `cannot-tell` or `n/a` with a note.

### S0 Starting point

If the phone is not on 1.1.0, install it (`adb install -r /tmp/run-1464/v1.1.0/app-release.apk`)
only when the app was not installed (fresh phone) or is already 1.1.x. If a
**newer** app is installed, Android will refuse the older APK (`INSTALL_FAILED_VERSION_DOWNGRADE`); do not
work around it. Confirm: `adb shell dumpsys package org.unfoldingword.tcmobile | grep versionName`
must read `1.1.0`. HUMAN: open the app; the build stamp at the foot of Books
(`v1.1.0 · <sha>`) must start `v1.1.0`.

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
- S6 Write the "before" table (below): books and order, chapter and segment
  names and counts, which segments are Finished, what each plays.

Also note the cover colours and the free storage figure
(`adb shell df /data | tail -1`).

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

HUMAN walks the app with the "before" table:

| Check                                                                               | How                      |
| ----------------------------------------------------------------------------------- | ------------------------ |
| Every book is on the shelf, same order, same names                                  | compare with S6          |
| Cover colours unchanged                                                             | compare with S6          |
| Every chapter is there, the renamed one keeps its name                              | open each book           |
| Every segment is there, the renamed one keeps its name                              | open each chapter        |
| Finished marks unchanged                                                            | compare with S6          |
| Every segment plays and says the word it said before (Finished and unfinished both) | tap Play on each, by ear |
| Close the app fully, reopen: nothing changes                                        | force-stop and reopen    |
| Books `≡` shows no red mark (or, if one appears, send the log and attach it)        | look; send log if marked |

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
  already on 1.0.x, a stop at 1.1.0 first is the same procedure with one more
  install.

## Results

One table per phone. Header: model, Android release and sdk, WebView version,
route (A or B), build versions installed in order, date.

| Row | What                                          | pass / fail / cannot-tell | Evidence | Notes        |
| --- | --------------------------------------------- | ------------------------- | -------- | ------------ |
| G   | Data safety gate passed (route and evidence)  |                           |          |              |
| S0  | Phone on 1.1.0, stamp reads `v1.1.0`          |                           |          |              |
| S6  | "Before" table written                        |                           |          |              |
| U1  | Install over succeeded, versionName 1.2.2     |                           |          |              |
| U1  | First open: no error screen                   |                           |          |              |
| U2  | Books, order, names unchanged                 |                           |          |              |
| U2  | Cover colours unchanged                       |                           |          |              |
| U2  | Chapters and the renamed chapter              |                           |          |              |
| U2  | Segments and the renamed segment              |                           |          |              |
| U2  | Finished marks unchanged                      |                           |          |              |
| U2  | Every segment plays (Finished and unfinished) |                           |          |              |
| U2  | Reopen: nothing changes                       |                           |          |              |
| U2  | `≡` shows no red mark                         |                           |          |              |
| U3  | New recording saves and plays                 |                           |          |              |
| U3  | Delete works                                  |                           |          |              |
| U3  | New chapter works                             |                           |          |              |
| U4  | Share Chapter opens the share sheet           |                           |          |              |
| U5  | iPhone and web two-copy case                  | open                      |          | not run here |

## Safety and stop rules

- **Never** run `adb uninstall`, `pm clear`, `pm uninstall`, a factory reset,
  "Clear storage" or "Clear data" in Settings, or `adb install -d`. Clearing
  the cache is also out of scope here.
- Never install an older APK over a newer one. A refusal is the answer, not a
  problem to work around.
- Stop and ask the DRI if: the phone holds real recordings and no confirmed
  copy exists; the install reports any error; the app shows "This copy is out
  of date", a database error screen, or fewer books than the "before" table;
  the phone shows a low-battery warning or under 1 GB free.
- If a recording is missing after the upgrade: **do not retry, reinstall or
  roll back.** Leave the phone as it is, send the failure log through the
  app's own share row, take a screenshot, and report on #1464. Roll forward
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
3. Do not commit logs, screenshots or the APKs. Delete `/tmp/run-1464` when
   done, after the comment is posted, and never
   `~/tc-mobile-rescue-copies` (Route B step 6).
4. Do not close #1464 from this run; it needs the iPhone entry and the web
   two-copy case.

## Cleanup

1. Stop the logcat capture.
2. Leave the app installed at 1.2.2. Do not uninstall and do not roll back.
3. Delete the downloaded APKs and any screenshots from the machine's scratch
   directory once the results are posted. Never delete
   `~/tc-mobile-rescue-copies` before the DRI confirms the recordings are safe
   elsewhere. Leave the throwaway test books on a
   Route A phone unless the DRI asks to remove them in the app.
