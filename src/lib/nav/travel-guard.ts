/**
 * Amendment A of docs/design/back-navigation.md — a shared, tested guard for
 * the two remaining raw `window.history.back()` issuers, grafted from Model
 * 2's `commit()` idea but narrowed to exactly the two issuers Model 1's
 * invariant 1 leaves once overlays are removed from the issuer count
 * entirely: `goBack` (the on-screen and system Back path) and the recorder's
 * commit-close exit (`App.tsx`'s `.then((exited) => { ... window.history.back()
 * })`).
 *
 * This closes F2 in "Resolving every surviving attack finding": no pure
 * function previously owned the shared outstanding-issuer bookkeeping, which
 * is the exact unformalized-adapter-code shape that produced R2-G-P2-1,
 * R2-G-P2-2 and R3-G-P2-1 three separate times across the parked #430 review.
 *
 * CORRECTED (George R1 P2-3, PR #492): `beginBack`/`settleBack` replace ONLY
 * `backRequested` — the pre-issue double-tap latch at `App.tsx:101-103`
 * (`if (backRequested.current) return; backRequested.current = true;
 * window.history.back();`). They answer "may THIS issuer call
 * `history.back()` right now?" `suppressPop` answers a different question —
 * "this incoming `popstate` is one WE caused to consume or cancel an entry;
 * do not route it through `popAction` at all" (`App.tsx:296-299`) — and stays
 * fully load-bearing at every programmatic `history.back()` site this matrix
 * does not model:
 *   - `App.tsx:266-268` — `closeRecorder`'s programmatic close (e.g. the
 *     erase confirm's `onExit`, which calls `close()` directly with no
 *     `popstate` involved): `suppressPop.current = true; window.history.back();`
 *   - `App.tsx:340-341` — `trap-forward`'s cancelling `back()`.
 *   - `App.tsx:358-360` — the commit-close settle's consuming `back()`.
 * An implementation that drops `suppressPop` because this docblock read as a
 * full replacement would route one of those self-caused `popstate`s through
 * `popAction` for real — e.g. `closeRecorder` firing `to-books` and clearing
 * the clipboard on a plain, successful close.
 *
 * `closeRecorder` (`App.tsx:266-268`) is therefore a THIRD raw
 * `window.history.back()` issuer this two-issuer matrix does not cover at
 * all — not `goBack`, not the commit-close exit. It is suppressed rather than
 * arbitrated (its `popstate` never reaches `popAction`), so it does not need
 * a slot in `TravelGuardState` for THIS design to be correct, but it is one
 * more raw issuer for whoever eventually answers #493's cross-issuer
 * coalescing question to account for — noted here so it is not missed when
 * that's revisited.
 *
 * The wiring — rewriting `goBack` to call `beginBack`/`settleBack` instead of
 * touching `backRequested` directly, and doing the same for the recorder's
 * commit-close exit's OWN outstanding-issuer bookkeeping (while leaving
 * `suppressPop` exactly as it is at every site above) — is PR2
 * (`hooks/use-nav-stack.ts`). Nothing here touches the DOM, `window`, or
 * React; this file is the pure decision table only.
 */

/**
 * Which of the two surviving raw-`history.back()` issuers is asking.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export type TravelIssuer = "go-back" | "commit-close";

/**
 * Whether each of the two issuers currently has an outstanding, not-yet-settled
 * `history.back()` call in flight. The full state space is exactly these two
 * booleans — four rows, small enough to enumerate completely (Amendment A's
 * table) rather than defended by an unreachable clamp (F5, invariant 10
 * superseded).
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export interface TravelGuardState {
  readonly goBackOutstanding: boolean;
  readonly commitCloseOutstanding: boolean;
}

/**
 * The guard's state before any `history.back()` has been issued.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export const initialTravelGuardState: TravelGuardState = {
  goBackOutstanding: false,
  commitCloseOutstanding: false,
};

/**
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export interface BeginBackResult {
  /** `true` if this issuer may proceed and call `history.back()`. */
  readonly ok: boolean;
  /** The state to hold until the corresponding `settleBack` call. */
  readonly next: TravelGuardState;
}

/**
 * Whether `issuer` may proceed with a `history.back()` call right now.
 *
 * Per Amendment A's table: an issuer is refused only when it has its OWN
 * outstanding call still unsettled — never by the other issuer's outstanding
 * call, because a `goBack` and the recorder's commit-close exit consume
 * different physical history entries and do not contend with each other. This
 * single rule reproduces all four rows of the matrix:
 *
 * | `goBackOutstanding` | `commitCloseOutstanding` | a third request...                        |
 * | -------------------- | ------------------------- | ------------------------------------------ |
 * | false                 | false                      | proceeds, sets its own flag                 |
 * | true                  | false                      | refused if another `goBack`; a commit-close request proceeds independently |
 * | false                 | true                       | mirror of the above                         |
 * | true                  | true                       | refused entirely (either issuer)            |
 *
 * When refused, `next` is the unchanged input state — the caller must NOT
 * proceed: do not call `history.back()`, and do not `pushState` either. The
 * stack simply did not move. This is corrected from an earlier version of
 * this docblock (George R1 P2-2, PR #492) that said a refusal "must re-arm
 * instead", drawing a false analogy to `routeBackToLayer`'s `"refused-busy"`
 * — that case is decided AFTER a `popstate` has already popped an entry
 * (`App.tsx:301-311`), so re-arming there means restoring what the browser
 * just consumed. `beginBack` is decided BEFORE `history.back()` is ever
 * called — it is the pure form of the pre-issue double-tap latch already at
 * `App.tsx:101-103` (`if (backRequested.current) return;`), which also does
 * nothing on refusal, not push a fresh entry. Pushing here would be actively
 * harmful: it would call `pushState` while the FIRST `history.back()` call is
 * still outstanding, which is exactly the coalescing/desync hazard
 * `App.tsx:98-100`'s comment already names — a later `popstate` could then
 * skip a level or misread as `"forward"`. The re-arm language belongs to
 * `routeBackToLayer`'s `"refused-busy"` case only, not here.
 *
 * OPEN RISK, not fixed here (tracked: #493, Frank R1 on PR #492): the
 * "different physical entries do not contend" reasoning above addresses
 * LOGICAL contention (which entry each call targets), not BROWSER-API
 * contention — two `window.history.back()` calls issued before the first
 * one's `popstate` has landed can coalesce into a single multi-entry
 * traversal in some browsers, independent of which entries they logically
 * target (the same class of hazard `App.tsx`'s existing `backRequested`
 * double-tap latch already guards against for a SINGLE issuer). This function
 * faithfully implements the design document's own stated matrix
 * (docs/design/back-navigation.md, Amendment A) as written; revising that
 * matrix — e.g. collapsing both flags into one `anyOutstanding` guard — is a
 * design decision, not a PR1 implementation bug, and needs DRI review before
 * PR2 wires this into real `history.back()` calls. Nothing in this PR (#452
 * PR1) calls `history.back()` at all, so the concrete failure scenario #493
 * describes cannot occur from this PR's code.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export function beginBack(
  state: TravelGuardState,
  issuer: TravelIssuer
): BeginBackResult {
  const alreadyOutstanding =
    issuer === "go-back"
      ? state.goBackOutstanding
      : state.commitCloseOutstanding;
  if (alreadyOutstanding) {
    return { ok: false, next: state };
  }
  const next: TravelGuardState =
    issuer === "go-back"
      ? { ...state, goBackOutstanding: true }
      : { ...state, commitCloseOutstanding: true };
  return { ok: true, next };
}

/**
 * Clear `issuer`'s outstanding flag once its `history.back()` has settled
 * (the `popstate` it caused has landed, or it was cancelled). Idempotent: no
 * matter what the flag's current value is, settling always clears it.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export function settleBack(
  state: TravelGuardState,
  issuer: TravelIssuer
): TravelGuardState {
  return issuer === "go-back"
    ? { ...state, goBackOutstanding: false }
    : { ...state, commitCloseOutstanding: false };
}
