# Native packaging — one codebase to Android and iPhone

**Status:** recommendation + argued counter-case (#86), for the go/no-go
decision. Not yet decided.
**Date:** 2026-08-27 · **Author:** the DRI (with Claude) · **For:** the
requirements owner, go/no-go
**Requested by:** the requirements owner, 2026-08-27: one codebase that compiles
to Android and iPhone.

## The question

tC Mobile today is a Progressive Web App: React + TypeScript, built with Vite,
served from Cloudflare Workers, running in the phone's browser. It installs to
the home screen and records offline. The question the requirements owner asked
is how to get from there to something we can put in the App Store and Play
Store — one codebase,
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

**Path C (Flutter)** is a full rewrite in Dart. Zero reuse, and against the
requirements owner's steer toward TypeScript. Off the table.

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

Effort ranges below are estimates, not measured.

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
- **Store review:** calendar time, little engineering.

The reason Capacitor is the _only_ option that fits October is timing: the UI is
still being tuned this week from the requirements owner's review. A rewrite
cannot absorb a moving UI and still ship a production build by the last week of
September. Capacitor
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

## Resolved with the requirements owner (2026-08-27)

- **Store distribution is the intent.** This confirms the move past Path 0 to a
  real native build.
- **No native UI widgets required for now.** This removes the only argument that
  would have favoured Path B (React Native) over A — the case for Capacitor is
  now unqualified.

With both settled, the single remaining unknown before the go/no-go is the
audio-boundary spike in §Recommendation, step 2.

## The counter-case — why we should NOT use Capacitor

A recommendation with no argued opposition is a claim with its debt unpaid
(#86). This section is the strongest honest case _against_ Capacitor — enough
that a reasonable engineer could choose React Native or fully-native instead.
It is deliberately adversarial; §"When the counter-case should flip the
decision" says when to actually act on it.

**C1 — The audio boundary is the whole product, and it is exactly what
Capacitor does not solve for free.** The reuse pitch is "keep 92%, swap ~8% at
the boundary." But that 8% — reliable background capture, interruption
recovery, durable storage — _is_ the hard, field-critical part; the 92% is
mostly UI that is cheap to rebuild. If the spike shows background capture needs
a **native audio plugin** (plausible: WKWebView's MediaRecorder is not a
guaranteed background recorder), then we are writing and maintaining native
audio code _anyway_ — but through a JS↔native bridge, which is strictly harder
to debug and reason about than owning the audio natively. Capacitor's central
promise evaporates precisely where this app lives or dies.

**C2 — WKWebView is not Safari, and Safari is the only surface we have
validated.** Every on-device pass to date (iOS 27 beta, backgrounding,
interruption) ran in **Safari**. A Capacitor app runs in **WKWebView**, which
differs in storage eviction, media-capture permissions, autoplay/gesture
gating, and background lifecycle. Shipping Capacitor means the one surface we
have field evidence for is _not_ the one users run. We would be re-validating
from close to zero — the same iOS risk AGENTS.md already calls the platform
most likely to break here.

**C3 — App Store §4.2 "minimum functionality" risk.** Apple has historically
rejected thin WebView wrappers. A recorder is more than a wrapper, but the
review risk is real, it is discovered late (at submission, against an October
deadline), and mitigating it can mean adding native features solely to satisfy
review — cost that lands when there is no time.

**C4 — Performance ceiling on the target hardware.** The users are on
entry-level Android. A WebView + our ~500 KB JS bundle + a canvas waveform +
main-thread MP3 encode (open item #1, still unmoved) is a stack that can jank
where native would not. The onion architecture makes the _code_ portable; it
does nothing for the runtime cost of running a browser inside an app on a cheap
phone.

**C5 — Bridge and plugin risk is a standing tax.** Capacitor adds a dependency
whose plugins can lag OS releases, get abandoned, or need forking; every
native capability crosses a JS↔native seam that is harder to debug than either
side alone; and a Capacitor major-version upgrade is its own migration each
time iOS/Android shift under it. This is recurring maintenance the team would
carry indefinitely.

**C6 — The UX ceiling, for users who read least.** A WebView can feel subtly
non-native — scroll physics, keyboard, gestures, haptics, back-button. For a
tool aimed at people who may not read, _feel_ is much of the usability budget,
and it is the hardest thing to fix from inside a WebView.

**C7 — Now is the cheapest a rewrite will ever be, and the exit cost only
grows.** The app is ~8.6k lines and pre-alpha. If we adopt Capacitor and it
does not hold, migrating _off_ it to React Native or native later is far more
expensive than choosing RN now, against a larger codebase with field data and
users. "Reuse 92%" is most seductive exactly when the rewrite is cheapest —
which is a reason to weigh RN seriously today, not a reason to defer it.

## When the counter-case should flip the decision

Capacitor stays the recommendation **unless** the pre-go/no-go spike or the
requirements move one of these:

- **The audio spike needs a native plugin for reliable background capture.**
  This is the decisive one. If we are maintaining native audio regardless
  (C1), the reuse argument no longer dominates, and building where audio is
  first-class (RN with a native module, or fully native) becomes the honest
  choice. **Run the spike before deciding.**
- **The field bar rejects WebView feel or entry-level-Android performance**
  (C4/C6) once measured on a real cheap device — not assumed, measured.
- **This is a long-lived, invested product, not a ship-and-maintain-minimally
  tool.** A multi-year commitment amortizes a native rewrite; a
  get-it-to-October-and-iterate posture favors Capacitor's speed.

If none of these fires — the spike shows the existing WebView audio path holds,
performance is acceptable on target hardware, and the near-term goal is October
— Capacitor remains correct, because it is the only path that ships a moving UI
on time. The counter-case is not a prediction that Capacitor fails; it is the
set of conditions under which we would be wrong to have chosen it, named in
advance so the spike is judged against them.
