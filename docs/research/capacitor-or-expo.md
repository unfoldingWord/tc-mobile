# Capacitor or Expo — where the line is for moving to a native app

**Issue:** [#1520](https://github.com/unfoldingWord/tc-mobile/issues/1520) ·
**Date:** 2026-10-22 · **Decision record:**
[ADR 0016](../decisions/0016-capacitor-or-expo.md) (Proposed) · **Throwaway
proof:** the draft PR on branch `spike/1520-expo-proof` (never merged)

Every claim below carries one of three labels:

- **[observed]** — read in this repository at develop `e2aeccfc`, in an issue
  or PR on this repository, in the installed package source, or in an official
  doc page cited by URL.
- **[inference]** — reasoned from observed facts; not checked on a device.
- **[assumption]** — taken as true without evidence; it needs a check.

**Nothing in this note has been run on a phone.** The Expo proof was built
in the container only; the run sheet in the draft PR says what the DRI runs
and what each result means.

This note continues
[`native-packaging.md`](native-packaging.md), which chose Capacitor on
2026-08-27 and named in advance the conditions that should flip that choice
(§"When the counter-case should flip the decision"). Section 5 below checks
each of those conditions against what has happened since.

## 1. The four questions, answered in short

| Question (#1520)                                                                    | Short answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. For each native need: fine in Capacitor, a small custom plugin, or a native app? | No need is in "needs a native app" today. Two are "fine in Capacitor", five are "small custom plugin", and one (the audio session) is "fine in Capacitor if one web setting holds, a small plugin if not". The plugins needed are roughly the same size in Expo, because Expo has no first-party module for the microSD card, Google Drive or iCloud either (§2). [inference from §2's per-row evidence]                                                                                                 |
| 2. What would a move cost?                                                          | A rewrite of `components/` (≈22 400 lines of React DOM plus ≈4 100 lines of CSS) and most of `hooks/` (≈19 600 lines), a new storage backend for `lib/storage` (≈4 500 lines on IndexedDB), a new UI test harness and new release lanes. About 120–200 PRs at this repo's 500-line cap, against about 17–33 for the middle path. [inference, §3 and §6]                                                                                                                                                  |
| 3. Can recordings carry over?                                                       | Probably, on both platforms, for the installed apps — but only if the Expo app ships under the same bundle id / package and the same signing key, and opens a web view at the old origin to export IndexedDB to files on first launch. Android looks straightforward from the docs; iOS has one unknown that only a phone can settle (whether a page loaded with base URL `capacitor://localhost` sees that origin's IndexedDB). PWA-only users cannot be carried over by an app at all. [inference, §4] |
| 4. Is there a middle path?                                                          | Yes: stay on Capacitor and add targeted plugins — the line the ADR proposes, with named triggers for a move. [§5, §6]                                                                                                                                                                                                                                                                                                                                                                                    |

## 2. The native needs, one row each

### 2.1 Verdict table

| Need                                               | Verdict in Capacitor                                                 | Verdict in Expo                                            | Evidence (details in 2.2)                     |
| -------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Audio session and the silent switch                | Fine if `navigator.audioSession` "playback" holds; else small plugin | Fine: one setting                                          | #1518, `AppDelegate.swift`, Apple, Expo docs  |
| microSD record and backup (Android)                | Small custom plugin (≈400 Java lines in the #1532 probe)             | Small custom module (Expo has no removable-storage API)    | #1456, ADR 0011, #1532, Android and Expo docs |
| Cloud backup (iCloud, Google Drive)                | Fine via the share sheet / Files; small plugin for a direct API      | Same: no first-party Drive or iCloud module                | Apple, Google docs                            |
| Background and interruptions                       | Fine: background capture is no longer wanted (#836)                  | Fine                                                       | #836, #59, Expo audio docs                    |
| Share sheet (chapter MP3, book zip)                | Fine: shipped (`@capacitor/share`, `@capacitor/filesystem`)          | Fine (`expo-sharing`)                                      | `package.json`, B7                            |
| Large files and storage quota                      | Small plugin once audio moves to files; quota is a real iOS limit    | Fine: files by default, no web quota                       | MDN quota rules, ADR 0011, #1532              |
| MP3 encoder worker                                 | Fine: shipped (B8, ADR 0009)                                         | Rewrite: no Web Worker; native encoder or JS-thread encode | ADR 0009, `hooks/mp3.worker.ts`               |
| Limiter or compressor at record time, 32-bit float | Fine for the limiter (Web Audio); float capture unproven             | Needs a native audio library (not `expo-audio`)            | #1520 table, `expo-audio` types               |
| Store listing and review                           | Fine so far                                                          | Fine                                                       | native-packaging.md C3                        |

### 2.2 Per need

**Audio session and the silent switch** (#1518; history #1100, #1111, #1116,
#1251, #1261).

- [observed] All playback is Web Audio (`createBufferSource`) inside
  WKWebView; nothing in `src/` uses `<audio>` (#1518 body, citing
  `src/hooks/audio-io.ts`).
- [observed] The iOS shell sets `.playAndRecord` with `.defaultToSpeaker`
  once at launch and never activates the session itself
  (`ios/App/App/AppDelegate.swift:52-56`); its own comment says the
  silent-switch case "has not been run on a device (#1251)".
- [observed] Apple: under `.playback` and `.playAndRecord`, "your audio
  continues with the Silent switch set to silent"; under `.ambient` and
  `.soloAmbient` (the default), audio "is silenced by screen locking and by
  the Silent switch"
  ([playback](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback),
  [playAndRecord](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord),
  [ambient](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/ambient),
  [soloAmbient](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/soloambient)).
- [observed] The W3C Audio Session draft resolves `auto` to `ambient` when no
  playing element declares another type
  ([W3C Working Draft](https://www.w3.org/TR/audio-session/), §5.4).
- [inference] That is the mechanism #1518 proposes: inside the shell WebKit,
  not the app, picks the category for page audio, and with no declared type
  it can fall to one the ring switch mutes. The app does not own the session.
- [observed] The fix in flight declares `"playback"` on every Play inside
  the shell (#1518's plan comment; `release/v1.1.1`), and waits on a device
  check.
- [observed] Expo: `setAudioModeAsync({ playsInSilentMode })` — "Determines
  if audio playback is allowed when the device is in silent mode"; default
  `true` in the SDK 58 types
  ([expo-audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/);
  `expo-audio/build/Audio.types.d.ts`).
- **Verdict:** fine in Capacitor if the #1518 device check passes; if it does
  not, a small Swift plugin that plays through `AVAudioPlayer` (the issue's
  fix 2). This is the one need where Expo is plainly simpler, because the app
  owns the session directly. [inference]

**microSD record and backup** (#1456, ADR 0011, R5: Android-app only).

- [observed] Android: `getExternalFilesDirs()` returns one directory per
  volume, including a removable card; "your app doesn't need to request any
  storage-related permissions" on API 19+; the files "are removed when your
  app is uninstalled"; and they "aren't guaranteed to be accessible, such as
  when a removable SD card is taken out"
  ([app-specific storage](https://developer.android.com/training/data-storage/app-specific)).
- [observed] The draft probe #1532 does this as a ≈394-line Java Capacitor
  plugin (volumes, chunked write with fsync and rename, base64 read-back,
  folder picker with persisted grant). Not compiled, not run.
- [observed] Expo's file-system page offers `Paths.document` and
  `Paths.cache`, a `FileHandle` for chunked writes, and a file picker; it says
  nothing about removable storage, and its directory-picker mention is not
  backed by an entry in its API reference
  ([expo-file-system SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/)).
- **Verdict:** a small custom plugin in either stack. The Android code is the
  same Java/Kotlin either way; only the bridge differs. [inference]

**Cloud backup — iCloud and Google Drive.**

- [observed] ADR 0011: "Cloud sync is not decided" and a v2 backup is
  "write-only unless" the requirements owner says otherwise (R4).
- [observed] iOS: `UIDocumentPickerViewController` exports a document to a
  destination the user picks, outside the sandbox
  ([Apple](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)).
  An app-owned iCloud container needs the iCloud entitlement and
  `url(forUbiquityContainerIdentifier:)`
  ([Apple](<https://developer.apple.com/documentation/foundation/filemanager/url(forubiquitycontaineridentifier:)>)).
- [observed] Google Drive's app data folder is "only accessible by your app
  and its contents are hidden from the user" and "is deleted when a user
  uninstalls your app from their My Drive"
  ([Google](https://developers.google.com/workspace/drive/api/guides/appdata)).
- [inference] A user-visible backup ("save this book to iCloud Drive / Drive")
  is the share sheet or the Files picker, which the app already uses. A
  silent, scheduled backup through the Drive REST API or an iCloud container
  needs sign-in and entitlements — a plugin in Capacitor and a module in Expo;
  Expo ships neither.
- **Verdict:** fine in Capacitor for a user-driven backup; a small plugin for
  an automatic one. No difference between the stacks. [inference]

**Background and interruptions** (#836, #59).

- [observed] #836 is closed: the requirements owner decided on 2026-09-24
  that switching apps ends the recording; the page becoming hidden seals the
  take (AGENTS.md "Testing").
- [observed] The #59 interruption fix saved a partial take on iOS (AGENTS.md,
  second on-device run).
- [observed] `expo-audio` supports background recording behind a config flag,
  with an Android foreground-service notification
  ([expo-audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/)).
- **Verdict:** fine in Capacitor. The capability Expo adds is one this product
  decided not to want. [inference]
- This retires the "decisive" flip condition of `native-packaging.md`
  ("needs a native plugin for reliable background capture"). [inference]

**Share sheet.** [observed] Share Chapter and Share Book shipped in B7 on
`@capacitor/share` 8.0.3 and `@capacitor/filesystem` 8.1.4 (`package.json`).
**Verdict:** fine in Capacitor.

**Large files and storage quota.**

- [observed] PCM is ≈5.3 MB per minute and MP3 ≈0.5 MB per minute
  (`src/types/audio.ts`); the take cap is 20 minutes (AGENTS.md, #1005), so
  one PCM take can reach ≈106 MB. [inference for the product]
- [observed] MDN: "For other WebKit-based apps that embed web content, each
  origin can store up to around 15% of total disk", and an overall cap of "20%
  of disk size for non-browser apps that display web content"; Chromium
  allows an origin "up to 60% of the total disk size"
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
- [inference] On iOS the Capacitor app holds every recording under the
  embedded-web 15% per-origin quota. On a 64 GB phone that is ≈9.6 GB — about
  30 hours of PCM or 300+ hours of MP3. That is enough for the training use,
  but it is a hard ceiling an Expo app writing files would not have.
- [observed] #1532 reads the card back as base64, because a Capacitor plugin
  call carries JSON. Expo's `File.write` takes an `ArrayBuffer` or
  `Uint8Array` (expo-file-system docs above).
- [inference] Once clip bytes move into files (the microSD seam), Capacitor
  pays a base64 cost of about 4/3 in size plus encoding time on every read
  and write of a take; Expo does not.
- **Verdict:** a small plugin, needed anyway for the card. The quota and the
  bridge cost are the two places where Capacitor has a real ceiling; neither
  has been measured on a phone.

**MP3 encoder worker.**

- [observed] The encoder runs `@breezystack/lamejs` in a Web Worker, built
  from a blob snapshot (ADR 0009, `hooks/mp3.worker.ts`,
  `hooks/mp3-codec.ts` ≈1 540 lines).
- [inference] React Native has no Web Worker. A move would encode on the JS
  thread (blocking the UI for a long take), in a worklet runtime, or with a
  native encoder. This is a rewrite in Expo and is already done in Capacitor.
- **Verdict:** fine in Capacitor.

**Limiter or compressor at record time, and 32-bit float capture** (#1520
table, "Round 4 T5").

- [inference] Web Audio has a `DynamicsCompressorNode` and `AudioWorklet`
  inside the current capture graph, so a limiter is web work.
- [observed] `expo-audio` records to a file through `MediaRecorder` on
  Android (`RecordingOptionsAndroid`) and exposes linear-PCM bit depth and
  float only on iOS (`RecordingOptionsIos.linearPCMIsFloat`), with no
  processing graph (`expo-audio/build/Audio.types.d.ts`).
- [observed] `react-native-audio-api` 0.13.6 describes itself as "compatible
  with Web Audio API specification" (npm registry, 2026-10-22).
- [inference] A move would need that library or a native module for this
  need, not `expo-audio`.
- **Verdict:** limiter fine in Capacitor; float capture unproven in both.

**Store listing and review.**

- [observed] `native-packaging.md` C3 named App Store guideline 4.2
  ("minimum functionality") as a WebView-wrapper risk. The app has shipped
  v1.0.0 and v1.1 tester builds through TestFlight (AGENTS.md "Versions";
  #1518).
- [observed] I do not have evidence of a public App Store review outcome.
- **Verdict:** fine so far.

## 3. What a move would cost, per area

Line counts are `wc -l` over `.ts`/`.tsx` at develop `e2aeccfc`. [observed]

| Area                                | Size                                                                                        | What a move does to it                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/` (DOM-free)                   | 97 files, ≈19 750 lines                                                                     | Mostly portable: ESLint and `typecheck:lib` keep it free of DOM and Web Audio [observed, AGENTS.md]. **Except `lib/storage` (≈4 540 lines)**, which is built on `idb` / IndexedDB [observed: `src/lib/storage/db.ts` imports `openDB`]. React Native has no IndexedDB [inference], so storage needs a new backend (SQLite plus files) and its transaction discipline re-proved. `lib/audio` (≈4 660) and `lib/export` (≈2 230) carry over. [inference] |
| `hooks/`                            | 46 files, ≈19 630 lines                                                                     | The browser boundary: `audio-io.ts` (≈1 710), `use-recorder.ts` (≈1 280), `mp3-codec.ts` and its worker, `share-flow.ts`, `use-nav-stack.ts`, the service worker. Rewritten on native audio, files and navigation. Hooks with no browser API (state over `lib/`) port with edits. [inference]                                                                                                                                                          |
| `components/`, `app/`               | 79 files, ≈24 070 lines, plus ≈4 090 CSS                                                    | React DOM and Tailwind to React Native: no DOM, no CSS cascade, no `<svg>` without a library. A rewrite, screen by screen; the three-layer token system would be re-expressed as a theme object. [inference]                                                                                                                                                                                                                                           |
| Test harness                        | 445 unit test files, 35 e2e specs                                                           | `lib/` tests run in Node and carry over. The render harness (`tests/render.ts`, `renderToStaticMarkup` plus jsdom, ≈70 importers) and every CSS-reading test do not. The Playwright suite against `dist/` would be replaced by a native UI runner. [observed counts; inference on what carries]                                                                                                                                                        |
| Release lanes                       | `ios-testflight.yml`, `android-apk.yml`, `android-play.yml` (≈1 020 lines) plus `fastlane/` | Each runs `cap sync` before a native build [observed: `ios-testflight.yml:261`]. A move rewrites them around `expo prebuild` or EAS Build. EAS accepts existing credentials through `credentials.json` ([Expo](https://docs.expo.dev/app-signing/existing-credentials/)) [observed]. The tester pre-release, QR and TestFlight group steps stay. [inference]                                                                                           |
| The PWA (tcmobile.app, workers.dev) | `wrangler.jsonc`, `vite-plugin-pwa`                                                         | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**What happens to the PWA.** Three options. [inference throughout]

1. **Keep the current web app as the PWA, and build a separate Expo app.**
   Two UI codebases sharing `lib/`. Every UI change is made twice.
2. **Expo web** (`npx expo export --platform web`, react-native-web)
   ([Expo](https://docs.expo.dev/workflow/web/)). One UI codebase, but the
   web build is a react-native-web app, not today's DOM app, and the
   recorder's web half would still need Web Audio behind a platform split.
   Existing PWA users keep their IndexedDB only if the web build keeps the
   same database name (`tc-mobile`) and schema at the same origin
   [observed: `db.ts:157-158`, `DB_NAME = "tc-mobile"`, `DB_VERSION = 12`].
3. **Retire the PWA** to a page pointing to the stores. Simplest, but it
   strands PWA-only users' recordings (§4.4) and removes the no-install path
   used in training.

**Expo DOM components** (`'use dom'`) run web React inside a web view in an
Expo app, which "enables incremental migration ... on a per-component basis"
([Expo](https://docs.expo.dev/guides/dom-components/)) [observed]. They do
not avoid the data question: release builds serve them from `file://` (same
page), a different origin from `capacitor://localhost` /
`https://localhost`, so today's IndexedDB is not visible to them without the
§4 export. [inference]

## 4. Data continuity — the hard rule

The requirements owner named losing recordings as fatal (#1520). This section
is the plan a move must pass before it starts.

### 4.1 Where the recordings are today

- [observed] Bundle id and package: `org.unfoldingword.tcmobile`
  (`capacitor.config.ts` `appId`; `ios/App/App.xcodeproj/project.pbxproj`
  `PRODUCT_BUNDLE_IDENTIFIER`; `android/app/build.gradle` `applicationId`).
- [observed] No `server.hostname`, `iosScheme` or `androidScheme` is set in
  `capacitor.config.ts`, so Capacitor 8.5.3's defaults apply: hostname
  `localhost`, iOS scheme `capacitor`, Android scheme `https`
  ([Capacitor config](https://capacitorjs.com/docs/config)).
- [inference] So the WebView origins are `capacitor://localhost` on iOS and
  `https://localhost` on Android.
- [observed] Capacitor's own upgrade guide: "Changing the scheme is the
  equivalent to shipping your application on a different domain ... any data
  stored in cookies, localstorage, etc would no longer be accessible"
  ([Capacitor 6 upgrade](https://capacitorjs.com/docs/updating/6-0)).
- [observed] The database is `tc-mobile`, version 12. Its stores are
  `books`, `chapters`, `segments`, `takes`, `clipMeta`, `clipData`,
  `failures`, `tombstones` and `pendingTakes`. `clipData` values are
  `ArrayBuffer`, keyed by `ClipId` (`src/lib/storage/db.ts:157-158`, `:253`,
  `:586-628`).
- [observed] iOS: Capacitor registers its scheme handler with
  `setURLSchemeHandler` and does not set a non-persistent store
  (`@capacitor/ios` `CAPBridgeViewController.swift:121`, `:297`). Apple:
  the default data store "stores data persistently to disk"
  ([WKWebsiteDataStore.default()](<https://developer.apple.com/documentation/webkit/wkwebsitedatastore/default()>)).
- [observed] Android: neither Capacitor nor `react-native-webview` calls
  `setDataDirectorySuffix` (grep of both packages' Java/Kotlin). Android:
  without it "no suffix will be used", and the directory is per process
  ([WebView](<https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String)>)).
- [observed] `android:allowBackup="false"`, so Android Auto Backup holds no
  copy (`AndroidManifest.xml:9`).

### 4.2 The precondition: an update, not a new app

- [observed] Android "compares the certificate(s) in the new version with
  those in the existing version" and allows the update only "if the
  certificates match". Otherwise the new build installs "as a completely new
  app" under a different package name
  ([app signing](https://developer.android.com/studio/publish/app-signing)).
  `docs/native/README.md` records "One keystore, forever".
- [observed] The Expo proof's `app.json` sets `ios.bundleIdentifier` and
  `android.package` to `org.unfoldingword.tcmobile`. EAS accepts the existing
  keystore and iOS certificate and profile through `credentials.json`
  ([Expo](https://docs.expo.dev/app-signing/existing-credentials/)).
- [assumption] iOS keeps an app's data container across an App Store or
  TestFlight update under the same bundle id and team. This is ordinary iOS
  behaviour, but I have no Apple page in hand that states it.
- [inference] If both hold, the Expo build replaces the Capacitor build in
  place. The old WebView data directory (iOS `Library/WebKit`, Android
  `app_webview`) is still in the container on first launch of the Expo build.

### 4.3 The migration — first launch of the Expo build

1. On first launch, before the main UI, mount a hidden
   `react-native-webview` (default persistent store; not `incognito`).
2. Load a small HTML string with the old origin as its base URL:
   `source={{ html, baseUrl: "https://localhost" }}` on Android, and
   `"capacitor://localhost"` on iOS.
   - Android: [observed] `react-native-webview` turns this into
     `loadDataWithBaseURL` (`RNCWebViewManagerImpl.kt:391`). Android: "The
     base URL is used both to resolve relative URLs and when applying
     JavaScript's same origin policy"; without a valid HTTP or HTTPS base URL
     the origin is `"null"` (WebView reference, same page). [inference]
     `https://localhost` is a valid HTTPS base URL, so the page runs at the
     old origin, in the same data directory, and sees the old IndexedDB.
   - iOS: [observed] `react-native-webview` calls
     `loadHTMLString:baseURL:` (`RNCWebViewImpl.m:859`) and has no prop to
     register a `WKURLSchemeHandler` (its
     [reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md)).
     **Unknown:** whether WebKit gives that page the origin
     `capacitor://localhost`, and lets it open that origin's IndexedDB, when
     no handler is registered for the scheme. [assumption until the phone run]
     If not, the fallback is a small Expo module in Swift that builds a
     `WKWebView` on the default data store, registers a handler for
     `capacitor`, and serves the export page. That is the same thing
     Capacitor does today ([WKURLSchemeHandler](https://developer.apple.com/documentation/webkit/wkurlschemehandler)).
     [inference]
3. In the page, open `tc-mobile` read-only. For each `clipData` entry,
   base64 it in chunks and `postMessage` it out — `react-native-webview`
   messages must be strings (Reference: "`data` must be a string"). Write each
   clip to a native file with `expo-file-system`, and write the metadata
   stores as JSON.
4. Verify the copy (count and byte length per clip against `clipMeta`) before
   marking the migration done. **Never delete the old IndexedDB** in the same
   release; leave it as the fallback.

This is what the Expo proof's probe does, in miniature (§7).

**Risks.** [inference]

- A 20-minute PCM take is ≈106 MB, ≈141 MB as base64. It must be chunked and
  written incrementally, or a low-memory Android phone will kill the app
  mid-migration.
- The migration must be idempotent: a killed first launch re-runs from the
  start, against an IndexedDB nothing has changed.
- The Expo build must also understand every schema version a phone could
  hold. Today that is v12 (AGENTS.md "A rollback is not free").

### 4.4 PWA-only users

- [inference] Their recordings live in the browser's IndexedDB at
  `tcmobile.app` or `tc-mobile.unfoldingword.workers.dev`. No installed app —
  Capacitor or Expo — can read another app's (the browser's) storage.
- [inference] The only carry-over is a file the user moves: the PWA writes a
  backup, and the app imports it. Today Share Book exports MP3s only; import
  is not built (ADR 0011, R4: "Backup only in v2; restoring on a phone comes
  with import").
- [inference] So a move strands PWA-only users unless either the web build
  keeps running at the same origins (§3, option 1 or 2), or a Scripture Bundle
  export plus an app-side import lands first.
- [inference] This holds equally for a Capacitor-only future. It is a reason
  to keep the PWA alive at both origins in any plan.

### 4.5 Verdict

**Feasible on paper for the installed apps on both platforms, and unproven on
a device.** [inference] Android rests on documented behaviour (same package,
same key, same data directory, same `https://localhost` origin through
`loadDataWithBaseURL`). iOS has one open question: the base-URL origin for a
scheme with no handler. It has a known fallback, a small Swift module.

**No move should start until the proof's probe has listed a real phone's
`tc-mobile` stores, with matching counts, on both platforms.**

## 5. The middle path: Capacitor plus targeted plugins

[inference throughout, from §2]

- **Audio session.** Ship the #1518 `"playback"` declaration. If the device
  check fails, add one Swift plugin that plays a take through
  `AVAudioPlayer` with the app's own session (on hold by the DRI's
  2026-10-22 pick until this spike reports).
- **microSD.** The #1456 chain as scoped (#1472 spike, ADR 0013, a storage
  seam, an Android plugin). Same Java whichever shell hosts it. Also on hold.
- **Cloud backup.** The share sheet or Files picker first; a Drive or iCloud
  plugin only if the requirements owner asks for automatic backup.
- **Limiter.** Web Audio, in `hooks/`.
- **Everything else stays.** The PWA, both origins, the lanes and the test
  harness.

**What the middle path does not fix.** The app does not own the iOS audio
session from JavaScript; the iOS embedded-web quota (≈15% per origin); the
base64 bridge for file-backed audio; and WebView feel on entry-level Android
(`native-packaging.md` C4/C6, still unmeasured).

**`native-packaging.md`'s flip conditions, checked.**

| Condition (2026-08-27)                                   | Status 2026-10-22                                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background capture needs a native audio plugin           | Retired: background capture is not wanted (#836). [observed]                                                                                                          |
| WebView feel or entry-level Android performance rejected | Not measured. [observed: I do not have evidence of a measurement]                                                                                                     |
| A long-lived, invested product                           | Moving toward yes: a v2 plan through the end of 2026 and v3 items are named (AGENTS.md, Known open items 5–6). [observed] What that means for the shell is inference. |

The counter-case's C7 ("the exit cost only grows") has also come true: the app
was ≈8.6k lines on 2026-08-27, and `src/` is now ≈64k lines. [observed]

## 6. Rough size in PRs

At this repo's 500-production-line PR cap. [inference; a range, not a plan]

| Work                                                    | Middle path | Move to Expo                                              |
| ------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| Audio session (#1518 + optional `AVAudioPlayer` plugin) | 1–3         | in the rewrite                                            |
| microSD card (#1456, as scoped)                         | 12–22       | 12–22 (same native code, plus a file-first storage layer) |
| Cloud backup, user-driven                               | 2–4         | 2–4                                                       |
| Limiter                                                 | 2–4         | 3–6 (native audio library)                                |
| `components/` and `app/` rewrite (≈24k lines + CSS)     | —           | 45–70                                                     |
| `hooks/` rewrite (≈19.6k lines)                         | —           | 30–50                                                     |
| `lib/storage` backend + migration (§4)                  | —           | 15–25                                                     |
| Test harness (render, CSS pins, e2e)                    | —           | 10–20                                                     |
| Release lanes                                           | —           | 4–8                                                       |
| **Total**                                               | **≈17–33**  | **≈120–200**                                              |

The microSD row is the #1456 body's own estimate ("about 12 to 22 PRs"). The
rewrite rows divide the line counts by the cap with roughly 1.5–2× for tests
and review fixes.

## 7. The throwaway proof

The draft PR (`spike/1520-expo-proof`, `spikes/expo-proof/`) is an Expo SDK 58
app under the same bundle id and package. It does three things:

1. Records with `expo-audio`, then plays with
   `setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })`,
   and shows the mode on screen.
2. Runs the §4.3 probe: a hidden web view at the old origin lists the
   IndexedDB databases and per-store counts, and exports one `clipData`
   entry to a native file.
3. Carries the old bundle id and package, with the signing caveat written in
   its run sheet.

Its `RUN-SHEET.md` says what the DRI runs on an iPhone (silent switch on) and
an Android phone that holds recordings, and what each result means for the
ADR.

## Sources

Official documentation, read 2026-10-22:

- Expo audio, SDK 58 — https://docs.expo.dev/versions/v58.0.0/sdk/audio/
- Expo file system, SDK 58 — https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/
- Expo existing credentials — https://docs.expo.dev/app-signing/existing-credentials/
- Expo development builds — https://docs.expo.dev/develop/development-builds/introduction/
- Expo Modules API — https://docs.expo.dev/modules/overview/
- Expo web — https://docs.expo.dev/workflow/web/
- Expo DOM components — https://docs.expo.dev/guides/dom-components/
- Capacitor config — https://capacitorjs.com/docs/config
- Capacitor 6 upgrade guide — https://capacitorjs.com/docs/updating/6-0
- Capacitor plugins — https://capacitorjs.com/docs/plugins/creating-plugins
- Apple AVAudioSession categories — https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback (and `/playandrecord`, `/ambient`, `/soloambient`)
- Apple interruption notification — https://developer.apple.com/documentation/avfaudio/avaudiosession/interruptionnotification
- Apple WKWebsiteDataStore.default() — https://developer.apple.com/documentation/webkit/wkwebsitedatastore/default()
- Apple WKURLSchemeHandler — https://developer.apple.com/documentation/webkit/wkurlschemehandler
- Apple UIDocumentPickerViewController — https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
- Apple ubiquity container — https://developer.apple.com/documentation/foundation/filemanager/url(forubiquitycontaineridentifier:)
- Android app-specific storage — https://developer.android.com/training/data-storage/app-specific
- Android WebView reference — https://developer.android.com/reference/android/webkit/WebView
- Android app signing — https://developer.android.com/studio/publish/app-signing
- Google Drive app data folder — https://developers.google.com/workspace/drive/api/guides/appdata
- W3C Audio Session (Working Draft) — https://www.w3.org/TR/audio-session/
- MDN storage quotas — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- react-native-webview reference — https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md

Package versions are from the npm registry on 2026-10-22: `expo` 58.0.17
(`latest`), `expo-audio` 58.0.10, `react-native-webview` 14.0.1,
`react-native-audio-api` 0.13.6.
