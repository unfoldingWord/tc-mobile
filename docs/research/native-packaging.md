# Native packaging — one codebase to Android and iPhone

**Status:** recommendation, for the go/no-go decision. Not yet decided.
**Date:** 2026-08-27 · **Author:** Seth (with Claude) · **For:** Tim, go/no-go
**Requested by:** Tim, 2026-08-27 call — "one code base that compiles into
Android and iPhone."

## The question

tC Mobile today is a Progressive Web App: React + TypeScript, built with Vite,
served from Cloudflare Workers, running in the phone's browser. It installs to
the home screen and records offline. The question Tim asked is how to get from
there to something we can put in the App Store and Play Store — one codebase,
both platforms — without throwing away what is already built.

The short answer: **wrap the existing app with Capacitor.** It keeps
essentially all of the code and adds a native shell around it. The two
alternatives (React Native, Flutter) are rewrites that would discard roughly
half the codebase or all of it, and neither fits the October deadline.

## Why it matters now

The app already runs on both platforms as an installable PWA. So "compile to
Android and iPhone" has a zeroth option — ship the PWA as-is — and it is worth
being honest about what that does and does not give us, because it decides how
urgent the native work is.

The one thing the PWA cannot guarantee is **storage durability**. iOS evicts a
web app's stored data under storage pressure. For a translator whose phone holds
the only copy of a chapter they just recorded (#24), that is a data-loss risk we
cannot accept in the field. A native app's storage is not evicted the same way.
That single property is the strongest reason to move off the bare PWA — more
than the app-store listing itself.

## The paths

| Path                 | What it is                                                         | Fits October? |
| -------------------- | ------------------------------------------------------------------ | ------------- |
| **0 — PWA as-is**    | Add-to-home-screen. No store, no shell.                            | Works today   |
| **A — Capacitor** ✅ | The web app runs in a native WebView; native features via plugins. | **Yes**       |
| **B — React Native** | Native UI, rewritten. Shared logic ports; UI does not.             | No            |
| **C — Flutter**      | Full rewrite in Dart. No TypeScript reuse.                         | No            |

**Path 0 (PWA as-is)** costs almost nothing and is the right call for this
weekend's initial testing — send the link, watch people use it. It is not the
production answer: no store distribution, no reliable background recording, and
the storage-eviction risk above.

**Path A (Capacitor) is the recommendation.** The existing app runs unchanged
inside a native WebView (WKWebView on iOS, the system WebView on Android).
Anything the web platform cannot do — durable storage, reliable background
audio, the OS share sheet, filesystem access — comes through Capacitor plugins,
which expose a JavaScript API backed by native code. We keep the entire
React/TypeScript codebase, the audio engine, the three pivot screens, the
styling system, and the UI fine-tunes we are landing this week. We add a native
project shell and wire the plugins we need.

**Path B (React Native)** gives genuinely native UI widgets, but the UI layer
would be rewritten from scratch — React Native has no DOM and no CSS, so every
screen, the styling system, and the canvas waveform get rebuilt in native
primitives. The pure logic (the audio core, the storage logic) ports directly;
the UI does not. It discards the design work and cannot land production-ready by
end of September.

**Path C (Flutter)** is a full rewrite in Dart. Zero reuse, and against Tim's
"TypeScript-ish" steer. Off the table.

## How much is reusable

The architecture was built for exactly this — browser APIs are concentrated in a
thin boundary, and the audio and storage cores are pure TypeScript that already
run in plain Node (that is what makes them unit-testable without a browser).
Measured against the current tree (8,651 lines of `src`, tests excluded):

| Under Capacitor                                                                     |    Lines | Reuse                             |
| ----------------------------------------------------------------------------------- | -------: | --------------------------------- |
| UI — components, app shell, CSS                                                     |    4,038 | as-is                             |
| Core — `lib/` + `types/` (runtime DOM-free, confirmed)                              |    2,311 | as-is                             |
| Most hooks                                                                          |   ~1,600 | as-is                             |
| **Boundary rework** — audio I/O (329) + storage backing (292) + PWA/SW config (~86) | **~700** | swapped behind the same interface |

**About 92% reuses untouched. About 8% is interface-preserving rework** at the
platform boundary — the audio I/O hook, the storage layer's durability backing,
and the service-worker/PWA config. That 8% is swapped, not deleted: the callers
above it do not change. On top of that is net-new native scaffolding (Capacitor
config, the iOS and Android project shells, plugin wiring, signing) — additive
cost, not a rewrite.

For contrast, React Native would rewrite the UI layer — about **half** the
codebase — plus the canvas waveform and the boundary hooks.

The automated test suite (2,646 lines) largely runs unchanged, because the
core it covers has no browser dependency. That coverage carries over to the
native build for free.

## Cost and the one real risk

Effort ranges below are estimates, not measured, and assume the current team.

- **Shell, build, and CI signing:** ~2–4 days.
- **Background / interruption audio in the native WebView — the swing factor.**
  If the current recording path works inside WKWebView (likely, since it already
  works in iOS Safari and the WebKit quirks are already handled), this is days of
  glue. If reliable background capture needs a **native audio plugin**, it is
  1–3 weeks. This is the one genuine unknown and the thing to spike before
  committing.
- **Storage durability** (native backing, or `navigator.storage.persist()`):
  ~days.
- **Share / export:** overlaps the planned B7 work, not additional.
- **Store review:** calendar time, little engineering. **Enrollment is
  already done** — active Apple App Store and Google Play accounts exist, so
  only app review remains.

The reason Capacitor is the _only_ option that fits October is timing: the UI is
still being tuned this week from Tim's review. A rewrite cannot absorb a moving
UI and still ship a production build by the last week of September. Capacitor
lets the UI keep moving right up to the deadline, because the UI is the same web
app either way.

## Recommendation

1. **This weekend:** ship the PWA link as-is for initial testing (Path 0). No
   work required.
2. **Before the go/no-go:** spike the one unknown — put the current recorder
   inside a Capacitor WebView on a real iPhone and an Android device, and test
   background capture and an interruption (incoming call). That result decides
   whether the audio boundary is days or weeks, which is the largest input to
   the go/no-go cost.
3. **If go:** take Path A. Keep the codebase, add the native shell, swap the
   ~8% boundary, wire durable storage first (it is the field data-loss risk).

## Resolved with Tim (2026-08-27)

- **Store distribution is the intent, and enrollment is not a blocker** — active
  Apple App Store and Google Play accounts already exist. This confirms the move
  past Path 0 to a real native build, and takes account setup off the critical
  path.
- **No native UI widgets required for now.** This removes the only argument that
  would have favoured Path B (React Native) over A — the case for Capacitor is
  now unqualified.

With both settled, the single remaining unknown before the go/no-go is the
audio-boundary spike in §Recommendation, step 2.
