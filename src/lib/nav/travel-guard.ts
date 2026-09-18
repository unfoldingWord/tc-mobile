/**
 * Amendment A of docs/design/back-navigation.md — a shared, tested guard for
 * the two remaining raw `window.history.back()` issuers, grafted from Model
 * 2's `commit()` idea but narrowed to exactly the two issuers Model 1's
 * invariant 1 leaves once overlays are removed from the issuer count
 * entirely: `goBack` (the on-screen and system Back path) and the recorder's
 * commit-close exit (`hooks/use-nav-stack.ts`'s `.then((exited) => { ...
 * window.history.back() })`).
 *
 * This closes F2 in "Resolving every surviving attack finding": no pure
 * function previously owned the shared outstanding-issuer bookkeeping, which
 * is the exact unformalized-adapter-code shape that produced R2-G-P2-1,
 * R2-G-P2-2 and R3-G-P2-1 three separate times across the parked #430 review.
 *
 * WIRED BY PR2 (`hooks/use-nav-stack.ts`): `goBack` calls `beginBack("go-back")`
 * and issues `history.back()` only when it may proceed; the commit-close settle
 * calls `beginBack("commit-close")`; every `popstate` landing clears the guard
 * with `settleOutstanding` at the top of the handler.
 *
 * CORRECTED (George R1 P2-3, PR #492): `beginBack` replaces ONLY
 * `backRequested` — the pre-issue double-tap latch that was at `App.tsx`'s old
 * `goBack` (`if (backRequested.current) return; backRequested.current = true;
 * window.history.back();`). It answers "may THIS issuer call `history.back()`
 * right now?" `suppressPop` answers a different question — "this incoming
 * `popstate` is one WE caused to consume or cancel an entry; do not route it
 * through `popAction` at all" — and stays fully load-bearing in the adapter at
 * every programmatic `history.back()` site this guard does not model:
 *   - `commitCloseRecorder`'s programmatic close (e.g. the erase confirm's
 *     `onExit`, which calls `close()` directly with no `popstate` involved):
 *     `suppressPop.current = true; window.history.back();`
 *   - `trap-forward`'s cancelling `back()`.
 *   - the commit-close settle's consuming `back()`.
 * An implementation that drops `suppressPop` because this docblock read as a
 * full replacement would route one of those self-caused `popstate`s through
 * `popAction` for real — e.g. the programmatic close firing `to-books` and
 * clearing the clipboard on a plain, successful close.
 *
 * `commitCloseRecorder`'s own raw `window.history.back()` is therefore a THIRD
 * raw `window.history.back()` issuer this two-issuer guard does not cover at
 * all — not `goBack`, not the commit-close exit. It is suppressed rather than
 * arbitrated (its `popstate` never reaches `popAction`), so it does not need
 * a slot in `TravelGuardState` for THIS design to be correct. **#493 is
 * answered below for the two issuers this file tracks (2026-09-18, round 4:
 * see `beginBack`'s docblock)** — but the programmatic close's own raw
 * `history.back()` call is outside `TravelGuardState` entirely, so the
 * any-outstanding guard cannot see it or refuse against it. Whether a
 * programmatic close racing an outstanding `goBack`/`commit-close` call can
 * itself coalesce is not evaluated here; noted so it is not missed if this
 * third issuer is ever folded into the guard's accounting.
 *
 * Nothing here touches the DOM, `window`, or React; this file is the pure
 * decision table only.
 */

/**
 * Which of the two surviving raw-`history.back()` issuers is asking.
 */
export type TravelIssuer = "go-back" | "commit-close";

/**
 * Whether each of the two issuers currently has an outstanding, not-yet-settled
 * `history.back()` call in flight. The full state space is exactly these two
 * booleans — four rows, small enough to enumerate completely (Amendment A's
 * table) rather than defended by an unreachable clamp (F5, invariant 10
 * superseded).
 */
export interface TravelGuardState {
  readonly goBackOutstanding: boolean;
  readonly commitCloseOutstanding: boolean;
}

/**
 * The guard's state before any `history.back()` has been issued.
 */
export const initialTravelGuardState: TravelGuardState = {
  goBackOutstanding: false,
  commitCloseOutstanding: false,
};

export interface BeginBackResult {
  /** `true` if this issuer may proceed and call `history.back()`. */
  readonly ok: boolean;
  /** The state to hold until the next `popstate` landing settles it. */
  readonly next: TravelGuardState;
}

/**
 * Whether `issuer` may proceed with a `history.back()` call right now.
 *
 * **The any-outstanding rule (2026-09-18, PR #492 round 4 — answers #493,
 * dev lead decision):** an issuer is refused whenever EITHER flag is already
 * set, regardless of which issuer is asking:
 *
 * | any flag outstanding? | a request from either issuer...            |
 * | ---------------------- | -------------------------------------------- |
 * | no (both false)         | proceeds, sets its own flag                  |
 * | yes (either/both true)  | refused, whichever issuer asks               |
 *
 * `issuer` matters for one thing only: which flag `beginBack` SETS on success
 * (so `settleOutstanding` at the next landing has something to clear) — it
 * plays no part in the refusal decision itself, which checks BOTH flags.
 *
 * When refused, `next` is the unchanged input state — the caller must NOT
 * proceed: do not call `history.back()`, and do not `pushState` either. The
 * stack simply did not move. This is unchanged from an earlier correction
 * (George R1 P2-2, PR #492) that removed a false "must re-arm instead"
 * analogy to `routeBackToLayer`'s `"refused-busy"` — that case is decided
 * AFTER a `popstate` has already popped an entry, so re-arming there means
 * restoring what the browser just consumed. `beginBack` is decided BEFORE
 * `history.back()` is ever called — it is the pure form of the pre-issue
 * double-tap latch the adapter's `goBack` used to spell inline, which also
 * did nothing on refusal, not push a fresh entry. Pushing here would be
 * actively harmful: it would call `pushState` while an outstanding
 * `history.back()` call has not yet settled, which is exactly the
 * coalescing/desync hazard the adapter's own comments name. The re-arm
 * language belongs to `routeBackToLayer`'s `"refused-busy"` case only, not
 * here.
 *
 * **ANSWERS #493 (2026-09-18, PR #492 round 4), superseding the ORIGINAL
 * per-issuer matrix this function shipped with (Frank R1/R2/R4/R5 on PR
 * #492):** the retired matrix refused an issuer only against its OWN
 * outstanding flag, reasoning that `goBack` and the recorder's commit-close
 * exit target different physical history entries and so "do not contend."
 * That addressed LOGICAL contention only. It did not address BROWSER-API
 * contention: two `window.history.back()` calls issued before the first
 * one's `popstate` has landed can coalesce into a single multi-entry
 * traversal in some browsers, independent of which entries they logically
 * target — the same class of hazard the old `backRequested` double-tap latch
 * already guarded against for a SINGLE issuer, just not across issuers.
 * Collapsing the refusal to any-outstanding removes the possibility of two
 * calls being simultaneously outstanding at all, so the coalescing question
 * cannot arise regardless of which browser's History implementation is asked.
 * This answers #493 rather than deferring it again; it does not claim to have
 * observed browser coalescing behavior directly (Frank's confidence on that
 * was itself "medium" — browser-dependent), only that the any-outstanding rule
 * removes the precondition the hazard needs.
 */
export function beginBack(
  state: TravelGuardState,
  issuer: TravelIssuer
): BeginBackResult {
  const anyOutstanding =
    state.goBackOutstanding || state.commitCloseOutstanding;
  if (anyOutstanding) {
    return { ok: false, next: state };
  }
  const next: TravelGuardState =
    issuer === "go-back"
      ? { ...state, goBackOutstanding: true }
      : { ...state, commitCloseOutstanding: true };
  return { ok: true, next };
}

/**
 * Clear the guard at a `popstate` landing, WITHOUT naming an issuer (#494 item
 * 2, 2026-09-18). This is the settle the adapter uses at the one place
 * `App.tsx`'s live latch cleared today — the top of the `popstate` handler
 * (`backRequested.current = false`), which runs on EVERY landing and knows
 * nothing about WHICH issuer's `history.back()` just settled.
 *
 * `beginBack`'s refusal is any-issuer (the #492 round 4 / #493 decision), so
 * the landing settle must be any-issuer too. A per-issuer settle at an
 * issuer-blind site — e.g. always clearing `goBackOutstanding` — would clear
 * the WRONG flag whenever the settling call was the recorder's commit-close
 * exit, leaving `commitCloseOutstanding` stuck true; after which every later
 * `beginBack`, from either issuer, is refused and on-screen Back is dead for
 * the rest of the session (#494 item 2 warns against exactly this port).
 * `settleOutstanding` is the issuer-blind counterpart of the any-issuer
 * `beginBack`: it returns the guard to `initialTravelGuardState` so the next
 * `beginBack` proceeds.
 *
 * Defined TOTAL — it clears BOTH flags for ANY input, the both-set state
 * included (the returned value is deep-equal to `initialTravelGuardState`) —
 * not "clear whichever single flag is set". The both-set state is unreachable
 * THROUGH `beginBack` under the any-outstanding rule (a second `beginBack` is
 * refused before a second flag can be set), but it is a legal value of the
 * two-boolean `TravelGuardState` type, so this function's correctness must not
 * depend on that invariant holding elsewhere — hence both flags are set false
 * unconditionally rather than one conditionally.
 */
export function settleOutstanding(state: TravelGuardState): TravelGuardState {
  return { ...state, goBackOutstanding: false, commitCloseOutstanding: false };
}
