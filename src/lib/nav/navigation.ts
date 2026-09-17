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
 */
export type PopAction =
  | "trap-recovery"
  | "trap-database-panel"
  | "rearm-during-commit"
  | "trap-forward"
  | "ignore"
  | BackEffect;

export function popAction(
  direction: NavDirection,
  screen: Screen,
  committing: boolean,
  recovering: boolean,
  databasePanel = false
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
