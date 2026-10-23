# microSD spike run sheet (#1472, E7)

THROWAWAY. This sheet and the probe it drives live on `spike/card-store` and
are never merged into `develop`. The output of the spike is a findings comment
on #1472; the run itself is recorded in `docs/progress_tracker.md`, not here and
not in a docblock (AGENTS.md).

Nothing below has been run on a device. Every cell starts empty and is filled
by whoever holds the phone.

## Open question (the DRI sets it)

The proposed threshold is: **a 20-minute take saves in 20 s or less on the
card.** It is not decided. The sheet records the measured figure only; do not
mark P2 pass or fail against 20 s, leave that column blank until the DRI sets
the number.

## Build and install

1. Check out `spike/card-store`; note `git rev-parse --short HEAD` as the build SHA.
2. Diagnostic build, so the WebView exposes heap numbers and can be inspected:
   `TC_ANDROID_DIAGNOSTIC=true` for both `npx cap sync android` and the Gradle
   command (`docs/native/README.md` §5a). Install the APK. Do not give it to testers.
3. Open the app, reach the phone check (five taps on the build stamp). The
   "Card spike 1472" block at its foot appears only on a native Android build.
4. Every tap appends one line to the log box. Copy the log into the table below.

## Phones and cards

| Slot | Phone model | Android | Slot? | Card (type, size, FS) | Build SHA |
| ---- | ----------- | ------- | ----- | --------------------- | --------- |
| (a)  |             | 11+     | yes   |                       |           |
| (b)  |             | 7 to 10 | yes   |                       |           |
| (c)  |             |         | no    | n/a                   |           |

Cards: one small FAT32 and one 64 GB or larger exFAT. Run (a) and (b) with both.
Phone (c) has no card: P1 only, expecting no removable volume.

## Steps

Mark each cell `pass`, `fail` or `n/a`, with the log line or a note. Every
native failure must show a typed `code` (FULL, UNMOUNTED, IO, ...), never a bare string.

| P   | What to do                                                                                                                                                                                                                                                     | Record                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P1  | Tap "P1 volumes". Card entry present, `removable` true, `state` mounted, `uuid` noted. Reboot, tap again: same uuid. Remove and reinsert: same uuid. Remove card: entry absent. If a card is adopted as internal storage, `removable` must be false.           | uuid before and after reboot and reinsert; entry with no card; adopted result   |
| P2  | Tap "P2 write 2 min", "10 min", "20 min", then "P2 IndexedDB 20 min". Record `wallMs`, `syncRenameMs` and `heapPeakMb` (null means the WebView hid heap numbers). Repeat each three times.                                                                     | wallMs for 20 min per run; IndexedDB wallMs; threshold column blank for the DRI |
| P3  | After a write, tap "P3 read back last write". `identical` must be true; record both `ms` values.                                                                                                                                                               | base64 ms, fetch ms, identical                                                  |
| P4  | Tap "P4 write 20 min then leave open", force-stop the app from Settings, relaunch, tap "P4 list card folder". Repeat and power the phone off instead of force-stop. A `.part` file or nothing is a pass; a final-named `killed.bin` is a fail.                 | files listed after each kind of kill                                            |
| P5  | Tap "P5 write 20 min for pulling card" and pull the card mid-write (physical). The app must not crash, the log line must show a typed `code`, and Books must show the same data as before.                                                                     | code seen, crash yes or no, Books unchanged yes or no                           |
| P6  | Tap "P6 fill card leaving 20 MB", then "P6 write 2 min on full card". Expect `code` FULL and a free-space figure (`freeAfterFill`) that predicted it. Tap "P6 remove filler" afterwards.                                                                       | code, freeAfterFill, whether it predicted the failure                           |
| P7  | `android:hasFragileUserData="true"` is already set in the manifest. Uninstall: is the card folder gone? Repeat choosing "keep app data": record exactly what is kept, then reinstall and tap "P4 list card folder".                                            | folder after uninstall; what keep-data kept                                     |
| P8  | Tap "P8 pick folder", pick a folder on the card, then "P8 write 50 MB", then "P8 overwrite with 1 MB": `sizeAfter` must be 1000000 (no tail). Tap "P8 grants" after app restart, reboot, card out and in, and with a different card (expect `resolves` false). | each `grants` result; sizeAfter; on 11+, can the card root be picked, what next |
| P9  | Remove and insert the card in the foreground, then in the background, then tap "P9 events" after resuming.                                                                                                                                                     | events seen per case; state on resume                                           |
| P10 | Optional (R5 input). In Chrome 132 or later on Android: does `showDirectoryPicker()` pick a card folder, write a file, and keep the grant across a reload?                                                                                                     | yes or no per step                                                              |
| P11 | Tap "P11 filesystem plugin full path". Does `@capacitor/filesystem` write the card path, prompt for permission, or fail?                                                                                                                                       | outcome and message                                                             |

## Results per phone

One row per phone and step, pass or fail, with model, Android version and
build SHA. Post this table as the findings comment on #1472, then record the
run in `docs/progress_tracker.md`.

| P   | (a) pass or fail | (b) pass or fail | (c) pass or fail | Notes |
| --- | ---------------- | ---------------- | ---------------- | ----- |
| P1  |                  |                  |                  |       |
| P2  |                  |                  | n/a              |       |
| P3  |                  |                  | n/a              |       |
| P4  |                  |                  | n/a              |       |
| P5  |                  |                  | n/a              |       |
| P6  |                  |                  | n/a              |       |
| P7  |                  |                  | n/a              |       |
| P8  |                  |                  | n/a              |       |
| P9  |                  |                  | n/a              |       |
| P10 |                  |                  | n/a              |       |
| P11 |                  |                  | n/a              |       |

## Reading the result

- O2 in the app's own folder passes when P1, P4, P5 and P6 pass on (a) and (b)
  and the 20-minute save meets the threshold the DRI sets (open).
- Backup on the picked folder passes when P8 passes on (a).
- If O2 fails, name the failed property and whether O1 (mirror on Finished) is
  the fallback. That fallback is a question for the requirements owner, since
  it does not meet "record straight onto the card".
