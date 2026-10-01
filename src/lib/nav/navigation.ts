/**
 * The one navigation decision extracted from the browser-only History wiring so
 * it can be tested in Node: given where the app is, what a Back gesture means.
 *
 * The app is three screens layered as state in `App.tsx` — Books, Segments, and
 * the Recorder sheet over Segments (#168). Nothing was in the history stack, so
 * a standalone PWA's system Back gesture left the app entirely: on the recorder
 * that fired `pagehide` → `leave()` → the in-progress take was dropped with no
 * recovery slot (the #58 loss). Pushing one entry per screen turns that gesture
 * into a `popstate` the app routes here instead.
 *
 * The mapping that matters is `"recorder" → "commit-close-recorder"`: Back on the
 * recorder must run the commit path (`close()`), never the take-dropping
 * `leave()`. That is the line the test pins and a mutation must break.
 */

import { routeBackToLayer, type LayerStack } from "@/lib/nav/layer-stack";

export type Screen = "books" | "segments" | "recorder";

/** Which screen is showing, from the two pieces of nav state App holds. */
export function screenFor(hasChapter: boolean, recorderOpen: boolean): Screen {
  // The recorder is a sheet over Segments, so it wins whenever it is open —
  // even though a chapter is also selected underneath it.
  if (recorderOpen) return "recorder";
  if (hasChapter) return "segments";
  return "books";
}

/**
 * What a Back gesture does from each screen.
 *
 * - `commit-close-recorder` runs the recorder's `close()` — stop, decode, save —
 *   the same path the on-screen Back takes. NEVER a bare unmount: that would drop
 *   the take (#58).
 * - `to-books` returns from Segments to the Books shelf.
 * - `exit-app` is the root: Books pushes no entry, so the browser's own Back
 *   leaves the app, which at the shelf loses nothing.
 */
export type BackEffect = "commit-close-recorder" | "to-books" | "exit-app";

export function backEffectFor(screen: Screen): BackEffect {
  switch (screen) {
    case "recorder":
      return "commit-close-recorder";
    case "segments":
      return "to-books";
    case "books":
      return "exit-app";
  }
}

/**
 * Which way a `popstate` moved, from the monotonic index each history entry
 * carries (Frank R1 F2). `popstate` fires for FORWARD as well as Back — a
 * standalone PWA can swipe forward — and the old handler routed on the current
 * screen alone, so a Forward was misread as a Back and dropped the UI to Books.
 * The live stack is strictly increasing in index bottom-to-top (a push always
 * truncates the forward entries and appends a higher index), so a lower
 * destination index is a Back and a higher one a Forward.
 */
export type NavDirection = "back" | "forward" | "same";

export function navDirection(from: number, to: number): NavDirection {
  if (to < from) return "back";
  if (to > from) return "forward";
  return "same";
}

/**
 * What the `popstate` handler does — the whole decision, pure so the two cases
 * Frank's R1 review turned on are pinned by a Node test rather than a browser:
 *
 * - **A failed-save recovery modal is up (`recovering`)** → `trap-recovery`,
 *   whatever the direction. The `SaveFailed` screen is a modal, NOT a navigation
 *   level (George R2 G2), and the only in-memory copy of the held take lives in
 *   React state behind it. So every gesture under it — Back included — must be
 *   ABSORBED by re-arming the protective entry (`pushHistoryEntry`), never walked
 *   farther back: a plain Back walks toward the document unload that destroys the
 *   heap and the take with it (Frank R3 G-R3-1). Checked FIRST — the modal
 *   outranks the screen beneath and any direction.
 * - **A screen transition is in flight (`transitionInFlight`)** →
 *   `rearm-transition-busy`, whatever the direction. This is the F1 data-loss
 *   guard: while the recorder's Back is running stop → decode → save (seconds on
 *   a long take), a second Back must be ABSORBED by re-pushing the protective
 *   entry, never allowed to escape the recorder and drop the uncommitted take
 *   (#58). Break this row and the second Back leaves over an unsaved recording —
 *   the exact regression. In PR2 the recorder's commit-close is the only screen
 *   transition with an async in-flight window, so this guard is that absorber in
 *   practice; the name generalizes (invariant 7) without changing what sets it.
 * - **Forward** → `trap-forward`: cancel it (the handler re-asserts history),
 *   the app stays put. Never route a Forward as a Back (F2).
 * - **Back** → the `backEffectFor` mapping for the current screen.
 *
 * - **The database panel is up (`databasePanel`)** → `trap-database-panel`,
 *   whatever the direction. Same slot and same shape as the recovery modal: a
 *   full-screen `alertdialog` that replaced the tree rather than a level within
 *   it. Checked after recovery, which outranks it, and before everything else.
 *
 * `trap-recovery`, `trap-database-panel` and `rearm-transition-busy` all re-arm
 * by pushing a fresh entry; they are named apart so the handler's intent — and
 * each test row — stays legible.
 *
 * **`rearm-layer-dismiss` / `rearm-layer-busy` (docs/design/back-navigation.md
 * #452 PR1, contract fixed per George R1 P2-1 on PR #492)** — the
 * screen-scoped `layerStack` has an open overlay on top, and the gesture is a
 * **Back**. Checked after the two global traps and the transition-in-flight
 * guard, and before `direction === "back"` falls through to `screen` routing
 * (invariant 3: "if no global trap and no screen transition is in flight,
 * ON BACK, the screen-scoped `layerStack`'s top entry only") — an overlay
 * never held a history entry of its own (invariant 1), so neither Forward nor
 * "same" has any meaning for it; only whether its top layer is busy does.
 *
 * **Layer routing applies ONLY on Back (George R2 P2-1 on PR #492).** The
 * premise below — a `popstate` has already popped the screen-depth entry —
 * is true for Back and FALSE for Forward: Forward RESTORED a previously
 * truncated entry, and the live cancel for it is `trap-forward`'s own extra
 * `history.back()`, not a layer re-arm. Both recorder-close paths (the adapter's
 * programmatic close, `hooks/use-nav-stack.ts`'s `commitCloseRecorder`, and its
 * `commit-close-recorder` popstate case) leave a forward entry behind; if a
 * non-empty stack were allowed to shadow Forward, a Forward swipe over an open overlay
 * would dismiss the overlay and re-arm instead of cancelling the Forward, and
 * the user's next Back would fall through past the now-empty stack to
 * `to-books` — an earlier revision of this function had exactly this bug,
 * caught before PR2 could copy it.
 *
 * A `popstate` has ALREADY popped the screen-depth entry before this function
 * runs (the adapter updates `navIndex` from the landing index just before
 * calling `popAction`, `hooks/use-nav-stack.ts`), exactly the same as every
 * other non-screen intercept above (`trap-recovery`/`trap-database-panel`/
 * `rearm-transition-busy`) — so on Back, BOTH outcomes must re-arm that entry,
 * not just one: `"rearm-layer-dismiss"` means dismiss the top layer (the
 * adapter recovers it via `topLayer(stack)`) AND push a fresh entry;
 * `"rearm-layer-busy"` means push a fresh entry only, same as every other
 * re-arm case.
 *
 * **One exception, added by Amendment G** (#452 PR3; George R1 P3-3 found this
 * paragraph still stating the rule as unconditional). The "push a fresh entry"
 * half holds unconditionally ABOVE the floor, where the consumed entry is the
 * screen's own. AT the floor it is the floor entry, which exists only while a
 * layer does, so `"rearm-layer-dismiss"` of the LAST floor layer re-arms
 * nothing and clears `floorArmed` instead — `rearmAfterLayerBack`
 * (`layer-stack.ts`) is the decision. **The tag name is misleading for exactly
 * that one case**: it still says "rearm" because the busy sibling shares it
 * and because every case above the floor does re-arm. Renaming it is a PR1
 * contract change, so it is written down here instead. **On `"rearm-layer-dismiss"` the adapter must also UNREGISTER
 * that top layer — call `popLayer(id)` — or make `dismiss()` itself the same
 * Close handler that already pops it (#494 item 3, George R4 P3-3 on PR
 * #492). If the layer is left on the stack, every later Back re-selects it as
 * `"rearm-layer-dismiss"` again with a now-no-op `dismiss()`, and the
 * screen-depth routing beneath it (`"exit-app"` at the Books root) can never
 * be reached — Back is permanently trapped at that depth. Two string tags rather than the object this PR originally
 * shipped (`{kind:"layer", result:...}`) so the re-arm obligation is NAMED
 * by the tag itself, not left to a docblock a reader could miss — the
 * earlier object shape's own prose taught the wrong contract ("nothing on
 * `refused-busy`"), and George's review caught it before PR2 could copy it.
 * **Naming the obligation is not the same as enforcing it (George R3 P3-6,
 * PR #492).** PR2 extracted the `popstate` `switch` out of `App.tsx` into the
 * adapter (`hooks/use-nav-stack.ts`), which consumes both layer tags and ends
 * with `default: { const _exhaustive: never = action }` — so a new `PopAction`
 * member with no case is a `tsc` error there, not a silent no-op. (On `develop`
 * before PR2 the switch lived in `App.tsx` with no such default; that is the
 * gap this closed.) The two string tags also remove the never-produced
 * `{kind:"layer", result:{kind:"empty"}}` combination entirely (former P3-4):
 * a plain string has no `"empty"` branch to write.
 */
export type PopAction =
  | "trap-recovery"
  | "trap-database-panel"
  // Invariant 7's name (docs/design/back-navigation.md, invariant 7): the guard this
  // tag names re-arms while a screen transition is in flight. In PR2 the ONLY
  // screen transition with an async in-flight window is the recorder's
  // commit-close (stop → decode → save) — invariant 7's "every other screen
  // pop" has no async member today, so this stays the recorder-commit-close
  // absorber in practice, renamed from the PR1 placeholder "rearm-during-commit"
  // (#452 PR2, invariant 7) without any change in what sets it.
  | "rearm-transition-busy"
  | "rearm-layer-dismiss"
  | "rearm-layer-busy"
  | "trap-forward"
  | "ignore"
  | BackEffect;

/**
 * `layerStack` is an OPTIONAL trailing parameter, defaulting to an empty
 * stack. As of PR2 the adapter (`hooks/use-nav-stack.ts`) is the sole caller
 * — `App.tsx` routes every `popstate` through `useNavStack` and no longer
 * calls `popAction` directly — and it passes its live `layerStack` ref on
 * every landing.
 *
 * **That stack is LIVE, not empty** (#536 item 3; this paragraph still
 * described PR2 after PR3 had shipped, and a reader who trusted it would treat
 * `"rearm-layer-dismiss"` as inert and copy "always `pushHistoryEntry()`" onto
 * the floor path — the exact mutant `e2e` case (e) exists to kill). Books'
 * and Segments' overlays push onto it. Both layer tags are
 * reachable on any Back landing with an overlay open, and what the adapter owes
 * each of them — including Amendment G's one exception at the floor, the
 * paragraph above — is the contract to read, not an unreachable branch.
 *
 * The empty DEFAULT is what still carries the pre-PR3 behaviour: a caller that
 * omits the argument (every pure test row written for PR1) can never satisfy
 * the `direction === "back" && layerStack.length > 0` check below, so it routes
 * exactly as `develop` does and those rows keep compiling unchanged.
 */
export function popAction(
  direction: NavDirection,
  screen: Screen,
  transitionInFlight: boolean,
  recovering: boolean,
  databasePanel = false,
  layerStack: LayerStack = []
): PopAction {
  if (recovering) return "trap-recovery";
  // Same shape as the recovery modal and for the same structural reason: the
  // database panel is a full-screen `alertdialog` in that same slot, NOT a
  // navigation level, and the screen it replaced is not reachable underneath.
  // Left untrapped, a system Back from the blocked panel on Books runs
  // `exit-app` — the copy that was waiting for the other one to close leaves
  // instead, and reopening is blocked all over again — and from Segments it
  // runs `backToBooks()` under a panel that stays up regardless (George R3 P3).
  // The way out is the panel's own control.
  //
  // This started as state-machine parity — no audio was held while the panel
  // showed, so nothing could be lost by a stray Back. That is no longer true and
  // the trap now carries weight: the panel shows over a full clipboard (George
  // R4 P1), and `backToBooks` clears the slot, so an untrapped Back from here
  // would destroy the cut phrase this whole guard exists to protect.
  if (databasePanel) return "trap-database-panel";
  if (transitionInFlight) return "rearm-transition-busy";
  // Invariant 3, stage 2: only once no global trap is up AND no screen
  // transition is in flight, AND the gesture is a Back (George R2 P2-1 — the
  // "popstate already popped the screen-depth entry" premise below is false
  // for Forward, whose own live cancel is `trap-forward`'s extra
  // `history.back()`, not a layer re-arm), does the screen-scoped layer stack
  // get a say — and only its TOP entry (`routeBackToLayer` never looks below
  // it). An empty stack (every existing caller, PR1), or a non-Back
  // direction, falls straight through to the direction/screen routing below,
  // unchanged from `develop`.
  if (direction === "back" && layerStack.length > 0) {
    const result = routeBackToLayer(layerStack);
    switch (result.kind) {
      case "dismiss":
        return "rearm-layer-dismiss";
      case "refused-busy":
        return "rearm-layer-busy";
      case "empty":
        // Unreachable: `routeBackToLayer` only returns "empty" for an empty
        // stack, and `layerStack.length > 0` is checked above. Handled
        // explicitly (as a re-arm, never a silent screen-level fall-through)
        // rather than left for a `default` to paper over, in case that
        // invariant is ever broken by a future change to either function.
        return "rearm-layer-busy";
    }
  }
  if (direction === "forward") return "trap-forward";
  if (direction === "same") return "ignore";
  return backEffectFor(screen);
}

/**
 * Whether a Back must dismiss a recorder overlay instead of committing.
 * The header is inert under any overlay, blocking on-screen Back. The sheet
 * is inert only while idle; during a take its recording controls stay usable.
 * System Back reaches `close()` through the imperative handle, so this guard
 * must also block commits while a menu, confirmation, or erase is active.
 * A blocked close resolves false and leaves the recorder open.
 */
export function overlayBlocksClose(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean
): boolean {
  return menuOpen || confirmOpen || erasing;
}

/**
 * Which recorder overlays a blocked system Back may dismiss.
 * Segments also uses this table for its confirmation layer. A menu or pending
 * confirmation can close, but an in-flight erase owns its confirmation until
 * completion. `overlayUp` includes `erasing` independently of `confirmOpen`,
 * so clearing confirmation alone cannot expose idle controls during deletion.
 * The header stays inert under any overlay; the sheet does so only at idle.
 */
export function overlayDismissal(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean
): { closeMenu: boolean; closeConfirm: boolean } {
  return { closeMenu: menuOpen, closeConfirm: confirmOpen && !erasing };
}

/**
 * Amendment B of docs/design/back-navigation.md — reload/bootstrap safety.
 *
 * `develop`'s mount effect (before PR2) ran `window.history.replaceState({tc:true,
 * index:0}, ""); navIndex.current = 0; nextIndex.current = 0;`
 * UNCONDITIONALLY on every mount, including a reload mid-stack. `replaceState`
 * only rewrites the CURRENT (top) entry; whatever real entries sit below keep
 * whatever index they were stamped with in the previous page life. Traced
 * concretely in the design doc: reload while at physical depth 2 restamps
 * only that top entry to `index:0`, while the depth-0/depth-1 entries below
 * still carry their original `index:0`/`index:1` — so the first post-reload
 * Back lands on the depth-1 entry (`{index:1}`), `navDirection(0, 1)` reads
 * "forward" against the freshly-reset baseline, `popAction` returns
 * `trap-forward`, and the resulting cancelling `history.back()` burns a
 * SECOND physical level the user never asked to skip. This was a pre-existing
 * hazard on `develop` (confirmed against its `App.tsx` mount and popstate
 * effects), not something #452's redesign introduces; PR2's adapter mount
 * effect (`hooks/use-nav-stack.ts`) is where the fix below is wired.
 *
 * `resumeNavIndex` is the fix's pure half: given whatever `window.history.state`
 * already holds on mount, decide what `navIndex`/`nextIndex` should ADOPT
 * instead of blindly resetting to 0 and lying about what is physically below.
 * `null`/anything that does not carry this app's own `{tc: true, index: N}`
 * shape → `0` (a fresh load, or an entry from before this app ever wrote one —
 * nothing to adopt). A well-formed entry → its own `index`, unchanged. This
 * never desyncs from the real stack: it only ever adopts truth that is
 * already there, never rewrites an index a lower entry might still be
 * compared against.
 *
 * Wiring this into the mount effect (calling `window.history.state`, deciding
 * whether to `replaceState` vs. adopt) is the adapter's job — PR2
 * (`hooks/use-nav-stack.ts`), not this pure function. This file only decides
 * WHAT index a given `state` value resumes to; it never reads `window` itself
 * (lib/ stays DOM-free — AGENTS.md).
 *
 * **Contract for BOTH refs (George R2 P2-2 on PR #492):** the caller must
 * assign this SAME returned number to both `navIndex.current` AND
 * `nextIndex.current` on mount — adopting only `navIndex` is not enough.
 * `pushHistoryEntry` stamps every pushed entry from `++nextIndex.current`
 * alone (`hooks/use-nav-stack.ts`), never from `navIndex`; if `nextIndex` is left at its
 * old value while `navIndex` adopts this one, the very next push stamps a
 * LOWER index on top of the one just adopted, desyncing the strictly-
 * increasing invariant `navDirection` depends on (see above) and
 * reintroducing this same reload hazard one push later — proved directly
 * against the `++nextIndex.current` stamp path in
 * `tests/nav-resume-index.test.ts`.
 *
 * The one remaining, disclosed limitation is unchanged from today: a reload
 * always shows Books regardless of history depth (no session-restore of which
 * chapter/segment was open). That is an existing, accepted simplification;
 * this fix removes the STACK CORRUPTION a reload could cause, not the
 * "always lands on Books" behavior.
 *
 * `index` must be a non-negative SAFE INTEGER, not merely `typeof === "number"`
 * (Frank R1 P2): every real entry this app ever writes is stamped from
 * `++nextIndex.current` (`hooks/use-nav-stack.ts`), a non-negative integer, so `NaN`,
 * `Infinity`/`-Infinity`, a negative number, or a fractional value can only
 * reach here from state this app never wrote — malformed/foreign/legacy
 * state, exactly the case the docblock above already says must resume to `0`.
 * Accepting `NaN` silently would be worse than a typo: `navDirection(NaN, 1)`
 * reads `"same"` (both `<`/`>` comparisons on `NaN` are false), so a REAL Back
 * gesture would be silently swallowed, and an adopted `NaN`/`Infinity`
 * baseline can never advance by `++nextIndex.current` again either.
 */
export function resumeNavIndex(state: unknown): number {
  if (
    typeof state === "object" &&
    state !== null &&
    "tc" in state &&
    (state as { tc?: unknown }).tc === true &&
    "index" in state &&
    typeof (state as { index?: unknown }).index === "number" &&
    Number.isSafeInteger((state as { index: number }).index) &&
    (state as { index: number }).index >= 0
  ) {
    return (state as { index: number }).index;
  }
  return 0;
}
