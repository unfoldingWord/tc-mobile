# Design pass: the history-stack model for system-Back (#452)

**Status:** Draft design, awaiting DRI review · **Date:** 2026-09-17 ·
**Tracking:** [#452](https://github.com/unfoldingWord/tc-mobile/issues/452),
supersedes [#430](https://github.com/unfoldingWord/tc-mobile/pull/430)
(parked as a draft at `36e10fd`, never merged)

> **This document is exploration/planning output, not a fix.** Nothing in
> `src/` changed to produce it — every claim below is a static read of
> `develop` as of 2026-09-17, `gh pr diff 430`, and issue #452's own thread.
> It was produced by a read-only multi-agent design pass (one grounding read
> of the six-round corpus, three independent models, one adversarial attack
> per model, one synthesis) and then read and corrected by the coordinator.
> **Android system Back has never been tested on a device in this repo, on
> any branch, at any point in this project's history.** Nothing below implies
> otherwise. Where a claim is inference rather than an observation, it is
> labeled inference explicitly.

## Why this document exists

`develop` today has **none** of #430's per-overlay push/consume machinery.
Direct reads of `src/app/App.tsx` and `src/lib/nav/navigation.ts` in this
worktree confirm they are identical to the diff's pre-image: no
`dismissingOverlay`, `outstandingBacks`, `reconcilePopState`,
`HistoryPushOutcome`, `queuedPushAction`, or per-screen
`onOverlayOpen`/`onOverlayClose` wiring exists on `develop`. The only merged
overlay-awareness is recorder-only (`overlayBlocksClose`/`overlayDismissal`,
`src/lib/nav/navigation.ts:147-171`), and it already carries a live bug: it
is called with `erase.erasing` — a `useState` value, one render stale — not a
live ref (`src/components/recorder.tsx:2014,2022,2203,2588,3704`, all
confirmed by direct read). Every other overlay in the app — Books' hamburger
menu, New Book, the book ≡ menu and its rename mode, the delete confirm;
Segments' chapter ≡ menu and rename, the row overflow menu, the erase
confirm — pushes **no history entry at all**. A system Back while any of them
is open falls straight through `popAction`'s screen-level routing
(`to-books` / `exit-app`), which is exactly the gap #374 and #393 describe.

PR #430 tried to close that gap by threading refs and counters through
`App.tsx`'s `onPopState` switch, incrementally, across six review rounds
(Frank + George, this repo's two required reviewers). Every round closed the
finding it was given and opened a new one adjacent to it — round 4's fix
produced round 5's P1; round 5's fix (scoped under an explicit DRI hard-stop
rule) produced round 6's P1. The DRI parked the branch on 2026-09-17 rather
than run a seventh round, and filed #452 for a **deliberate model
replacement** instead of another targeted patch. This document is that
replacement.

Three candidate models were drafted and each was attacked against the full
six-round finding corpus (31 findings as extracted from the round triages,
Frank + George, R1–R6) plus
fresh review of the current codebase. This document picks one, grafts in the
two ideas from the others that measurably improve it without reopening a
reconciliation problem, and closes out every surviving attack finding — by a
design change where one exists, by an explicit decision where the risk is
accepted, or by naming it as an open question for the dev lead or the
requirements owner.

## Method

Each model was scored on four axes:

- **(a)** how many root-cause _classes_ it removes by construction, versus by
  a guard that has to be gotten right at every call site;
- **(b)** the severity of what survived its own attack (a fresh Frank/George
  pass, `verdict` + per-finding replay + new findings);
- **(c)** the size and risk of the migration, given under two weeks to the
  2026-09-30 production gate and under three to the first-week-of-October
  training on Android phones;
- **(d)** how much of the mechanism is Node-testable in `src/lib/nav`, the
  only layer this repo can red-first test at all — there is no jsdom or
  renderer here (`AGENTS.md`), so `App.tsx`, `books-screen.tsx`,
  `segments-screen.tsx` and `recorder.tsx`'s wiring code stays review-only no
  matter which model wins.

I re-verified, myself, in this worktree, the load-bearing facts the scoring
turns on, rather than trusting the models' own citations at face value:
`src/lib/nav/navigation.ts` in full (matches the ground truth line-for-line —
`popAction` at 107-134, `overlayBlocksClose`/`overlayDismissal` at 147-171,
`backEffectFor` at 40-49, `navDirection` at 62-66); `src/app/App.tsx:50-104`
and `:285-386` (confirms `nextIndex` is a global monotonic counter reset only
at mount, line 71/78/88; confirms the single `popstate` listener's exact
routing, including that `navIndex.current` is updated unconditionally at line
302 _before_ the switch, which matters for one of the findings below);
`src/hooks/use-books.ts` and `src/hooks/use-erase-segment.ts` (neither
exports an `isDeleting()`/`isErasing()`-style live-ref accessor on
`develop` — that pattern exists only inside the unmerged PR); `MainActivity.java`
(`public class MainActivity extends BridgeActivity {}`, no override);
`package.json` (`@capacitor/android`, `-core`, `-filesystem`, `-ios`,
`-share`, `-cli` present; **`@capacitor/app` absent**); `use-audio-session.ts:711-713`
(the `pagehide` → `leave()` loss path is still live and unconditional); and
`gh pr diff 430` directly, to confirm `dismissingOverlay` is in fact OR'd
into `committing` at the `popAction` call site (`committing.current ||
dismissingOverlay.current`) and that `isErasing()` is a live-ref accessor
added only in that unmerged branch (`erase.isErasing = () =>
erasingRef.current`). Every one of these matched the ground truth exactly.
On that basis I treat the ground truth's remaining file:line citations as
reliable and do not re-derive each one from scratch below; new claims this
document adds are marked with their own verification.

I additionally read `gh issue view 452` directly. Its one comment
(2026-09-17, the DRI) adds two findings from #430's parked round 6 that
predate this synthesis pass and are folded in below (a spurious
`consumeHistoryEntry()` firing from an unstable-dependency cleanup effect,
and a `leave()`-before-outcome-check ordering bug) and poses a standing,
repo-wide question this document is expected to answer: _should any effect
that gates history-stack bookkeeping depend on a hook-returned object whose
reference stability isn't guaranteed?_ See Amendment E.

## The three models, and where they land

|                                              | Sentinel-per-depth + layer stack                                                                                                                 | Entry-per-layer (state-derived)                                                                                                                | Platform-first (two transports)                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core move**                                | Overlays never touch `history` at all; only 3 real screen transitions do                                                                         | `history.state` _is_ the screen (a full `Frame`); one `commit()` function is the sole issuer                                                   | One pure `decideBack()`; DOM `popstate` and a Capacitor `backButton` listener are two interchangeable transports into it                                   |
| **(a) root causes removed by construction**  | Removes the whole overlay-push-race class (closes 5 of the 6 "carried" R1 findings outright)                                                     | Removes the _live-state-re-read-at-landing-time_ root cause directly — the one the retrospective in #452 itself names as the six-round pattern | Narrows issuer count from ~5 to 3, but its own weakness list admits the remaining arbitration is "asserted sufficient, not proven"                         |
| **(b) severity of what survived attack**     | 1 new P1 (an unmount edge case — narrow), 3 P2, 1 P3                                                                                             | 1 new P1 (reload/bootstrap, verified-in-code), 4 P2, 3 P3                                                                                      | 1 new P1, 3 P2 — and its attack found the design **re-exposes the exact single-boolean-vs-count shape R3-G-P2-2 already disproved**, live, at its own core |
| **(c) migration size, <2 weeks to the gate** | Smallest: five small PRs (see the PR split), overlays converted one screen at a time, recorder's existing mechanism left mostly alone in phase 1 | Largest: the shape of every history entry changes; needs a new bootstrap/reload story before it's safe                                         | Adds a native dependency (`@capacitor/app`) and a second listener — real scope, sequenced last, but doesn't reduce the PWA-leg's own risk                  |
| **(d) Node-testable in `lib/nav`**           | Strong — `layer-stack.ts` + `history-stack.ts` + extended `navigation.ts`, each with its own decision table                                      | Strongest — a single decision-table test enumerates all 30 corpus findings by id                                                               | Solid core table, but the highest-risk mechanism (issuer arbitration) has **no** pure function at all, by the attack's own finding                         |

**Decision: base = Sentinel-per-depth + in-memory layer stack ("Model 1").**

The other two are not wrong, and each contributes something real (below),
but on the method's own terms Model 1 wins three of four axes and loses the
fourth only by a margin that matters less than (b) and (c) do with three
weeks on the clock. The deciding factors, in order:

1. **It is the only one of the three whose attack did not find that the
   design re-exposes a defect shape this repo's own review chain already
   spent a round disproving.** Model 3's attack found exactly that (its
   travel-in-flight arbitration is "the exact representation
   R3-G-P2-2 already proved insufficient" — the attack's own words). A
   design meant to close #452 cannot start from a mechanism whose own attack
   says it reopens #452's namesake defect.
2. **Its migration is the smallest and the most reversible.** Overlays
   convert to `Layer`s one screen at a time (Books, then Segments), and the
   recorder's two overlays can be left exactly as they are — already
   correct, already merged, not in the defect corpus — for phase 1. Given
   the production gate is 2026-09-30 and the training is the first week of
   October, a design whose riskiest PR (the core adapter swap) can land and
   bake for days before any user-visible overlay behavior changes is worth
   more than a more elegant but larger single swap.
3. **Removing overlay-push-to-history by construction is the direct fix for
   the actual open requirement** (#374 / #393), not an indirect consequence
   of a broader architectural move. Model 2's `Frame`-in-`history.state`
   design is more thorough about the _general_ live-state-vs-snapshot class,
   but that generality is also why its attack found a new, verified-in-code
   P1 (reload/bootstrap) that Model 1 structurally cannot have — Model 1
   never puts the rendered screen in `history.state`, only a bare monotonic
   index, so a stale entry left below a reload point cannot cause a stale
   _screen_ to render (see the reload analysis in Amendment B below, which
   traces through exactly this and confirms Model 1's version of the same
   hazard is real but far less severe).

Two ideas from the other two models are grafted in below, each scoped
narrowly enough that it does not reopen a reconciliation problem:

- **From Model 2:** the single-counted-issuer discipline (`commit()`,
  `pending`/`queued`), applied **only** to the two real screen-level
  `history.back()` issuers that survive in Model 1 (`goBack`, the
  recorder's commit-close exit) — not to overlays, which never touch
  history at all under Model 1's invariant 1. This closes a real gap in
  Model 1's own design (its "handled-by-an-invariant" disposition for
  R1-F-carried-5/R1-G-P2-2 turned out to be aspirational, not backed by a
  pure function — see Amendment A) and, because the state space is
  provably two issuers rather than three or five, it does not carry Model
  2's or Model 3's unresolved arbitration risk.
- **From Model 3:** the observation that Share Chapter/Share Book's MP3
  build is a genuine, previously-unexamined busy overlay state, and the
  Android-hardware-Back question, kept as an explicitly deferred, separately
  sequenced amendment rather than folded into the core (see Amendments D and
  F).

## The chosen design

### Invariants

1. **Overlay open/close never calls `window.history.back()` or
   `pushState()`.** The DOM history depth changes only for the three real
   screen transitions (Books → Segments → Recorder), never for a menu,
   dialog, confirm, or rename mode. Enforced by a lint rule banning
   `history.*` calls outside `hooks/use-nav-stack.ts`, and by a Node test
   that drives a `Layer` through open/close and asserts no history-mutating
   spy fired.
2. **Exactly one history entry exists per screen depth** (0 = Books, 1 =
   Segments, 2 = Recorder) — never one per overlay.
3. **A `popstate` is routed top-down through exactly two ordered stages,
   never merged:** (1) the two global full-screen traps, `recovering` then
   `databasePanel`, unchanged from `develop`'s merged, working precedence
   (`popAction`, `navigation.ts:107-134`) and unrelated to overlays; (2) if
   no global trap and no screen transition is in flight, the screen-scoped
   `layerStack`'s **top** entry only. A layer below the top is never asked
   to dismiss.
4. **`Layer.busy()` is backed by a ref flipped synchronously at the start of
   the guarded write, never a `useState` value read at render time.** This
   is the generalized form of the fix `develop` is missing for the
   recorder's own erase confirm (`recorder.tsx:2014` reads `erase.erasing`,
   the state, not a live ref) and the fix round 2 of the parked PR built for
   Books/Segments but never wired into the recorder.
5. **A screen-transition request (`openChapter`, `openRecorder`, `goBack`,
   the recorder's commit-close) is one function that guards, mutates, and
   pushes/pops as a single call** — never a caller that mutates UI state
   unconditionally and separately checks a push/pop outcome. This is the
   literal fix for the parked branch's round-5 P1 (a refuse that guarded the
   history side without gating the UI-state side it existed to protect).
6. **Layer registration is imperative, colocated in the same event handler
   that flips the overlay's own boolean — never inside a `useEffect` or
   `useLayoutEffect` keyed on that boolean or on any hook-returned
   callback.** This structurally removes the parked branch's round-6 P1 (a
   cleanup effect's dependency array went unstable because
   `useChapterShare()`/`useBookShare()` return a fresh object literal every
   render, and the effect's cleanup fired a real, counted `history.back()`
   on every ~60 ms playback tick while a menu was open). There is no
   dependency array in this path to go unstable, because there is no effect.
7. **The recorder's commit-close path sets `transitionInFlight = true`
   synchronously, in the same tick it decides to proceed, reusing the same
   guard every other screen pop uses** — not a separate `committing` boolean
   OR'd into an unrelated overlay-absorb latch. This is the direct fix for
   the parked branch's round-5/round-6 P2 (`dismissingOverlay` OR'd into
   `committing`, confirmed present in `gh pr diff 430` at the `popAction`
   call site: `committing.current || dismissingOverlay.current`), which let
   a single overlay dismissal absorb a second, genuinely new system Back —
   three Backs needed to leave instead of two.
8. **A queued screen-transition request holds at most one identified
   intent** (latest-wins, not a fungible count), re-validated against
   current state at drain time, checked _before_ it is applied — never
   applied then corrected. This closes the parked branch's round-4 ordering
   bug (drain-before-check) and its round-5 P2-3 identity bug (a shared
   integer counter that could cancel the wrong queued intent) together, by
   construction: there is only ever one identified thing to cancel or drain.
9. **`navIndex` is always stamped from the app's own current physical depth,
   never from a separately-incrementing counter.** `develop`'s `nextIndex`
   (`App.tsx:71`, confirmed live: `++nextIndex.current` at line 78, reset
   only at mount, line 88) is the exact defect the parked branch's round-3
   Frank finding fixed and this design keeps that fix.
10. _(Superseded by Amendment A below — see there for why the originally
    proposed numeric-displacement clamp is dropped rather than built.)_

### Mechanism

One hook, `hooks/use-nav-stack.ts`, owns three refs — `navIndex`,
`nextIndex` (renamed conceptually but kept as the depth-stamping source per
invariant 9), and a per-screen `layerStack: Layer[]` — and the single
`window.popstate` listener. `interface Layer { id: string; busy(): boolean;
dismiss(): void }`. Opening an overlay calls `pushLayer(layer)` directly from
the same click handler that sets the overlay's own `open` state; closing —
by the overlay's own Close/Cancel/scrim, or by a Back landing on it — calls
`popLayer(id)`, also directly, never from an effect.

On a `popstate`: check `recovering`, then `databasePanel` (unchanged,
merged, correct); then check whether a screen transition is in flight
(Amendment A's shared guard); then, **only when the gesture is Back** — a
non-empty layer stack never shadows Forward or "same" (superseded by #492
round 1; see below) — call `routeBackToLayer(layerStack)`: if the top layer
exists, either `dismiss()` it (not busy) or refuse (busy). A `popstate` has
ALREADY popped the screen-depth entry before this decision runs, so **both**
outcomes re-arm it (push a fresh protective entry) — `dismiss` additionally
calls `dismiss()` on the named layer; `refused-busy` re-arms only. `popAction`
itself never touches history: it names one of two string tags,
`"rearm-layer-dismiss"` / `"rearm-layer-busy"` (not the object shape
originally specified here — see "Pure core" below), and the adapter performs
the re-arm/dismiss the tag names. Only if the layer stack is empty, or the
gesture is Forward/"same", does the `popstate` fall through to Forward's own
cancelling handling or `backEffectFor(screen)` (`to-books` / `exit-app` /
`commit-close-recorder`), the only path that changes `navIndex`.

> **Superseded by #492 round 1 (2026-09-18):** the two paragraphs above
> originally specified `routeBackToLayer` itself deciding history and a
> `popAction` case of `{kind:'layer', result}` that consumed "no screen-depth
> index change either way." Implementation (PR #492) found that framing
> backwards: a `popstate` always pops the screen-depth entry before `popAction`
> runs, regardless of whether a layer absorbs the gesture, so BOTH the
> `"dismiss"` and `"refused-busy"` outcomes must re-arm it, not neither. The
> object-shaped `popAction` result was also replaced with two string tags so
> the obligation is encoded in the type `App.tsx`'s existing string `switch`
> already consumes, rather than left to prose a reader could miss (the earlier
> object shape's own docblock taught the wrong contract once — George R1
> P2-1). `routeBackToLayer` itself is unchanged: it still returns the
> three-way `{kind:'empty'|'refused-busy'|'dismiss', layerId?}` object below;
> only `popAction`'s consumption of that result changed shape.

### Pure core

- `src/lib/nav/layer-stack.ts` (new) — `Layer`, `LayerStack`, `topLayer()`,
  `routeBackToLayer(stack): {kind:'empty'|'refused-busy'|'dismiss', layerId?}`.
  Pure decision only; the adapter performs the dismiss/refuse the result
  names. Tested: empty stack, single non-busy, single busy, two-layer
  top-only-dismissed (mutated to `[0]` instead of `[length-1]` to prove the
  test would catch it).
- `src/lib/nav/navigation.ts` (extended, not replaced) —
  `screenFor`/`backEffectFor`/`navDirection` kept **verbatim**; `popAction`
  regains a signature of `(direction, screen, transitionInFlight, recovering,
databasePanel, layerStack)`, with `rearm-during-commit` renamed
  `rearm-transition-busy` (invariant 7) and, **superseded by #492 round 1**,
  two new string tags — `"rearm-layer-dismiss"` / `"rearm-layer-busy"` — in
  place of the originally-specified `{kind:'layer', result}` case, checked
  only on Back, inserted between the two global traps/transition guard and
  the direction/screen switch. Both tags mean re-arm the screen-depth entry
  the popstate already popped; `"rearm-layer-dismiss"` additionally means
  dismiss the top layer (the adapter recovers it via `topLayer(layerStack)`).
  `overlayBlocksClose`/`overlayDismissal` are kept, unmodified, for the
  recorder's own two overlays in phase 1 (see the PR split) — they already
  work and are not in the defect corpus, except for the one required fix
  below (Amendment C's busy-ref requirement applied to the recorder's erase
  confirm specifically).
- `src/lib/nav/travel-guard.ts` (new, grafted from Model 2 — Amendment A).
- `src/hooks/use-nav-stack.ts` (new, thin adapter) — the only file that
  touches `window.history`/`window.popstate`; exposes `pushLayer`,
  `popLayer`, `openChapter`, `openRecorder`, `goBack`, `commitCloseRecorder`.

### Overlay catalogue

`busy()` always outranks openness: a busy layer refuses dismissal and
re-arms; a non-busy one dismisses.

| Overlay                          | Site                                             | `busy()` while                                                             | Fix required beyond wiring                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Books hamburger menu             | `books-screen.tsx:86`                            | never                                                                      | —                                                                                                                                                                                                                                                                                                                          |
| New Book dialog                  | `books-screen.tsx:94,114`                        | `creatingBook.current` (write in flight)                                   | — (ref already exists)                                                                                                                                                                                                                                                                                                     |
| Book ≡ menu / rename             | `books-screen.tsx:134,137,147`                   | `savingBookName` write in flight **or** `bookShare.status === "preparing"` | needs a **new** live-ref accessor — `savingBookName`/`useBookShare` currently only expose `useState`, confirmed by direct read of `use-books.ts` and `use-book-share.ts`; #384/#393's revert of a menu-level rename guard should be reconfirmed by the DRI now that the guard is generic, not bespoke (see open questions) |
| Delete confirm (book)            | `books-screen.tsx:152`                           | `deleteBook()` write in flight                                             | needs a **new** `isDeleting()`-style ref accessor — `use-books.ts` exports only `deleting` (state) and an internal, unexported `deletingRef` (confirmed, line 349/357/672)                                                                                                                                                 |
| Segments chapter ≡ menu / rename | `segments-screen.tsx:93,96,103`                  | `savingChapterName` in flight **or** `chapterShare.status === "preparing"` | same ref gap as Books' ≡ menu                                                                                                                                                                                                                                                                                              |
| Segments row overflow menu       | `segments-screen.tsx:90`                         | never                                                                      | —                                                                                                                                                                                                                                                                                                                          |
| Segments erase confirm           | `segments-screen.tsx:85`, `use-erase-segment.ts` | erase in flight                                                            | needs a **new** `isErasing()`-style ref accessor — `use-erase-segment.ts` exports only `erasing` (state) and an internal `erasingRef` (confirmed, line 88/97/120); the unmerged PR built exactly this (`gh pr diff 430`, `isErasing: () => erasingRef.current`) and it should be ported here, not rebuilt from scratch     |
| Recorder ≡ menu                  | `recorder.tsx:261`                               | never                                                                      | already correct, merged                                                                                                                                                                                                                                                                                                    |
| Recorder erase confirm           | `recorder.tsx:271`                               | `erase.erasing` — **currently the stale state value, not a live ref**      | switch the call site to `erase.isErasing()` (port the same accessor from the unmerged branch, confirmed to exist there at `gh pr diff 430` line ~2916)                                                                                                                                                                     |

**Share is new scope, not in the six-round corpus.** `share-flow.ts:109`
defines `ShareStatus = "idle" | "preparing" | "ready"`; `segments-screen.tsx:435`
renders the Share control inside the same panel gated by `chapterMenuOpen`
(`open={chapterMenuOpen}`), and reads `share.status` at lines 264, 475, 492,
507, 510 — confirmed by direct read. `books-screen.tsx:160,378,426,461`
shows the identical pattern for `useBookShare()` inside the book ≡ menu.
Neither the six #430 rounds nor #452's own body ever exercised Back against
an in-flight Share build, because it lives inside a menu overlay that had no
busy concept at all before this design. A system Back while a chapter or
book's MP3 is being built in the Web Worker (ADR 0009) must refuse dismissal
the same as a rename-in-flight, not silently close the menu over a build
that is still writing into memory the app is about to discard.

### Platform behavior

**Browser tab / installed PWA** — the mechanism above, unchanged in kind
from `develop`'s existing, merged, tested `popstate` plumbing. Root-level
Back (Books, no history entry) leaves the tab/backgrounds the installed app,
exactly as `exit-app` already does today; this document does not change that
and it is not part of the defect corpus.

**Capacitor Android WebView (hardware Back)** — **not addressed by this
design's core**, and not addressed by `develop` today either. Confirmed
directly: `android/app/.../MainActivity.java` is `public class MainActivity
extends BridgeActivity {}` with no override; `package.json` lists
`@capacitor/android`, `-core`, `-filesystem`, `-ios`, `-share`, `-cli` but
**not** `@capacitor/app`; no `backButton` listener exists anywhere in `src/`.
**Inference, not observation:** every hardware Back press on the Android
build today almost certainly falls straight through to AndroidX's default
Activity-finish behavior, independent of anything in `src/`, at any screen
depth — this is standard platform behavior given the above three facts, not
something this repo has watched happen on a device. See Amendment F for the
deferred, optional fix and the question this raises for the dev lead.
**iOS (Capacitor, WKWebView)** has no hardware/system Back gesture; the
on-screen header Back already shares the one `history.back()` path
(`goBack`) per this repo's stated "one Back path" rule, so iOS needs nothing
platform-specific here.

## Resolving every surviving attack finding

The base model's own attack (`sound-with-changes` verdict) left three
`still-possible` replays and five new findings (1 P1, 3 P2, 1 P3). Every one
is closed below by a design change or turned into an explicit, named
decision — none is left silently unaddressed.

| #                                                         | Finding                                                                                                                                                                                                                                                                                                                                                         | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 (**P1**)                                               | `layerStack` has no unmount-safety net; a parent-forced unmount (App's early return for `recovering`/`databasePanel`, `App.tsx:412-443`, over `use-database-status.ts`'s cross-tab-triggered flip) can orphan a busy Layer, permanently trapping Back at that screen depth                                                                                      | **Design change — Amendment C.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F2 (**P2**)                                               | No pure, tested function owns `outstandingBacks`-equivalent bookkeeping for the two remaining raw `history.back()` issuers (`goBack`, the recorder's async commit-close exit); this is unformalized adapter code, the exact shape that produced R2-G-P2-1, R2-G-P2-2 and R3-G-P2-1 three separate times in the parked review                                    | **Design change — Amendment A** (grafted from Model 2, scoped to exactly these two issuers).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F3 (**P2**)                                               | Reload while at screen depth > 0 leaves a stale history entry stamped with the old index below the freshly-reset current entry; the first post-reload Back can be silently swallowed as a phantom Forward, or — if the user has re-navigated since reload — can silently skip a physical level and cause an unexplained exit while a non-root screen is showing | **Design change — Amendment B.** This is confirmed to be a pre-existing hazard on `develop` today (`App.tsx:85-89`, `:301-302`), not something this redesign introduces; it is fixed here rather than merely disclosed, because #452's own mandate is to close classes, not relocate them.                                                                                                                                                                                                                                      |
| F4 (**P2**)                                               | The overlay catalogue above needs `isSavingBookName()`/`isSavingChapterName()`/`isDeleting()`-style live-ref accessors that do not exist on `develop` — confirmed by direct read of `use-books.ts` and the Segments equivalent — so a plan that says "reuse the existing ref" for these three overlays is wrong; they need net-new plumbing                     | **Design change — folded into the PR split below** (PR3/PR4 scope explicitly includes building these accessors, following the pattern the unmerged branch already proved for `isErasing()`; not "reusing" anything that isn't there).                                                                                                                                                                                                                                                                                           |
| F5 (**P3**)                                               | The originally-drafted numeric-displacement clamp (invariant 10) has nothing to attach to — `popAction`'s signature carries only `NavDirection`'s tri-state, never a delta                                                                                                                                                                                      | **Design change — dropped, not built.** Amendment A's shared travel-guard reduces the outstanding-issuer state space to exactly two booleans (`goBack` outstanding, commit-close-recorder outstanding), enumerated in full (4 rows) rather than defended by an unreachable clamp. See Amendment A.                                                                                                                                                                                                                              |
| R1-G-P3-3 (still-possible)                                | A Layer's identity/busy-ness must be keyed off the live resolved entity (e.g. the shelf-resolved book), not a stored id that can go stale if the entity is deleted from another tab mid-overlay                                                                                                                                                                 | **Explicit decision, documented rule, not compiler-enforced.** Every Layer's `id` and `busy()` closure must resolve against the live entity the same way `books-screen.tsx:134/350` already does (`shareMenuBook` resolved from the live shelf, not just `shareMenuBookId`). Called out explicitly in the PR3/PR4 review checklist. This is a discipline, not a type-system guarantee, and is named as such in Residual Risks below rather than claimed as closed.                                                              |
| R3-G-P3-2 (still-possible)                                | `pendingIntent`/queued-drop is latest-wins; two distinct rapid navigation intents queued in the same outstanding window drop the first                                                                                                                                                                                                                          | **Accepted, explicit decision.** Given the narrow window (only reachable while one of exactly two screen-transition issuers is outstanding — sub-100ms in practice) and the low blast radius (the dropped intent is a no-op the user can simply repeat; nothing is corrupted, nothing is lost), this is accepted rather than engineered around, matching the precedent the original review chain itself set for comparable low-severity residuals (R3-G-P3-1, R4-G-P3-4/5). Not a silent gap: named here and in Residual Risks. |
| R4-G-P3-5 (still-possible, restated as new finding above) | See F5.                                                                                                                                                                                                                                                                                                                                                         |

## Amendments

### Amendment A — a shared, tested travel-guard for the two remaining raw issuers (grafted from Model 2)

Model 1 as originally drafted asserted, via invariant 5, that "every
screen-transition request is one guard-then-mutate-then-push call," but
named no pure function that actually owns the shared outstanding-count state
between `goBack` and the recorder's commit-close exit — its own attack
caught this (F2 above) as unformalized adapter code.

Model 2's `commit()` design solves exactly this, generally, for an arbitrary
number of issuers, with a `pending: 0|1` flag and a `queued` slot. Grafting
that idea wholesale would reopen Model 2's own attack finding (R3-G-P3-2-style
overflow, since Model 2's version has to arbitrate three issuers at once —
`goBack`, the trap-forward cancel, and the commit-settle pop — and its own
attack notes two of those three can be outstanding back-to-back within one
gesture). Model 1 does not have that problem, because invariant 1 already
removes overlays from the issuer count entirely, leaving **exactly two**
real raw-`history.back()` sites: `goBack` (on-screen and system Back, shared
per this repo's "one Back path" rule) and the recorder's commit-close exit
(`.then((exited) => { ... window.history.back() })`, `App.tsx:357-361`).

`src/lib/nav/travel-guard.ts` (new): a pure trio,
`beginBack(state, issuer): {ok: boolean, next: TravelGuardState}`,
`settleBack(state, issuer): TravelGuardState`, and
`settleOutstanding(state): TravelGuardState`, operating on `{ goBackOutstanding:
boolean, commitCloseOutstanding: boolean }` (the `issuer` parameter is
required — `travel-guard.ts:149-151`, `:172-174` — and matches the live code;
#494 item 4). `settleBack` clears one named issuer's flag; `settleOutstanding`
is the issuer-blind landing settle the adapter runs at the top of every
`popstate` (the one place `App.tsx`'s live latch clears today), returning the
guard to `initialTravelGuardState` regardless of which issuer settled — the
issuer-blind counterpart of the any-issuer `beginBack` refusal (#494 item 2).
`goBackOutstanding` and
`commitCloseOutstanding` still identify WHICH issuer has a call outstanding
(for `settleBack`'s own bookkeeping — it clears only the settling issuer's
flag), but as of **2026-09-18 (PR #492 round 4, answers #493)** the rule is
**any-outstanding, not per-issuer**: a request is refused whenever EITHER
flag is already set, regardless of which issuer is asking.

| Any flag outstanding?  | A request from either issuer...                                  |
| ---------------------- | ---------------------------------------------------------------- |
| no (both false)        | proceeds, sets its own flag                                      |
| yes (either/both true) | refused, whichever issuer asks — the state is returned unchanged |

> **Superseded by #492 round 4 (2026-09-18, answers #493):** the table this
> replaces refused an issuer only against its OWN outstanding flag, reasoning
> that `goBack` and the recorder's commit-close exit target different
> physical history entries and so "do not contend" — a claim about LOGICAL
> contention. Frank's review (rounds 1, 2, 4, 5 on PR #492) kept finding that
> this does not address BROWSER-API contention: two `window.history.back()`
> calls issued before the first one's `popstate` has landed can coalesce into
> a single multi-entry traversal in some browsers, independent of which
> entries they logically target — the same class of hazard the existing
> `backRequested` double-tap latch already guards against for a single
> issuer, just not across issuers. The dev lead's decision (PR #492 round 4)
> is to collapse the matrix to the single any-outstanding rule above rather
> than defer the question again; the four-row table, and the "different
> physical entries do not contend" reasoning, are retired. `settleBack` is
> unchanged — it still requires the caller to name which issuer is settling,
> and still clears only that issuer's own flag, so `beginBack`'s next caller
> only unblocks once the actual outstanding call has settled.

This is the exact regression test for R2-G-P2-1/R2-G-P2-2/R3-G-P2-1's
class, and — since round 4 — also answers #493's cross-issuer coalescing
question **for the two issuers this guard tracks** (`goBack` and the
recorder's commit-close exit), at the source rather than disclosing it as an
open risk. It does **not** close #493 for `closeRecorder`'s own programmatic
`window.history.back()` (`App.tsx:266-268`): that is a THIRD raw issuer
outside `TravelGuardState` entirely, suppressed rather than arbitrated, and
the any-outstanding guard cannot see or refuse against it — already disclosed
at `travel-guard.ts:34-45`. `goBack` and the recorder's commit-close exit are
rewritten to call `beginBack`/`settleBack` instead of touching **only**
`backRequested` — **not** `suppressPop`, which stays fully load-bearing at
`App.tsx:266-268` (programmatic close), `:340-341` (`trap-forward`) and
`:358-360` (the commit-close consume), per `travel-guard.ts:15-32` (#494 item
1, George R4 P2-1). Dropping `suppressPop` would route the commit-close
consume-back as a real Segments Back → `"to-books"` → `backToBooks()` →
`setClipboard(null)`. That wiring is still PR2, not this PR.

### Amendment B — reload/bootstrap safety

Traced directly against `develop`'s current mount effect
(`App.tsx:85-89`): `window.history.replaceState({tc:true, index:0}, "");
navIndex.current = 0; nextIndex.current = 0;` runs **unconditionally** on
every mount, including a reload mid-stack. `replaceState` only rewrites the
**current** (top) entry; whatever real entries sit below keep whatever index
they were stamped with in the previous page life.

Traced through concretely: open a chapter (push, physical depth 1, entry
stamped `index:1`), open the recorder (push, depth 2, `index:2`), reload
while on the recorder. React resets to Books (`chapterId = null`,
`recorder = null`) as it always does on a full reload — this part is
existing, disclosed, unchanged behavior, not something this document takes
on. The mount effect restamps the **current physical entry** (depth 2) to
`index:0` and resets `navIndex.current`/`nextIndex.current` to 0, but the
entries below it (depth 0 and depth 1) still carry their original `index:0`
and `index:1`. A system Back now pops to the depth-1 entry, delivering
`{index:1}`; `navDirection(navIndex.current=0, toIndex=1)` returns
`"forward"`, so `popAction` returns `trap-forward`, which calls
`history.back()` **again** to cancel it — decrementing the browser a
_second_ physical level, past the depth-1 entry, to depth 0. One real Back
gesture is silently absorbed as two, skipping a level, with the UI showing
no change throughout (since it was already at Books). If the user had
instead re-navigated to a real screen between the reload and this Back
(so the rendered screen is genuinely not Books), the same misclassification
would burn two physical levels for one gesture while the visible screen
never routes at all — a Back that should show `to-books` shows nothing, and
the _following_ Back — still on the wrong screen — computes against an
already-corrupted baseline and can trigger `exit-app` while a non-root
screen is on display. This is real and present on `develop` **today**,
independent of anything else in this document; I confirmed it by reading
`App.tsx:301-302`, where `navIndex.current` is updated unconditionally
_before_ the `popAction` switch runs, so there is no downstream check that
could catch the mismatch.

**Fix, scoped small:** replace the unconditional `replaceState`/reset with a
pure `resumeNavIndex(state: unknown): number` in `src/lib/nav`
(`null`/malformed → `0`; `{tc: true, index: N}` → `N`). The mount effect
calls `window.history.state` on load; if it already carries the app's own
shape, it **adopts** that index as the current `navIndex`/`nextIndex`
baseline instead of forcing it to 0 and lying about what is physically
below. This never desyncs from the real stack, because it never rewrites an
index that a lower entry might still be compared against — it only ever
adopts the truth that is already there. The one remaining, disclosed
limitation is unchanged from today: a reload always shows Books regardless
of history depth (no session-restore of which chapter/segment was open).
That is an existing, accepted simplification, not a defect this design
introduces or is asked to fix; the fix here removes the _stack corruption_
that reload could cause, not the "always lands on Books" behavior. Test:
`resumeNavIndex(null) === 0`; `resumeNavIndex({tc:true,index:2}) === 2`;
a reload-then-Back integration-shaped Node test (fake `history.state`,
fake `popstate`) confirming no `trap-forward` misfire and no skipped level.

### Amendment C — a centrally-owned, stable unmount safety net for the layer stack

F1's scenario is real: `App.tsx`'s early return for `recovering` or
`databasePanel` unconditionally unmounts `BooksScreen`/`SegmentsScreen`
(confirmed structurally by the ground truth's own citation of
`App.tsx:412-443` and by `use-database-status.ts`'s cross-tab, this-tab-independent
trigger), and invariant 6 bans layer bookkeeping from living in any
per-overlay effect — so nothing was specified to clean up a Layer left
registered when its owning screen disappears out from under it.

**Fix:** one additional, centrally-owned cleanup effect in
`hooks/use-nav-stack.ts` itself — not per-overlay, not per-screen-component —
with a dependency array of exactly `[screen, recovering, databasePanel]`,
all three of which are primitive values the adapter itself already tracks,
never a hook-returned object or callback. Its body: whenever the screen
identity changes or either global trap engages, clear any Layers registered
for a screen that is no longer the current one. This does **not** reopen
invariant 6's class (the parked branch's round-6 P1), because the
dependency array here contains no hook-returned reference — only the three
primitives that already gate every other routing decision in this design —
so there is nothing for an unmemoized `useChapterShare()`/`useBookShare()`
object literal to destabilize.

### Amendment D — Share-preparing is a busy overlay state (grafted from Model 3)

Confirmed above: both the Book ≡ menu and the Segments chapter ≡ menu host a
Share control whose `status` can be `"preparing"` while ADR 0009's Web
Worker builds an MP3. This design's overlay catalogue (above) already folds
`status === "preparing"` into each menu's `busy()` alongside its
rename-in-flight condition. This is genuinely new scope — no #430 review
round, and no line of #452's own body, ever exercised Back against an
in-flight Share — and it needs its own red-first test and its own on-device
pass like every other row in the catalogue, not an assumption that the
existing rename-guard machinery covers it for free.

### Amendment E — hook-returned-object identity is a repo-wide rule, not a one-off fix (answers #452's own standing question)

The DRI's 2026-09-17 comment on #452 asks directly: _should any effect that
gates history-stack bookkeeping be allowed to depend on a hook-returned
callback whose reference stability is not independently guaranteed?_ This is
now the second time the same class has broken something load-bearing here —
round 5's `erase.erasing` vs. a live ref, and round 6's
`useChapterShare()`/`useBookShare()` object literal feeding an
`exhaustive-deps`-mandated dependency array on a cleanup effect with a real
side effect.

**Answer: no.** Invariant 6 already forecloses this for layer bookkeeping
specifically (there is no effect in that path to depend on anything). The
general rule this design adopts, to be applied wherever a future effect
_does_ need to depend on a hook's return value for a purpose with a real
side effect (history, IndexedDB writes, anything not purely presentational):
either the hook memoizes its returned object (`useMemo` around the object
literal, or split `reset`/`prepare`/`send` into their own stable
`useCallback`s the way `useEraseSegment` already isolates `erase` itself),
or the consuming effect depends on a primitive/ref instead of the whole
object. As a concrete, scoped instance of this rule: `useChapterShare()`
(`use-chapter-share.ts:65`) and `useBookShare()` return a fresh object
literal on every render today, confirmed by direct read; since Amendment D
now wires their `status` into a `busy()` check that Amendment C's cleanup
effect must be able to trust is stable, **memoizing these two hooks' return
value is in scope for PR3/PR4**, not a separate ticket (whether it lands as
its own preparatory commit is open question 3).

### Amendment F — Android hardware Back via `@capacitor/app` (deferred, from Model 3)

Model 3's static evidence is solid and I re-verified it directly:
`MainActivity.java` is a bare `BridgeActivity` subclass with no override,
`@capacitor/app` is absent from `package.json`, and no `backButton` listener
exists anywhere in `src/`. The **inference** — that every hardware Back
press today falls through to AndroidX's default Activity-finish behavior —
is standard platform behavior given those three facts, not an observation;
it has never been checked on a device.

This design does **not** build the fix, for two reasons stated plainly
rather than hidden in a footnote. First, it is orthogonal to the
reconciliation-model choice this document exists to make — the Android leg
can be bolted onto whichever core model wins, later, by funneling a
`backButton` event into the same `routeBackToLayer`/`popAction` pure core
Model 1 already builds, exactly as Model 3 proposed. Second, doing it now
would add a new native dependency and a new listener to the _highest-risk_
period of the runway (under two weeks to the 2026-09-30 production gate, as
of 2026-09-17), before the PWA-side core (Amendments A–E)
has even landed and baked. **Whether to build it at all before the October
training, and if so, in which PR, is named explicitly as a question for the
dev lead below** — this document takes no position on the tradeoff between
"ship the PWA-side fix only, Android hardware Back stays whatever it is
today" and "also wire `@capacitor/app` before the training," because that is
a scheduling and risk call the requirements owner and dev lead need to make
with the training date in view, not something a design pass for the history
model should decide unilaterally. If the DRI does choose to build it: it
should be its own PR, sequenced **after** PR1–PR4 below are review-clean at
one head, and its acceptance bar must not be satisfied by a unit test
against a fake plugin alone — this repo's hard rule stands: it is unverified
inference until it is run on an actual Android device.

## Test plan

- **Layer-stack decision table** (`layer-stack.test.ts`): empty → `empty`;
  single non-busy → `dismiss`, spy fires once; single busy → `refused-busy`,
  spy fires zero times; two-layer stack → only the top's spy fires (mutation:
  swap `topLayer`'s index expression to `[0]`, confirm the test dies).
- **Travel-guard exhaustive table** (`travel-guard.test.ts`, Amendment A):
  all four rows of the 2×2 outstanding-issuer matrix above, each asserting
  proceed/refuse correctly; mutation: invert one comparison, confirm at
  least one row dies.
- **Reload/bootstrap** (`resumeNavIndex` unit test + an integration-shaped
  Node test simulating a fake `history.state` and a `popstate`, Amendment
  B): confirms no `trap-forward` misfire and no skipped physical level.
- **#168 non-regression, re-targeted:** the existing mutation test (break the
  guard, confirm a second Back during an in-flight commit reaches
  `leave()`/`cancelRecording()`) is re-run against the new
  `transitionInFlight` guard and must still die on the mutation. This is the
  single highest-stakes test in the suite and nothing in this redesign may
  weaken it.
- **`busy()`-is-a-ref regression:** one fake `Layer` whose `busy()` closes
  over a snapshot boolean (the wrong shape) and one whose `busy()` reads a
  ref; flip the underlying value synchronously with no intervening
  render/await and assert only the ref-backed one reflects it immediately —
  documented as a negative example, never shipped.
- **Per-overlay `busy()` unit test**, one row per catalogue entry above,
  including the two new Share-preparing rows (Amendment D) and using the
  net-new ref accessors from F4's fix, not the state values they replace.
- **Corpus decision-table test** (grafted from Model 2's strongest process
  idea): one row per finding id from the six-round corpus (R1-F-carried-1
  through R6-G-P3), each asserting the new mechanism produces the correct
  outcome for that finding's exact scenario, so the corpus itself becomes
  the permanent regression suite rather than living only in triage comments.
- **Manual/on-device, explicitly not claimed done here:** iOS system-Back-equivalent
  (header Back / edge gesture) against every busy overlay, once per this
  repo's T2 bar, before PR3/PR4 merge. **Android hardware Back: unverified
  before this design, unverified by this design, and remains unverified
  until Amendment F (if built) is walked through on a real device** — this
  plan does not, and must not, claim otherwise.

## Constraints this design does not relax

- No jsdom/renderer exists in this repo; `App.tsx`, `books-screen.tsx`,
  `segments-screen.tsx`, `recorder.tsx` stay review-only regardless of this
  document. Only the pure decisions in `src/lib/nav` are Vitest-covered —
  which is why this design pushes as much as possible into that layer.
- On-screen Back and system Back must continue to share exactly one code
  path (`goBack` → `history.back()` → the one `popstate` listener), per this
  repo's own stated "one Back path" design rationale from the original #168/#259
  work. Nothing in this document special-cases the system gesture.
- The dual-review cap is 4 rounds (`docs/review/dual-review.md`); the parked
  branch's DRI overrode it twice, each time with a named hard-stop, and both
  stop rules were triggered. This document's PR split is deliberately small
  per PR specifically so each one has a realistic chance of clearing four
  rounds clean.
- Never merge without explicit permission, in any repo, per both
  `AGENTS.md` and workspace `CLAUDE.md`. Nothing here authorizes opening or
  merging a PR; this is the scope-and-plan artifact that precedes one.

## Open questions

### For the dev lead (engineering risk, sequencing, tooling)

1. **Should `@capacitor/app` land before the training, and if so, in which
   PR?** (Amendment F.) This document takes no position; it only confirms
   the current gap and the size of the fix.
2. **PR sequencing with under two weeks to the gate:** this document proposes
   PR1 (pure core, zero behavior change) land and bake before PR2 (the
   adapter/`App.tsx` swap, the highest-risk PR since it touches the #168
   path) is even opened for review, and PR2 bake before PR3/PR4 (Books',
   then Segments' overlay wiring). Is that pacing realistic against
   2026-09-30, or does it need to compress?
3. **Should the memoization fix for `useChapterShare()`/`useBookShare()`
   (Amendment E) ship as its own preparatory commit, or fold into PR3/PR4?**
4. **Is the R3-G-P3-2 latest-wins accepted-risk call (a dropped queued
   intent under a sub-100ms double-navigation race) the right tradeoff, or
   does it warrant the identified-queue machinery Model 2 used instead?**
   This document defaults to "accept," but it is a real engineering
   tradeoff, not a foregone one.
5. **R1-G-P3-3's live-entity-keying rule is a code-review discipline, not a
   compiler guarantee.** Is a lint rule worth building for it, or is a PR3/PR4
   review checklist item sufficient given the training deadline?

### For the requirements owner (what Back should DO, for people who may not read)

6. **A dialog holding typed-but-not-yet-submitted input (New Book; the
   rename field inside the Book ≡ menu or the Segments chapter ≡ menu) is
   _not_ covered by any "busy" guard in this design** — busy only covers
   the write-in-flight window, after the person has already tapped
   Save/Create. Confirmed by direct read: `onCancelNewBook`
   (`books-screen.tsx:260-268`) already discards a typed-but-unsubmitted
   name today whenever the write is not in flight, and every model in this
   pass's corpus (including this one) mirrors Cancel's behavior for Back by
   default. For a translator who may not read, silently discarding a typed
   name on a stray Back is a real cost with no correction path. **What
   should Back do here** — discard silently (today's Cancel behavior,
   carried forward unchanged), keep the draft and let the person resume it
   next time they open the dialog, or refuse Back entirely while the field
   is non-empty (forcing an explicit Cancel tap)? This is squarely AGENTS.md's
   own open item — "how a destructive action is confirmed without words" —
   applied to Back specifically, and it has never been decided for any of
   the three affected fields.
7. **Should the #384/#393-reverted rename-in-flight Back guard actually ship
   this time?** It is now generic (part of every menu's shared `busy()`
   check, invariant 4) rather than the bespoke, menu-specific latch that was
   reverted before. The original revert's product rationale was not
   recovered in this pass (only #393's citation of it was read) — worth a
   fresh look now that the mechanism is different, not the same proposal
   coming back unchanged.

## PR split

1. **PR1 — pure core only.** `layer-stack.ts`, `travel-guard.ts`,
   `resumeNavIndex`, the extended `popAction`. Zero behavior change to the
   shipped app; fully Vitest-covered including the corpus decision table.
2. **PR2 — the adapter.** `hooks/use-nav-stack.ts` replaces `App.tsx`'s
   inline refs/effect wholesale; carries the #168 mutation test forward
   re-targeted at `transitionInFlight`; wires Amendment B (reload) and
   Amendment C (unmount safety net). This is the PR that touches the
   highest-stakes path in the app and should bake before PR3 opens.
3. **PR3 — Books' overlays.** Builds the missing ref accessors (F4) for
   `savingBookName` and `deleting`; converts Books' five overlays to
   `Layer`s; wires Amendment D for the book ≡ menu's Share status; includes
   the `useBookShare()` memoization fix (Amendment E) if the dev lead
   chooses to fold it in here (open question 3).
4. **PR4 — Segments' overlays.** Same shape as PR3 for Segments' three
   overlays, plus the `useChapterShare()` memoization fix if not already
   done in PR3.
5. **PR5 — Recorder's erase-confirm fix only.** Ports the `isErasing()` live
   ref accessor already proven correct in the unmerged #430 branch
   (confirmed present in `gh pr diff 430`) and switches the one call site
   (`recorder.tsx:2014,2022`) from `erase.erasing` to `erase.isErasing()`.
   Deliberately the smallest, most isolated PR in the set, since it is a
   single-line-of-consequence fix to already-merged, already-correct
   machinery.
6. **PR6 (optional, deferred) — Amendment F**, if the dev lead's answer to
   open question 1 is yes. Sequenced last, after PR1–PR5 are clean at one
   head SHA.

Each PR needs both Frank and George clean at one head SHA per `AGENTS.md`,
and none merges without the DRI's explicit permission per workspace
`CLAUDE.md`'s policy, applied here as a same-repo rule.

## Residual risks

- **Two discipline-only rules are not compiler-enforced**: `busy()` must be
  ref-backed (invariant 4), and a Layer's identity must resolve against the
  live entity, not a stale id (R1-G-P3-3's disposition above). Both are
  named as PR3/PR4 review-checklist items, not structural guarantees — a
  future overlay author can still get either wrong, exactly as this repo's
  own history shows happened twice already (round 2, round 4) before being
  caught.
- **Latest-wins queued-intent drop is accepted, not eliminated** (R3-G-P3-2).
- **Reload always lands on Books regardless of prior depth** — an existing,
  disclosed simplification this design leaves unchanged; only the _stack
  corruption_ reload could cause (Amendment B) is fixed, not a
  session-restore feature that never existed.
- **After a reload at depth N, leaving the app takes N extra Backs**
  (adopt-don't-rewrite, Amendment B, leaves the physical stack below intact
  rather than flattening it) — George R3 P2-1 on PR #492 traced this
  concretely: `"exit-app"` in `App.tsx` is a no-op that assumes the browser
  is already leaving, which holds at real depth 0 but not after an adopted
  reload baseline `> 0`. **Accepted 2026-09-18** (dev lead decision, PR #492
  round 4) as UX for now, in preference to (a) flattening the stack on mount
  (which would contradict adopt-don't-rewrite as written above) or (b) making
  `"exit-app"` drain the leftover levels itself. PR2 may revisit this with a
  device in hand.
- **Android hardware Back remains completely unaddressed by this design's
  core**, and unverified on any device, on any branch, at any point in this
  project. Amendment F names the fix and defers the scheduling call
  explicitly rather than either building it under time pressure or
  pretending the gap does not exist.
- **No device testing of any kind was performed to produce this document.**
  Every claim above is a static read of already-merged source, `gh pr diff
430`, and issue #452's thread, plus a new pure-function design. The T2
  on-device checks this plan proposes have not yet been run.

## Status

Awaiting DRI review. No code has changed. The next step, on approval, is
PR1 as scoped above — pure core, zero behavior change — which can start
independent of any answer to the open questions listed, since none of them
bear on the pure layer.
