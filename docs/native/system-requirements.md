# System requirements — status and evidence

**Status: draft statement, RAM floor open.** This is the single source of
truth #1017 calls for. Three of #1017's four questions are decided; only the
RAM floor is still open:

| #1017 question                   | Status              | Decision and where it is recorded                                                                                                                                                                                                        |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Build target vs. device floor | Answered 2026-09-26 | iOS floor raised to 15.4 to match `:has()` (#1052, DRI: "Raise floor to 15.4 (Recommended)"); `build.target` pinned (#1051); Xcode project raised (#1055). See below.                                                                    |
| 2. RAM floor                     | **Open**            | Waits on phone-check reports on #974 from at least one low-end Android phone and one older iPhone. No RAM floor is adopted. #1017's withheld draft figures are quoted only under "Still open" item 1, and they are not for the listings. |
| 3. Keep Android 7?               | Answered 2026-09-28 | DRI pick on #1017 (verbatim): "Keep Android 7 (Recommended)". The floor stays API 24, Capacitor 8's own minimum; the listing reads "Android 7 or later".                                                                                 |
| 4. Long takes                    | Answered 2026-09-28 | Covered by the take cap (#1005), per the DRI's #1017 comment; the doc note landed in #1142. See "Open question 4" below.                                                                                                                 |

The section "Requirements statement (draft for the listings)" below is the
wording the Play listing, the App Store listing and the web page / facilitator
runbook (#248) should reuse. Its platform floors are read
from the build files, and its storage figures are derived by arithmetic shown
there. **No phone has been measured, and nothing here claims a device test.**
The RAM floor is deliberately **not** stated: it waits on real phone reports on
#974 (#1002 §6), and #1017 says not to publish RAM figures before then. Read
#1017 and #1002 for the full picture.

**The iOS floor is 15.4, not 15.0 — raised 2026-09-26 (#1052).** The reason is
below (open question 1's CSS section): the O4 CSS uses `:has()`, which needs
Safari/iOS 15.4, and the DRI decided to raise the documented floor to match it
rather than rewrite the 13 `:has()` sites. **This doc, `vite.config.ts`'s
`build.target`, and the Xcode project now all state 15.4.** The Xcode project
(`ios/App/App.xcodeproj/project.pbxproj`'s `IPHONEOS_DEPLOYMENT_TARGET`, all
four occurrences at lines 241, 292, 309 and 331 in the tree at this doc's
head) was raised from `15.0` to `15.4` by #1055 (merged 2026-09-26), which
also updated `ios/App/CapApp-SPM/Package.swift`,
`docs/native/README.md`, and `docs/native/ios-credentials.md`. **The store
listings still do not** — see "What this does not answer" at the bottom.

## Open question 1 — build target vs. the device floor (answered 2026-09-26; iOS floor updated 2026-09-26 per #1052)

**Question (from #1017):** does Vite's `build.target` (plus the esbuild/
LightningCSS targets it derives, the PWA plugin, Workbox's `sw.js` output, the
MP3 Web Worker chunk, and Capacitor's WebView floor) produce output that runs
on the stated iOS floor (`ios/App/App.xcodeproj/project.pbxproj`,
`IPHONEOS_DEPLOYMENT_TARGET`, **15.4 in the tree and as documented — both
raised to match by #1052/#1055, see above**) and the stated Android floor
(`android/variables.gradle`, `minSdkVersion = 24`, Android 7.0)?

**Short answer:** the JS side was a latent risk, now closed by pinning
`vite.config.ts`'s `build.target` explicitly. The CSS side had one real,
already-shipping gap that pinning `build.target` could not fix — resolved not
by changing the CSS, but by the DRI raising the documented floor to 15.4 to
match what the CSS already needed (#1052).

### JS: latent, now pinned

Vite 8.3.0 (the version pinned in `package.json`), when `build.target` is left
unset, resolves it to the string `"baseline-widely-available"` — a rolling
snapshot bumped on every Vite major release
(`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET`,
`node_modules/vite/dist/node/chunks/node.js`) that at this pinned version is
`["chrome111","edge111","firefox114","safari16.4","ios16.4"]`. `vite.config.ts`
set no `build.target` before this change, so the app was building against that
default — a Safari/iOS floor of 16.4, above the app's original stated 15.0 (and
still above the raised 15.4).

This same value also decided the CSS minifier's target: `build.cssTarget`
defaults to `build.target` (`cssTarget: merged.cssTarget ?? merged.target` in
the same vite chunk), and LightningCSS is the active CSS minifier here
(`cssMinify` defaults to `true` for a non-`lib` client build, which routes to
the LightningCSS branch of `minifyCSS`, not the `"esbuild"` one) — so one
setting covers both the JS and the CSS target.

Vite also already runs a **real esbuild transpile pass** on every build,
independent of rolldown's own bundling (`vite:esbuild-transpile`, a
`renderChunk` hook calling `transformWithEsbuild` with `config.build.target` —
`resolveEsbuildTranspileOptions` in the same vite chunk). That pass downlevels
syntax the target doesn't support, or fails the build on syntax it cannot
downlevel — so pinning the target is not just documentation, it changes what
this pass actually enforces on every future build.

**Evidence the current `dist/` was already safe despite the wrong default,**
checked with esbuild 0.28.1 (already present via the `wrangler` devDependency)
by comparing each shipped JS asset transpiled at `target: "esnext"` against the
same asset transpiled at `target: "safari15"` (the original floor; the
comparison is at least as valid at the raised 15.4 floor, since 15.4 is a
strict superset of what 15 already supports), both minified to strip
formatting-only differences: every file — the main bundle, the MP3 encoder's
Web Worker chunk, the Capacitor web-bridge chunks, `registerSW.js`, the
generated `sw.js`, and the Workbox runtime chunk — produced byte-identical
output either way, meaning none of them contain JS syntax the safari15 target
would need to rewrite. Source and dist were also grepped directly for the
specific features `@babel/compat-data`'s `data/plugins.json` and MDN mark as
needing newer than 15.4 — class static initialization blocks (`ios: "16.4"`),
`Array.prototype.at`, `structuredClone`, `OffscreenCanvas` (iOS Safari support
starts at 17.0 per caniuse-lite's `data/features/offscreencanvas.js`),
`navigator.locks` (Web Locks) — and none are used anywhere in `src/` or
`dist/`. `MediaRecorder` (the one runtime API this app does depend on for
recording) needs only Safari 14.1 per caniuse-lite's
`data/features/mediarecorder.js`, well under the floor, and its iOS mp4/aac
codec negotiation is already feature-detected in `src/hooks/audio-io.ts`.

So nothing shipped broken. But nothing was pinned either — a future dependency
bump or a new class static block, `.at()` call, etc. would have silently
shipped untranspiled and broken below 16.4 with no build-time signal. Fixed:
`vite.config.ts`'s `build.target` is now explicitly
`["chrome111", "edge111", "firefox114", "safari15.4", "ios15.4"]` — the
`chrome`/`edge`/`firefox` entries carried over unchanged from Vite's own
current baseline (no evidence found that they need lowering; the Android floor
is conditioned everywhere on Android System WebView being kept up to date, and
Android WebView tracks current Chrome), with the Safari-family entries at the
app's **raised** iOS floor (see below for why it is 15.4, not the original
15.0). `tests/build-target-floor.test.ts` pins the config value and, once a
build exists, scans `dist/` for a class static block as a concrete regression
guard.

### CSS: `:has()` needs 15.4 — resolved by raising the floor to match (#1052)

`src/app/styles/o4/menus.css` and `src/app/styles/o4/sheets.css` (and
`src/app/styles/o4/motion.css`) use the `:has()` selector, which reaches
`dist/assets/*.css` today (verified directly: `grep -c ":has(" dist/assets/*.css`
found one occurrence, expanding to twelve rules across the menu/sheet
component — #1052 counts 13 across all three source files). Per caniuse-lite's
`data/features/css-has.js` (compiled from MDN/caniuse's compatibility data),
`:has()` support starts at **Safari 15.4 and iOS Safari 15.4** — iOS 15.0
through 15.3 do not support it. Against the app's _original_ stated 15.0
floor, that was a real gap.

**`build.target` could not have fixed this.** Verified directly: passing the
built CSS through LightningCSS (the library Vite's CSS minifier already uses)
with `targets` set to Safari 15 leaves the `:has()` selector completely
unchanged, with no warning. There is no fallback transform for a CSS
relational pseudo-class the way there is for JS syntax — an unsupported
`:has()` rule is simply dropped by the browser at parse time, silently, with
no signal from the build.

**Resolution (#1052, DRI decision, 2026-09-26):** #1052 gave the DRI two
options — (a) raise the documented iOS floor to 15.4, or (b) rewrite the 13
`:has()` sites to a class/attribute shape that stays compatible with 15.0. The
DRI's verbatim decision was **"Raise floor to 15.4 (Recommended)"**. No
`:has()` rule was rewritten; `vite.config.ts`'s `build.target` now reads
`safari15.4`/`ios15.4` to match, and this doc states the iOS floor as 15.4 (see
the top of this file). The 13 `:has()` sites are therefore no longer a gap
against the documented floor — they are exactly at it.

Native CSS nesting (`&`, Safari 17.2+ per caniuse-lite's
`data/features/css-nesting.js`) was also checked and is **not** present in the
built CSS (`grep -c "&" dist/assets/*.css` → 0), so it was never a second
instance of this class of gap.

### What this does not answer

Android's practical floor for a WebView-based feature (as opposed to the API
24 install floor) was not independently re-derived here — the existing draft
wording's "kept up to date" caveat was taken as the standing product decision
for that question, not re-litigated.

**Raising the floor here was originally a documentation and build-config
change only; the native project has since caught up.** One of the two places
#1052/#1017's "Done when" checklist named as not yet updated is now done:

- `ios/App/App.xcodeproj/project.pbxproj`'s `IPHONEOS_DEPLOYMENT_TARGET` was
  raised from `15.0` to `15.4` at all four occurrences (lines 241, 292, 309, 331) by #1055, which also raised `ios/App/CapApp-SPM/Package.swift`'s
  platform floor and updated `docs/native/README.md` and
  `docs/native/ios-credentials.md`. This is native-project work this doc's
  original change did not touch, and it has landed since.
- The Play listing, the App Store listing, and the web page / facilitator
  runbook (#248) still need the "iOS 15.4" wording pasted in once the full
  requirements statement is finished — not done here, since this file is
  still partial (see the top of this file).

Whether the "kept up to date" WebView caveat is sufficient is not decided by
this section. The other three questions are in the table at the top of this
file.

## Open question 4 — long takes (answered 2026-09-28: covered by the take cap)

**Question (from #1017):** "Until the take cap (#1005) lands, a single take
over about 20 minutes may fail on low-RAM phones (#1002 §3). Should the
listing say 'record in segments of under 20 minutes'?"

**Answer:** no separate listing warning. The DRI's 2026-09-28 comment on
#1017, verbatim: "Q4 (long takes) is covered by the take cap (#1005) and
recorded in #1142." Reading that as "the listing needs no length warning" is
this file's interpretation of the comment, which does not use those words. The question's own condition, "until the take cap lands", no longer
holds:

- `src/lib/audio/take-cap.ts` defines `TAKE_CAP_MS = 20 * 60_000` (20
  minutes) and `TAKE_WARN_MS = 15 * 60_000`, the DRI's 2026-09-25 decision on
  #1005, verbatim: "Warn at 15, seal at 20".
- `src/hooks/use-recorder.ts` (`startTick`, the 100 ms tick that runs only
  while recording) seals the live take once
  `takeCapStatus(elapsed, true).reached` is true, and logs one
  `"recorder-take-cap"` failure-log row recording that the take was cut. The
  seal itself writes nothing. The recorder sheet then commits the take through
  the same path an interruption uses (the `seal()` comment in
  `use-audio-session.ts`): `stop()`'s flush and whole-take decode, then the
  save.
- From 15 minutes, `src/components/take-cap-marker.tsx` shows a marker in the
  recorder (`takeCap.nearLimit`).

What the cap does **not** change: at 20 minutes the take goes through the
ordinary Stop save, which still decodes the whole take in memory
(`take-cap.ts`'s own docblock names that decode as the low-RAM risk). The cap
bounds the take at about 106 MB of PCM (arithmetic below). It does not prove
that a low-end phone can save that much. None of this has been run on a phone:
the 20-minute take on a low-end phone is a row on #974. The longer-term fix,
decoding in rolling chunks so Stop never holds a whole take, is #1093.

## Requirements statement (draft for the listings)

Every line cites the file it comes from. Where the tree cannot answer, the line
says so. Nothing in this section was measured on a phone.

### Platform floors (read from the tree)

| Platform         | Floor                                          | Source                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android          | Android 7.0 (API 24)                           | `android/variables.gradle` `minSdkVersion = 24`                                                                                                                                                                                         |
| Android target   | API 36 (`compileSdkVersion` is also 36)        | `android/variables.gradle` `targetSdkVersion = 36`                                                                                                                                                                                      |
| iPhone           | iOS 15.4; iPhone only                          | `ios/App/App.xcodeproj/project.pbxproj` `IPHONEOS_DEPLOYMENT_TARGET = 15.4` (four occurrences) and `TARGETED_DEVICE_FAMILY = 1` (both app-target configurations, #1289); `ios/App/CapApp-SPM/Package.swift` `platforms: [.iOS("15.4")]` |
| Native shell     | Capacitor 8.5.2                                | `package.json` (`@capacitor/core`, `@capacitor/android`, `@capacitor/ios`)                                                                                                                                                              |
| Web build target | Chrome 111, Edge 111, Firefox 114, Safari 15.4 | `vite.config.ts` `build.target`                                                                                                                                                                                                         |

There is no `ios/App/Podfile` in the tree; the iOS project uses Swift Package
Manager (`ios/App/CapApp-SPM/Package.swift`), so the Xcode setting and that file
are the two iOS floors.

**The iOS app is iPhone-only as of 1.0.1** (#1289, DRI pick 2026-10-01,
verbatim: "iPhone only for now (Recommended)"): `TARGETED_DEVICE_FAMILY = 1`
in both app-target configurations, and the `~ipad` orientation set is gone
from `ios/App/App/Info.plist`; `tests/ios-store-readiness.test.ts` pins both.
Whether an iPad runs it in iPhone-compatibility mode is an inference in #1289
and was not tried; no iPad has run any build of this app on record. The
listings, this file and the runbook therefore say "iPhone", not "iPhone and
iPad".

The Android floor is the install floor. The app runs inside Android System
WebView, so the standing wording is "kept up to date". The tree pins no minimum
WebView version, and this file does not derive one. The DRI's decision on
keeping API 24 (2026-09-28, quoted verbatim on #1017) was **"Keep Android 7
(Recommended)"**, and the listing reads "Android 7 or later".

### What the app needs from the device

| Need                               | Where the tree uses it                                                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microphone permission              | `android/app/src/main/AndroidManifest.xml` declares `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`; `ios/App/App/Info.plist` has `NSMicrophoneUsageDescription`                                                                                         |
| `getUserMedia` and `MediaRecorder` | `src/hooks/audio-io.ts` checks `navigator.mediaDevices?.getUserMedia` and picks a type with `MediaRecorder.isTypeSupported` (mp4/aac on iOS, webm/opus elsewhere)                                                                                   |
| IndexedDB                          | `src/lib/storage/db.ts`; every recording lives there                                                                                                                                                                                                |
| Web Worker                         | `src/hooks/mp3-codec.ts` (`new Worker`), the MP3 encoder                                                                                                                                                                                            |
| `navigator.storage`                | `estimate()` for the nearly-full marker (`src/lib/storage/pressure.ts`, `src/hooks/use-storage-pressure.ts`); `persist()` and `persisted()` for the not-persisted marker (`src/lib/storage/persistence.ts`, `src/hooks/use-storage-persistence.ts`) |
| Secure context (HTTPS)             | Inference: `getUserMedia` requires one (AGENTS.md, "Device testing"). The native apps serve from local files inside the shell                                                                                                                       |

The web page also needs a browser at or above the build target above. The
iOS row in that target is the same 15.4 as the native floor. The build target
is a build setting, not a test result. `MediaRecorder` needs Safari 14.1 and
`:has()` needs Safari 15.4 (caniuse-lite `data/features/mediarecorder.js` and
`css-has.js`, as cited under "Open question 1").

### Storage: derived estimates

Constants: `CANONICAL_SAMPLE_RATE = 44_100`, mono, 16-bit
(`src/lib/audio/format.ts`), and 64 kbps MP3 once a segment is Finished
(`src/types/audio.ts`, `src/hooks/share-flow.ts`).

- Recording in progress (PCM): 44 100 samples/s x 2 bytes x 60 s = 5 292 000
  bytes per minute, about **5.3 MB/min**. This agrees with AGENTS.md.
- Finished (MP3): 64 000 bits/s / 8 x 60 s = 480 000 bytes per minute, about
  **0.48 MB/min**.
- One take at the cap: `TAKE_CAP_MS = 20 * 60_000` (`src/lib/audio/take-cap.ts`),
  so 20 x 5.292 = about **106 MB** of PCM.
- The draft's long-book example, 5 hours (300 min, the figure from #1002 §4,
  not re-derived here): in progress 300 x 5.292 = about **1.6 GB**; Finished
  300 x 0.48 = about **144 MB**.

These are file-size arithmetic on the codec parameters. They ignore IndexedDB
overhead, the app itself, the browser cache and the space the OS keeps free. The
share step writes a file as well: Share Book builds a zip of chapter MP3s
(AGENTS.md), so plan on roughly another Finished-size copy while sharing
(inference; the temporary-file size is not measured).

### Draft wording

**Minimum** (records, edits and shares chapters)

- Android 7.0 or later, with Android System WebView kept up to date, or an
  iPhone with iOS 15.4 or later.
- A working microphone, and permission to record audio.
- Free storage: about 5 MB per minute while a segment is being worked on, and
  about 0.5 MB per minute once it is marked Finished (arithmetic above).
- RAM: **not stated.** See the open items.

**Recommended** (a long book, shared in one sitting)

- Free storage: at least twice the size of the finished book, plus room for the
  segments still in progress. For example, a 5-hour book is about 144 MB
  finished and up to about 1.6 GB while in progress. "Twice" is a derived
  margin for the share copy above, not a measured figure.
- Keep the app open while a book is being shared (this is guidance from #1017's
  draft; the tree does not enforce it).
- A take stops by itself at 20 minutes and then goes through the normal save
  (`take-cap.ts`, #1005). That save is the full-take decode the RAM item below
  still waits on, and no low-end phone has run it (#974). The listing adds no
  separate length warning (#1017 Q4, above). A passage longer than 20 minutes
  needs more than one recording; splitting it into segments is the normal way
  to work (facilitator runbook §3).
- RAM and processor class: **not stated.** See the open items.

**Web (PWA)**

- A current Chrome or Edge (111 or later), Firefox 114 or later, or Safari 15.4
  or later on iPhone, opened over HTTPS. Installing it to the home screen is
  recommended (#1017's draft). Samsung Internet is not in the build target; a
  Chromium-version mapping for it is not derived here. Nothing in the build
  target excludes Safari on an iPad, but no iPad run is on record, so this
  file does not claim one.
- The production address is <https://tcmobile.app>, connected 2026-10-02 as a
  Custom Domain on the `tc-mobile` Worker and serving 1.0.1;
  <https://tc-mobile.unfoldingword.workers.dev> keeps serving the same build
  with no redirect, because browser storage is per origin and recordings made
  at one address are not visible at the other (#1295, which also tracks
  putting the domain into `wrangler.jsonc` and deciding `www`).

### Still open

1. **RAM floor and the recommended RAM and processor tier.** #1017's draft
   figures (2 GB minimum, 4 GB recommended, a Unisoc T606 / Helio G85 class
   phone) are inferences from desktop experiments and published benchmarks in
   #1002. They wait on phone-check reports on #974 from at least one low-end
   Android phone and one older iPhone. They are not restated here.
2. **The slow-share line** ("close to an hour for Psalms on a very slow phone",
   #1017) is an extrapolation from #1002 strand C. It is not reproduced here
   until measured numbers exist.
3. **Minimum Android System WebView version.** Not pinned in the tree.
4. **Pasting the finished wording** into the Play listing and the App Store
   listing, each linking back to this file. The listings are outside the
   repository and are not checked from here. The two in-repo readers,
   `docs/tester-install.md` (the "iPhone (TestFlight)", "Android" and "Web
   browser" sections) and `docs/training/facilitator-runbook.md` (§1 step 2),
   carry the platform floors from this file as of 2026-10-02 and link back
   here; they repeat no RAM figure, per the top of this file.
5. **Existing docs that state the floors**: `docs/tester-install.md` and
   `docs/training/facilitator-runbook.md` say Android 7.0 with WebView kept up
   to date, and iPhone with iOS 15.4, which matches the table above.
   `docs/native/ios-credentials.md` says iOS 15.4, which matches.
