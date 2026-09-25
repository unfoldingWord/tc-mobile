/**
 * Which design the app is wearing (#938, batch 0 of epic #936) — the decision
 * alone, DOM-free, modelled directly on `lib/theme.ts`'s split of the same
 * shape (#171).
 *
 * The O4 look ships in the v1.0.0 training build behind this switch. With it
 * off, `data-design` is absent (or `"current"`) and every O4-scoped rule in
 * `app/styles/o4/` — each one written `[data-design="o4"] ...` — matches
 * nothing, so the current look renders exactly as it does today (epic #936,
 * "Behind a switch"). The DOM half — the attribute, `localStorage`, the menu
 * control — is `hooks/use-design.ts`.
 *
 * WHY A SEPARATE MECHANISM FROM `data-theme` AND NOT A THIRD THEME VALUE. The
 * two are independent axes: a tester compares the current look against O4 in
 * either theme, and `2-semantic.css`'s theme roles apply under both looks
 * unchanged. Folding "which look" into "which theme" would mean four values
 * standing in for two orthogonal choices, and would make the O4 stylesheets'
 * own scoping selector (`[data-design="o4"]`) depend on a value that also
 * carries the theme.
 */

/** The two looks `app/styles/o4/` and `2-semantic.css`/`3-components.css` between them define. */
export type Design = "current" | "o4";

/**
 * Where the choice is kept. Namespaced the same way `THEME_STORAGE_KEY` is:
 * `localStorage` is per-origin, and a preview Worker or a dev server can serve
 * more than one thing from one.
 */
export const DESIGN_STORAGE_KEY = "tc-mobile.design";

/** The app ships the current look. O4 is opt-in until #951 turns it on by default. */
const DEFAULT_DESIGN: Design = "current";

/**
 * The design a stored value selects, defaulting to `"current"` on **anything**
 * this app did not write.
 *
 * Not defensive for its own sake, the same reason `readStoredTheme` gives:
 * `data-design` is a plain attribute selector, and every O4 rule this repo
 * will ever add is scoped under `[data-design="o4"]` specifically — a stray
 * value would select neither block name, but only `"o4"` renders anything
 * different from today, so the safe fallback for anything unrecognised is the
 * look already shipping.
 */
export function readStoredDesign(raw: string | null): Design {
  return raw === "current" || raw === "o4" ? raw : DEFAULT_DESIGN;
}

/**
 * The other design.
 *
 * An involution, like `nextTheme`: the menu entry is one control carrying one
 * fixed label ("New look (O4)") and an `aria-pressed` state rather than two
 * different destinations to name, so a second tap is the only way back and
 * this is what makes that true.
 */
export function nextDesign(design: Design): Design {
  switch (design) {
    case "current":
      return "o4";
    case "o4":
      return "current";
  }
}
