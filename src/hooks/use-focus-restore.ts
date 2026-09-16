import { useCallback, useMemo, useRef } from "react";

import { focusRestoreTarget } from "@/lib/a11y/focus-restore";

export interface FocusRestore {
  /**
   * Remember what has focus, **synchronously inside the opening gesture's own
   * handler** — never from an effect.
   *
   * That is the half of #97 that cannot be moved: React applies `inert` during
   * the mutation phase, which blurs the focused trigger to `<body>` before any
   * effect runs. A capture taken later captures `body`, which is exactly why
   * #96's `useRestoreFocusOnClose` was pulled: it was a no-op for every menu in
   * the app, and nothing said so.
   *
   * Re-entrant by design: a second `capture()` while one is held keeps the
   * FIRST. Before the header went inert under any overlay regardless of
   * `takeActive` (George R2 P2), the recorder's ≡ opener stayed reachable to AT
   * while the menu was up over a live take (#75), and a second tap on it had to
   * not overwrite the real trigger with a row inside the panel. The header
   * fix closes that specific path — the ≡ is now inert whenever an overlay is
   * up, mode or `takeActive` regardless — but the guard is kept as the
   * defensive rule for any future caller that captures again before the
   * previous overlay's `inert` has committed.
   */
  capture: () => void;
  /**
   * Put focus back, **after the subtree's `inert` has lifted** — so from a
   * layout effect keyed on the composite "any overlay is up" flag, never from
   * the close handler itself and never keyed on one overlay of several.
   *
   * Always consumes the capture, whatever it decides, so a state change later
   * in the session can never resurrect a trigger the translator has left.
   *
   * @param suppressed another surface has deliberately taken focus in this same
   *   commit (a full-body panel's `autoFocus`), so restore nothing. Consumes
   *   the capture. To hold it instead — the surface is mid-transition and there
   *   is no stable landing yet — do not call `restore` at all, and let the
   *   effect run again when the transition settles.
   * @param fallback the named landmark to use when the trigger is gone, inert
   *   or disabled. `null` means there is none, and focus is left alone — which
   *   is the right answer far more often than it looks. A disconnected element
   *   is treated the same as `null` (checked here, not in the caller): the
   *   caller resolves this synchronously inside its own layout effect today,
   *   so it is never stale in practice, but the guard costs nothing and this
   *   file exists precisely to stop a stale-element `.focus()` no-op.
   *
   *   **The landmark must never be a destructive or exiting control.** This is
   *   the contract, not a style note: the fallback runs on exactly the paths
   *   where the trigger was torn down, which for a menu is every row that
   *   changes mode — the common case, not the edge. A landmark that saves,
   *   deletes or leaves is then armed under the next activation, which is the
   *   hazard #97 exists to close, reintroduced by the fix for it (George R1 P1
   *   on #368 caught precisely that: a "first focusable in the sheet" fallback
   *   resolved to the recorder's Back, and Back is `close()`). Prefer the
   *   control that owns the overlay; prefer `null` over anything dangerous.
   */
  restore: (options: {
    suppressed: boolean;
    fallback: HTMLElement | null;
  }) => void;
}

/**
 * Modal focus-restore, done against this app's `inert` model (#97).
 *
 * One capture/restore pair per **inert scope** — not per dialog. The recorder's
 * ≡ menu and its erase confirm share one scope and chain within it (the Erase
 * row closes the menu and opens the confirm in the SAME commit), so a
 * per-dialog restore would fire into a subtree that is still inert and do
 * nothing. Keying on the composite is what makes the chain restore once, to the
 * ≡ that started it.
 *
 * That also closes the sharp edge #97 names: after cancelling an erase, focus
 * used to sit on the document, so a switch user's next Tab landed on **Back** —
 * and Back is `close()`, which SAVES. Landing on the ≡ instead puts the next Tab
 * past Back and into the body.
 *
 * ## What is NOT verified
 *
 * Everything in this file. The decision it delegates to is table-tested
 * (`tests/focus-restore.test.ts`); the DOM around it — reading
 * `document.activeElement` at tap time, `closest("[inert]")`, `.focus()`, and
 * the layout-effect ordering that is the point of the whole thing — has no
 * automated coverage and cannot have any in a Node-only suite. That gap is
 * #361. It is review and on-device surface; do not write "verified" on it
 * without a device.
 */
export function useFocusRestore(): FocusRestore {
  const triggerRef = useRef<HTMLElement | null>(null);

  const capture = useCallback(() => {
    if (triggerRef.current !== null) return;
    const active = document.activeElement;
    // `<body>` is the "nothing was focused" reading, not a target: a touch user
    // has no focus ring, and handing them one on close invents a state they
    // never had. Storing null here is what makes `captured: false` mean it.
    triggerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);

  const restore = useCallback(
    ({
      suppressed,
      fallback,
    }: {
      suppressed: boolean;
      fallback: HTMLElement | null;
    }) => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      const target = focusRestoreTarget({
        captured: trigger !== null,
        suppressed,
        connected: trigger?.isConnected ?? false,
        // `inert` is inherited down the flat tree, so the question is about any
        // ancestor, not the element. React renders `inert={true}` as the bare
        // attribute, which is what this matches.
        inert: trigger !== null && trigger.closest("[inert]") !== null,
        // Natively disabled only. An `aria-disabled` control keeps its place in
        // the Tab order here as it does everywhere else in this app (#135).
        focusable: trigger !== null && !trigger.hasAttribute("disabled"),
        // Connectivity, not just non-null (Frank round 3 P2, on
        // `recorder.tsx`'s header-button fallback): today's only caller
        // resolves this inside the same `useLayoutEffect` that fires after
        // React's mutation phase, so it is never stale in practice — but the
        // table has no way to know that, and a disconnected fallback's
        // `.focus()` is the exact silent no-op this whole module exists to
        // catch for the trigger. Hardening the check here costs nothing today
        // and stops a future caller from re-opening the gap this file was
        // built to close.
        hasFallback: fallback !== null && fallback.isConnected,
      });
      if (target === "none") return;
      if (target === "fallback") {
        fallback?.focus();
        return;
      }
      trigger?.focus();
      // The belt to the table's braces. The predicates above enumerate the
      // conditions this app actually produces; they cannot enumerate every way
      // a browser refuses focus (an ancestor gone `display: none` or
      // `visibility: hidden`, a detail iOS decides differently). If the focus
      // did not land, the landmark is still better than the document — which is
      // the state #97 was filed about.
      if (document.activeElement !== trigger) fallback?.focus();
    },
    []
  );

  // Stable identity: consumers put this object in a layout effect's dependency
  // list, and a fresh object per render would re-run that effect — and so
  // `restore()` — on every tick of a live take.
  return useMemo(() => ({ capture, restore }), [capture, restore]);
}
