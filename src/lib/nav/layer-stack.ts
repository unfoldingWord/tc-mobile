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
 * The adapter (`hooks/use-nav-stack.ts`, #452 PR2) owns the stack, but no
 * overlay pushes onto it yet — it stays empty until Books'/Segments' overlays
 * convert to `Layer`s in PR3/PR4, so this routing is inert until then. */
export function routeBackToLayer(stack: LayerStack): RouteBackToLayerResult {
  const layer = topLayer(stack);
  if (!layer) return { kind: "empty" };
  if (layer.busy()) return { kind: "refused-busy", layerId: layer.id };
  return { kind: "dismiss", layerId: layer.id };
}
