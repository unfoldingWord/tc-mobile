import {
  shareSettledGlyph,
  type ShareOutcomeGlyph,
} from "./share-outcome-glyph";
import type { ShareProgress as ShareProgressState } from "@/hooks/share-progress";

/**
 * Which mark and tone `ShareProgress` shows for the overlay's current phase
 * (#850) — a plain function, not a JSX branch, so a test can call it
 * directly with a `busy` or `outcome` progress value and read the result.
 *
 * Before this existed, the busy-vs-settled choice lived as a ternary inline
 * in `share-progress.tsx`, reachable only by reading rendered JSX (which
 * `ShareProgress` cannot even produce through `tests/render.ts` — it portals
 * to `document.body`, and `renderToStaticMarkup` refuses a portal outright)
 * or by matching that component's source text, which proves nothing about
 * BEHAVIOUR: a comment or a dead branch can say the same string back and
 * still pass a text match. This module is its own file rather than folded
 * into `share-progress-panel.tsx` (the presentational split `#197` gives
 * that component) on purpose: a file `react-refresh/only-export-components`
 * allows to export a component must export ONLY components, and this is a
 * plain function, not JSX.
 *
 * `hidden` is excluded from the parameter type rather than handled as a
 * third, `null`-returning case: `ShareProgress` already returns `null` for
 * `hidden` before it would ever reach this call (its own `if (progress.phase
 * === "hidden") return null;`), so every real caller already holds a `busy`
 * or `outcome` value by the time this runs. Encoding that in the type means
 * the switch below has exactly two cases to be exhaustive over, and a
 * widened `ShareProgress` that added a phase this switch forgot is a
 * compile error (the `never` default), not a silent gap or a spurious null
 * check nothing could ever hit.
 */
export function shareOverlayGlyph(
  progress: Exclude<ShareProgressState, { readonly phase: "hidden" }>
): ShareOutcomeGlyph {
  switch (progress.phase) {
    // The wait wears its own ring-of-dots mark (#850, `icon.tsx`'s
    // "share-busy"), not `Notice`'s shared `busy` retry arc — spun by the
    // stylesheet either way (`.share-scrim[data-outcome="busy"]
    // .share-progress-glyph` in 3-components.css, which predates this glyph
    // and needed no change: it already rotates whatever icon sits in the
    // busy slot and already drops to a still frame under
    // `prefers-reduced-motion: reduce`). Scoped to the share overlay only:
    // `notice-tone.ts`'s own `busy` entry, worn by every other wait in the
    // app, is untouched.
    case "busy":
      return { icon: "share-busy", tone: "busy" };
    case "outcome":
      return shareSettledGlyph(progress.settled);
    default: {
      const unhandled: never = progress;
      return unhandled;
    }
  }
}
