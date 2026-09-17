import { useCallback, useEffect, useState } from "react";

import { reportFailure } from "./report-failure";
import {
  THEME_STORAGE_KEY,
  nextTheme,
  readStoredTheme,
  type Theme,
} from "@/lib/theme";

/**
 * The DOM half of #171: apply a theme, persist it, and keep the browser's own
 * chrome in step.
 *
 * `lib/theme.ts` owns the decision and is DOM-free; everything that touches the
 * document lives here, per AGENTS.md's layering. Nothing in this file is
 * covered by an automated test — there is no DOM runner in this repo (#197) —
 * and it is not claimed as tested. `lib/theme.ts`'s table is what is pinned.
 *
 * WHY `localStorage` AND NOT IndexedDB. Every byte this app stores in IndexedDB
 * is a translator's recording or the structure around it: losing it is
 * unrecoverable in the field, which is what makes `lib/storage` T1. A theme
 * preference is the opposite — per-device, one word long, and worth nothing if
 * it is lost, because the toggle is right there. Putting it in the audio
 * database would mean a schema version and a migration path for a cosmetic
 * choice, and would make the first paint wait on an async open. It is also
 * deliberately NOT synced with the recordings: two facilitators handing out
 * the same book to phones in different light should not fight over the theme.
 */

/**
 * Read `localStorage` without letting it take the app down.
 *
 * `localStorage` is not merely absent in some contexts — the accessor itself
 * THROWS on access in a few real ones (Safari with cookies blocked, an
 * embedded WebView with storage disabled, a full quota on some engines).
 * Capacitor's Android WebView (#336, #262) is a new container for this app and
 * has not been verified here, so a throw is treated as "no preference" rather
 * than trusted not to happen.
 */
function readTheme(): Theme {
  try {
    return readStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch (cause) {
    // Not swallowed — routed to the one sink (#167). A translator gets the
    // default theme, which is the app's normal state, so there is nothing to
    // say on screen; the maintainer still gets the report.
    reportFailure(cause, "use-theme: read");
    return readStoredTheme(null);
  }
}

/**
 * Put the theme on the root element and repaint the browser's chrome.
 *
 * The `theme-color` meta is read by the OS for the status bar and the task
 * switcher, and it was hard-coded dark in `index.html` — so a translator who
 * switched to light kept a dark status bar over a white screen. It is set from
 * the COMPUTED `--s-floor` rather than from a second copy of the hex, so the
 * chrome cannot drift from the token the body actually paints. (The old
 * hard-coded `#0b0f14` had already drifted: `--s-floor` resolves to `#0b1016`.)
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  const floor = getComputedStyle(root).getPropertyValue("--s-floor").trim();
  if (floor === "") return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", floor);
}

/**
 * Apply the stored theme synchronously, before React renders.
 *
 * Called from `main.tsx` at module-eval time rather than from an effect: an
 * effect runs after the first paint, so a translator who chose light would see
 * one dark frame on every launch.
 *
 * RESIDUAL, stated rather than glossed: this still runs after the stylesheet
 * has applied `body { background: var(--s-floor) }` in its dark default, so a
 * very slow module evaluation could show a dark flash before this lands. The
 * zero-flash fix is an inline script in `index.html`, which is a build and CSP
 * question rather than a line here. Not observed on a device — nothing in this
 * file has been run on a phone.
 */
export function installStoredTheme(): void {
  applyTheme(readTheme());
}

export interface UseTheme {
  readonly theme: Theme;
  /** Switch to the other theme and remember it. */
  readonly toggle: () => void;
}

export function useTheme(): UseTheme {
  // Seeded from storage, not from a constant: `installStoredTheme` has already
  // put that theme on the element, and seeding "dark" here would make the
  // hook's first render disagree with the screen.
  const [theme, setTheme] = useState<Theme>(readTheme);

  // Re-apply on mount so the attribute and this hook's state cannot diverge if
  // something else has written `data-theme` in between. Idempotent, which is
  // the property AGENTS.md asks of every write.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch (cause) {
        // The theme still CHANGES — it just will not survive a reload. Failing
        // the toggle over a failed write would deny the accommodation to
        // exactly the contexts where storage is blocked, which is the wrong
        // trade for a cosmetic preference. Reported, not shown: the control's
        // own glyph flipping is the feedback, and there is no honest way to say
        // "this will not be remembered" without text.
        reportFailure(cause, "use-theme: persist");
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
