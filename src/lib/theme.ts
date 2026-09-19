/**
 * Which theme the app is wearing (#171) — the decision alone, DOM-free, so it
 * is a table rather than a phone.
 *
 * A complete light theme has existed in `2-semantic.css` since the pivot and
 * nothing could ever select it: before this, `grep -rn "data-theme" src
 * --include=*.ts --include=*.tsx` returned no hits at all. The theme was
 * written because direct equatorial sun makes the dark screen unreadable, so
 * the condition it was written for was unaddressed while its maintenance cost
 * was already being paid — and the two roles that fall below AA in it were
 * fixed alongside this, which is the ordering #171 asked for.
 *
 * WHY A PERSISTED TOGGLE AND NOT `prefers-color-scheme`. #171 offered both and
 * argued the toggle, which is the decision taken here: these are shared phones
 * handed out by a facilitator, so the OS setting is not the translator's to
 * change, and the person who needs light is the one standing in the sun — not
 * the one whose device happened to be configured that way. `readStoredTheme`
 * takes a stored string and nothing else, so that decision is enforced by the
 * signature rather than by this comment.
 *
 * The DOM half — the attribute, `localStorage`, the `theme-color` meta — is
 * `hooks/use-theme.ts`.
 */

/** The two token blocks `2-semantic.css` actually defines. */
export type Theme = "dark" | "light";

/**
 * Where the choice is kept. Namespaced: `localStorage` is per-origin, and a
 * preview Worker or a dev server can serve more than one thing from one.
 */
export const THEME_STORAGE_KEY = "tc-mobile.theme";

/** The app ships dark — see `2-semantic.css`'s header for why. */
const DEFAULT_THEME: Theme = "dark";

/**
 * The theme a stored value selects, defaulting to dark on **anything** this
 * app did not write.
 *
 * Not defensive for its own sake: `data-theme` is a plain attribute selector,
 * so a value matching neither block selects NEITHER, and every semantic role
 * would fall back to nothing — an unstyled screen, not a differently-coloured
 * one. A stray value therefore has to be turned into a theme here rather than
 * passed through.
 */
export function readStoredTheme(raw: string | null): Theme {
  return raw === "dark" || raw === "light" ? raw : DEFAULT_THEME;
}

/**
 * The other theme.
 *
 * An involution, deliberately: the toggle is one control carrying a sun/moon
 * glyph and no text a non-reader could check against, so the only guarantee it
 * can offer is that tapping twice undoes it. That is what rules out a third
 * "follow the system" state.
 */
export function nextTheme(theme: Theme): Theme {
  switch (theme) {
    case "dark":
      return "light";
    case "light":
      return "dark";
  }
}
