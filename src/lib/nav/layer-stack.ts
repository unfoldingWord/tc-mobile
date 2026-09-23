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
 * `dismiss()` on the named layer.
 *
 * **Amendment G narrowed the re-arm half, and this paragraph is where a PR4
 * reader will look for it** (George R1 P3-3). Above the floor it is still
 * unconditional. AT the floor the consumed entry is the floor entry, which
 * exists only while a layer does, so it comes back only when one remains —
 * `rearmAfterLayerBack` is the decision and `e2e` case (e) pins the shelf
 * going back to the floor. Copying "always push a fresh entry" into a Segments
 * overlay is harmless there; copying it back into the floor path breaks that
 * case. That full, corrected contract is encoded
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
 * entry the `popstate` already consumed — unconditionally above the floor, and
 * at the floor only when a layer remains, per `rearmAfterLayerBack`;
 * `"dismiss"` additionally dismisses the named layer) — `navigation.ts`'s `popAction` is where that full
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
 * Without a protective entry, Back at the floor can leave the document
 * instead of reaching the popstate handler. Registering an overlay as a
 * Layer alone cannot route that Back through `routeBackToLayer`.
 *
 * So: when the floor screen's first overlay opens, the adapter arms ONE entry.
 * One per SCREEN, never one per overlay — two or five deep makes no
 * difference, and `atFloor` is `backEffectFor(screen) === "exit-app"` so
 * nothing here hard-codes WHICH screen the floor is. Invariant 1 is untouched:
 * no overlay calls this, the adapter does.
 *
 * ── THE ENTRY IS NEVER GIVEN BACK BY A TRAVERSAL, and that is the whole
 * shape of this amendment ──
 *
 * An earlier revision paired `"arm"` with a `"release"` that consumed the
 * entry with a suppressed `window.history.back()` when the last overlay
 * closed. It was the wrong shape and Frank's review found it twice, in two
 * different places, which is this repo's own siblings signal — the approach,
 * not the details:
 *
 *   - **R1 P2:** the release had to be suppressed while a global trap was up
 *     (the trap re-arms against that very entry) and re-issued when the trap
 *     cleared. One edge was handled and the other was not.
 *   - **R2 P1:** a release is an ASYNC traversal, and nothing stopped
 *     `openChapter` from issuing a `pushState` before it landed — a push
 *     behind an outstanding `back()`, which is precisely the coalescing/desync
 *     hazard `travel-guard.ts` exists to keep out of this adapter. Closing it
 *     would have needed a deferral latch on the app's only push path, whose
 *     own stuck state kills navigation for the session (#494 item 2's defect,
 *     invited back in).
 *
 * Both dissolve if the entry is never released. What replaces the release:
 *
 *   - A Back that DISMISSES the last overlay consumes the entry itself — the
 *     `popstate` already popped it and {@link rearmAfterLayerBack} declines to
 *     put it back. Nothing is issued.
 *   - A screen transition out of the shelf REUSES it: the entry already sits
 *     at exactly the depth the new screen's entry wants, so the adapter
 *     re-stamps it with `replaceState` instead of stacking a second one on top
 *     (`use-nav-stack.ts`'s `enterScreen`). One entry per screen depth,
 *     invariant 2, with no traversal.
 *   - Only one path leaves an entry standing: an overlay closed by its OWN
 *     control (Close, Cancel, the scrim) with no navigation afterwards. Then
 *     the next Back at the shelf consumes it and routes `"exit-app"`, which is
 *     a no-op, so that Back does nothing visible and a second one leaves.
 *
 * **That last line is a real cost, disclosed rather than hidden, and ACCEPTED
 * by the DRI (2026-09-20) — tracked as #535, which also records that the
 * release path is not to be redesigned to remove it:** one silent Back, once,
 * after an overlay was opened and closed without using Back. It is bounded — `armed` refuses a second arm, so the shelf never holds
 * more than one — and it is the same accepted class as Amendment B's "after a
 * reload at depth N, leaving takes N extra Backs" (dev lead, 2026-09-18), at a
 * smaller size. It cannot be forwarded away: `history.back()` at the app's
 * first entry is a no-op by spec, so an installed PWA would not leave, and
 * asking the platform to close the app is not something the History API can
 * do. Every path is still strictly better than before PR3, where that same
 * Back exited the app and took the open dialog with it (#374).
 */
export type FloorEntryAction = "arm" | "none";

/**
 * Whether opening an overlay must arm the floor screen's protective entry.
 * Pure: the adapter performs the `pushState` this names, and owns the `armed`
 * flag this reads.
 *
 * - `"arm"` — the floor screen has an overlay open and no entry is armed yet.
 * - `"none"` — everything else, and notably EVERY change above the floor:
 *   Segments and the Recorder already hold the entry their own transition
 *   pushed, and arming a second one there would strand the app one level below
 *   the screen it is showing (invariant 2).
 *
 * The decision is `open` — the stack size AFTER the change — and not a
 * before/after PAIR, because a transition adds nothing `armed` does not
 * already say. A `before` parameter was written first and its mutation
 * survived the decision table — an unkillable branch, which AGENTS.md reads as
 * redundant logic rather than a missing test — so it is gone.
 *
 * `armed` is also what makes this correct across a global trap
 * (`recovering` / `databasePanel`). Amendment C's cleanup clears the WHOLE
 * stack when one engages, which on Books can happen with a menu open —
 * `useDatabaseStatus` flips from another tab — leaving `armed` true with
 * nothing stacked. Nothing needs doing on either trap edge now that there is
 * no release: the entry stays, which is what `"trap-database-panel"` re-arms
 * against, and when the shelf comes back the next overlay open sees `armed`
 * already true and arms nothing.
 */
export function floorEntryForLayerChange(change: {
  /** `backEffectFor(screen) === "exit-app"` — this screen pushes nothing itself. */
  readonly atFloor: boolean;
  /** Whether the adapter is already holding a floor entry. */
  readonly armed: boolean;
  /** Stack length AFTER the change. */
  readonly open: number;
}): FloorEntryAction {
  if (!change.atFloor) return "none";
  return change.open > 0 && !change.armed ? "arm" : "none";
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
 * AT the floor the consumed entry is the floor entry, which exists only for
 * overlays — so it comes back only if one remains. `remaining` is the stack
 * length AFTER the absorption: unchanged for `"rearm-layer-busy"` (a refused
 * layer is not popped), one less for `"rearm-layer-dismiss"`. A busy refusal
 * at the floor therefore always re-arms, and a dismissal re-arms only while
 * something is still stacked beneath it.
 *
 * **This is the only path that gives the floor entry back**, now that there is
 * no release (see {@link FloorEntryAction}): declining to re-arm is how a Back
 * that dismisses the shelf's last overlay both absorbs the gesture AND leaves
 * the shelf at the floor again, with no traversal of its own to race. The
 * adapter clears `armed` in the same breath. Getting it wrong in the other
 * direction — not re-arming while a layer remains — drops the protection out
 * from under an overlay that is still open, so the next Back leaves the app
 * over it.
 */
export function rearmAfterLayerBack(
  atFloor: boolean,
  remaining: number
): boolean {
  return atFloor ? remaining > 0 : true;
}

/**
 * Whether the adapter should consider itself already holding the floor entry
 * after Amendment B's bootstrap ADOPTED an entry left on the stack by a
 * previous page life (a reload).
 *
 * **The gap this closes** (Frank R3 P2 on PR #531). `floorArmed` is a ref, so
 * it starts `false` on every mount, while the ENTRY it tracks survives the
 * reload. Without this, a shelf reloaded with an overlay open comes back
 * holding an entry the adapter has forgotten, and the next overlay arms a
 * SECOND one. Repeat reload → open and the history tail grows without bound —
 * one dead Back per cycle — which falsifies the "at most one" property
 * {@link floorEntryForLayerChange} is written around.
 *
 * **Why an explicit marker and not `index > 0`.** A reload always re-renders
 * the shelf (no session restore of the open chapter — `e2e` case (c) pins
 * that), so at bootstrap EVERY adopted entry is sitting at the floor, whichever
 * screen pushed it. Depth cannot tell a floor entry from a Segments entry that
 * outlived its screen, and the two must not be treated alike: adopting a
 * Segments entry as the floor's would hand the next `enterScreen` a
 * `replaceState` over a level PR2 deliberately keeps, which case (c)'s tail
 * pins. So the kind is WRITTEN DOWN when the entry is pushed —
 * `pushHistoryEntry` stamps `floor: atFloor`, `enterScreen` never does — and
 * read back here.
 *
 * `atFloor` is still required and is not redundant: it is what stops a stale
 * marker arming the adapter on a screen that owns its own entry, if this app
 * ever does restore a screen across a reload. Today that combination is
 * unreachable; it is a row in the table rather than an assumption.
 */
export function floorArmedOnResume(resumed: {
  /** The adopted entry carries the `floor` marker this app writes. */
  readonly marked: boolean;
  /** `backEffectFor(screen) === "exit-app"` for the screen being resumed ON. */
  readonly atFloor: boolean;
}): boolean {
  return resumed.marked && resumed.atFloor;
}
