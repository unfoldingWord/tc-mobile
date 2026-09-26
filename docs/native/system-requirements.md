# System requirements — status and evidence

**Status: partial.** This is the single source of truth #1017 calls for, but
it is not yet the finished requirements statement for the store listings and
web page. Only #1017's open question 1 (below) is answered here. The other
open questions — the RAM floor, whether Android 7 is worth keeping, the long-take
guidance — are **not** answered in this file yet: the RAM tiers in particular
stay blocked on real phone reports landing on #974 (#1002 §6), and are
deliberately not restated here until they are. Read #1017 and #1002 for the
full picture; this file will grow into the final wording once every open
question is closed.

## Open question 1 — build target vs. the device floor (answered 2026-09-26)

**Question (from #1017):** does Vite's `build.target` (plus the esbuild/
LightningCSS targets it derives, the PWA plugin, Workbox's `sw.js` output, the
MP3 Web Worker chunk, and Capacitor's WebView floor) produce output that runs
on the stated iOS 15.0 floor (`ios/App/App.xcodeproj/project.pbxproj`,
`IPHONEOS_DEPLOYMENT_TARGET = 15.0`) and the stated Android floor
(`android/variables.gradle`, `minSdkVersion = 24`, Android 7.0)?

**Short answer:** the JS side was a latent risk, now closed by pinning
`vite.config.ts`'s `build.target` explicitly. The CSS side has one real,
already-shipping gap that pinning `build.target` cannot fix.

### JS: latent, now pinned

Vite 8.3.0 (the version pinned in `package.json`), when `build.target` is left
unset, resolves it to the string `"baseline-widely-available"` — a rolling
snapshot bumped on every Vite major release
(`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET`,
`node_modules/vite/dist/node/chunks/node.js`) that at this pinned version is
`["chrome111","edge111","firefox114","safari16.4","ios16.4"]`. `vite.config.ts`
set no `build.target` before this change, so the app was building against that
default — a Safari/iOS floor of 16.4, above the app's stated 15.0.

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
same asset transpiled at `target: "safari15"`, both minified to strip
formatting-only differences: every file — the main bundle, the MP3 encoder's
Web Worker chunk, the Capacitor web-bridge chunks, `registerSW.js`, the
generated `sw.js`, and the Workbox runtime chunk — produced byte-identical
output either way, meaning none of them contain JS syntax the safari15 target
would need to rewrite. Source and dist were also grepped directly for the
specific features `@babel/compat-data`'s `data/plugins.json` and MDN mark as
needing newer than iOS 15 — class static initialization blocks (`ios: "16.4"`),
`Array.prototype.at`, `structuredClone`, `OffscreenCanvas` (iOS Safari support
starts at 17.0 per caniuse-lite's `data/features/offscreencanvas.js`),
`navigator.locks` (Web Locks) — and none are used anywhere in `src/` or
`dist/`. `MediaRecorder` (the one runtime API this app does depend on for
recording) needs only Safari 14.1 per caniuse-lite's
`data/features/mediarecorder.js`, well under the floor, and its iOS mp4/aac
codec negotiation is already feature-detected in `src/hooks/audio-io.ts`.

So nothing shipped broken. But nothing was pinned either — a future dependency
bump or a new class static block, `.at()` call, etc. would have silently
shipped untranspiled and broken on iOS 15–16.3 with no build-time signal. Fixed
in this PR: `vite.config.ts`'s `build.target` is now explicitly
`["chrome111", "edge111", "firefox114", "safari15", "ios15"]` — the
`chrome`/`edge`/`firefox` entries carried over unchanged from Vite's own
current baseline (no evidence found that they need lowering; the Android floor
is conditioned everywhere on Android System WebView being kept up to date, and
Android WebView tracks current Chrome), with only the Safari-family entries
corrected to the app's actual iOS floor. `tests/build-target-floor.test.ts`
pins the config value and, once a build exists, scans `dist/` for a class
static block as a concrete regression guard.

### CSS: `:has()` already ships below Safari 15.4 — a real, separate gap

`src/app/styles/o4/menus.css` and `src/app/styles/o4/sheets.css` (and
`src/app/styles/o4/motion.css`) use the `:has()` selector, which reaches
`dist/assets/*.css` today (verified directly: `grep -c ":has(" dist/assets/*.css`
found one occurrence, expanding to twelve rules across the menu/sheet
component). Per caniuse-lite's `data/features/css-has.js` (compiled from
MDN/caniuse's compatibility data), `:has()` support starts at **Safari 15.4
and iOS Safari 15.4** — iOS 15.0 through 15.3 do not support it. That is a real
gap against the stated 15.0 floor, and it predates this PR.

**`build.target` cannot fix this.** Verified directly: passing the built CSS
through LightningCSS (the library Vite's CSS minifier already uses) with
`targets` set to Safari 15 leaves the `:has()` selector completely unchanged,
with no warning. There is no fallback transform for a CSS relational
pseudo-class the way there is for JS syntax — an unsupported `:has()` rule is
simply dropped by the browser at parse time, silently, with no signal from the
build. Closing this gap needs one of: an `@supports selector(:has(...))`
guard around the affected rules, a JS-driven fallback for the same states, or
raising the documented iOS floor to 15.4. That is CSS/UI work in the O4 design
surfaces this PR does not touch (out of scope for a `vite.config.ts` /
`build.target` change) — recorded here and on the #1017 comment as a residual
for whoever owns that CSS next.

Native CSS nesting (`&`, Safari 17.2+ per caniuse-lite's
`data/features/css-nesting.js`) was also checked and is **not** present in the
built CSS (`grep -c "&" dist/assets/*.css` → 0), so it is not a second
instance of this same class of gap today.

### What this does not answer

Android's practical floor for a WebView-based feature (as opposed to the API
24 install floor) was not independently re-derived here — the existing draft
wording's "kept up to date" caveat was taken as the standing product decision
for that question, not re-litigated. Whether that caveat is sufficient, and the
other three open questions in #1017, are unchanged by this section.
