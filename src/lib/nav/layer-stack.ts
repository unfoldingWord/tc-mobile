/**
 * The pure decision half of the layer stack (docs/design/back-navigation.md,
 * "The chosen design" → "Pure core", Model 1 / "Sentinel-per-depth + layer
 * stack"). An overlay — a menu, a dialog, a confirm, a rename mode — never
 * touches `window.history` (invariant 1): it registers itself here instead,
 * and a `popstate` is routed to the top of this stack before it is ever
 * allowed to reach a real screen transition (invariant 3).
 *
 * This file owns ONLY the decision. The adapter that owns the actual
 * `Layer[]` ref, calls `pushLayer`/`popLayer` imperatively from click handlers
 * (never from an effect — invariant 6), and performs the `dismiss()`/refuse a
 * `routeBackToLayer` result names, is `hooks/use-nav-stack.ts` (#452 PR2).
 * Nothing here touches the DOM, `window`, or React.
 */

/**
 * One open overlay. `id` identifies it for the caller (not compared for
 * equality by anything in this file); `dismiss()` is what a non-busy Back
 * runs.
 *
 * `busy` MUST be a function that reads a live ref at call time — synchronously
 * flipped at the start of the guarded write it protects — never a snapshot
 * boolean captured when the `Layer` was constructed, and never a closure over
 * a `useState` value read at render time. This is invariant 4
 * (docs/design/back-navigation.md): a `useState` snapshot is exactly the bug
 * `develop` still has at `recorder.tsx:2014`, where the erase-confirm's
 * `busy`-equivalent reads `erase.erasing` (the state) rather than a ref, and
 * can therefore observe a value one render stale. A `LayerStack` consumer that
 * captures a boolean instead of passing a ref-reading function reintroduces
 * that exact defect class silently — `routeBackToLayer` has no way to tell
 * the two shapes apart, because both type-check identically as `() => boolean`
 * at the call site; only the ref-backed one can ever reflect a synchronous
 * flip with no intervening render. See the "busy()-is-a-ref" negative example
 * in `tests/nav-layer-stack.test.ts`. */
export interface Layer {
  readonly id: string;
  busy(): boolean;
  dismiss(): void;
}

/**
 * Screen-scoped stack of open overlays, bottom-to-top open order. */
export type LayerStack = readonly Layer[];

/**
 * The most-recently-opened layer, or `undefined` for an empty stack. */
export function topLayer(stack: LayerStack): Layer | undefined {
  return stack[stack.length - 1];
}

/**
 * The result of routing a Back against a layer stack. `routeBackToLayer` never
 * calls `dismiss()` itself, and it never touches history — it names WHICH
 * layer (if any) is on top and whether it is busy; nothing more.
 *
 * IMPORTANT, corrected per George R1 P2-1 (PR #492): this type does NOT, by
 * itself, say what the adapter must do with the browser's history entry. An
 * earlier version of this docblock claimed the adapter re-arms only on
 * `"refused-busy"` and does nothing on `"dismiss"` — that was backwards. A
 * `popstate` has already popped the screen-depth entry before any of this
 * runs, exactly like every other non-screen intercept in `popAction`
 * (`trap-recovery`/`trap-database-panel`/`rearm-transition-busy` all re-arm),
 * so BOTH a `"dismiss"` and a `"refused-busy"`
 * outcome require the adapter to re-arm; `"dismiss"` additionally calls
 * `dismiss()` on the named layer. That full, corrected contract is encoded
 * where the adapter actually reads it — `navigation.ts`'s `popAction`, as the
 * string tags `"rearm-layer-dismiss"` / `"rearm-layer-busy"` — not here. This
 * type stays three-way (`empty`/`dismiss`/`refused-busy`) because it is still
 * useful as the narrower, per-layer decision `popAction` builds on. */
export type RouteBackToLayerResult =
  | { readonly kind: "empty" }
  | { readonly kind: "refused-busy"; readonly layerId: string }
  | { readonly kind: "dismiss"; readonly layerId: string };

/**
 * Route a Back gesture against a screen's layer stack (invariant 3: only the
 * TOP entry is ever asked to dismiss; a layer below the top is never touched).
 *
 * - Empty stack → `{kind: "empty"}`; the caller falls through to
 *   `backEffectFor`/`popAction`'s screen-level routing.
 * - Non-empty, top not busy → `{kind: "dismiss", layerId}`.
 * - Non-empty, top busy → `{kind: "refused-busy", layerId}`.
 *
 * See `RouteBackToLayerResult`'s docblock for what the adapter must actually
 * do with each of these (both non-empty outcomes re-arm the screen-depth
 * entry the `popstate` already consumed; `"dismiss"` additionally dismisses
 * the named layer) — `navigation.ts`'s `popAction` is where that full
 * contract is encoded, as `"rearm-layer-dismiss"` / `"rearm-layer-busy"`.
 *
 * `navigation.ts`'s `popAction` calls this once `layerStack` is non-empty.
 * The adapter (`hooks/use-nav-stack.ts`, #452 PR2) owns the stack. Books'
 * overlays push onto it as of PR3; Segments' follow in PR4. */
export function routeBackToLayer(stack: LayerStack): RouteBackToLayerResult {
  const layer = topLayer(stack);
  if (!layer) return { kind: "empty" };
  if (layer.busy()) return { kind: "refused-busy", layerId: layer.id };
  return { kind: "dismiss", layerId: layer.id };
}

/**
 * ── Amendment G: the FLOOR entry (#452 PR3, #374) ─────────────────────────
 *
 * The design's invariant 2 says "exactly one history entry exists per screen
 * depth (0 = Books, 1 = Segments, 2 = Recorder)". That is true for depths 1
 * and 2, each of which holds the entry its own screen transition pushed — and
 * FALSE for depth 0. Books is the floor: it pushes nothing, which is what
 * makes a Back there `"exit-app"`.
 *
 * The consequence for the layer stack was measured on the pre-PR3 build, not
 * inferred (`e2e/back-navigation.spec.ts`'s PR3 header records the reading):
 * on Books with an overlay open, `history.state` was the app's own
 * `{tc:true,index:0}` with no entry of the app's BELOW it, and a Back
 * navigated the document straight to `about:blank` — **no `popstate` fired at
 * all**. `routeBackToLayer` is reached only FROM the `popstate` handler, so at
 * the floor it could never be reached: registering Books' overlays as `Layer`s
 * would have been inert, and #374 would have stayed open. That is the whole
 * reason this pair exists.
 *
 * The fix keeps invariant 1 (an OVERLAY never touches history) and invariant 2
 * (never one entry per overlay) intact, because neither function is called by
 * an overlay and neither counts overlays: the ADAPTER holds at most ONE extra
 * entry, for the floor screen, for exactly as long as that screen has any
 * layer open at all — two, five or zero overlays deep makes no difference.
 * `atFloor` is `backEffectFor(screen) === "exit-app"`, so nothing here hard-
 * codes which screen the floor is; a future re-rooting moves with it.
 *
 * Why an ARM/RELEASE pair rather than simply pushing an entry at mount and
 * leaving it: an always-present floor entry would silently cost every user a
 * second Back to leave the shelf, which is a product change nobody asked for
 * and which the design explicitly declines to make ("Root-level Back leaves
 * the tab/backgrounds the installed app, exactly as `exit-app` already does
 * today; this document does not change that"). Armed only while an overlay is
 * open, and released the moment the last one closes, Back at a bare shelf is
 * bit-for-bit what it was before — pinned by case (e)'s and (g)'s final
 * `about:blank` assertion.
 */
export type FloorEntryAction = "arm" | "release" | "none";

/**
 * Whether a layer push/pop must arm or release the floor screen's protective
 * entry. Pure: the adapter performs the `pushState`/`history.back()` this
 * names, and owns the `armed` flag this reads.
 *
 * - `"arm"` — the floor screen has an overlay open and nothing is armed yet.
 *   Push one entry, so the next Back is a `popstate`.
 * - `"release"` — the stack has emptied and an entry is armed. Consume it, so
 *   the shelf goes back to being the floor and Back leaves the app again.
 * - `"none"` — everything else, and notably EVERY change above the floor:
 *   Segments and the Recorder already hold the entry their own transition
 *   pushed, and arming a second one there would strand the app one level below
 *   the screen it is showing (invariant 2).
 *
 * The decision is `open` — the stack size AFTER the change — and not a
 * before/after PAIR, because a transition adds nothing `armed` does not
 * already say: `armed` false with an overlay open means no entry exists for
 * that overlay, whether this call opened the first one or found a stack that
 * a cleanup had left behind. A `before` parameter was written first and its
 * mutation survived the decision table — an unkillable branch, which
 * AGENTS.md reads as redundant logic rather than a missing test — so it is
 * gone.
 *
 * The `armed` guard is what makes a repeat arm impossible, and it is load-
 * bearing beyond simple double-tap safety. Amendment C's cleanup effect clears
 * the WHOLE stack when a global trap engages (`recovering` / `databasePanel`),
 * which on Books can happen with a menu open — `useDatabaseStatus` flips from
 * another tab. That leaves `armed` true with an empty stack, and it must stay
 * that way: the entry is exactly what `"trap-database-panel"` re-arms against,
 * and releasing it there would let a Back walk out of the app from under a
 * panel whose whole purpose is to hold it (`popAction`'s own comment on that
 * case). When the trap lifts, the next overlay open sees `armed` already true
 * and arms nothing — self-correcting rather than double-counting.
 */
export function floorEntryForLayerChange(change: {
  /** `backEffectFor(screen) === "exit-app"` — this screen pushes nothing itself. */
  readonly atFloor: boolean;
  /** Whether the adapter is currently holding a floor entry. */
  readonly armed: boolean;
  /** Stack length AFTER the push/pop. */
  readonly open: number;
}): FloorEntryAction {
  if (!change.atFloor) return "none";
  if (change.open > 0 && !change.armed) return "arm";
  if (change.open === 0 && change.armed) return "release";
  return "none";
}

/**
 * Whether a Back that a layer absorbed must re-arm the entry the `popstate`
 * has already consumed (#452 PR1's `"rearm-layer-dismiss"` /
 * `"rearm-layer-busy"` obligation), given how many layers remain afterwards.
 *
 * ABOVE the floor this is unconditionally `true`, unchanged from PR1/PR2: the
 * entry that was consumed is the SCREEN's own, it must exist for as long as
 * the screen does, and whether an overlay is left open has nothing to do with
 * it. Both tags re-arm.
 *
 * AT the floor the consumed entry is the floor entry, which exists only while
 * a layer does — so it comes back only if one remains. `remaining` is the
 * stack length AFTER the absorption: the length unchanged for
 * `"rearm-layer-busy"` (a refused layer is not popped), one less for
 * `"rearm-layer-dismiss"`. A busy refusal at the floor therefore always
 * re-arms (the refusing layer is still open), and a dismissal re-arms only
 * while something is still stacked beneath it.
 *
 * The two directions are NOT symmetric, and the docblock says so rather than
 * claiming a tidier story than the code supports:
 *
 *   - **Not re-arming while a layer remains is a defect.** It drops the
 *     protection out from under an overlay that is still open, so the next
 *     Back leaves the app over it.
 *   - **Re-arming when nothing remains is NOT an end-state defect**, and this
 *     was established by mutation rather than assumed: forcing `true` here
 *     leaves every case in `e2e/back-navigation.spec.ts` green, because the
 *     `popLayer` the adapter runs immediately afterwards empties the stack and
 *     `floorEntryForLayerChange` then RELEASES the entry that was just pushed.
 *     The two mechanisms converge on the same shelf.
 *
 * What this half buys is therefore not correctness of the end state but the
 * absence of a self-caused traversal: without it, dismissing the shelf's last
 * overlay issues a `pushState` and, in the same task, a `history.back()` to
 * undo it — one more outstanding traversal for a second, genuine Back to race,
 * which is the browser-API contention `travel-guard.ts` exists to keep out of
 * this adapter (and which this fourth raw issuer is not arbitrated against).
 * `e2e/back-navigation.spec.ts` case (e) asserts that absence directly, by
 * counting the app's own `pushState`/`back()` calls across the dismissal —
 * the same mutation-unique shape case (d) uses for the #168 guard, and the
 * assertion that kills this mutant.
 */
export function rearmAfterLayerBack(
  atFloor: boolean,
  remaining: number
): boolean {
  return atFloor ? remaining > 0 : true;
}
