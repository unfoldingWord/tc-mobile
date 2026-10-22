# Expo proof — run sheet (#1520)

**Throwaway. Never merged.** This app exists so the DRI can run three checks
on real phones and read the results against
[ADR 0016](../../docs/decisions/0016-capacitor-or-expo.md) and the research
note `docs/research/capacitor-or-expo.md` (both on PR #1605's branch until it
merges).

**Nothing here has run on a phone.** What ran in the container is under
"Built in the container" at the end.

## Safety first — read before installing anything

- **Use a test phone, never a field phone.** The probe reads the old app's
  storage read-only. But installing this app **replaces** tC Mobile on the
  phone, because it carries the same bundle id and package
  (`org.unfoldingword.tcmobile`).
- **Never uninstall** tC Mobile or this app to "clean up". On both platforms,
  uninstalling deletes the app's data, and with it every recording.
- **Getting back:** install a newer tC Mobile build over this one, the same way
  you installed this one. On Android the new build's version code must be
  higher than this app's. Android refuses a downgrade (`docs/native/README.md`,
  "versionCode"). [observed, repo doc]
- What the old IndexedDB does when tC Mobile is reinstalled over this app:
  [inference] it should still be there, because this app never writes to it,
  and an update keeps the app's data directory. Check that a recording is
  still there after you go back.

## What you need

- A Mac with Xcode, for iOS; Android Studio or the Android SDK, for Android.
  Node `^22.22.2 || ^24.15.0 || >=26`.
- `cd spikes/expo-proof && npm ci`
- **Expo Go is only good for check 1** (audio). Expo Go is its own app with
  its own sandbox. It cannot see tC Mobile's storage, and it ignores this
  app's bundle id. Checks 2 and 3 need a **development build** of this app
  (`npx expo run:ios --device`, `npx expo run:android`).
  [inference from app sandboxing and the Expo development-build docs]

## Check 1 — Record, then Play with the silent switch on (iPhone)

Expo Go is fine here: `npx expo start`, then scan the QR code.

1. Turn the ring/silent switch to **silent**. Turn the volume up.
2. Tap **Record**, speak for 5 seconds, then tap **Stop**. Allow the
   microphone if asked.
3. Tap **Play (playsInSilentMode: true)**. Note whether you hear it.
4. Tap **Control: Play (playsInSilentMode: false)**. Note whether you hear it.
5. Read the **Audio mode set** box. It should show the mode for the last Play.
6. Repeat 2–4 once with the switch on ring.

| Result                                            | What it means for ADR 0016                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Step 3 audible, step 4 silent                     | Expected. Expo owns the session with one setting. Compare it with the Capacitor build's #1518 result on the same phone.          |
| Step 3 audible, step 4 audible                    | `false` did not take effect, or the session stayed in a record category. Still fine for Expo; note it.                          |
| Step 3 silent                                     | Unexpected. Expo does not give a free fix on this phone. Weakens trigger 3 and the audio-session argument for a move.            |

Then run the **current tC Mobile build** on the same phone, with the switch on
silent: record, then Play (the #1518 check). If tC Mobile is silent where step
3 was audible **after both #1518 fixes**, that is ADR 0016 trigger 3, for the
requirements owner to rule on.

Android: run the same steps. Android has no hardware silent switch on most
phones; use the ringer set to **Vibrate** or **Silent**. The `expo-audio`
types say `playsInSilentMode: false` suppresses playback "when the ringer
mode is silent or vibrate" on Android. [observed, `Audio.types.d.ts`]

## Check 2 — The data-continuity probe (both platforms)

The phone must already have **tC Mobile with recordings**, installed in a way
this build can update. You need the **same bundle id and the same signing
key** (research note §4.2).

### Android

Pick **one** route.

- **Route A (recommended, a test phone):**
  1. Build and install tC Mobile from develop as a **debug** APK
     (`docs/native/README.md` §0). It is signed with your
     `~/.android/debug.keystore`.
  2. Make one book with **two** segments. Record both. Mark one Finished, so
     it is transcoded to MP3.
  3. Here, run `npx expo prebuild --platform android`. Then **replace**
     `android/app/debug.keystore` with a copy of `~/.android/debug.keystore`.
     Expo's template ships its own debug key, which would not match.
  4. Run `npx expo run:android`. If it refuses with
     `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the keys differ. Stop; do not
     uninstall.
- **Route B (a phone with a CI-built APK):** sign this app with the **release
  keystore** (`docs/native/README.md` §5). Set `versionCode` to
  `$(date +%s)` in `android/app/build.gradle` after prebuild, so it is above
  the installed CI build. Then install the release APK with `adb install -r`.
  This mirrors a real migration most closely.

### iOS

1. The same Apple team that signs tC Mobile must sign this build, under
   `org.unfoldingword.tcmobile`.
2. Run `npx expo prebuild --platform ios` and open `ios/*.xcworkspace`. Set
   the team. Then `npx expo run:ios --device`.
3. [assumption] A development-signed build installed over a TestFlight build
   with the same bundle id keeps the app's data container. If you would
   rather not rely on that, first install tC Mobile itself from Xcode
   (`npx cap run ios`), record into it, then install this build.

### Run it

1. Open the app. Under **2. Data-continuity probe**, tap the first origin:
   `https://localhost` on Android, `capacitor://localhost` on iOS.
2. Write down every line it shows. Take a screenshot.
3. If it says "tc-mobile not found", tap the other origin and write that
   down too.
4. If it exported a clip, tap **Play the exported recording**.

Before you install this app, write down the counts the old app shows: the
number of books, and the segments with audio. You need them to compare.

| Result                                                                                                       | What it means                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page origin` equals the old origin, `tc-mobile v12` listed, the counts match, `MATCH`, and the clip plays   | The hard rule (ADR 0016 §4) passes on this platform. A move's migration is a matter of engineering, not feasibility.                                                                                 |
| Android passes; iOS `page origin: null`, or a different origin, or `tc-mobile not found`                       | Expected possibility (note §4.3). `loadHTMLString` with an unhandled scheme does not reach the old origin. A move needs a small Swift module that registers a `capacitor` scheme handler. A move costs more; this does not block it. |
| Counts are 0, or the stores are missing, at the right origin                                                  | The data is not where the note says. Stop. Recheck the origin, and whether the build replaced tC Mobile or installed beside it (check the app list for two icons).                                     |
| `MISMATCH`, or the clip does not play                                                                         | The bridge or the chunking is wrong. Fix the proof before drawing any conclusion.                                                                                                                    |
| The install was refused (signature)                                                                           | Route problem, not a finding. Do not uninstall.                                                                                                                                                      |

Then put tC Mobile back (see Safety first). Check that the recordings are
still there and play.

## Check 3 — Identity

Section **3. Identity** shows the bundle id and package this build carries.
Both should read `org.unfoldingword.tcmobile`. After installing, check the
phone's app list. There should be **one** tC Mobile, not two; two would mean
the install did not replace the old app.

**Signing caveat.** The same id is not enough. Android accepts the update only
when the signing certificates match ([Android app
signing](https://developer.android.com/studio/publish/app-signing)). A real
move would ship through the same Play app-signing key and the same App Store
Connect record. EAS can use the existing keystore and certificates through
`credentials.json`
([Expo](https://docs.expo.dev/app-signing/existing-credentials/)). This proof
does not touch any store or any release secret, unless you choose Route B by
hand.

## Where to post results

Post a comment on #1520. Give the phone model, OS version, the route, every
probe line, and checks 1 and 3. Name the tester by role only.

## Built in the container (2026-10-22)

These ran in the container. None ran on a phone.

- `npx create-expo-app@latest expo-proof --template blank-typescript`:
  Expo SDK 58 (`expo` ~58.0.17, `react-native` 0.88.0). Then
  `npx expo install expo-audio react-native-webview expo-file-system expo-constants expo-asset`.
- `npx tsc --noEmit`: exit 0 (checks `App.tsx`, `index.ts`,
  `src/probe-page.ts`).
- `npx expo-doctor`: "20/20 checks passed. No issues detected!"
- `npx expo export --platform android --platform ios`: exit 0. It wrote one
  Hermes bundle per platform (≈1.7 MB each).
- `npx expo prebuild --no-install`, in a scratch copy that was not
  committed: exit 0. It generated `applicationId 'org.unfoldingword.tcmobile'`
  and the iOS bundle id, and wrote `NSMicrophoneUsageDescription`. No native
  compile ran; there is no Xcode, and no Android SDK, in the container.
