# microSD spike run sheet (#1472, E7)

THROWAWAY. This sheet and the probe it drives live on `spike/card-store` and
are never merged into `develop`. The output of the spike is a findings comment
on #1472; the run itself is recorded in `docs/progress_tracker.md`, not here and
not in a docblock (AGENTS.md).

**Nothing below has been run on a device.** The Java in
`CardProbePlugin.java` has never been compiled (PR #1532's body says so), so
the first `assembleDebug` is the first compile; expect to fix a compile error
or two, and say so in the findings. Every table cell starts empty and is filled
by whoever holds the phone. Anything marked **ASSUMPTION** is the author's
reading, not something observed: check it before relying on it, and record what
you found instead.

## Who runs this

The reader is a Claude Code session on a machine with an Android phone
connected over adb, driven by the DRI. Run it step by step. Where a step says
**HUMAN**, stop and ask the DRI to do it with their hands (insert or pull a
card, tap a button on the phone, pick a folder) and wait for the answer. Do not
guess a result; write `cannot-tell` with the reason.

## Open question (the DRI sets it)

The proposed threshold is: **a 20-minute take saves in 20 s or less on the
card.** It is not decided. Record the measured figure only; leave the
threshold-pass column blank until the DRI sets the number.

## What each probe answers

ADR 0013 (`docs/decisions/0013-card-store.md`, Status Proposed) marks every
phone-dependent fact "owed to #1472 Pn". #1826 is revising that ADR on
`develop` today; re-read the ADR at its current head before posting, because
its owed lines may have moved. The mapping below is from the ADR at
`origin/develop` on 2026-11-02 and from #1472's scope.

| P   | Question it answers                                                                                                                                                  | ADR 0013 place it is owed           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P1  | Is the card found, removable, mounted? Is the volume UUID stable across reboot and reinsert? Is an adopted card non-removable? Does the card fold case (FAT, exFAT)? | Path A, volume identity, name rules |
| P2  | Write time and JS heap peak for 2, 10 and 20 minutes in 384 KiB base64 chunks, then fsync and rename; IndexedDB baseline                                             | Save step 1, bridge cost            |
| P3  | Read-back by base64 chunks versus `fetch(convertFileSrc)`: byte-identical (CRC32), and how long each takes                                                           | Read-back, step 1a                  |
| P4  | After a kill or a power-off mid-write: `.part` or nothing, never a partial final name; does the read-back and the rename reach the card, not a cache                 | State table S1 to S5, step 1a       |
| P5  | Card pulled mid-write: no crash, typed error code, IndexedDB unchanged                                                                                               | "Card missing" and "pulled" rows    |
| P6  | Card full: typed FULL code, and a free-space read before the write predicts it                                                                                       | "Card full" row                     |
| P7  | Uninstall: is the app's card folder deleted; what does `hasFragileUserData` keep, for the card folder and for IndexedDB                                              | Uninstall section                   |
| P8  | Picked backup folder (SAF): grant persists across restart, reboot, card out and in; fails on a different card; `rwt` overwrite leaves no tail; card root pickable?   | Path B, backup                      |
| P9  | Which card events reach the plugin, foreground and background, and the state seen on resume                                                                          | Card events                         |
| P10 | Chrome on Android: can `showDirectoryPicker()` pick a card folder and keep the grant (R5 evidence only)                                                              | Path D                              |
| P11 | Does `@capacitor/filesystem` write a full card path, or prompt, or fail (is a custom plugin needed for writes)                                                       | Path C                              |

## Prerequisites

Run each check and paste its output into the notes.

1. **Tools on the machine.** `adb version`, and a built checkout needs Node, the
   Android SDK and a JDK (`docs/native/README.md` core loop). If there is no
   Android SDK, stop: nothing below can build. Report that on #1472.
2. **Phone connected.** `adb devices -l` must list exactly one device in state
   `device`. `unauthorized` means the DRI must accept the USB debugging prompt
   on the phone (**HUMAN**). If more than one device is listed, pass
   `-s <serial>` to every adb command below. Record the serial only in your
   local scratch notes; it does not go on the issue.
3. **Phone facts.** Record `adb shell getprop ro.product.manufacturer`,
   `ro.product.model` and `ro.build.version.release` and `ro.build.version.sdk`.
   Model and Android version go in the results; the probe's `P1 volumes` line
   also prints `sdk` and `model`.
4. **A microSD card in the phone** (**HUMAN** to insert) that is **empty or
   disposable**. The probe writes up to the whole free space of the card (P6)
   and deletes only its own files, but a card with someone's files on it is not
   to be used. Note card type, size and filesystem (FAT32 or exFAT; the phone's
   Settings storage screen shows it, or `adb shell sm list-volumes public`).
5. **The card is mounted.** `adb shell sm list-volumes all` shows a `public`
   volume with state `mounted`. If it says `unmounted` or `unmountable`, stop
   and ask the DRI to reinsert or reformat (**HUMAN**; reformatting erases the
   card, so ask first).
6. **Adopted-storage check.** If the card was ever formatted as internal storage
   the list shows a `private` volume instead. That is the "adopted" case P1
   tests; do not undo it without asking.
7. **Which phones.** The spike wants (a) Android 11 or later with a slot, (b)
   Android 7 to 10 with a slot, (c) a phone with no slot (P1 only, expect no
   removable volume), and two cards (a small FAT32 and a 64 GB or larger
   exFAT). The DRI has one phone connected now; run what that phone is, fill
   that column, and leave the others blank for a later session. Slot status of
   the project's phones is not verified.

## Build and install

Use the branch's own commands. These come from `docs/native/README.md` (core
loop, and §5a "diagnostic builds") and `package.json` on this branch.

1. Check out `spike/card-store` and record the build SHA:
   `git rev-parse --short HEAD`. Run `npm ci` if `node_modules` is stale.
2. Diagnostic debug build, so the WebView exposes heap numbers and can be
   inspected. The same variable must be set for **both** the sync and Gradle:
   ```
   export TC_ANDROID_DIAGNOSTIC=true
   npm run build:native && npx cap sync android
   cd android && ./gradlew assembleDebug
   # -> android/app/build/outputs/apk/debug/app-debug.apk
   ```
   If Gradle fails to compile `CardProbePlugin.java`, fix only that file, note
   every change, and commit it on `spike/card-store` with a normal commit. Do
   not touch anything else.
3. Install over adb: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
   Package name: `org.unfoldingword.tcmobile` (from `capacitor.config.ts`).
   **If an ordinary tester build of the app is already on the phone, stop and
   ask the DRI** (**HUMAN**). A debug-signed APK cannot update a release-signed
   one, and uninstalling deletes that app's recordings. Use a phone with no
   recordings that matter, or one where the DRI says deleting is fine.
4. Confirm: `adb shell pm list packages | grep tcmobile`. This APK is for the
   spike only; never give it to testers.
5. Open the app on the phone (**HUMAN** or `adb shell monkey -p
org.unfoldingword.tcmobile 1`), reach the phone check (five taps on the
   build stamp). The "Card spike 1472" block at its foot appears only on a
   native Android build. If it is missing, record that and stop.
6. Every tap appends one line to the log box. The box is in the WebView only, so
   it is lost on a force-stop. **Copy each line out as you go**:
   - Preferred: `adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof org.unfoldingword.tcmobile)`
     and read the page through desktop Chrome `chrome://inspect` (README §5a),
     **ASSUMPTION** that this works on the phone in use.
   - Fallback: the DRI reads each line aloud or photographs the screen, and you
     transcribe it (**HUMAN**).

## Capturing output

Start this before step P1 and leave it running in a second shell; stop it at the
end. The probe's native failures log with the plugin's class name.

```
mkdir -p /tmp/card-spike-1472
adb logcat -c
adb logcat -v threadtime > /tmp/card-spike-1472/logcat-all.txt &
# filtered view (re-run any time):
grep -E 'CardProbe|Capacitor|tcmobile|StorageManager|vold|AndroidRuntime|FATAL' /tmp/card-spike-1472/logcat-all.txt
```

`AndroidRuntime` or `FATAL EXCEPTION` lines are a crash; that matters for P5.
The logcat buffer is lost when the phone reboots or powers off, so restart the
capture after P1's reboot and P4's power-off. Keep every file under the scratch
directory `/tmp/card-spike-1472` (use your own unique name if another session
is running).

The card's app folder on the phone is
`/storage/<volume-uuid>/Android/data/org.unfoldingword.tcmobile/files`, the
path the `P1 volumes` line prints as `path`. To read it from the machine:
`adb shell ls -l <that path>` and `adb pull <that path>/<file> /tmp/card-spike-1472/`.
**ASSUMPTION:** `adb shell` may be refused access to `Android/data` on newer
Android versions. If so, use the probe's `P4 list card folder` button instead and
write the refusal in the notes.

## Safety and stop rules

- **Only the probe's own folder.** The probe writes only inside the app's
  folder on the card (`.../Android/data/org.unfoldingword.tcmobile/files`) and
  in the one folder the DRI picks for P8. Never write, move or delete anything
  else on the phone or the card. Never run `rm`, `sm format`, `sm partition`,
  `pm clear`, a factory reset, or any `adb shell` command that touches the
  user's photos, downloads or other apps.
- **P8's picked folder must be a new, empty folder** that the DRI creates on
  the card for this (**HUMAN**), named something plain like `tc-spike`. Do not
  pick the card root or a folder that already holds files.
- **Stop and ask the DRI** before: formatting or adopting a card, installing
  over an existing app, uninstalling anything, a factory reset, or if the phone
  shows a card error that asks to format ("corrupted", "unsupported").
- **Stop the whole run** if the phone shows a low-battery warning (charge it
  first), if the card becomes unreadable and the probe cannot list it, or if any
  step wants a Google account, payment or personal data.
- **P6 fills the card.** Always finish with `P6 remove filler`, and confirm the
  free space came back (`P1 volumes` `freeBytes`).
- **Pulling the card (P5, P9) is a physical act.** Ask the DRI to do it; do not
  try to emulate it with `sm unmount` unless the DRI agrees, and note it if you
  do (**ASSUMPTION:** an unmount is not the same event as a physical pull).
- **No names, no places.** Do not write any person's name or any place name,
  address or Wi-Fi name in the results, logs you paste, screenshots or
  comments. Refer to people by role only ("the DRI") and to phones by model and
  Android version. Redact a card's volume label and serial; keep the volume
  UUID only as a short form (first 4 characters plus `...`) in public text,
  while comparing the full value locally. Do not post the adb device serial.

## Steps

Mark each cell `pass`, `fail`, `cannot-tell` or `n/a`, with the log line or a
note. Every native failure must show a typed `code` (FULL, UNMOUNTED, IO,
NO_SESSION, NOT_FOUND, GRANT, CANCELLED), never a bare string. Only the button
labels below exist on the panel; anything marked **adb** is run by you on the
machine.

### P1 Find the card

1. Tap `P1 volumes` (HUMAN or via the inspected page). Expect an entry whose
   `path` is on the card, `removable` true, `state` mounted, and a `uuid`.
   Record `sdk`, `model`, `freeBytes`, `totalBytes`. Note the `uuid` in full in
   local notes.
2. **adb** `adb reboot`, then `adb wait-for-device`, wait for the home screen
   (**HUMAN** unlocks), reopen the app and phone check, tap `P1 volumes`. Same
   `uuid`? Restart the logcat capture.
3. **HUMAN** removes the card and reinserts it. Tap `P1 volumes` with the card
   out: is the entry absent or `path` null? Then with the card back: same `uuid`?
4. If the card was adopted as internal storage (prerequisite 6), `removable` must
   be false. Otherwise `n/a`.
5. Case folding (ADR 0013 inference, owed to P1): **adb**
   `adb shell sh -c 'cd <card app folder> && echo a > spike-case.txt && echo b > SPIKE-CASE.txt && ls -l'`.
   One file means the card folds case; two means it does not. Delete both
   afterwards. **ASSUMPTION:** the shell may lack write access there; if so mark
   `cannot-tell`.

### P2 Write speed

Tap `P2 write 2 min`, `P2 write 10 min`, `P2 write 20 min`, then
`P2 IndexedDB 20 min`. Each run prints `wallMs`, `syncRenameMs` and `heapPeakMb`
(null means the WebView hid heap numbers; then read the heap through
`chrome://inspect` Memory instead, **ASSUMPTION**). Repeat each three times.
Keep the phone awake and plugged in. Record the 20-minute `wallMs` for every run
and the IndexedDB `wallMs`. Threshold column stays blank for the DRI.

### P3 Read back

After a P2 write, tap `P3 read back last write`. `identical` must be true.
Record both `ms` values and the `fetch` `status`. If `fetch` fails or returns
another status, record it: ADR 0013 needs to know if the `fetch` route reaches
card files at all. **adb** cross-check: `adb pull` the written file and compute
its CRC32 on the machine (`python3 -c 'import sys,zlib;print(zlib.crc32(open(sys.argv[1],"rb").read()))' <file>`);
compare with `nativeCrc`. The ADR's known-answer value for ASCII `123456789`
is 0xCBF43926 (CRC-32/ISO-HDLC), a sanity check for the machine-side
calculation.

### P4 Kill during write

1. Tap `P4 write 20 min then leave open` (it opens `killed.bin.part` and writes
   a stub). Then **adb** `adb shell am force-stop org.unfoldingword.tcmobile`.
   Reopen, tap `P4 list card folder`. A `.part` file or nothing is a pass; a
   final-named `killed.bin` is a fail.
2. Repeat, with **HUMAN** powering the phone off (hold power) instead of
   force-stop. This is the "power off mid-write" case; reopen and list again.
3. Limitation to record, not hide: the button leaves a stub write open, not a
   live 20-minute write in flight. A kill in the middle of real chunk traffic is
   not exercised unless you tap `P5 write 20 min for pulling card` (which runs a
   real write) and force-stop during it; do that once and list the folder.
4. The ADR asks whether sync and read-back reach the card rather than a cache.
   This probe does not test that directly; mark that part `cannot-tell` unless
   you can show otherwise (for example a file present after power-off).

### P5 Card pulled mid-write (physical)

Tap `P5 write 20 min for pulling card`. **HUMAN** pulls the card within a few
seconds. Expect: the app does not crash (`AndroidRuntime` or `FATAL` in logcat
means it did), the log line shows a typed `code`, and the app's own recordings
list is unchanged. To check the last point, **before** P5 the DRI notes what
Books shows (names and counts only), and compares after. This probe never
touches IndexedDB, so a change would mean a crash or a bug elsewhere. Then
reinsert the card, tap `P1 volumes`, and list the folder for the leftover `.part`.

### P6 Card full

Tap `P6 fill card leaving 20 MB`; record `freeBefore` and `freeAfterFill` (the
free-space read). Tap `P6 write 2 min on full card`. A 2-minute write is about
10.6 MB, so with 20 MB left it is expected to **succeed**, which does not
exercise FULL (**ASSUMPTION**; check it). To force FULL, change the panel's
`cardFull(20)` to `cardFull(5)` (a one-line change in
`src/components/card-probe-panel.tsx` on the spike branch; the button label
still says 20 MB, so note the change), rebuild, reinstall over the debug build
(`adb install -r`), and repeat. Expect `code` FULL, and that `freeAfterFill`
(about 5 MB) was below the write's size, so the read before the write predicts
the failure. Record which leave size produced FULL. Always end with
`P6 remove filler`.

### P7 Uninstall

`android:hasFragileUserData="true"` is already in the manifest. Before
uninstalling, tap `P4 list card folder` to record what exists.

1. **adb** `adb uninstall org.unfoldingword.tcmobile`. Is the card folder gone?
   (`adb shell ls` on the path, or reinstall and tap `P4 list card folder`.)
2. Reinstall, write something (any P2 run), then uninstall **from the phone's
   Settings** and, when the phone offers it, choose "keep app data" (**HUMAN**).
   **ASSUMPTION:** that prompt appears only on Android 14 and later and only
   with `hasFragileUserData`. If no prompt appears, record that. Record exactly
   what is kept: the card folder, the app's IndexedDB, both, neither. Reinstall
   and check with `P4 list card folder` and by whether Books still shows data.
   `adb uninstall -k` (keep data) is a different mechanism; use it only as an
   extra row, labelled as such.

### P8 Backup folder (SAF)

1. **HUMAN** makes an empty folder `tc-spike` on the card with the phone's
   Files app. Tap `P8 pick folder`; the DRI picks it. Record the result and
   whether the card root could be picked at all (on Android 11 and later the
   system refuses the root; record what the picker showed and what the DRI had
   to do instead).
2. Tap `P8 write 50 MB`, then `P8 overwrite with 1 MB`: `sizeAfter` must be
   1000000 (no tail). **adb** `adb pull` is not available for a SAF folder on all
   versions; the `sizeAfter` figure is the evidence.
3. Tap `P8 grants` (expect `resolves` true) after each of: app force-stop and
   relaunch; reboot; card out and in (**HUMAN**); and with a **different**
   card (expect `resolves` false). **Note:** `pickTree` is per tap and the panel
   keeps the picked URI only in memory, so after a restart `P8 write 50 MB`
   needs a fresh pick; `P8 grants` alone shows the persisted grant.

### P9 Card events

Tap nothing, then: **HUMAN** removes and reinserts the card with the app in the
foreground; again with the app in the background (home button); then foreground
the app and tap `P9 events`. Record each event (`volumeCallback` on Android 11 and
later, `broadcast ...` below) and the `state` from `P1 volumes` on resume.
Note that the plugin's event list is in memory only, so restart the app between
cases and tap `P9 events` after each.

### P10 Browser picker (optional, R5 input)

**HUMAN** in Chrome 132 or later on the phone: open a page that calls
`showDirectoryPicker()` (any simple test page the DRI trusts; do not put one on
a public host with real data), pick a card folder, write a file, reload, see if
the grant persists. **ASSUMPTION:** Chrome on Android may not offer the picker at
all. Mark `n/a` with the reason if so.

### P11 `@capacitor/filesystem` with a full card path

Tap `P11 filesystem plugin full path`. Record whether it writes, prompts for a
permission, or fails, with the message. **adb** confirm the file exists in the
card folder.

## Results per phone

Fill one table per phone. Header row: model, Android version (release and sdk),
card (type, size, filesystem), build SHA.

| P   | Question answered (ADR 0013)                | pass / fail / cannot-tell | Evidence (log line, file, value) | Notes |
| --- | ------------------------------------------- | ------------------------- | -------------------------------- | ----- |
| P1  | card found, removable, mounted              |                           |                                  |       |
| P1  | uuid stable across reboot                   |                           |                                  |       |
| P1  | uuid stable across remove and reinsert      |                           |                                  |       |
| P1  | entry absent with no card                   |                           |                                  |       |
| P1  | adopted card not removable                  |                           |                                  |       |
| P1  | case folding on the card                    |                           |                                  |       |
| P2  | 2 min write (wallMs, syncRenameMs, heap)    |                           |                                  |       |
| P2  | 10 min write                                |                           |                                  |       |
| P2  | 20 min write (threshold column: DRI)        |                           |                                  |       |
| P2  | IndexedDB 20 min baseline                   |                           |                                  |       |
| P3  | base64 read identical and ms                |                           |                                  |       |
| P3  | fetch(convertFileSrc) read identical and ms |                           |                                  |       |
| P4  | force-stop: .part or nothing                |                           |                                  |       |
| P4  | power-off: .part or nothing                 |                           |                                  |       |
| P4  | sync and read-back reach the card           |                           |                                  |       |
| P5  | no crash on pull                            |                           |                                  |       |
| P5  | typed error code                            |                           |                                  |       |
| P5  | Books unchanged                             |                           |                                  |       |
| P6  | typed FULL code                             |                           |                                  |       |
| P6  | free-space read predicts it                 |                           |                                  |       |
| P7  | card folder deleted on uninstall            |                           |                                  |       |
| P7  | what keep-app-data keeps (card, IndexedDB)  |                           |                                  |       |
| P8  | grant persists across restart               |                           |                                  |       |
| P8  | grant persists across reboot                |                           |                                  |       |
| P8  | grant persists across card out and in       |                           |                                  |       |
| P8  | grant gone with a different card            |                           |                                  |       |
| P8  | rwt overwrite leaves no tail (sizeAfter)    |                           |                                  |       |
| P8  | card root pickable on 11+; what instead     |                           |                                  |       |
| P9  | events seen, foreground                     |                           |                                  |       |
| P9  | events seen, background; state on resume    |                           |                                  |       |
| P10 | showDirectoryPicker picks, writes, persists |                           |                                  |       |
| P11 | @capacitor/filesystem full card path        |                           |                                  |       |

## Cleanup

Do all of this, then record that you did:

1. `P6 remove filler` (if P6 ran); confirm `freeBytes` returned.
2. Delete the probe's files: tap `P4 list card folder`, then
   `adb shell rm` only the probe's own names inside the app's card folder
   (`speed-*.bin`, `killed.bin*`, `filler.bin`, `fs-probe.txt`, `spike-case.txt`,
   `SPIKE-CASE.txt`). Or simply uninstall the spike APK (the app folder goes with
   it, see P7).
3. Ask the DRI to delete the `tc-spike` folder on the card and revoke its grant
   (**HUMAN**), or uninstall the app.
4. `adb uninstall org.unfoldingword.tcmobile` unless the DRI wants it kept.
   Restore any ordinary app build only by the DRI's choice; do not uninstall an
   app holding real recordings.
5. Stop the logcat capture. Do not commit logs; they may contain device names.
   Quote only the lines the findings need, after redaction.

## Recording the result

1. **Findings comment on #1472**, dated `YYYY-MM-DD` (the user's date, not the
   container clock). Include: one results table per phone with the phone model,
   Android version and build SHA on its header; for P2 the figures per run;
   whether the Java compiled unchanged; which rows are `cannot-tell` and why;
   and which **ASSUMPTION** lines turned out wrong. Per #1472 acceptance criterion
   4, if O2 fails, name the failed property and whether O1 is the fallback (a
   question for the requirements owner). Mention that #1826 is changing ADR
   0013 so the ADR author can reconcile.
2. **Progress-tracker line via a docs PR.** Add one dated entry at the top of
   `docs/progress_tracker.md` (newest first, one entry per session; the file is
   append-only, never edit an older entry), stating what was run, on which phone
   model and Android version, the build SHA, and a link to the #1472 comment.
   Open it as a docs PR from `develop` (not from `spike/card-store`, which is
   never merged), with the Sprint 6 milestone, and `release-notes: N/A`, spike
   output only. Tracker and PR body follow `AGENTS.md` and
   `.github/pull_request_template.md`; run `npm run check:pr-body` first.
3. **No names, no places** in either: roles only, phone model and Android
   version, redacted UUIDs and labels.
4. Do not mark PR #1532 ready and do not merge it.

## Reading the result

- O2 in the app's own folder passes when P1, P4, P5 and P6 pass on (a) and (b)
  and the 20-minute save meets the threshold the DRI sets (open).
- Backup on the picked folder passes when P8 passes on (a).
- If O2 fails, name the failed property and whether O1 (mirror on Finished) is
  the fallback. That fallback is a question for the requirements owner, since
  it does not meet "record straight onto the card".
