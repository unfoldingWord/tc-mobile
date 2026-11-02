# Run sheet: the Android tester-build phone report (#974)

This is the Android half of #974, written for a Claude Code session driving a
phone over adb with the DRI beside it, in the same shape as the card-spike run
sheet (`docs/native/card-spike-sheet.md` on `spike/card-store`, #1472).
**The iPhone half and the browser rows stay open.** #974 is the standing list
for every phone check that code cannot settle; this sheet runs its Android rows
against `tester-build-v1.2.2`. It does not close #974, and it does not close any
row's source issue by itself.

**Nothing below has been run on a device.** Every results cell starts empty.
Anything marked **ASSUMPTION** is the author's reading, not something observed.
Where a step says **HUMAN**, stop and ask the DRI to do it with their hands and
wait for the answer. Do not guess a result; write `cannot-tell` or
`couldn't reach` with the reason. #974's own convention is pass, fail or
"couldn't reach" per row, one comment per device.

## Which rows this sheet runs

#974 has 34 comments (read 2026-11-02), many of them rows added over six weeks,
some already reported on (an iPhone pass on 1.1.0 on 2026-10-14, an Android
update smoke test on 0.2.14, an rc.1 Moto G report). **Step 0 is to read the
issue and drop any row a later comment already records as passed on Android.**
The rows below are the ones that were Android-runnable and not recorded as
passed in #974's comments. Re-check that against the live thread, because rows
may have moved after 2026-11-02.

Grouped as the three things #974 was asked for:

- **Group 1, the upgrade** (T1, a data-safety row): its own sheet,
  `docs/native/run-sheet-1464-upgrade.md`. Run that first; this sheet does not
  repeat it.
- **Group 2, the O4 look.**
- **Group 3, the device-only checks** (the rest).

## Prerequisites

Run each check and paste its output into the notes.

1. **Tools.** `adb version`, `gh --version`, `sha256sum`.
2. **Phone connected.** `adb devices -l` lists exactly one device in state
   `device` (`unauthorized`: the DRI accepts the prompt, **HUMAN**). With more
   than one, pass `-s <serial>`. The serial stays in local notes only.
3. **Phone facts for the report header** (#974 asks for model, OS, WebView,
   build and role). `adb shell getprop ro.product.manufacturer`,
   `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`,
   `adb shell grep MemTotal /proc/meminfo`, and
   `adb shell pm list features | grep -i ram.low` (the Go flag;
   **ASSUMPTION** it is the right flag on this phone). WebView:
   `adb shell pm list packages | grep -i webview`, then
   `adb shell dumpsys package <package> | grep versionName`.
4. **The build.** `adb shell dumpsys package org.unfoldingword.tcmobile | grep -E "versionName|versionCode"`.
   The build under test is `tester-build-v1.2.2` (APK SHA-256
   `5092fcfea1163eb80853f95d671dfc38a654876c0ccf9f78d7ec1889a0955744`,
   signing certificate SHA-256
   `eed23e1bccf9fbad8b69f2f9598fd8d97e094d23e544b71b9e91dd21c934baf2`, both from
   the release notes). If the phone is on 1.2.2 already, go on. If it is on an
   older build, **stop and run `run-sheet-1464-upgrade.md` first**: 1.2.2
   raises the database version from 11 to 14, one way. If it is not installed
   and the DRI confirms the phone holds nothing that matters:

   ```
   mkdir -p /tmp/run-974
   gh release download tester-build-v1.2.2 --repo unfoldingWord/tc-mobile --pattern app-release.apk --dir /tmp/run-974
   sha256sum /tmp/run-974/app-release.apk
   adb install -r /tmp/run-974/app-release.apk
   ```

   The hash must equal the one above. Never `adb install -d`, never uninstall.
   The footer's build stamp on Books must start `v1.2.2` (**HUMAN** reads it).

5. **Throwaway data.** Several rows erase a recording (Record again, Reset,
   delete). Use only recordings made for this run. **HUMAN** confirms that.
6. **Role.** The report is by role, never name: "developer" or "the DRI".

## Capturing output

```
mkdir -p /tmp/run-974
adb logcat -c
adb logcat -v threadtime > /tmp/run-974/logcat-all.txt &
grep -E 'Capacitor|tcmobile|AndroidRuntime|FATAL|chromium' /tmp/run-974/logcat-all.txt
```

Screenshots: `adb exec-out screencap -p > /tmp/run-974/<name>.png`. Open each
one before keeping it; retake or delete one that shows a notification,
contact, carrier or location. The release APK's WebView is not inspectable
(only a diagnostic build is, `docs/native/README.md` §5a), so the in-app failure
log is the record of what the app logged: Books `≡`, a red mark means a failure
was logged, then the send-log row (**HUMAN**; it goes out as a text file via the
share sheet). After any failed row, note whether `≡` is marked and send the log.

## Steps

Mark each row `pass`, `fail`, `couldn't reach` or `n/a`, with a note.

### Step 0 Read the thread

`gh issue view 974 --repo unfoldingWord/tc-mobile --comments`. Strike from this
run any row a later comment already passed on this class of phone, and keep the
list of what you struck for the dated comment.

### Group 1, the upgrade

- **U** v11 to v14 upgrade in place: run
  `docs/native/run-sheet-1464-upgrade.md`. U passes only on that sheet's
  rows run in this session. **The #964 row (v8 to v9) is not covered by it:**
  that run starts at schema 11, and `src/lib/storage/db.ts` runs the v9 step
  only when `oldVersion` is below 9. #974's own comment says to install the
  build before and after, which needs a phone holding pre-v9 data. Leave the
  #964 row open (`couldn't reach`), as the 1464 sheet's U5 does.
- **N** #923 / #934, native service worker: after the upgrade, the app opens
  straight into the new build, not stuck on the old one until a second launch.
  Observed only when this session watched U1 of the upgrade sheet open the app
  for the first time. If it did not (for example the phone was already on
  1.2.2), N is `couldn't reach`.

### Group 2, the O4 look

**ASSUMPTION:** #974 wrote these rows when the O4 look was behind a switch (≡ >
"New look (O4)"). The O4 look is the only look in 1.2.2 as far as this sheet's
author read (`strings.ts` has no such label at the current head); if ≡ still
shows a toggle, record it.

- **O1** Walk every screen in light and in dark: Books, a book, Segments, the
  recorder, the menus (app ≡, book, chapter, segment, recorder), Settings
  (the gear on Books), About. Text and icons readable (#951 step 4). Screenshot
  each in both themes.
- **O2** Confirm dialogs (#946): erase a take and delete a book. The dialog is
  the O4 card with a dimmed backdrop and two big buttons. Focus lands in the
  dialog and returns to where it was. Use a recording made for this run.
- **O3** Share busy glyph (#947): share a chapter. While it is packing, the
  overlay glyph is teal. A mid-run screenshot is enough.
- **O4** Microphone refused (#948): refuse the microphone (phone Settings, then
  Apps, then tC Mobile, then Permissions). The panel shows the mic. Tap Try
  again, then refuse again: the numbered steps for the phone's settings appear
  with a compact header, Retry and Back stay on screen, and the steps match the
  phone's real Settings route (#1569, #1571). A first refusal still shows the
  older panel. Restart shows the restart glyph where it applies. Allow the
  microphone again afterwards (**HUMAN**).
- **O5** Crash and save-failed screens (#948): if they can be provoked, both use
  O4 paint. Otherwise write `couldn't reach: not reachable on hand`. Do not
  provoke a failure that could lose data.
- **O6** TalkBack: turn it on in the phone's Settings > Accessibility (**HUMAN**).
  Open each tile menu: each tile is read by name. Say if
  focus returns to the ⋮ on closing a book, chapter or segment menu (#679, #676,
  #799, #395).
- **O7** Reduced motion (#1021): Settings > Accessibility > Remove animations
  (path varies; **ASSUMPTION**). Open the app. The launch intro is only a short
  fade and nothing keeps moving (the recording-edge pulse, the Share ring, the
  guide pulse). Note anything still moving. Turn the setting back (**HUMAN**).
- **O8** Native status and navigation bars against the light theme (#506):
  light theme on, then dark. Do the bars follow the theme or stay dark?
  Screenshot each. If they ignore it, note it for a new issue linking #506.
- **O9** The recorder menu (#927): in the recorder, ≡. The sheet covers no more
  than half the screen and its icons are easy to tap; the waveform behind the
  dim backdrop is still readable.
- **O10** The red line while the clipboard holds a cut (#925): in edit mode cut a
  piece; leave and re-enter edit mode; the red line is still there and no
  selection frame opens; open and close ≡ and undo the cut; paste.
- **O11** Press-and-hold reorder (#953): hold a segment's badge or title about
  half a second, drag, drop; the numbers renumber and the order persists on
  reopening; a quick tap still opens the recorder; holding the waveform does
  not drag. Books: hold a chapter row and drop; the chapter badges renumber.
  Also the 1.2.2 ⋮ Move up and Move down on a chapter (it is greyed on the
  first and last). Note any long-press callout, scroll fighting the drag, or
  missing haptic.
- **O12** Long names: press and hold a cut-off book or chapter name in the
  header to read it whole (1.2.2).

### Group 3, the device-only checks

**Recording and playback (Android sanity rows from the 1.1.1 list, comment 31):**

- **R1** Record, speak 10 seconds, Stop (#1294). The timer runs, nothing stops
  by itself, the take plays.
- **R2** Record, set a 1-minute alarm, let it ring, dismiss it (#1294). Pass:
  the timer and wave stop at the alarm and the take ends there. Repeat once
  with the alarm locking the screen and once with a banner. 1.2.x contains
  #1511 (a "recording stopped" state and a `recorder-capture-stalled` row),
  which 1.1.1 did not; read the `≡` log and write down the exact row text or
  "no row".
- **R3** Record, Stop, Play; and Play, Record, Play; and lock/unlock then Play;
  and cold start, then Record before any Play (1.1.1's cases 4 to 8). The
  loudspeaker, not an earpiece, plays. The new take has shape and is audible.
- **R4** Bluetooth speaker or headphones (if the DRI has one): Play and Record
  route to it; Play still works after disconnecting.
- **R5** Record again, microphone allowed (#1028): old take gone, new take
  running. Then with the microphone refused: the old take is still there and
  plays and the screen shows the same message as a refused Record. Then Back
  while the permission prompt is open and Allow: nothing erased. Then switch
  apps right after the confirm: either nothing erased or cleared with a take
  that ended at once; say which. Use a throwaway recording.
- **R6** Static or clicks on record-mode Play (#558): record 20 to 30 seconds,
  press Play in the recorder, then again from the chapter screen; say what you
  hear on each (speaker, and headphones if there are any).
- **R7** Moto G rows (#1201), only if the phone is a Moto G: record then Save,
  does the waveform redraw smaller (screenshot); add a louder take over a quiet
  one and note whether the live wave shows shape or a solid block.
- **R8** Back (#452): Android back button or gesture on Books, Segments and the
  recorder goes one step up and never leaves the app by surprise; open a menu,
  Back once closes it, Back again immediately leaves the screen (not a third);
  open a Clear or Delete confirm, Back closes it and nothing is erased.
- **R9** Tap right after a menu is dragged closed (#1278): open a half-screen
  menu, drag it down, and within half a second tap a control that was
  underneath. A lost tap is the failure.
- **R10** A recording shorter than a moment (#245 step 5): record and stop at
  once; the segment row shows what, and does it play or say empty without an
  error?
- **R11** Background and lock (#245 step 6/7, #58): record, press Home at 30 s,
  wait 60 s, return; and record, Stop, Home at once, reopen. Per the 2026-09-28
  smoke test, locking saves the take and stops recording; a hidden page now
  seals the take (#836). Record what the phone does and whether the take is
  there and plays.
- **R12** Microphone refusal paths (#245 step 3, #203): deny at the OS level then
  Record; allow at the OS but deny at the app prompt; note the panel and copy
  each time.
- **R13** An incoming call mid-take (#59, never run on Android): with a second
  phone or a service, ring the phone mid-take. The partial take is saved as a
  playable segment and the recorder is not frozen. **ASSUMPTION:** needs a
  second phone; `couldn't reach` if not.

**Sharing:**

- **S1** Share Chapter, Share Book, and Share your work once each (#593, #272,
  #1333): the phone's own share sheet opens with the file; the file plays or
  unzips on the receiving side (#1397 touched the share plugins). "Share your
  work" appears only on a nearly full phone; otherwise `couldn't reach`.
- **S2** Share Book on the longest book available, on the smallest phone
  (#1031): screenshot the progress sheet partway; can you tell which chapter it
  is on? Does the chip wall push anything off-screen?
- **S3** Share Book with a partly recorded chapter (#115): the missing-segments
  line shows.
- **S4** Export project (1.2.0): in a book's menu; the first time it asks for the
  book's language; a Scripture Bundle zip shares out. The licence ask appears on
  the first Share Chapter or Share Book (#1455, #1457, #1492).
- **S5** Low space (#992): only on a nearly full phone. Share your work refuses
  cleanly, no half-written file, and the failure log has an entry. Else
  `couldn't reach`. **Never fill the DRI's phone for this**; use only a phone
  that is already low on space, or skip it.
- **S6** Conversion after a full phone (#1015, #1167): only reachable on a nearly
  full phone; same rule as S5.

**Low-end timing** (#1002, from #974 comment 2; ideally on the slowest phone):

- **L1** Share a 5-minute chapter and time it with a clock; one number is the
  need. Record the figure.
- **L2** Share a 20 to 30 minute chapter: does it finish, or does the app crash
  or reload? Time it.
- **L3** Record one 20-minute take, press Stop (#1005): does it save and play
  back? The cap is 20 minutes and cuts a take at the cap (a log row
  `recorder-take-cap`, which does not mark `≡`).
- **L4** Share a book of several hours if one exists, once with the screen on
  and once locking the screen partway.
- **L5** After sharing a book, Settings > Apps > tC Mobile > Storage: note the
  cache size. **Clear cache** only (never Clear storage), only on a phone with
  throwaway recordings, then confirm every recording is still there (#248).

**Phone check** (#1009, #1013):

- **P1** On Books, tap the version line 5 times within 3 seconds. Tap **Start**
  and wait for "Done." Then read the warning and tap **Start memory test**; if
  the app restarts, open the Phone check again to see how far it got. Tap
  **Copy report**; **HUMAN** pastes it into the session; add role and device
  lines. It never touches books or recordings. (The same screen has the Script
  samples section: that is `run-sheet-1486-fonts.md`.)
- **P2** Cancel a running check by leaving the screen with an earlier report
  saved, then reopen: the earlier report is there (#1417).

**Language** (1.2.0, drafts not yet read by speakers):

- **G1** Set the phone to Spanish, French, Portuguese, Indonesian, Swahili,
  Hindi, Russian, Chinese: the app follows the phone and the text draws. Fonts
  are the focus of `run-sheet-1486-fonts.md`; here, only note whether anything
  is wrong in practice. Vietnamese is not in 1.2.2 (see that sheet).

**Rows not runnable on this Android pass** (leave them open in #974): every
iPhone and VoiceOver row; browser and PWA rows (#272 web, the PWA install and
update path, the two-copy case); the `persisted()` / `persist()` reads (#406),
which need an inspector, so a diagnostic APK (README §5a), whose install over a
release-signed 1.2.2 is allowed only with a newer version code and never by
uninstalling (the CI diagnostic APK carries the release signer, README §5a; a
locally built, differently signed APK cannot update the app, so do not use
one); the instrumented playback probe (#555, #612, #269), same reason.
Also not runnable: any row waiting on a build newer than 1.2.2.

## Results

Header per phone: model, Android release and sdk, WebView version, Go flag
and RAM, build, date, role. One row per item that was run:

| Row | What                                      | pass / fail / couldn't reach | Evidence (screenshot, log row) | Notes |
| --- | ----------------------------------------- | ---------------------------- | ------------------------------ | ----- |
| U   | Upgrade (the 1464 sheet)                  |                              |                                |       |
| N   | Native service worker opens the new build |                              |                                |       |
| O1  | Every screen, light and dark              |                              |                                |       |
| O2  | Confirm dialogs                           |                              |                                |       |
| O3  | Share busy glyph                          |                              |                                |       |
| O4  | Mic refused, then refused twice           |                              |                                |       |
| O5  | Crash and save-failed screens             |                              |                                |       |
| O6  | TalkBack names and focus return           |                              |                                |       |
| O7  | Reduced motion                            |                              |                                |       |
| O8  | Status and navigation bars vs theme       |                              |                                |       |
| O9  | Recorder menu                             |                              |                                |       |
| O10 | Red line with a cut on the clipboard      |                              |                                |       |
| O11 | Press-and-hold reorder, Move up and down  |                              |                                |       |
| O12 | Long names                                |                              |                                |       |
| R1  | Normal take                               |                              |                                |       |
| R2  | Alarm                                     |                              |                                |       |
| R3  | Record, Play, lock, cold start            |                              |                                |       |
| R4  | Bluetooth                                 |                              |                                |       |
| R5  | Record again, four cases                  |                              |                                |       |
| R6  | Static or clicks                          |                              |                                |       |
| R7  | Moto G rows                               |                              |                                |       |
| R8  | Back                                      |                              |                                |       |
| R9  | Tap after a menu drag                     |                              |                                |       |
| R10 | Very short take                           |                              |                                |       |
| R11 | Background and lock                       |                              |                                |       |
| R12 | Microphone refusal paths                  |                              |                                |       |
| R13 | Incoming call                             |                              |                                |       |
| S1  | Share Chapter, Book, Your work            |                              |                                |       |
| S2  | Share Book, long book, small phone        |                              |                                |       |
| S3  | Partly recorded chapter                   |                              |                                |       |
| S4  | Export project and licence ask            |                              |                                |       |
| S5  | Low space                                 |                              |                                |       |
| S6  | Conversion retry when full                |                              |                                |       |
| L1  | 5-minute share time                       |                              |                                |       |
| L2  | 20 to 30 minute share                     |                              |                                |       |
| L3  | 20-minute take                            |                              |                                |       |
| L4  | Several-hour book, screen on and locked   |                              |                                |       |
| L5  | Cache size and Clear cache                |                              |                                |       |
| P1  | Phone check and report                    |                              |                                |       |
| P2  | Cancel a run, reopen                      |                              |                                |       |
| G1  | Phone language switches the app           |                              |                                |       |

## Safety and stop rules

- **Never** run `adb uninstall`, `pm clear`, "Clear storage" or "Clear data", a
  factory reset, or `adb install -d`. Uninstalling deletes the recordings.
  **Clear cache** is allowed only for L5, only on a phone with throwaway
  recordings.
- **Rows that erase** (O2, R5, delete and Reset) use only recordings made for
  this run.
- Do not fill a phone's storage to reach S5, S6 or the low-space rows; use a
  phone that is already low, or write `couldn't reach`.
- Do not provoke a crash or a save failure on purpose (O5).
- Stop and ask the DRI if the phone shows a low-battery warning, if any step
  wants an account or personal data, if the build stamp is not `v1.2.2`, if a
  recording that should exist is missing (then **do not retry, reinstall or
  roll back**: send the failure log through the app and report), or if the
  app shows "This copy is out of date".
- No names, no places. Roles only; phones by model and Android version. Do not
  post the adb serial, a Wi-Fi or carrier name, or a screenshot showing a
  notification, contact or location.

## Recording the result

1. **One dated comment on #974 per phone**, `YYYY-MM-DD` (the user's date, not
   the container clock). Header: platform, device, OS, WebView, build stamp,
   role. Then pass, fail or `couldn't reach` per row, with the rows that were
   struck in Step 0 and why. A failed row also gets a short evidence comment on
   its own issue or PR, as #974's own instructions say. State that the iPhone
   rows, the browser rows and the inspector-only rows are still open. Claim
   only what was observed.
2. **A tracker line through a docs PR.** One dated entry at the top of
   `docs/progress_tracker.md` (newest first, one entry per session, never edit
   an older entry): what was run, on which phone model and Android version, the
   build, which rows passed, failed or were not reached, and a link to the #974
   comment. Open it from `develop` with the Sprint 6 milestone and
   `release-notes: N/A`. Run `npm run check:pr-body` first.
3. Do not commit logs or screenshots; put screenshots on the issue after
   review. Delete `/tmp/run-974` when done.
4. A row's source issue closes only by its own acceptance criteria, not by this
   run.

## Cleanup

1. Stop the logcat capture.
2. **HUMAN:** put back any phone setting changed (TalkBack, Remove animations,
   language, microphone permission).
3. Leave the app installed at 1.2.2. Do not uninstall and do not roll back.
4. Delete the scratch directory after the comment is posted.
