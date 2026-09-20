import { useCallback, useEffect, useMemo, useRef } from "react";

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
 * own beyond the id: `busy()` and `dismiss()` always run the CURRENT render's
 * behaviour for that id. That removes the class for every overlay at once
 * rather than per overlay, which is what this repo's own history says to do
 * when the same defect shows up as siblings.
 *
 * It does NOT weaken invariant 4. The behaviours a caller writes must still
 * read a live ref for `busy()` — a latest-ref makes the closure at most one
 * commit old, which is enough for a `dismiss()` that calls stable setters but
 * says nothing about a `useState` value read INSIDE it. `busy()` still has to
 * be ref-backed at the source (`creatingBook.current`, `useBooks`'
 * `isDeleting()`, `useShareFlow`'s `ownsScreen()`); see `Layer`'s docblock and
 * the negative example in `tests/nav-layer-stack.test.ts`.
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
  const behaviorsRef = useRef(behaviors);
  useEffect(() => {
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
