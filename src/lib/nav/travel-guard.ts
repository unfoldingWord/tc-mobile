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
 * a slot in `TravelGuardState` for THIS design to be correct. **#493 is
 * answered below for the two issuers this file tracks (2026-09-18, round 4:
 * see `beginBack`'s docblock)** — but `closeRecorder`'s own raw
 * `history.back()` call is outside `TravelGuardState` entirely, so the
 * any-outstanding guard cannot see it or refuse against it. Whether a
 * `closeRecorder` call racing an outstanding `goBack`/`commit-close` call can
 * itself coalesce is not evaluated here; noted so it is not missed if this
 * third issuer is ever folded into the guard's accounting.
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
 * **The any-outstanding rule (2026-09-18, PR #492 round 4 — answers #493,
 * dev lead decision):** an issuer is refused whenever EITHER flag is already
 * set, regardless of which issuer is asking:
 *
 * | any flag outstanding? | a request from either issuer...            |
 * | ---------------------- | -------------------------------------------- |
 * | no (both false)         | proceeds, sets its own flag                  |
 * | yes (either/both true)  | refused, whichever issuer asks               |
 *
 * `issuer` still matters for two things only: which flag `beginBack` SETS on
 * success, and which flag `settleBack` clears (see below) — it plays no part
 * in the refusal decision itself, which now checks BOTH flags.
 *
 * When refused, `next` is the unchanged input state — the caller must NOT
 * proceed: do not call `history.back()`, and do not `pushState` either. The
 * stack simply did not move. This is unchanged from an earlier correction
 * (George R1 P2-2, PR #492) that removed a false "must re-arm instead"
 * analogy to `routeBackToLayer`'s `"refused-busy"` — that case is decided
 * AFTER a `popstate` has already popped an entry (`App.tsx:301-311`), so
 * re-arming there means restoring what the browser just consumed. `beginBack`
 * is decided BEFORE `history.back()` is ever called — it is the pure form of
 * the pre-issue double-tap latch already at `App.tsx:101-103`
 * (`if (backRequested.current) return;`), which also does nothing on
 * refusal, not push a fresh entry. Pushing here would be actively harmful: it
 * would call `pushState` while an outstanding `history.back()` call has not
 * yet settled, which is exactly the coalescing/desync hazard
 * `App.tsx:98-100`'s comment already names. The re-arm language belongs to
 * `routeBackToLayer`'s `"refused-busy"` case only, not here.
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
 * target — the same class of hazard `App.tsx`'s existing `backRequested`
 * double-tap latch already guards against for a SINGLE issuer, just not
 * across issuers. Collapsing the refusal to any-outstanding removes the
 * possibility of two calls being simultaneously outstanding at all, so the
 * coalescing question cannot arise regardless of which browser's History
 * implementation is asked. This answers #493 rather than deferring it again;
 * it does not claim to have observed browser coalescing behavior directly
 * (Frank's confidence on that was itself "medium" — browser-dependent), only
 * that the any-outstanding rule removes the precondition the hazard needs.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
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

/**
 * Clear the guard at a `popstate` landing, WITHOUT naming an issuer (#494 item
 * 2, 2026-09-18). This is the settle the adapter uses at the one place
 * `App.tsx`'s live latch clears today — the top of the `popstate` handler
 * (`App.tsx:287-291`, `backRequested.current = false`), which runs on EVERY
 * landing and knows nothing about WHICH issuer's `history.back()` just
 * settled.
 *
 * `settleBack` is per-issuer; `beginBack`'s refusal is any-issuer (the #492
 * round 4 / #493 decision). Those two do not compose at an issuer-blind site:
 * a literal port of the old undifferentiated latch to `settleBack(state,
 * "go-back")` at the landing clears the WRONG flag whenever the settling call
 * was the recorder's commit-close exit, leaving `commitCloseOutstanding` stuck
 * true — after which every later `beginBack`, from either issuer, is refused
 * and on-screen Back is dead for the rest of the session. `settleOutstanding`
 * is the issuer-blind counterpart of the any-issuer `beginBack`: it returns
 * the guard to `initialTravelGuardState` so the next `beginBack` proceeds.
 *
 * Defined TOTAL — it clears BOTH flags for ANY input, the both-set state
 * included (the returned value is deep-equal to `initialTravelGuardState`) —
 * not "clear whichever single flag is set". The both-set state is unreachable
 * THROUGH `beginBack` under the any-outstanding rule (a second `beginBack` is
 * refused before a second flag can be set), but it is a legal value of the
 * two-boolean `TravelGuardState` type, so this function's correctness must not
 * depend on that invariant holding elsewhere — hence both flags are set false
 * unconditionally rather than one conditionally.
 *
 * @pivotpending #452 — PR2 (hooks/use-nav-stack.ts) wires it.
 */
export function settleOutstanding(state: TravelGuardState): TravelGuardState {
  return { ...state, goBackOutstanding: false, commitCloseOutstanding: false };
}
