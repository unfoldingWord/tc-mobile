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

import {
  routeBackToLayer,
  type LayerStack,
  type RouteBackToLayerResult,
} from "@/lib/nav/layer-stack";

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
 * - **A commit is in flight (`committing`)** → `rearm-during-commit`,
 *   whatever the direction. This is the F1 data-loss guard: while the recorder's
 *   Back is running stop → decode → save (seconds on a long take), a second Back
 *   must be ABSORBED by re-pushing the protective entry, never allowed to escape
 *   the recorder and drop the uncommitted take (#58). Break this row and the
 *   second Back leaves over an unsaved recording — the exact regression.
 * - **Forward** → `trap-forward`: cancel it (the handler re-asserts history),
 *   the app stays put. Never route a Forward as a Back (F2).
 * - **Back** → the `backEffectFor` mapping for the current screen.
 *
 * - **The database panel is up (`databasePanel`)** → `trap-database-panel`,
 *   whatever the direction. Same slot and same shape as the recovery modal: a
 *   full-screen `alertdialog` that replaced the tree rather than a level within
 *   it. Checked after recovery, which outranks it, and before everything else.
 *
 * `trap-recovery`, `trap-database-panel` and `rearm-during-commit` all re-arm by
 * pushing a fresh entry; they are named apart so the handler's intent — and each
 * test row — stays legible.
 *
 * **`layer` (docs/design/back-navigation.md #452 PR1)** — the screen-scoped
 * `layerStack` has an open overlay on top. Checked after the two global traps
 * and the transition-in-flight guard (invariant 3: "if no global trap and no
 * screen transition is in flight, the screen-scoped `layerStack`'s top entry
 * only"), and before `direction`/`screen` are consulted at all — an overlay
 * never held a history entry of its own (invariant 1), so neither Forward nor
 * "same" has any meaning for it; only whether its top layer is busy does.
 * `result` is `routeBackToLayer`'s own decision (dismiss / refused-busy /
 * empty); this function never calls `dismiss()` itself, only reports what the
 * adapter (PR2, `hooks/use-nav-stack.ts`) must do.
 */
export type PopAction =
  | "trap-recovery"
  | "trap-database-panel"
  // NOTE (#452 PR1 → PR2): the design (invariant 7) renames this to
  // "rearm-transition-busy" once the guard generalizes to every screen
  // transition, not just the recorder's commit-close. That rename touches
  // `App.tsx`'s switch (a consumer), which is out of PR1's scope — PR1 is a
  // zero-behaviour-change pure-core PR. Kept as "rearm-during-commit" here so
  // every existing call site and test row compiles and passes unchanged;
  // PR2 does the rename.
  | "rearm-during-commit"
  | "trap-forward"
  | "ignore"
  | BackEffect
  | { readonly kind: "layer"; readonly result: RouteBackToLayerResult };

/**
 * `layerStack` is an OPTIONAL trailing parameter, defaulting to an empty
 * stack, specifically so every existing call site (`App.tsx`, untouched by
 * this PR) and every existing test row keeps compiling and keeps producing
 * the identical result it does on `develop` today — an empty stack can never
 * satisfy the new `layerStack.length > 0` check below, so the new `"layer"`
 * case is unreachable unless a caller opts in by passing a non-empty stack,
 * which no caller does yet (that wiring is PR2). Zero behaviour change.
 */
export function popAction(
  direction: NavDirection,
  screen: Screen,
  committing: boolean,
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
  if (committing) return "rearm-during-commit";
  // Invariant 3, stage 2: only once no global trap is up AND no screen
  // transition is in flight does the screen-scoped layer stack get a say —
  // and only its TOP entry (`routeBackToLayer` never looks below it). An
  // empty stack (every existing caller, PR1) falls straight through to the
  // direction/screen routing below, unchanged from `develop`.
  if (layerStack.length > 0) {
    return { kind: "layer", result: routeBackToLayer(layerStack) };
  }
  if (direction === "forward") return "trap-forward";
  if (direction === "same") return "ignore";
  return backEffectFor(screen);
}

/**
 * Whether a Back must be spent dismissing a recorder overlay instead of running
 * the commit (George R2 G1). The sheet's `inert` blocks the on-screen Back while
 * the ≡ menu or the erase-confirm is up, but the SYSTEM gesture reaches
 * `close()` through the imperative handle and never saw those flags — so a Back
 * during an in-flight erase raced `saveEditedSegment` against the erase (last
 * IndexedDB writer wins, the confirmed-erased take written back), and a Back
 * over the confirm dialog committed instead of cancelling. When this returns
 * true, `close()` dismisses the overlay and resolves `false` (the sheet stays,
 * its history entry re-armed); it commits only when nothing is in the way.
 */
export function overlayBlocksClose(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean
): boolean {
  return menuOpen || confirmOpen || erasing;
}

/**
 * When a system Back is absorbed by an open recorder overlay (`overlayBlocksClose`
 * is true), WHICH overlays `close()` may dismiss (Frank R4-1). The ≡ menu and a
 * confirm dialog still awaiting the user are dismissed; but a confirm whose erase
 * is ALREADY IN FLIGHT is NOT. `onConfirmErase` deliberately holds `confirmOpen`
 * true across the whole IndexedDB delete precisely to keep the sheet `inert`, and
 * clearing it mid-erase un-inerts the sheet and exposes Record — whose newly
 * started capture the erase's own completion (`onExit`) then discards. So while
 * `erasing`, leave the confirm alone and let the erase tear itself down.
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
 * `App.tsx`'s mount effect runs `window.history.replaceState({tc:true,
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
 * SECOND physical level the user never asked to skip. This is a pre-existing
 * hazard on `develop` today (confirmed against `App.tsx:85-89` and
 * `:301-302`), not something #452's redesign introduces.
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
 * The one remaining, disclosed limitation is unchanged from today: a reload
 * always shows Books regardless of history depth (no session-restore of which
 * chapter/segment was open). That is an existing, accepted simplification;
 * this fix removes the STACK CORRUPTION a reload could cause, not the
 * "always lands on Books" behavior.
 *
 * `index` must be a non-negative SAFE INTEGER, not merely `typeof === "number"`
 * (Frank R1 P2): every real entry this app ever writes is stamped from
 * `++nextIndex.current` (`App.tsx:78`), a non-negative integer, so `NaN`,
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
