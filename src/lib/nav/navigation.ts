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
 *
 * Books and Segments each open their own overlays (a ≡ menu, New Book, a rename,
 * a delete/erase confirm) that push no history entry of their own and have no
 * `popstate` awareness — only their OWN scrim/Close/Escape can dismiss them
 * (#393, #374). `popAction`'s `screenOverlayOpen` parameter and the
 * `"dismiss-screen-overlay"` effect close that gap the same way the recorder's
 * `overlayBlocksClose`/`overlayDismissal` already close it for its own ≡
 * menu/erase-confirm: the screen, not the popstate handler, decides whether an
 * overlay absorbs the gesture, and the handler re-arms a fresh entry either way.
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
 * `trap-recovery` and `rearm-during-commit` both re-arm by pushing a fresh entry;
 * they are named apart so the handler's intent — and each test row — stays legible.
 *
 * - **Books or Segments has an open overlay (`screenOverlayOpen`)** →
 *   `dismiss-screen-overlay`, checked after every trap/trip above but BEFORE the
 *   plain `backEffectFor` mapping (#393, #374). Books' ≡ menu, New Book, a
 *   rename, and Books'/Segments' delete/erase confirm push no history entry of
 *   their own and have no `popstate` awareness, so a system Back used to walk
 *   straight past them to `to-books`/`exit-app` — silently abandoning a typed
 *   name, or (worse) leaving a rename/delete committing with no menu open to
 *   show it, exactly the class of loss `commit-close-recorder` exists to
 *   prevent for the recorder. Never checked for `screen === "recorder"`: that
 *   screen's own overlays are handled entirely inside `commit-close-recorder`
 *   via `overlayBlocksClose`/`overlayDismissal`, unchanged.
 */
export type PopAction =
  | "trap-recovery"
  | "rearm-during-commit"
  | "trap-forward"
  | "ignore"
  | "dismiss-screen-overlay"
  | BackEffect;

export function popAction(
  direction: NavDirection,
  screen: Screen,
  committing: boolean,
  recovering: boolean,
  // Optional and defaulted false so `screen === "recorder"` call sites (and
  // every existing test row) do not need to know this parameter exists — the
  // recorder's own overlays never reach it (guarded below), and the app only
  // ever passes true when Books' or Segments' OWN state says an overlay of its
  // own is open.
  screenOverlayOpen = false
): PopAction {
  if (recovering) return "trap-recovery";
  if (committing) return "rearm-during-commit";
  if (direction === "forward") return "trap-forward";
  if (direction === "same") return "ignore";
  if (screen !== "recorder" && screenOverlayOpen)
    return "dismiss-screen-overlay";
  return backEffectFor(screen);
}

/**
 * Whether a Back must be spent dismissing an open overlay instead of running
 * the screen's own effect — originally the recorder's commit (George R2 G1),
 * now shared with Books and Segments' ≡ menus and delete/erase confirms
 * (#393, #374, generalised from the recorder-only version).
 *
 * On the recorder, the HEADER's `inert` — not the sheet's, which stays reachable
 * for the transport during an active take (#75, corrected here per #376; the
 * sheet is inert only at idle) — is what blocks the ON-SCREEN Back while the ≡
 * menu or the erase-confirm is up. The SYSTEM gesture reaches `close()` through
 * the imperative handle regardless of either `inert` flag, so without this a
 * Back during an in-flight erase raced `saveEditedSegment` against the erase
 * (last IndexedDB writer wins, the confirmed-erased take written back), and a
 * Back over the confirm dialog committed instead of cancelling. Books and
 * Segments have the identical gap for their OWN ≡ menu / delete-confirm: they
 * push no history entry and have no `popstate` awareness at all, so a system
 * Back walked straight past them to `exit-app`/`to-books`.
 *
 * When this returns true, the screen dismisses the overlay instead of running
 * its Back effect: the recorder's `close()` resolves `false` (the sheet stays,
 * its history entry re-armed); Books/Segments call their own overlay-dismiss
 * and the popstate handler re-arms a fresh entry (`"dismiss-screen-overlay"`)
 * the same way. It commits/navigates only when nothing is in the way.
 */
export function overlayBlocksClose(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean
): boolean {
  return menuOpen || confirmOpen || erasing;
}

/**
 * When a system Back is absorbed by an open overlay (`overlayBlocksClose` is
 * true), WHICH overlays may be dismissed (Frank R4-1, generalised for #393/#374).
 * The menu and a confirm dialog still awaiting the user ARE dismissed; a confirm
 * whose destructive action is ALREADY IN FLIGHT is NOT — `erasing` is the
 * recorder's and Segments' shared `EraseConfirm`/`erase.erasing`, and the same
 * shape guards Books' delete confirm against `deleting`.
 *
 * On the recorder, `onConfirmErase` deliberately holds `confirmOpen` true across
 * the whole IndexedDB delete so the overlay stays up throughout — `erase.erasing`
 * is folded into the sheet's `overlayUp` flag directly (not only read as a reason
 * to hold `confirmOpen`, per #376's correction), which is what keeps the HEADER
 * inert for the whole erase even if `confirmOpen` were ever cleared out from
 * under it. Dismissing the confirm mid-erase would let a system Back reach
 * Record again — whose newly started capture the erase's own completion
 * (`onExit`) then discards. So while erasing/deleting, leave the confirm alone
 * and let the operation tear itself down.
 *
 * A rename in flight (Books'/Segments' `NameEdit`) is deliberately NOT held this
 * way: the menu dismisses under a saving rename exactly like an on-screen Close
 * already does, since #384's own Menu-level guard against that was reverted —
 * the write lands silently, the same as it did before #384. Only the
 * confirm/`erasing` pairing above blocks a dismiss; `menuOpen` alone never does.
 */
export function overlayDismissal(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean
): { closeMenu: boolean; closeConfirm: boolean } {
  return { closeMenu: menuOpen, closeConfirm: confirmOpen && !erasing };
}
