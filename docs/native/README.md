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

Convenience scripts were **not** added to `package.json`: `npx cap sync`,
`npx cap open ios`, `npx cap open android` are the documented commands and the
`cap` CLI is already a dev dependency. (Add them later if the workflow warrants.)

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
3. **Version/build:** set _Marketing Version_ and bump _Build_ (`CURRENT_PROJECT_VERSION`)
   for each upload — App Store Connect rejects a duplicate build number. See
   [§6](#6-versioning) for how these relate to `package.json`.
4. **Microphone permission:** the app records audio — confirm
   `NSMicrophoneUsageDescription` is present in `ios/App/App/Info.plist` with
   human copy before the first TestFlight build. (Verify/add on the Mac; the
   recording path is the product's whole point — #262 / #86 C1–C2.)
5. Select **Any iOS Device (arm64)** → _Product → Archive_.
6. In the Organizer: **Distribute App → TestFlight (Internal/External)** →
   upload to App Store Connect.
7. In **App Store Connect → TestFlight**, add the build to a tester group
   (Caleb, Javi, Tim). External testers need a one-time Beta App Review.
8. **Testers install** via the **TestFlight** app using the invite link/email.

---

## 5. Android → APK sideload

Sideload only; **Play Store submission is out of scope** (#262).

1. **Create a signing keystore once** (keep it and its passwords safe — losing
   it means a new app identity):
   ```bash
   keytool -genkey -v -keystore tc-mobile-release.jks \
     -keyalg RSA -keysize 2048 -validity 10000 -alias tc-mobile
   ```
   Store it **outside** the repo (keystores are git-ignored) and record the
   passwords in the team secret store.
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
  (build, must increase every upload).
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
(AGENTS.md → _Cloudflare Workers Builds owns deployment_). Capacitor produces
**local** native artifacts on a Mac and deploys nothing — there is no native
build in CI and no new deploy workflow. `cap sync` only copies `dist/` into the
native projects locally.

Two operational notes:

- The native build consumes the **same** `dist/` the PWA ships, so a tester's
  native app and the staging PWA run identical web code from the same commit.
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
