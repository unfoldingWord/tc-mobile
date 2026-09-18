import { useCallback, useEffect, useSyncExternalStore } from "react";

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
 * document lives here, per AGENTS.md's layering.
 *
 * WHAT IS AND IS NOT COVERED, split apart because this file's first draft said
 * flatly "nothing here is covered", which was already untrue when it shipped
 * (QA review, #457) and understated the gate a later change would have to keep
 * passing:
 *
 *   - COVERED, in real Chromium against the shipped `dist/` build
 *     (`e2e/theme-toggle.spec.ts`): the toggle flips `data-theme`, the computed
 *     `--s-floor` and the `theme-color` meta both follow, two taps return, the
 *     choice survives a reload, the iOS status-bar meta is WRITTEN (not that
 *     iOS reads it — see `installStoredTheme`), and — since the QA round — a
 *     theme whose WRITE THROWS still survives a Books → chapter → Books round
 *     trip AND lands one row in the durable failure log, asserted through the
 *     ≡ control's name and mark rather than inferred from the throw.
 *   - NOT COVERED: `readTheme`'s catch path (an accessor that throws on READ,
 *     as opposed to on write), and `applyTheme`'s empty-`--s-floor` early
 *     return. Both are engine-specific states this suite cannot produce.
 *   - NOT COVERED, and not coverable here: any of it on a phone. Capacitor's
 *     Android WebView has never run this app at all (#245), and headless
 *     Chromium in a container is not the sunlit screen the light theme exists
 *     for. `lib/theme.ts`'s Node table remains what pins the decision.
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
 * THE LIVE THEME, above the component tree.
 *
 * Module scope, not `useState` alone, because `App` renders `BooksScreen` XOR
 * `SegmentsScreen` (`src/app/App.tsx`) — so opening a chapter UNMOUNTS the only
 * component that calls `useTheme`. With the state seeded from storage on each
 * mount, a theme whose write had failed came back as the default on the way
 * back to Books: light on the toggle, light inside the chapter, dark on return,
 * with no reload (QA review P2 on #457).
 *
 * That defeated exactly the fallback this hook's `toggle` sets out to give —
 * "the theme still CHANGES, it just will not survive a reload" — and it failed
 * hardest for the person the light theme exists for, who is outdoors, whose
 * storage is most likely to be full, and who is navigating between screens
 * while they work.
 *
 * So `localStorage` is now used for exactly two things: hydrating this value
 * once at launch, and best-effort persistence. Everything on screen reads
 * THIS, which is why a failed write costs a relaunch and not a navigation.
 */
let liveTheme: Theme | null = null;

/** Subscribers, so every mounted `useTheme` sees one toggle. */
const listeners = new Set<() => void>();

/**
 * The current theme, hydrating from storage on first read.
 *
 * Lazy rather than initialised at module load: `installStoredTheme()` runs
 * before React renders and is what populates this, and a module-load read
 * would put a `localStorage` access in the import graph of anything that
 * touches this file — including the Node test suite.
 */
function currentTheme(): Theme {
  liveTheme ??= readTheme();
  return liveTheme;
}

function setLiveTheme(next: Theme): void {
  liveTheme = next;
  for (const listener of listeners) listener();
}

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
 *
 * `apple-mobile-web-app-status-bar-style` is the iOS sibling of that meta, and
 * `theme-color` does not cover it: an installed iOS PWA reads THIS one for the
 * status bar's own content, and `index.html` ships it `black-translucent`
 * (light glyphs, content laid under the bar) for the dark default. Left alone,
 * the light screen kept light clock-and-battery glyphs over a near-white
 * floor — the same "dark chrome over a white screen" class the `theme-color`
 * repaint closes, on the one platform this app has actually been run on
 * (George R1 P2 on #457). `default` is Apple's dark-content style. Whether iOS
 * re-reads the meta after launch is NOT verified — see `installStoredTheme`.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute(
      "content",
      theme === "light" ? "default" : "black-translucent"
    );
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
 *
 * A SECOND RESIDUAL, also unverified: `applyTheme` rewrites
 * `apple-mobile-web-app-status-bar-style` alongside `theme-color`, and whether
 * iOS reads that meta LIVE (on a toggle, after launch) or only once at the
 * launch of an installed PWA is not known here — no iOS device was available
 * to the session that added it, and `e2e/theme-toggle.spec.ts` proves only
 * that the attribute is written. If iOS reads it at launch only, a toggle to
 * light gets the right status bar from the NEXT launch and the wrong one until
 * then; this call, which runs before React renders, is what makes the next
 * launch right. Inference, not observed: `default` lays the page BELOW the
 * bar where `black-translucent` lays it under, so a live re-read would also
 * move the top safe-area inset by the bar's height. Both halves need a check
 * on an installed iOS build, and until one is made neither is claimed.
 */
export function installStoredTheme(): void {
  applyTheme(currentTheme());
}

export interface UseTheme {
  readonly theme: Theme;
  /** Switch to the other theme and remember it. */
  readonly toggle: () => void;
}

export function useTheme(): UseTheme {
  // Subscribed to the module-level value, NOT seeded from storage per mount —
  // see `liveTheme` above for the navigation defect that caused. Every mounted
  // copy of this hook therefore agrees, and a remount picks up the live theme
  // rather than re-deriving one from a write that may have failed.
  const theme = useSyncExternalStore(subscribe, currentTheme, currentTheme);

  // Re-apply on mount so the attribute and the live value cannot diverge if
  // something else has written `data-theme` in between. Idempotent, which is
  // the property AGENTS.md asks of every write.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next = nextTheme(currentTheme());
    // The live value moves FIRST, so the screen is correct whatever storage
    // does next.
    setLiveTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (cause) {
      // The theme still CHANGES, and now it survives navigation too — it just
      // will not survive a relaunch. Failing the toggle over a failed write
      // would deny the accommodation to exactly the contexts where storage is
      // blocked, which is the wrong trade for a cosmetic preference. Reported,
      // not shown: the control's own glyph flipping is the feedback, and there
      // is no honest way to say "this will not be remembered" without text.
      reportFailure(cause, "use-theme: persist");
    }
  }, []);

  return { theme, toggle };
}

/** `useSyncExternalStore`'s subscribe half. Stable, so it never resubscribes. */
function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
