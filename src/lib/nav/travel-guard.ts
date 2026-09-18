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
 * The wiring — rewriting `goBack` and the recorder's commit-close exit to
 * call `beginBack`/`settleBack` instead of touching `backRequested`/
 * `suppressPop` directly — is PR2 (`hooks/use-nav-stack.ts`). Nothing here
 * touches the DOM, `window`, or React; this file is the pure decision table
 * only.
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
 * proceed, and must re-arm instead (this mirrors `routeBackToLayer`'s
 * `"refused-busy"` shape: the pure function only reports the decision, it
 * never mutates anything itself).
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
