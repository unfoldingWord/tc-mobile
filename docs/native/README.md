# Native packaging (Capacitor) — build & ship runbook

**Issue:** [#262](https://github.com/unfoldingWord/tc-mobile/issues/262) —
installable iOS (TestFlight) + Android (APK) for the Nairobi training.
**Decision basis:** `docs/research/native-packaging.md` (recommendation) and
its counter-case (#86). **Status:** shell only, no product changes.

Capacitor wraps the **existing PWA** in a native WebView. The same app code
that Cloudflare serves is copied into a native iOS and Android project — but
the native build is `npm run build:native` (`vite build --mode native`), not
the plain `npm run build` Cloudflare Workers Builds runs for the PWA
(#923). Both emit the same application code into `dist/`; the native build
additionally ships a self-unregistering, cache-clearing service worker and no
registration script at all, instead of the PWA's normal offline precache —
see [§2](#2-the-core-loop)'s note below and `vite.config.ts`'s native-mode
comment. There is no second codebase and no product change here — just the
native shell, this one build-mode difference, and the pipeline to produce
installable builds.

> **What was NOT done in this repo, and why.** This integration was scaffolded
> in a Linux CI container with **no Xcode and no Android Studio**. The native
> _projects_ were generated and the web bundle synced into them (`cap add`,
> `cap sync` both run without native SDKs), but **no `.ipa`, `.aab`, or `.apk`
> was built, signed, or run on any device or simulator.** The local steps in
> [§4](#4-ios--testflight) and [§5](#5-android--apk-sideload) require a Mac
> with the native toolchains and are Seth's to run; the CI lanes in
> [§4a](#4a-ios--testflight-via-ci-automated-no-mac-step) and
> [§5a](#5a-android--apk-via-ci-automated-no-mac-step) run on GitHub-hosted
> runners instead. A Capacitor debug APK was once refused the microphone by
> the Android WebView, which is why §5's `MODIFY_AUDIO_SETTINGS` paragraph
> exists — that is a reason the permission stays, not a coverage claim. For
> what has and has not run on a device, read `docs/progress_tracker.md` and
> #245; do not read it out of this banner. §8 still applies in full.

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
  npm run build:native && npx cap sync android
  cd android && ./gradlew assembleDebug
  # → android/app/build/outputs/apk/debug/app-debug.apk
  ```

  To inspect this local debug build through `chrome://inspect`, set
  `TC_ANDROID_DIAGNOSTIC=true` for both the sync and Gradle commands
  ([diagnostic builds](#5a-android--apk-via-ci-automated-no-mac-step)).

  Install that APK **only on a developer's own device — one that will never
  receive a §5a release build** — and follow the sideload steps in
  [§5](#5-android--apk-sideload) step 4 (enable _Install unknown apps_, open the
  file). Testers get release-signed builds from the CI lane
  ([§5a](#5a-android--apk-via-ci-automated-no-mac-step)) once the keystore and
  its four secrets exist; the debug APK proves the toolchain and the WebView,
  nothing more. The signed-**release** path (§5 steps 1–3) is the durable
  distribution route.

  > **The debug APK is for the developer's own proof, not for anyone who will
  > later receive a release build.** Android ties app identity to the signing
  > key: a phone that installed a debug-signed APK **cannot update** to a
  > release-signed one (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, whatever the
  > `versionCode`). The only way forward is uninstall — and because backups are
  > off (§5) and IndexedDB is the system of record, **uninstall deletes every
  > recording on that phone.** Once the release keystore exists, testers get
  > release-signed builds only (§5a), and every one of them is signed with the
  > same keystore.

- **iOS — gated on the Apple Developer account (the long pole).** There is no
  debug-APK equivalent: every install onto an iPhone requires a signing identity
  tied to an **Apple Developer Program** membership and the unfoldingWord Apple
  **Team**. **Before Monday, verify the Team exists and enrollment is active**
  (see [§0.1](#01-humanpaid-gates) and [§4](#4-ios--testflight)). If it is not,
  that is the item to resolve first — the Xcode steps cannot start without it. A
  local build to a **cabled personal device** is possible with a free Apple ID
  but is not the TestFlight path testers use; TestFlight still needs the paid
  membership.

If only one platform is ready on Monday, ship that one. Android has no human or
paid dependency, so it is the safest to count on — but **what ships to testers is
the release-signed CI APK ([§5a](#5a-android--apk-via-ci-automated-no-mac-step))
once the keystore and its four secrets exist.** The debug APK above proves the
toolchain and the WebView on a developer's own device; it never goes to a phone
that will later receive a release build (see the callout under the Android
route).

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

**Capacitor version:** pinned exactly in `package.json`. **appId:** `org.unfoldingword.tcmobile`.
**appName / ordinary home-screen label:** `tC Mobile` (matches the PWA `short_name`).
Android [diagnostic builds](#5a-android--apk-via-ci-automated-no-mac-step)
use the label `tC Mobile Diagnostic`.

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
  `applicationId org.unfoldingword.tcmobile`, `versionCode 1` (default; a
  build passes `-PversionCode`), `versionName` read from `package.json`'s
  `version` at build time (`0.2.3` as of this writing — was the Capacitor
  template default `"1.0"` until #410).
- **iOS:** deployment target `15.0`, bundle id `org.unfoldingword.tcmobile`,
  `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1`, display name `tC Mobile`.

---

## 2. The core loop

Any time the web app changes, the native shell needs the new bundle:

```bash
npm run build:native   # emit dist/ — the NATIVE build mode, not `npm run build`
npx cap sync            # copy dist/ into ios/ and android/, refresh native deps
# then open/build the native project (Mac only) — §4 / §5
```

**Always `npm run build:native` here, never the plain `npm run build`
(#923).** Both emit the same application code; `build:native`
(`vite build --mode native`) additionally swaps the service worker
`vite-plugin-pwa` emits for a self-unregistering, cache-clearing one and
ships no registration script, because a Workbox offline precache adds
nothing inside a WebView that already reads its bundle from local files —
and a stale one is exactly what left an APK upgraded in place still running
the old build. Syncing a plain `npm run build` into a native project
re-introduces that bug. See `vite.config.ts`'s native-mode comment and
`src/hooks/register-service-worker.ts` for the full reasoning, and
[§7](#7-coexistence-with-the-cloudflare-pwa-deploy) for how this keeps the
native shell from colliding with the Cloudflare PWA deploy, which still runs
the plain `npm run build`.

`cap sync` = `cap copy` (web assets + config) + `cap update` (native deps).
Both `cap add` and `cap sync` run **without** Xcode/Android Studio (verified in
this container). Everything past sync — `cap open`, archive, gradle assemble,
signing, upload — needs the native toolchains: **locally that is a Mac** with
Xcode and Android Studio (§3), which is what the team runs; **in CI it is the two
manual lanes**, [§4a](#4a-ios--testflight-via-ci-automated-no-mac-step) for
TestFlight and [§5a](#5a-android--apk-via-ci-automated-no-mac-step) for the
APK, which need no Mac at all.

Convenience scripts are in `package.json` (added for the Monday prep, #262):

- `npm run cap:sync` → `npm run build:native && npx cap sync` (rebuild the
  native bundle and copy it into both native projects — the core loop above
  in one command).
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

**Local workflow tests:** `tests/ios-workflow-gates.test.ts` runs extracted Bash
steps with real Node and Ruby executables. `ruby` (with RubyGems for
`Gem::Version`) must be on `PATH` when running `npm test` or `npm run verify`,
including in a devcontainer. These tests do not require Xcode or signing
credentials and do not dispatch a native build.

```bash
git clone https://github.com/unfoldingWord/tc-mobile.git
cd tc-mobile
npm ci
npm run build:native
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
([`fastlane/Fastfile`](../../fastlane/Fastfile), lane `ios beta`). Signing is
**manual**: a Distribution certificate (`.p12`) and an App Store provisioning
profile (`.mobileprovision`) are decoded from secrets into a temporary keychain;
the App Store Connect **API key** authenticates the **upload only**, not signing.
No `match`, no certs repo. It is **manual-trigger only** (`workflow_dispatch`):
run it from **Actions →
iOS TestFlight → Run workflow**, choosing the branch to build. It never runs on
push/PR, so it does not collide with the Cloudflare PWA deploy ([§7](#7-coexistence-with-the-cloudflare-pwa-deploy))
and adds no required check to normal PRs.

**What a run does:** `npm ci` → `npm run build` → `npm run test:dist` (the web
build and its own artifact checks, including the OBS thumbnail policy) →
`npm run test:dist:native` (rebuilds `dist/` in native mode — the
self-unregistering, cache-clearing service worker, #923 — and checks that
output) → select Xcode 26 → `npx cap sync ios` → guard the synced bundle →
archive the `App` scheme (Release) → upload to TestFlight. **A green run means
the binary
uploaded, not that a tester received it:** the lane sets
`skip_waiting_for_build_processing` (it does not hold the billed runner open for
Apple's processing) and assigns no tester group, so it cannot observe a later
processing rejection either. Internal testers receive the build automatically once
processing finishes **only if the internal tester group has _Automatically
distribute new builds_ enabled** (§4a setup) — otherwise assign the processed build
to the group by hand. **External** distribution needs a Beta App Review and is a
separate step.

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

> **Doing this for the first time?** [`ios-credentials.md`](ios-credentials.md)
> walks the same four items as a sit-down checklist — every field each Apple
> form asks for, with the answer for this project, the two prerequisite
> questions that can block the whole session (enrollment status and your team
> role), and the failure modes that produce a **green** run no tester ever
> receives. The summary below is the reference; that file is the procedure.

1. **App Store Connect API key — for the upload, not signing.** App Store
   Connect → _Users and Access → Integrations → App Store Connect API_ →
   generate a key with the **App Manager** role (`upload_to_testflight` needs it
   to submit the build). Download the `.p8` **once** (it cannot be
   re-downloaded); note the **Key ID** and **Issuer ID**.
2. **A Distribution certificate and an App Store provisioning profile — the
   signing identity.** Manual signing needs a stable Apple **Distribution**
   certificate exported as a `.p12` **with its private key**, plus an **App
   Store** provisioning profile bound to `org.unfoldingword.tcmobile` and that
   certificate. [`ios-credentials.md`](ios-credentials.md) walks the portal
   steps; base64-encode both files for the secrets below. Keep the `.p12` and its
   export password in a secrets vault: the same identity is reused on every run —
   the point of manual over automatic signing.
3. **The app record must already exist.** App Store Connect → _Apps → **+** → New
   App_, bundle id `org.unfoldingword.tcmobile`. `upload_to_testflight` uploads to
   an existing app; it does **not** create one. (A first manual Xcode upload,
   [§4](#4-ios--testflight), also creates it — see the recommendation below.)
   Then create an **internal tester group** (TestFlight → Internal Testing) and
   enable **_Automatically distribute new builds_** on it, or an uploaded build
   reaches no one until it is assigned to a group by hand.
4. **The `release-signing` environment** (_Settings → Environments → New_):
   name it exactly `release-signing`, add **required reviewers** (the DRI at
   minimum), and **untick _Allow administrators to bypass configured
   protection rules_** — with it on (GitHub's default), any repository admin
   can click _Start all waiting jobs_ and no reviewer is consulted, which is
   the #321 hole under a different door. Leave _Prevent self-review_ off: the
   DRI both dispatches and approves. Leave the deployment-branch rule at "all
   branches" — the in-yml ref guard handles branches; the reviewer is the actor
   guard (#321). A settings-side branch list would be the one ref guard a
   rewritten yml cannot remove, but it would also block the `allow_any_ref`
   proving dispatches from feature branches; recorded here so the trade-off is
   not re-litigated.

   **Plan trap.** On GitHub Free, Pro and Team, required reviewers exist
   **only on public repositories**, and the unfoldingWord org is on Free. If
   this repository is ever made private again, GitHub ignores the protection
   rules **and the environment secrets**: the gate is silently gone, and both
   lanes fail at the presence check naming a secret that is in fact set.
   Nothing in a run explains why — this paragraph is the explanation.

   Both native lanes' signing jobs declare `environment: release-signing`, so
   every dispatch pauses for one approval before any secret is read.

   **What the approval is.** GitHub runs the workflow file **on the dispatched
   ref**, and any push-access branch can rewrite it while keeping
   `environment: release-signing` on the job — so a branch can add a step that
   reads the secrets, and the pause is the only thing between it and them.
   Before _Approve and deploy_, open `.github/workflows/<lane>.yml` **on the
   ref the run shows** and confirm it is the committed lane; reject anything
   else. Approving without reading is the #321 hole with a rubber stamp on it.

5. **Environment secrets** (_Settings → Environments → release-signing →
   Environment secrets_), **not** repository secrets. When both exist, the
   environment copy takes precedence for the gated job — but a repository
   secret stays readable by **any** workflow in the repository, gated or not,
   so a leftover repository copy is the bypass #321 closes. Migrating from
   repository secrets, **in this order**: set and verify every environment
   secret; promote the yml that carries `environment: release-signing` to
   **every ref you still dispatch** (`staging`, and `main` once it has the
   lane); only then delete the repository copies (all eleven signing names in
   one loop — `ios-credentials.md` §8). Deleting earlier breaks the live
   tester lane: the pre-#321 yml on `staging` has no environment, cannot see
   environment secrets, and runs on the repository copies until the promotion
   replaces it. Afterwards `gh secret list` at repository level should show
   **no signing name** — `CLOUDFLARE_ACCOUNT_ID` is not one:

   | Secret                         | Value                                                                      |
   | ------------------------------ | -------------------------------------------------------------------------- |
   | `ASC_KEY_ID`                   | the API **Key ID**                                                         |
   | `ASC_ISSUER_ID`                | the API **Issuer ID**                                                      |
   | `ASC_KEY_P8_BASE64`            | the `.p8` contents, base64-encoded (`base64 -i AuthKey_XXXX.p8 \| pbcopy`) |
   | `APPLE_TEAM_ID`                | the unfoldingWord Apple **Team ID** (Developer portal → _Membership_)      |
   | `IOS_DIST_CERT_P12_BASE64`     | the Distribution `.p12` (private key included), base64-encoded             |
   | `IOS_DIST_CERT_PASSWORD`       | the `.p12` export password                                                 |
   | `IOS_PROVISION_PROFILE_BASE64` | the App Store `.mobileprovision`, base64-encoded                           |

   The `.p8`, `.p12` and `.mobileprovision` are decoded into `fastlane/` at build
   time (all gitignored) and removed after the run. **Never commit them.**

### Committed to make CI buildable (evidence)

- `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` — a **shared**
  scheme. Xcode keeps the `App` scheme in gitignored `xcuserdata` by default, so a
  fresh CI checkout had **no** scheme for `xcodebuild` to build. This commits one.
- `ITSAppUsesNonExemptEncryption = false` in `Info.plist` — the app uses only
  standard HTTPS, so it is export-exempt; this skips the per-build _Missing
  Compliance_ prompt in App Store Connect.
- `Gemfile` + `Gemfile.lock` (locked to the macOS runner's platforms) and
  `fastlane/{Appfile,Fastfile}`. The workflow sets `bundle config set --local
frozen true` before `bundle install`, so a run fails rather than silently
  re-resolving. No CocoaPods (SPM — [§3](#3-one-time-mac-prerequisites)).

### Prove the chain once by hand first (recommended)

None of this could be run where it was authored (Linux, no Xcode), so do **one**
manual archive+upload ([§4](#4-ios--testflight)) to confirm the account, Team,
bundle id and app record are wired before relying on CI. After that, the workflow
is the repeatable path. **The first green CI run is the first real verification.**

---

## 5. Android → APK sideload

Sideload only here. Google Play distribution is its own lane and runbook:
[`play-store.md`](play-store.md).

**Microphone permission — two manifest lines, not one:** the manifest declares
`RECORD_AUDIO` **and** `MODIFY_AUDIO_SETTINGS`
(`android/app/src/main/AndroidManifest.xml`, alongside `INTERNET`). Both are
required because of how Capacitor bridges the WebView to Android: when the page
calls `getUserMedia({audio:true})`, the system WebView asks the host app for
`AUDIO_CAPTURE`, and Capacitor's `BridgeWebChromeClient.onPermissionRequest`
answers by requesting **both** `MODIFY_AUDIO_SETTINGS` and `RECORD_AUDIO` from
Android and calls `request.deny()` unless every one is granted
(`node_modules/@capacitor/android/.../BridgeWebChromeClient.java`, 8.5.1).
Android refuses an undeclared permission silently, so with `RECORD_AUDIO` alone
the OS prompt appears, the user allows it, Settings shows Microphone allowed —
and the app still gets a `NotAllowedError` and shows the permission panel. That
is exactly what the first Android device pass hit (Galaxy A17 5G, debug APK
v0.1.15, 2026-09-14; #263 / #245). `MODIFY_AUDIO_SETTINGS` is normal-protection,
granted at install with no prompt; `RECORD_AUDIO` still shows the **runtime**
prompt on first record. Confirm the prompt appears and audio captures on-device
(part of the audio-revalidation spike, §8). Do not remove either permission
(#262 / #86 C1–C2, PR #265).

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
2. Release signing is **already wired in `android/app/build.gradle`** — the
   `signingConfigs.release` block reads four **environment variables**:
   `ANDROID_KEYSTORE_PATH`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`. Export them in your shell before running
   `assembleRelease`, with `ANDROID_KEYSTORE_PATH` **absolute** — Gradle
   resolves a relative path against `android/app/`, not your shell's cwd, and
   the guard only checks that the variable is set, not that the file is there.
   They are read with `System.getenv`, so entries in
   `~/.gradle/gradle.properties` do **not** work — those become Gradle project
   properties, not env vars, and the guard below would report all four as
   missing. The build fails loudly if any is unset, so it cannot silently
   produce an unsigned APK. **Never commit the keystore or passwords.**

   The Mac's login shell is **zsh**, not bash — a bare `read -s VAR` (the bash
   idiom) prints no prompt in zsh, so hitting Enter without noticing exports
   an **empty** password and `assembleRelease` fails opaquely (hit for real,
   2026-09-16, #411). Use zsh's `name?prompt` form, which shows a prompt while
   still suppressing echo:

   ```bash
   export ANDROID_KEYSTORE_PATH="/absolute/path/to/tc-mobile-release.jks"
   export ANDROID_KEY_ALIAS="tc-mobile"
   read -s "ANDROID_STORE_PASSWORD?ANDROID_STORE_PASSWORD: "; export ANDROID_STORE_PASSWORD
   read -s "ANDROID_KEY_PASSWORD?ANDROID_KEY_PASSWORD: "; export ANDROID_KEY_PASSWORD
   ```

   (bash's equivalent is `read -s -p "ANDROID_STORE_PASSWORD: " ANDROID_STORE_PASSWORD`
   — the flag/prompt order is reversed between the two shells, which is the
   trap.)

3. Build a signed APK — **always with a `versionCode`**, the same unix
   timestamp the CI lane uses:
   ```bash
   npx cap sync android
   cd android && ./gradlew assembleRelease -PversionCode="$(date +%s)"
   # → android/app/build/outputs/apk/release/app-release.apk
   ```
   Without `-PversionCode` the build defaults to `versionCode 1`. Android
   refuses a downgrade, so after **any** CI APK (§5a) a `1` can never install
   over it — the tester's only way forward would be uninstall, which wipes
   their recordings. (`npx cap open android` opens Android Studio if you prefer
   _Build → Generate Signed Bundle / APK_; set the version code there too. Use
   **APK**, not AAB, for sideload.)
4. **Testers install:** enable _Install unknown apps_ for the browser/file
   app on the device, then open the APK to install. Distribute the file via a
   link the testers can reach (e.g. a shared drive).

---

## 5a. Android → APK via CI (automated, no Mac step)

[`.github/workflows/android-apk.yml`](../../.github/workflows/android-apk.yml)
builds the Android app on an ubuntu runner and uploads the APK as a workflow
artifact. It is **manual-trigger only** (`workflow_dispatch`): run it from
**Actions → Android APK → Run workflow**, choosing the branch to build. It
never runs on push/PR.

**What a run does:** `npm ci` → `npm run build` (the OBS-thumbnail policy is
checked against this web build) → `npm run test:dist:native` (rebuilds
`dist/` in native mode — the self-unregistering, cache-clearing service
worker, #923 — and checks that output) → `npx cap sync android` →
`./gradlew assembleRelease -PversionCode=$(date +%s)` → upload
`app-release.apk` as a workflow artifact (14-day retention). The APK is signed
with the release keystore decoded from `ANDROID_KEYSTORE_BASE64`.

**Diagnostic APKs (#593).** Leave the `diagnostic` dispatch input off for
training builds. Turn it on only for a USB inspection session: it enables
WebView inspection in `chrome://inspect`, appends `-diagnostic` to Android's
version name, labels the launcher/activity **tC Mobile Diagnostic**, and names
the artifact `android-apk-diagnostic-<sha>`. The web footer still shows the
package version and build SHA. It remains an `assembleRelease` APK with the
same application ID, release signer, signing approval and timestamp version
code, so it can update the installed tester app without uninstalling. It is
not a separate app and it uses the same recordings. Return to an ordinary
build with a newer version code after the inspection; do not uninstall.

For local builds, set `TC_ANDROID_DIAGNOSTIC=true` for both `npx cap sync
android` and Gradle to request diagnostics. Unset it (or set `false`) for
**both** commands to return to normal. Ordinary sync writes an explicit
`webContentsDebuggingEnabled: false`, including on local debug builds.
Gradle rejects assets synced with a different diagnostic mode. No
`package.json` version edit or alternate signing key is needed.

**Inspecting a diagnostic APK with `chrome://inspect`.** This is how
`Share.share`'s settle is read on a tester's phone (#593, #336). You need a
computer with desktop Chrome and a USB data cable. Install the diagnostic APK
over the tester's existing app the §5 step 4 way. **Do not uninstall first.**

1. **Turn on USB debugging on the phone.** Open Settings → About phone and tap
   **Build number** seven times. On Samsung it is under About phone → Software
   information. Then turn on Settings → Developer options → **USB debugging**.
2. **Connect the phone by USB.** Accept the phone's _Allow USB debugging?_
   prompt for this computer.
3. **Attach.** On the computer, open `chrome://inspect#devices` in Chrome and
   leave **Discover USB devices** ticked. Open **tC Mobile Diagnostic** on the
   phone. Its WebView shows under the phone's name with the package
   `org.unfoldingword.tcmobile`. Click **inspect**. If the phone appears
   with no WebView under it, bring the app to the front first. If it still
   does not appear, check that Settings → Apps shows a version ending in
   `-diagnostic`. An ordinary APK cannot be inspected.
4. **Record the environment.** Paste this in the DevTools Console and keep the
   output (the user agent carries the WebView version #593 is missing):

   ```js
   ({
     ua: navigator.userAgent,
     share: typeof navigator.share,
     canShare: typeof navigator.canShare,
   });
   ```

5. **Wrap the bridge before tapping anything.** `@capacitor/core` looks up
   `Capacitor.nativePromise` each time a plugin method is called, so wrapping
   it in the Console catches the app's own `Share.share` call and its settle.
   The wrapper logs the plugin and method names, the option keys, a file
   count and the settle time. It never logs option values, settled values or
   error bodies: Share's `files` URIs carry the device path and the chapter
   file name, and `Filesystem.writeFile`/`appendFile` carry the audio as
   base64.

   ```js
   const tcNative = Capacitor.nativePromise.bind(Capacitor);
   Capacitor.nativePromise = (plugin, method, options) => {
     const t0 = performance.now();
     const call = tcNative(plugin, method, options);
     if (plugin === "Share" || plugin === "Filesystem") {
       const tag = `${plugin}.${method}`;
       const ms = () => Math.round(performance.now() - t0);
       console.log("[call]", tag, {
         keys:
           options && typeof options === "object" ? Object.keys(options) : [],
         files: Array.isArray(options?.files) ? options.files.length : 0,
       });
       call.then(
         () => console.log("[resolve]", tag, ms(), "ms"),
         (error) => console.log("[reject]", tag, ms(), "ms", error?.name)
       );
     }
     return call;
   };
   ```

   Paste it once per page load. A reload or a relaunch removes it, and then
   you paste it again.

6. **Reproduce.** Tap Share Chapter (≡ on a chapter row → Share → Share now).
   Then, separately, send the failure log from the Books ≡ control. Each time,
   write down whether the Android chooser appeared, what you tapped, and
   whether the phone left the app, even briefly (a notification, a call, the
   Home button). Leaving the app matters because the Android Share plugin
   resolves a cancelled chooser as a success once the activity has stopped
   (`src/hooks/share-target.ts`, `resolveProvesDelivery`).
7. **Report.** Paste the Console lines from `[call] Share.share` through its
   `[resolve]` or `[reject]`, plus the step 4 object and your notes from step
   6, as a comment on #593. #593 is public: paste only those redacted lines,
   never an expanded object from elsewhere in the Console. Put the output in
   the issue, not in a file in this repo. If Share is tapped and no `[call] Share.share` line appears,
   the wrapper did not catch the call. Say that in the comment rather than
   reading the silence as "Share was never called."

When the session is over, turn off USB debugging. Then put the tester back on
an ordinary build with a newer version code, as above.

**`versionCode`** is the run's unix timestamp — unique and strictly increasing
with no external round-trip. Android refuses a `versionCode` downgrade, so
every build that reaches a tester must carry a higher code than the last. A
local `assembleRelease` must pass the same `-PversionCode="$(date +%s)"` (§5
step 3); the committed default of `1` never installs over a CI build.

**One keystore, forever.** Every APK a tester receives must be signed with the
same release keystore — a phone cannot update across signing keys, and the
forced uninstall wipes IndexedDB, i.e. every recording (§0). A debug-signed APK
(§0's Monday route) is therefore a dead end for anyone who will later get a CI
build: never hand one to a tester once the release keystore exists.

`keytool` on Java 21 (§5 step 1) writes the keystore as **PKCS12**, which has a
single password for both the store and every key inside it — so
`ANDROID_STORE_PASSWORD` and `ANDROID_KEY_PASSWORD` are, in practice, **the
same value** for a keystore generated this way. Confirm the two secrets match
before assuming a typo when only one of them fails the presence check.

**Tester distribution:** the lane itself attaches the APK **only** as a run
artifact, and workflow artifacts require a GitHub login to download. The repo
is public, so "a GitHub login" means **any** signed-in GitHub user can fetch
the artifact for as long as it is retained; it is a convenience, not a private
channel (the keystore is not in the APK — this is an access-boundary note, not
a signing leak). **In practice the working channel is a manually published
GitHub pre-release** with the run's `app-release.apk` attached as an asset —
`android-release-v0.2.3` (published 2026-09-16, the first release-signed
build) is the first instance — because USB did not enumerate the test device
on the DRI's Mac, so a tester opens the release page directly in the phone's
browser and downloads the `.apk` from there; §5 step 4 covers installation
once it lands on the phone. Nothing in `android-apk.yml` creates the release
automatically: a person downloads the run's `android-apk-<commit sha>`
artifact and publishes it by hand as a pre-release with that file attached.
Sharing the artifact through a team drive (the previously documented path)
still works when USB or a browser download is not the constraint.

### Tester announcement template

Use this template for the manually published release body and its tester-chat
copy. It covers all three channels even though the attached asset is an APK.
Fill the placeholders from the actual distributed builds; mark a channel as
pending if it is not yet available. A green upload job is not evidence of
on-device acceptance. **Never attach a `-diagnostic` build.** The diagnostic
APKs above are for a maintainer's own USB inspection session — same signer,
different label — and are not tester builds (#709); confirm the asset is an
ordinary `app-release.apk` before publishing.

```markdown
This is the shared tC Mobile v<VERSION> tester announcement for Android,
iPhone and browser. Android's APK is attached here; iPhone testers use
TestFlight; browser testers use the staging link below.

Source: <commit and promotion>. Changes since <last version handed to testers>.

**Android — install/update:** Download app-release.apk below. <Confirmed
signing compatibility and minimum Android version>. If uninstalling is
necessary, share any recordings you need to keep first: uninstall deletes them.

**iPhone — install/update:** Open TestFlight using your invitation and select
<version/build>. <Availability or invitation instructions>.

**Browser — open:** <staging URL>. Check the app's displayed build before testing.

**With every report:** Include the app build, steps, expected result and what
happened. Android: phone model, Android version and Android System WebView
version. iPhone: model and iOS version. Browser: device, OS, browser/version,
and whether opened in a tab or installed to the home screen. We log every
report by your role (tester, facilitator, developer), never by your name.

**If something breaks:** On the Books screen, tap **≡** — a red mark means a
problem was recorded. Tap it, then tap the share icon once to prepare the
report and once more to send it: two taps, the same gesture as sharing a
recording. It goes out as a small text file through your phone's own share
sheet. If no share sheet opens, tell us that directly rather than retrying —
that is itself a report, and may be the same failure already tracked in #593.

**Changes:** <Symptom, affected platforms and evidence limits for each change>.

**What to test:**

- <Platforms> — <action>. Look for: <observable expected result>.

**Known limits:** <Unverified behavior and checks still owed per platform>.
```

Name a symptom rather than a phone in change notes, and label every test with
its platforms. For the #556 text-selection fix, say: "Long-press text-selection
popup: suppression added; symptom seen on iPhone, Android not yet checked."
Ask iPhone and Android testers to try it; do not turn that request into a claim
that either platform passed. Android system Back, the app's Back control and a
browser's Back are different actions; name the one a check requires.

Keep existing `android-release-vX.Y.Z` tags and release URLs unchanged so
shared links and QR codes continue to work. Use `tester-build-vX.Y.Z` for
future all-platform tester announcements, starting with the next published
build (DRI decision, #629).

### One-time setup

1. **Create the release keystore** (§5 step 1) and store it in the team secret
   store.
2. **Four environment secrets** in the `release-signing` environment (§4a
   step 4 creates it; _Settings → Environments → release-signing →
   Environment secrets_). Not repository secrets — the build job is
   environment-scoped and pauses for a reviewer before reading them (#321). A
   repository secret of the same name is still readable by an ungated
   workflow, so if any of these four ever existed at repository level, delete
   that copy — the eleven-name loop in `ios-credentials.md` §8 — once the
   environment copy is verified **and** the gated yml is on every ref you
   still dispatch (§4a step 5 has the order and the reason):

   | Secret                    | Value                                                                         |
   | ------------------------- | ----------------------------------------------------------------------------- |
   | `ANDROID_KEYSTORE_BASE64` | the `.jks` file, base64-encoded (`base64 -i tc-mobile-release.jks \| pbcopy`) |
   | `ANDROID_STORE_PASSWORD`  | keystore (store) password                                                     |
   | `ANDROID_KEY_ALIAS`       | key alias (e.g. `tc-mobile`)                                                  |
   | `ANDROID_KEY_PASSWORD`    | key password                                                                  |

   The keystore is decoded to `android/tc-mobile-release.jks` at build time
   (gitignored) and deleted after the APK is built. **Never commit it.**

**First dispatch:** the preflight checks the ref; the build job then waits for
the environment reviewer and, once approved, checks all four secrets as its
first step, before checkout. The `build.gradle` signing config also fails
loudly if the env vars are unset — three layers. What the runner provides was checked against the
`ubuntu-24.04` image notes (actions/runner-images, 2026-09-12), not observed on
a live run: Android SDK Platform 36 and Build-tools 36.0.0 under `ANDROID_HOME`,
and Ruby for the keystore decode — so no `sdkmanager` step is needed. The JDK is
the one thing the image gets **wrong** for this project: its default is Java 17,
while Capacitor's generated `android/app/capacitor.build.gradle` compiles at
Java 21, so the lane pins JDK 21 with `actions/setup-java` before `cap sync`.
The lane has not been dispatched yet; the first run is the end-to-end proof.

---

## 6. Versioning

`package.json` `version` is the **web/PWA** build number and moves only in the
`chore(release)` promotion PR (AGENTS.md → _Versions and milestones_). The two
native platforms **diverge on whether their user-facing version field tracks
it**: iOS's stays independent by design; Android's does not (#410). Each
platform's separate build-number field (`versionCode` / `CURRENT_PROJECT_VERSION`)
stays native/CI-owned either way — a unix timestamp stamped at build or upload
time, never read from `package.json`.

- **iOS:** `MARKETING_VERSION` (user-facing) is **independent** of
  `package.json` by design — still `1.0` — + `CURRENT_PROJECT_VERSION`
  (build, must increase every upload — and the CI lane uploads unix-timestamp
  builds, so a later manual build must exceed the last `CFBundleVersion` on
  TestFlight, not the committed `1`; §4a).
- **Android:** `versionName` (user-facing) is sourced from `package.json`'s
  `version` at Gradle configuration time (#410) — **not** independent the way
  iOS's `MARKETING_VERSION` is, so it moves with every PWA version bump, with
  no separate `-PversionName` property to remember or pass in CI — +
  `versionCode` (integer, must increase every install). The CI lane (§5a)
  stamps `versionCode` with a unix timestamp via `-PversionCode=$(date +%s)`;
  a manual `assembleRelease` must pass the same, because the committed
  default is `1`, and once any CI APK is on a phone a `1` is a downgrade that
  Android refuses (§5 step 3).

  On ordinary builds, Settings → Apps shows the same version number as the `v…`
  half of the in-app build stamp (`src/components/build-stamp.tsx`), instead
  of a permanent `"1.0"`. That is **not** the same thing the facilitator
  runbook asks testers to report: `docs/training/facilitator-runbook.md` §5
  asks for the full build stamp — version **and** build SHA — because
  Settings alone cannot distinguish two builds that share a `package.json`
  version (for example, two CI dispatches of the same `staging` ref, or an
  `allow_any_ref` build off `develop`). Point testers at the stamp; Settings
  is a fallback only when the app will not open at all. Android
  [diagnostic builds](#5a-android--apk-via-ci-automated-no-mac-step) append
  `-diagnostic` to the Settings version; the web footer retains the package version.

---

## 7. Coexistence with the Cloudflare PWA deploy

**They do not collide.** Cloudflare Workers Builds deploys the PWA by running
`wrangler deploy` (serving `./dist`) on pushes to `develop`/`staging`/`main`
(AGENTS.md → _Cloudflare Workers Builds owns deployment_). Both native CI lanes
([§4a](#4a-ios--testflight-via-ci-automated-no-mac-step),
[§5a](#5a-android--apk-via-ci-automated-no-mac-step)) are **manual-dispatch
only** (`workflow_dispatch`) — never push/PR — so neither is a Workers Builds
trigger and neither produces a web deploy. `cap sync` only copies `dist/` into
the native projects; the IPA goes to App Store Connect and the APK becomes a
workflow artifact, not a Cloudflare deploy.

Two operational notes:

- The native build runs the **same application code** as the PWA at the
  dispatched ref — identical to staging only when the workflow is dispatched
  from `staging` — but NOT the same `dist/`: the native lanes rebuild it in
  native mode (`npm run build:native`, #923) after the ref's plain web build
  has already been checked, so what actually ships inside the WebView carries
  a different service worker (self-unregistering, no offline precache)
  from what that same ref's PWA deploy serves. The lane's ref guard refuses
  anything but `staging`/`main` unless explicitly overridden, so build tester
  IPAs and APKs from `staging` or `main`, not `develop`.
- Committing `android/`/`ios/` adds source under version control. To keep a
  native-only commit from burning a Cloudflare preview build, add `android/**`
  and `ios/**` to Cloudflare's **Exclude paths** on both Workers, alongside the
  existing `docs/**` and `*.md` entries (dashboard setting; not in this repo).

---

## 8. The one real risk (do not skip)

The recommendation and counter-case (#86) agree the **audio boundary** is the
decider: the background and interruption paths have only ever been validated
in **iOS Safari**, and a
Capacitor app runs in **WKWebView** (iOS) / the system WebView (Android), which
differ in `getUserMedia`/MediaRecorder behavior, background capture, and storage
eviction. **Record → background → interruption must be re-tested inside the
Capacitor build on a real iPhone and a real Android device** before this is
called shippable. That spike is tracked separately (see #262 → the
audio-revalidation issue), not closed by this scaffold.
