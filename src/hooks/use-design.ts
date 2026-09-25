import { useCallback, useEffect, useSyncExternalStore } from "react";

import { reportFailure } from "./report-failure";
import {
  DESIGN_STORAGE_KEY,
  nextDesign,
  readStoredDesign,
  type Design,
} from "@/lib/design";

/**
 * The DOM half of #938: apply a design, persist it, and expose it to markup
 * that needs to branch on it (#936, "Markup changes read the switch through
 * the `useDesign()` hook").
 *
 * `lib/design.ts` owns the decision and is DOM-free; everything that touches
 * the document lives here, per AGENTS.md's layering — the same split
 * `hooks/use-theme.ts` makes for `lib/theme.ts`, and this file follows that
 * one's shape deliberately rather than inventing a second one.
 *
 * WHY `localStorage` AND NOT IndexedDB: the same reasoning `use-theme.ts`
 * gives for the theme choice applies unchanged here — per-device, one word,
 * worth nothing lost, and not something that should make first paint wait on
 * an async open or gain a schema migration of its own.
 *
 * WHAT IS AND IS NOT COVERED. COVERED, in Node: `readStoredDesign`/
 * `nextDesign` (the pure half) in `tests/design.test.ts`; this hook's
 * attribute toggle, persistence, bad-stored-value fallback and
 * `installStoredDesign` in `tests/use-design.test.ts`, mounted with
 * `createRoot` and `act` in a manual jsdom. NOT COVERED: `readDesign`'s catch
 * path (an accessor that throws on READ), the Books menu entry
 * (`components/design-control.tsx`), which no test renders, and anything on
 * a phone.
 */

/**
 * THE LIVE DESIGN, above the component tree — module scope for the same
 * reason `use-theme.ts`'s `liveTheme` is: `App` renders one screen at a time,
 * so a hook seeded fresh from storage on every mount would let a design whose
 * write had failed revert on a navigation, defeating the fallback `toggle`
 * gives below (the exact failure `use-theme.ts`'s docblock records for #457).
 */
let liveDesign: Design | null = null;

/** Subscribers, so every mounted `useDesign` sees one toggle. */
const listeners = new Set<() => void>();

/**
 * The current design, hydrating from storage on first read.
 *
 * Lazy rather than initialised at module load, for the same reason
 * `use-theme.ts`'s `currentTheme` is: `installStoredDesign()` runs before
 * React renders, and a module-load read would put a `localStorage` access in
 * the import graph of anything that touches this file, including the Node
 * test suite.
 */
function currentDesign(): Design {
  liveDesign ??= readDesign();
  return liveDesign;
}

/**
 * Move the live design AND put it on the document in the same call, before
 * any subscriber is told — the same ordering `use-theme.ts`'s `setLiveTheme`
 * uses, and for the same reason: applying inside the store rather than in a
 * mount effect keeps a toggle correct even when the mounted screen that owns
 * the menu is not the only thing that could read `data-design`.
 */
function setLiveDesign(next: Design): void {
  liveDesign = next;
  applyDesign(next);
  for (const listener of listeners) listener();
}

/**
 * Read `localStorage` without letting it take the app down — mirrors
 * `use-theme.ts`'s `readTheme` exactly, including the reasoning for why a
 * throw here is not routed to `reportFailure`: it runs once per launch, and a
 * throw leaves the app in its normal state (the current look), which is
 * nothing a translator or facilitator needs to act on.
 */
function readDesign(): Design {
  try {
    return readStoredDesign(window.localStorage.getItem(DESIGN_STORAGE_KEY));
  } catch {
    return readStoredDesign(null);
  }
}

/**
 * Put the design on the root element.
 *
 * Unlike `applyTheme`, there is no second piece of browser chrome to repaint:
 * the O4 stylesheets (`app/styles/o4/`) are plain CSS scoped under
 * `[data-design="o4"]`, and setting the attribute is the whole contract.
 */
function applyDesign(design: Design): void {
  document.documentElement.setAttribute("data-design", design);
}

/**
 * Apply the stored design synchronously, before React renders — called from
 * `main.tsx` alongside `installStoredTheme()`, for the identical reason: an
 * effect runs after the first paint, so a tester who chose O4 would see one
 * frame of the current look on every launch. Same residual as
 * `installStoredTheme`, stated there rather than repeated here: this still
 * runs after the stylesheet itself has applied, so a very slow module
 * evaluation could in principle show a flash before this lands.
 */
export function installStoredDesign(): void {
  applyDesign(currentDesign());
}

export interface UseDesign {
  readonly design: Design;
  /** Switch to the other design and remember it. */
  readonly toggle: () => void;
}

export function useDesign(): UseDesign {
  const design = useSyncExternalStore(subscribe, currentDesign, currentDesign);

  // A mount-time RECONCILE, not where the design is applied — the toggle
  // applies inside `setLiveDesign`. Exists so the attribute and the live
  // value cannot diverge if something else wrote `data-design` while no
  // `useDesign` was mounted. Idempotent, the property AGENTS.md asks of every
  // write.
  useEffect(() => {
    applyDesign(currentDesign());
  }, []);

  const toggle = useCallback(() => {
    const next = nextDesign(currentDesign());
    // The live value and `data-design` move FIRST, together, so the screen is
    // correct whatever storage does next.
    setLiveDesign(next);
    try {
      window.localStorage.setItem(DESIGN_STORAGE_KEY, next);
    } catch (cause) {
      // The design still CHANGES, and survives navigation — it just will not
      // survive a relaunch. Reported, not shown, mirroring `useTheme`'s
      // `toggle`: there is no honest way to say "this will not be
      // remembered" without text, and the control's own `aria-pressed` state
      // flipping is the feedback.
      reportFailure(cause, "use-design: persist");
    }
  }, []);

  return { design, toggle };
}

/** `useSyncExternalStore`'s subscribe half. Stable, so it never resubscribes. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
