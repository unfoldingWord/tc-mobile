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
 *
 * `menuBusy` is the ONE menu-side exception to that: Books' New Book dialog
 * (`onCancelNewBook`) refuses to close while its own create write is in
 * flight — the write cannot be recalled, unlike a rename, which just lands
 * silently underneath the closed menu. Optional and defaulted false so the
 * recorder's and Segments' call sites (neither has a menu with this shape)
 * do not need to know this parameter exists (Frank, on 25faf3f, #393): App's
 * `dismissingOverlay` latch reads `closeMenu || closeConfirm` back from this
 * function's own result, so hoisting the refusal here — rather than
 * duplicating `creatingBook.current`'s check inline at the call site — is
 * what keeps that "did anything actually close" decision a single, tested
 * source of truth instead of two copies that can drift.
 */
export function overlayDismissal(
  menuOpen: boolean,
  confirmOpen: boolean,
  erasing: boolean,
  menuBusy = false
): { closeMenu: boolean; closeConfirm: boolean } {
  return {
    closeMenu: menuOpen && !menuBusy,
    closeConfirm: confirmOpen && !erasing,
  };
}

/**
 * The arithmetic `App.tsx`'s `onPopState` needs to tell "a popstate we caused
 * ourselves" from "a genuine navigation" — extracted here, pure, because
 * George's round 2 AND round 3 reviews both found a real bug in it while it
 * lived only as refs in `App.tsx` (P2-1/P2-2 both rounds): a single boolean
 * (`suppressPop`) can mark "ignore exactly the next popstate", but this app
 * can have MORE than one of its own `history.back()` calls outstanding at
 * once (an overlay consume, `closeRecorder`'s programmatic close, and the
 * on-screen Back can all fire in overlapping windows), and the browser is
 * free to deliver those as separate, sequential popstates OR coalesce them
 * into ONE popstate whose destination index jumps by more than one level
 * (this file already documents that coalescing as fact — see `goBack`'s own
 * comment in `App.tsx`). A single bit cannot represent "two are outstanding,
 * only one landed" or "one was outstanding, but the actual jump was two
 * levels, so one level of this belongs to something else."
 *
 * `outstandingBacks` is that count — how many of THIS app's own `back()`
 * calls have not yet landed as a popstate. `delta` is `fromIndex - toIndex`:
 * the REAL number of index levels a landed popstate actually traversed
 * backward, read from the entries' own monotonic index rather than counted
 * per-event. Comparing the two (not counting popstates 1-for-1 against
 * `back()` calls) is what makes this correct under EITHER delivery: as many
 * of `delta`'s levels as `outstandingBacks` allows are attributed to this
 * app's own bookkeeping (returned as the new, decremented count); anything
 * beyond that is `remaining` — a genuine navigation that happened to land
 * coalesced into the same popstate as our own consume, and must still be
 * routed exactly as if it had arrived as its own separate popstate.
 *
 * Returns `null` when nothing of this app's own is outstanding (or the
 * popstate did not move backward at all — forward/same are `navDirection`'s
 * concern, not this function's) — the ordinary case, meaning: route this
 * popstate normally, nothing to reconcile first.
 *
 * **Precondition — `delta` must be an actual traversal count, not merely a
 * difference of two labels.** Frank, on `11775a6` (#393): `App.tsx` used to
 * stamp each pushed entry from a globally monotonic counter, incremented on
 * every push and never reset. That works for `navDirection`'s simple
 * greater/less/equal comparison, but NOT for this function's arithmetic — a
 * Back (which the real History API always processes by walking to an
 * adjacent entry, never by "jumping" past one still on the stack) followed
 * by a re-push truncates the browser's own forward entries and starts a new
 * one from the CURRENT position, so the real stack is exactly as deep as it
 * was before the Back — but a global counter keeps counting up regardless,
 * leaving a gap between the label the app last saw and the one it stamps
 * next that does not correspond to any real traversal at all. Feeding that
 * gap in as `delta` manufactures a phantom "extra" navigation this function
 * then (correctly, given its input) reports as `remaining` — the actual bug
 * was in what `App.tsx` computed before calling this, never in this
 * function's own arithmetic, which is why fixing it needed no change here:
 * `App.tsx`'s `navIndex` ref must always be stamped as an actual, current
 * depth (see its own comment), never from an independent counter.
 */
export interface PopStateReconciliation {
  /** `outstandingBacks`, after this popstate's displacement is attributed
   *  against it. Zero once every `back()` this app had in flight has landed. */
  outstandingBacks: number;
  /** Displacement beyond what this app had outstanding — 0 in the common
   *  case; a genuine extra navigation, coalesced into the same popstate,
   *  that still needs routing when greater than 0. */
  remaining: number;
  /**
   * What to do with `pushState` calls deferred while a `back()` was
   * outstanding (George round 4 P2-3, #393) — a THIRD field, not left for the
   * caller to re-derive from the two above, because getting it wrong is
   * exactly this finding: draining unconditionally as soon as
   * `outstandingBacks` reaches 0 (App's round-3 code) ignored `remaining`,
   * so a queued push (an overlay open, `openChapter`, `openRecorder`)
   * requested for the screen THIS popstate is now routing AWAY from (a
   * genuine coalesced Back) still landed on it — pushing a chapter/recorder
   * entry the very same event's routing step immediately closes again.
   *
   * - `"hold"` — `outstandingBacks` has not yet reached 0; more of this
   *   app's own `back()`s are still outstanding. Never drain here: a push
   *   landing while a further back() is in flight is the original hazard
   *   `queuedPushes` exists to prevent (Frank round 1 / George round 1
   *   P2-2). Reachable only when `remaining` is 0 (see below).
   * - `"drain"` — every outstanding `back()` has resolved AND nothing is
   *   left over (`remaining` is 0): the popstate this app expected has
   *   landed exactly, so whatever was queued for the CURRENT screen is
   *   still valid and should be pushed for real, in order.
   * - `"drop"` — every outstanding `back()` has resolved but `remaining` is
   *   greater than 0: a genuine extra navigation coalesced into this same
   *   popstate, which the caller is about to route (leaving the screen the
   *   queued push targeted). Discard the queue without pushing — "a queued
   *   `openRecorder` is for the screen you are leaving" (George's own
   *   words); materializing it here would be the exact defect this finding
   *   names.
   *
   * `"drain"` and `"drop"` are mutually exclusive with `"hold"` and with
   * each other precisely because `remaining` can only be nonzero once
   * `outstandingBacks` has fully resolved to 0 (`consumed` cannot exceed
   * `outstandingBacks`, so `outstandingBacks - consumed === 0` is a
   * precondition for `delta - consumed > 0` ever being reachable) — there is
   * no state where BOTH "more is still outstanding" and "a genuine extra
   * navigation landed" are true at once.
   */
  queuedPushAction: "hold" | "drain" | "drop";
}

export function reconcilePopState(
  outstandingBacks: number,
  delta: number
): PopStateReconciliation | null {
  if (outstandingBacks <= 0 || delta <= 0) return null;
  const consumed = Math.min(delta, outstandingBacks);
  const remainingOutstanding = outstandingBacks - consumed;
  const remaining = delta - consumed;
  return {
    outstandingBacks: remainingOutstanding,
    remaining,
    queuedPushAction:
      remainingOutstanding > 0 ? "hold" : remaining > 0 ? "drop" : "drain",
  };
}

/**
 * What `App.tsx`'s `pushHistoryEntry` did with a request to protect a new
 * screen or overlay with a history entry (George round 5 P1, #393):
 *
 * - `"pushed"` — a real `pushState` ran immediately; the entry exists now.
 * - `"queued"` — deferred behind an outstanding, app-issued `back()`
 *   (`outstandingBacks`) that is expected to fully resolve; `reconcilePopState`
 *   drains it once that happens (`queuedPushAction: "drain"`), so the entry
 *   still lands, just not synchronously.
 * - `"refused"` — an on-screen Back (`goBack`) already has its OWN routed
 *   `back()` outstanding (`backRequested`). Unlike `"queued"`, nothing here
 *   will ever push this entry: `goBack`'s popstate is what decides the next
 *   screen, and it is decided from live state read fresh when that popstate
 *   lands, not from an entry this call could have pushed underneath it.
 */
export type HistoryPushOutcome = "pushed" | "queued" | "refused";

/**
 * Whether a caller that asked for a protective history entry may go ahead
 * with the UI change that entry was meant to protect (George round 5 P1,
 * #393). Round 5 introduced `pushHistoryEntry`'s `"refused"` outcome (a
 * REFUSE, not a queue, while an on-screen Back's own `back()` is outstanding)
 * but left every caller unconditional — `openRecorder`/`openChapter` still
 * called `setRecorder`/`setChapterId`, and the Books/Segments overlay layout
 * effects still latched `overlayEntryPushed = true`, regardless of the
 * outcome. That desynced the screen the user was looking at from the history
 * stack meant to model it: the in-flight `goBack` popstate, once it lands,
 * reads LIVE `screenFor`/`hasOpenOverlay()` state to decide where to route —
 * state this now-unconditional UI change had already moved out from under it
 * with no matching entry to show for it (App.tsx `onPopState`, `screenFor`).
 *
 * `"pushed"` and `"queued"` both still get an entry — the second, later,
 * once `outstandingBacks` drains — so proceeding is safe either way; only
 * `"refused"` means no entry is ever coming and the in-flight `goBack` is
 * what owns the screen instead. This is deliberately the ONLY thing this
 * fix changes: the "stronger" variants George also offered (keep
 * `backRequested` set past `popAction` itself; route from a screen/overlay
 * snapshot taken at `goBack`-issue time rather than live state) are a
 * history-stack model change, scoped out of this round to a design-pass
 * issue instead (#393's round-5 P2-2/P2-3 are the same family of concern).
 */
export function shouldProceedAfterPush(outcome: HistoryPushOutcome): boolean {
  return outcome !== "refused";
}
