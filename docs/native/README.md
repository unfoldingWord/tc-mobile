# Native packaging (Capacitor) — build & ship runbook

**Issue:** [#262](https://github.com/unfoldingWord/tc-mobile/issues/262) —
installable iOS (TestFlight) + Android (APK) for the Nairobi training.
**Decision basis:** `docs/research/native-packaging.md` (recommendation) and
its counter-case (#86). **Status:** shell only, no product changes.

Capacitor wraps the **existing PWA** in a native WebView. The same web build
(`npm run build` → `dist/`) that Cloudflare serves is copied into a native iOS
and Android project. There is no second codebase and no product change here —
just the native shell and the pipeline to produce installable builds.

> **What was NOT done in this repo, and why.** This integration was scaffolded
> in a Linux CI container with **no Xcode and no Android Studio**. The native
> _projects_ were generated and the web bundle synced into them (`cap add`,
> `cap sync` both run without native SDKs), but **no `.ipa`, `.aab`, or `.apk`
> was built, signed, or run on any device or simulator.** Every step in
> [§4](#4-ios--testflight) and [§5](#5-android--apk-sideload) requires a Mac
> with the native toolchains and is Seth's to run. Nothing below has been
> verified on a device.

---

## 0. Minimal Monday path

**Goal (Monday, 2026-09-14):** get _a_ build installed on a real phone that
**opens, prompts for the microphone, and records a passage in the foreground.**
That is the whole bar. **Background / lock-screen capture is a known limitation
and a separate spike ([§8](#8-the-one-real-risk-do-not-skip)) — it is _not_ a
Monday blocker.** Do not spend Monday's Mac time on native plugins, app icons,
or version-sync ([§6](#6-versioning)); none of them affect install-open-record.

The two platforms have very different fastest routes:

- **Android — recommended Monday-fast route, no external gatekeeper.**
  `./gradlew assembleDebug` produces an **auto-signed _debug_ APK** that
  installs and runs on a device **today, with zero keystore and no Google
  account**. Android's debug build type is signed with the local debug keystore
  the toolchain generates for you, so there is nothing to set up first.

  ```bash
  npm run build && npx cap sync android
  cd android && ./gradlew assembleDebug
  # → android/app/build/outputs/apk/debug/app-debug.apk
  ```

  Send that APK to a tester and follow the sideload steps in
  [§5](#5-android--apk-sideload) step 4 (enable _Install unknown apps_, open the
  file). The signed-**release** path (a keystore + `signingConfigs`, §5 steps
  1–3) is the durable distribution route and can follow later — it is **not**
  needed to hit Monday's bar.

- **iOS — gated on the Apple Developer account (the long pole).** There is no
  debug-APK equivalent: every install onto an iPhone requires a signing identity
  tied to an **Apple Developer Program** membership and the unfoldingWord Apple
  **Team**. **Before Monday, verify the Team exists and enrollment is active**
  (see [§0.1](#01-humanpaid-gates) and [§4](#4-ios--testflight)). If it is not,
  that is the item to resolve first — the Xcode steps cannot start without it. A
  local build to a **cabled personal device** is possible with a free Apple ID
  but is not the TestFlight path testers use; TestFlight still needs the paid
  membership.

If only one platform is ready on Monday, ship that one. Android via the debug
APK is the route with no human/paid dependency, so it is the safest to count on.

### 0.1 Human / paid gates

Some steps depend on people, money, or approvals outside this repo. Start these
early — a membership or an access grant can take **more than a day**.

| Gate                                   | Platform | Cost   | Lead time                      | Needed for                                              |
| -------------------------------------- | -------- | ------ | ------------------------------ | ------------------------------------------------------- |
| **Apple Developer Program** membership | iOS      | Paid   | Enrollment can take **a day+** | Any signed iOS install; TestFlight                      |
| **unfoldingWord Apple Team**           | iOS      | —      | Access grant                   | Signing under the org identity                          |
| **App Store Connect** access           | iOS      | —      | Access grant                   | Adding the build + testers (Caleb, Javi, Tim)           |
| Android signing                        | Android  | **$0** | **None**                       | Nothing external — debug APK, or a self-signed keystore |

**Android has no external gatekeeper.** You either use the auto-signed debug APK
above, or generate your own release keystore locally (§5 step 1) — no account,
no payment, no approval. **iOS cannot start until the Apple items above are in
place**, so confirm them before Monday rather than discovering the gap that
morning.

---

## 1. What is in the repo

| Path                            | What it is                               | Committed?      |
| ------------------------------- | ---------------------------------------- | --------------- |
| `capacitor.config.ts`           | appId, appName, `webDir: "dist"`         | yes             |
| `android/`                      | Gradle/Android Studio project            | yes (see below) |
| `ios/`                          | Xcode project (Swift Package Manager)    | yes (see below) |
| `@capacitor/{core,ios,android}` | runtime + platform deps (`dependencies`) | package.json    |
| `@capacitor/cli`                | the `cap` CLI (`devDependencies`)        | package.json    |

**Capacitor version:** 8.5.1 (pinned exact). **appId:** `org.unfoldingword.tcmobile`.
**appName / home-screen label:** `tC Mobile` (matches the PWA `short_name`).

The native projects **are committed** — the mainstream Capacitor practice —
so that signing config, `Info.plist`, entitlements, icons, and any native
customization are version-controlled and Seth can open them on his Mac without
re-scaffolding. Capacitor's own per-folder `.gitignore` files keep the noise
out: the **copied web bundle** (`android/app/src/main/assets/public`,
`ios/App/App/public`), the generated `capacitor.config.json`, build output,
`DerivedData`, `Pods`, keystores, and `local.properties` are all ignored. The
root `.prettierignore` and ESLint `ignores` exclude `android/` and `ios/` so
the JS toolchain never formats or lints generated native files. **No root
`.gitignore` change was needed** — the per-folder ignores cover it.

Generated project facts (evidence, from the scaffolded projects):

- **Android:** `minSdk 24`, `compile/targetSdk 36`, Gradle `8.14.3`,
  `applicationId org.unfoldingword.tcmobile`, `versionCode 1`, `versionName "1.0"`.
- **iOS:** deployment target `15.0`, bundle id `org.unfoldingword.tcmobile`,
  `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1`, display name `tC Mobile`.

---

## 2. The core loop

Any time the web app changes, the native shell needs the new bundle:

```bash
npm run build          # emit dist/
npx cap sync           # copy dist/ into ios/ and android/, refresh native deps
# then open/build the native project (Mac only) — §4 / §5
```

`cap sync` = `cap copy` (web assets + config) + `cap update` (native deps).
Both `cap add` and `cap sync` run **without** Xcode/Android Studio (verified in
this container). Everything past sync — `cap open`, archive, gradle assemble,
signing, upload — needs the native toolchains on a Mac.

Convenience scripts are in `package.json` (added for the Monday prep, #262):

- `npm run cap:sync` → `npm run build && npx cap sync` (rebuild the web bundle
  and copy it into both native projects — the core loop above in one command).
- `npm run cap:ios` → `npx cap open ios`.
- `npm run cap:android` → `npx cap open android`.

They are thin wrappers over the `cap` CLI, which is already a dev dependency;
the underlying `npx cap …` commands still work directly.

---

## 3. One-time Mac prerequisites

Install exact required versions from Capacitor's **Environment Setup** doc
(<https://capacitorjs.com/docs/getting-started/environment-setup>); the set for
Capacitor 8:

- **Xcode** (current) + Command Line Tools, an Apple **Developer Program**
  account (enrollment already done — see the research doc). iOS uses **Swift
  Package Manager**, so **CocoaPods is not required**.
- **Android Studio** (current) with **Android SDK Platform 36** and a JDK
  compatible with Gradle 8.14.3 (**JDK 21** recommended).
- `git clone` the repo, then `npm ci` at the repo root.

```bash
git clone https://github.com/unfoldingWord/tc-mobile.git
cd tc-mobile
npm ci
npm run build
npx cap sync
```

---

## 4. iOS → TestFlight

TestFlight only; **App Store submission is out of scope** (#262).

1. `npx cap open ios` (opens `ios/App` in Xcode).
2. **Signing:** select the `App` target → _Signing & Capabilities_ → check
   _Automatically manage signing_ → pick the unfoldingWord **Team**. Confirm the
   bundle id is `org.unfoldingword.tcmobile` (register it in the Apple Developer
   portal / App Store Connect the first time).
3. **Version/build:** set _Marketing Version_ and set _Build_ (`CURRENT_PROJECT_VERSION`)
   **higher than the last build already on TestFlight** — App Store Connect rejects
   a build number that is not greater. The committed value is `1`, but the CI lane
   (§4a) uploads large unix-timestamp builds, so read the last `CFBundleVersion`
   from App Store Connect and exceed it rather than incrementing the committed `1`.
   See [§6](#6-versioning) for how these relate to `package.json`.
4. **Microphone permission:** the app records audio and iOS terminates the
   first `getUserMedia` request in WKWebView if no usage-description string is
   present. `NSMicrophoneUsageDescription` now **ships in the committed shell**
   (`ios/App/App/Info.plist`: _"tC Mobile uses the microphone to record spoken
   translations."_) — no Mac step is needed to add it. Adjust the copy here if
   the wording changes, but do not remove the key: the recording path is the
   product's whole point (#262 / #86 C1–C2, PR #265).
5. Select **Any iOS Device (arm64)** → _Product → Archive_.
6. In the Organizer: **Distribute App → TestFlight (Internal/External)** →
   upload to App Store Connect.
7. In **App Store Connect → TestFlight**, add the build to a tester group
   (Caleb, Javi, Tim). External testers need a one-time Beta App Review.
8. **Testers install** via the **TestFlight** app using the invite link/email.

---

## 4a. iOS → TestFlight via CI (automated, no Mac step)

[`.github/workflows/ios-testflight.yml`](../../.github/workflows/ios-testflight.yml)
builds the iOS app on a macOS runner and uploads it to TestFlight with Fastlane
([`fastlane/Fastfile`](../../fastlane/Fastfile), lane `ios beta`), signing via an
App Store Connect **API key** — no `match`, no committed certificate, no second
repo. It is **manual-trigger only** (`workflow_dispatch`): run it from **Actions →
iOS TestFlight → Run workflow**, choosing the branch to build. It never runs on
push/PR, so it does not collide with the Cloudflare PWA deploy ([§7](#7-coexistence-with-the-cloudflare-pwa-deploy))
and adds no required check to normal PRs.

**What a run does:** `npm ci` → `npm run build` → `npx cap sync ios` → archive the
`App` scheme (Release) → upload to TestFlight, where **internal testers receive it
automatically once App Store Connect finishes processing** (a few minutes,
server-side). The lane does not wait for that (billed runner time) and does not
distribute to **external** testers — that needs a Beta App Review and is a separate
step. An internal tester group must exist in App Store Connect.

The build number (`CFBundleVersion`) is the run's **unix timestamp** — unique and
strictly increasing with no round-trip to App Store Connect. (Reading the latest
build and adding one would race the no-wait upload: a rerun fired before Apple
indexes the previous build reads a stale latest and uploads a duplicate.) The
user-facing **marketing version** stays `MARKETING_VERSION` from the project —
**`1.0`** today, the native-shell version, deliberately independent of the PWA's
`package.json` version ([§6](#6-versioning)); TestFlight therefore shows `1.0`, not
the web `0.x`. Bump it in `ios/App/App.xcodeproj/project.pbxproj` for a user-facing
change.

### One-time setup (human, outside this repo)

1. **App Store Connect API key.** App Store Connect → _Users and Access →
   Integrations → App Store Connect API_ → generate a key with the **App Manager**
   role — required so the archive may create the distribution certificate and
   provisioning profile via `-allowProvisioningUpdates`. Download the `.p8`
   **once** (it cannot be re-downloaded); note the **Key ID** and **Issuer ID**.
2. **The app record must already exist.** App Store Connect → _Apps → **+** → New
   App_, bundle id `org.unfoldingword.tcmobile`. `upload_to_testflight` uploads to
   an existing app; it does **not** create one. (A first manual Xcode upload,
   [§4](#4-ios--testflight), also creates it — see the recommendation below.)
3. **GitHub repository secrets** (_Settings → Secrets and variables → Actions_):

   | Secret              | Value                                                                      |
   | ------------------- | -------------------------------------------------------------------------- |
   | `ASC_KEY_ID`        | the API **Key ID**                                                         |
   | `ASC_ISSUER_ID`     | the API **Issuer ID**                                                      |
   | `ASC_KEY_P8_BASE64` | the `.p8` contents, base64-encoded (`base64 -i AuthKey_XXXX.p8 \| pbcopy`) |
   | `APPLE_TEAM_ID`     | the unfoldingWord Apple **Team ID** (Developer portal → _Membership_)      |

   The `.p8` is decoded into `fastlane/AuthKey.p8` at build time (gitignored) and
   removed after the run. **Never commit it.**

### Committed to make CI buildable (evidence)

- `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` — a **shared**
  scheme. Xcode keeps the `App` scheme in gitignored `xcuserdata` by default, so a
  fresh CI checkout had **no** scheme for `xcodebuild` to build. This commits one.
- `ITSAppUsesNonExemptEncryption = false` in `Info.plist` — the app uses only
  standard HTTPS, so it is export-exempt; this skips the per-build _Missing
  Compliance_ prompt in App Store Connect.
- `Gemfile` + `Gemfile.lock` (locked to the macOS runner's platforms) and
  `fastlane/{Appfile,Fastfile}`. The workflow installs with `--frozen`, so a run
  fails rather than silently re-resolving. No CocoaPods (SPM — [§3](#3-one-time-mac-prerequisites)).

### Prove the chain once by hand first (recommended)

None of this could be run where it was authored (Linux, no Xcode), so do **one**
manual archive+upload ([§4](#4-ios--testflight)) to confirm the account, Team,
bundle id and app record are wired before relying on CI. After that, the workflow
is the repeatable path. **The first green CI run is the first real verification.**

---

## 5. Android → APK sideload

Sideload only; **Play Store submission is out of scope** (#262).

**Microphone permission:** the app records audio, so the manifest declares
`RECORD_AUDIO`. This now **ships in the committed shell**
(`android/app/src/main/AndroidManifest.xml`, alongside `INTERNET`) — the system
WebView cannot grant `getUserMedia({audio:true})` a permission the manifest
never declares. Android 6+ also shows a **runtime** prompt on first record;
confirm the prompt appears and audio captures on-device (part of the
audio-revalidation spike, §8). Do not remove the permission (#262 / #86 C1–C2,
PR #265).

**Backups are off:** the manifest sets `android:allowBackup="false"`
(`AndroidManifest.xml`). Recordings and project metadata live in
WebView/IndexedDB and are the system of record; Android auto-backup would make
them eligible to leave the device (cloud backup / device transfer). Recordings
stay on-device only — do not re-enable backup without a backup-rule exclusion
for the audio store (PR #265).

1. **Create a signing keystore once** (keep it and its passwords safe — losing
   it means a new app identity):
   ```bash
   keytool -genkey -v -keystore tc-mobile-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias tc-mobile
   ```
   Store it **outside** the repo and record the passwords in the team secret
   store. As a backstop, `android/.gitignore` ignores `*.jks`/`*.keystore` so a
   keystore accidentally dropped inside `android/` is not committed.
2. Wire release signing in `android/app/build.gradle` (`signingConfigs` +
   `buildTypes.release`), reading passwords from
   `~/.gradle/gradle.properties` or env vars — **never commit them**.
3. Build a signed APK:
   ```bash
   npx cap sync android
   cd android && ./gradlew assembleRelease
   # → android/app/build/outputs/apk/release/app-release.apk
   ```
   (`npx cap open android` opens Android Studio if you prefer _Build → Generate
   Signed Bundle / APK_. Use **APK**, not AAB, for sideload.)
4. **Testers install:** enable _Install unknown apps_ for the browser/file
   app on the device, then open the APK to install. Distribute the file via a
   link the testers can reach (e.g. a shared drive).

---

## 6. Versioning

`package.json` `version` is the **web/PWA** build number and moves only in the
`chore(release)` promotion PR (AGENTS.md → _Versions and milestones_). The
native builds carry their **own** version fields:

- **iOS:** `MARKETING_VERSION` (user-facing) + `CURRENT_PROJECT_VERSION`
  (build, must increase every upload — and the CI lane uploads unix-timestamp
  builds, so a later manual build must exceed the last `CFBundleVersion` on
  TestFlight, not the committed `1`; §4a).
- **Android:** `versionName` (user-facing) + `versionCode` (integer, must
  increase every upload).

These are **not** auto-synced from `package.json` today, and nothing in this PR
changes that. For the training, set them by hand per build. If we want one
source of truth later, a small `cap sync`-time script can stamp them from
`package.json` — deferred, not built (avoids shipping an unused stub).

---

## 7. Coexistence with the Cloudflare PWA deploy

**They do not collide.** Cloudflare Workers Builds deploys the PWA by running
`wrangler deploy` (serving `./dist`) on pushes to `develop`/`staging`/`main`
(AGENTS.md → _Cloudflare Workers Builds owns deployment_). The native TestFlight
build ([§4a](#4a-ios--testflight-via-ci-automated-no-mac-step)) runs on a macOS
runner, but **only on manual dispatch** (`ios-testflight.yml`, `workflow_dispatch`)
— never on push/PR — so it is not a Workers Builds trigger and produces no web
deploy. `cap sync` only copies `dist/` into the native projects; the archive it
uploads goes to App Store Connect, not Cloudflare.

Two operational notes:

- The native build consumes the **same** `dist/` the dispatched ref built, so a
  tester's native app runs identical web code to the PWA **at that ref** — identical
  to staging only when the workflow is dispatched from `staging`. The lane's ref
  guard refuses anything but `staging`/`main` unless explicitly overridden, so build
  tester IPAs from `staging` or `main`, not `develop`.
- Committing `android/`/`ios/` adds source under version control. To keep a
  native-only commit from burning a Cloudflare preview build, add `android/**`
  and `ios/**` to Cloudflare's **Exclude paths** on both Workers, alongside the
  existing `docs/**` and `*.md` entries (dashboard setting; not in this repo).

---

## 8. The one real risk (do not skip)

The recommendation and counter-case (#86) agree the **audio boundary** is the
decider: the app has only ever been validated in **iOS Safari**, and a
Capacitor app runs in **WKWebView** (iOS) / the system WebView (Android), which
differ in `getUserMedia`/MediaRecorder behavior, background capture, and storage
eviction. **Record → background → interruption must be re-tested inside the
Capacitor build on a real iPhone and a real Android device** before this is
called shippable. That spike is tracked separately (see #262 → the
audio-revalidation issue), not closed by this scaffold.
