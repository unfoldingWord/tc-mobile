import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { Layer } from "@/lib/nav/layer-stack";

/**
 * A screen's overlays, registered as system-Back layers (#452 PR3, #374).
 *
 * One `Layer` per open overlay, registered from the SAME click handler that
 * flips the overlay's own `open` state and unregistered from every path that
 * closes it — never from a `useEffect` keyed on that state (invariant 6,
 * `docs/design/back-navigation.md`: there is no dependency array in this path,
 * so there is nothing for an unmemoized hook-returned object to destabilise,
 * which is the round-6 P1 class the design was built to remove).
 *
 * ── Why a shared primitive rather than a `pushLayer({...})` per overlay ──
 *
 * `Layer.busy` and `Layer.dismiss` are captured when the overlay OPENS and
 * called much later, from the `popstate` handler. A `dismiss` captured inline
 * therefore freezes whatever its enclosing render closed over — and Books'
 * book-≡ close (`onCloseShareMenu`) closes over `useBookShare()`'s return
 * value, a fresh object literal every render whose `progress` field is the
 * screen's own share state. A Back a second later would have run that close
 * against a share timeline from the render in which the menu was opened: the
 * exact stale-snapshot class invariant 4 forbids for `busy()`, arriving
 * through `dismiss()` instead.
 *
 * So the behaviours are re-read from a latest-ref on every call — the same
 * pattern `use-nav-stack.ts` uses for its own state-half callbacks, and
 * `menu.tsx` for `onClose`. The `Layer` this pushes holds no closure of its
 * own beyond the id.
 *
 * ── EXACTLY how current "current" is ──
 *
 * `busy()` and `dismiss()` run the behaviour from **the most recent COMMIT**
 * for that id. That is a precise claim and it is deliberately not the stronger
 * one an earlier revision of this docblock made ("always the CURRENT render's
 * behaviour"), which contradicted the paragraph below it and was the P2 Frank
 * raised in round 4 of #531. The refresh is a `useLayoutEffect`, so it lands
 * synchronously inside the commit task — before paint, and before any
 * macrotask a `popstate` could arrive on. There is therefore no window in
 * which a committed overlay is driven by a pre-commit closure. What this does
 * NOT claim is anything about a render that has not committed; nothing here
 * can see one, and nothing needs to.
 *
 * It does NOT weaken invariant 4. The behaviours a caller writes must still
 * read a live ref for `busy()`: "most recent commit" is enough for a
 * `dismiss()` that calls stable setters, and says nothing about a `useState`
 * value read INSIDE it that changed without a commit. `busy()` still has to be
 * ref-backed at the source (`creatingBook.current`, `useBooks`' `isDeleting()`,
 * `useShareFlow`'s `ownsScreen()`); see `Layer`'s docblock and the negative
 * example in `tests/nav-layer-stack.test.ts`.
 *
 * **Review-only, and this is the honest bound on it.** The window this closes
 * cannot be covered by a test in this repo: there is no jsdom or renderer for
 * a unit test (AGENTS.md), and Playwright cannot deterministically schedule a
 * Back inside a commit→effect window. The mutation
 * `useLayoutEffect` → `useEffect` leaves the entire suite green. Stated rather
 * than implied, because a reader is otherwise entitled to assume the suite
 * would catch a regression here. It would not.
 *
 * Node-testable surface: none. This is a hook, and this repo runs Vitest in
 * the Node environment with no jsdom or renderer (AGENTS.md), so it is review
 * surface plus `e2e/back-navigation.spec.ts` in real Chromium — stated here
 * rather than implied.
 */
export interface ScreenLayerBehavior {
  /**
   * Whether a write this overlay owns is in flight, so Back must be refused.
   * MUST read a live ref at call time — never a `useState` value (invariant 4).
   *
   * The rule that keeps `busy()` honest: it must be true whenever `dismiss()`
   * would be a no-op. A Back that runs a no-op `dismiss()` still unregisters
   * the layer and drops the entry protecting it, which is #494 item 3's trap.
   */
  busy(): boolean;
  /** Close the overlay. Runs only when `busy()` is false. */
  dismiss(): void;
}

export interface ScreenLayers<Id extends string> {
  /** Register `id` as the top layer. Call it beside the overlay's own open. */
  open(id: Id): void;
  /** Unregister `id`. Idempotent. Call it from every path that closes it. */
  close(id: Id): void;
}

export function useScreenLayers<Id extends string>(
  pushLayer: (layer: Layer) => void,
  popLayer: (id: string) => void,
  behaviors: Readonly<Record<Id, ScreenLayerBehavior>>
): ScreenLayers<Id> {
  // No dependency array: the behaviours are rebuilt every render, and this
  // refresh must land on every one of them. `use-nav-stack.ts`'s own
  // latest-ref effect is written the same way and for the same reason.
  //
  // `useLayoutEffect`, NOT `useEffect` (Frank R4 P2 on PR #531). A passive
  // effect is flushed in a scheduler macrotask AFTER the commit, and a
  // `popstate` is a macrotask too — so between React committing an overlay's
  // new state and this refresh landing, a Back could run the PREVIOUS render's
  // behaviour. That window is short but it is not empty, and it is exactly
  // where a Back lands when the translator opens an overlay and immediately
  // presses Back. A layout effect runs synchronously inside the commit task,
  // before paint and before any macrotask, which closes it rather than
  // narrowing it.
  const behaviorsRef = useRef(behaviors);
  useLayoutEffect(() => {
    behaviorsRef.current = behaviors;
  });

  const open = useCallback(
    (id: Id) => {
      pushLayer({
        id,
        // Indexed at CALL time, never captured: `Record<Id, …>` is total over
        // the id union, so there is no missing-behaviour branch to get wrong
        // — a typo'd or retired id is a `tsc` error at the call site instead.
        busy: () => behaviorsRef.current[id].busy(),
        dismiss: () => behaviorsRef.current[id].dismiss(),
      });
    },
    [pushLayer]
  );

  const close = useCallback((id: Id) => popLayer(id), [popLayer]);

  // MEMOIZED, not a fresh literal per render (Amendment E's rule, applied to
  // this hook's own return): a caller's close path can legitimately live in an
  // effect — Books' delete confirm auto-closes when its book vanishes from
  // another tab — and an unstable object in that effect's dependency array is
  // precisely the round-6 P1 shape the design exists to remove. `useMemo` here
  // means a caller never has to choose between `exhaustive-deps` and a stable
  // effect. Mirrors `useFocusRestore`'s own return.
  return useMemo(() => ({ open, close }), [open, close]);
}
