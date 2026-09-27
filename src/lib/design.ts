/**
 * Which design the app is wearing (#938, batch 0 of epic #936) — the decision
 * alone, DOM-free, modelled directly on `lib/theme.ts`'s split of the same
 * shape (#171).
 *
 * The O4 look ships in the v1.0.0 training build behind this switch, and #951
 * turned it on by default. With `data-design="current"` — an explicit saved
 * choice, never the default — every O4-scoped rule in `app/styles/o4/` —
 * each one written `[data-design="o4"] ...` — matches nothing, so the
 * current look renders exactly as it did before the flip (epic #936,
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

/**
 * The app ships O4 by default (#951). A user's saved choice still wins —
 * `readStoredDesign` only reaches this for a stored value it does not
 * recognise, chiefly "nothing has ever been written" (`raw === null`). An
 * existing user with nothing stored is therefore switched to the new look
 * the next time they launch; someone who already chose the old look
 * explicitly (the exact `"current"` value `nextDesign`/the menu control
 * writes) keeps it, because that string matches the first branch above and
 * never falls through to this default.
 */
const DEFAULT_DESIGN: Design = "o4";

/**
 * The design a stored value selects, defaulting to {@link DEFAULT_DESIGN} —
 * `"o4"` since #951 — on **anything** this app did not write.
 *
 * Not defensive for its own sake, the same reason `readStoredTheme` gives:
 * `data-design` is a plain attribute selector, and every O4 rule this repo
 * will ever add is scoped under `[data-design="o4"]` specifically. An
 * explicit, recognised `"current"` still wins over the default — that is
 * the whole mechanism #951 relies on to honour a saved choice.
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
