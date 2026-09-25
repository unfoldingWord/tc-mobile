import { Control } from "./control";
import { Tile } from "./o4-tile-menu";
import { strings } from "@/lib/strings";
import { useTheme } from "@/hooks/use-theme";

/**
 * The theme toggle, as one control any menu can mount (#149, #171).
 *
 * ── Why it is a component and not three copies of a `Control` ──
 *
 * It is mounted in three menus now — the Books global `≡`, the chapter `≡` and
 * the recorder's own menu (its header `≡`, or the edit toolbar's `⋮` since
 * #863 — one menu, two openers) — and the three facts it has to get right are
 * the same at each one:
 *
 *   - the glyph shows the DESTINATION, not the current state (a sun on a dark
 *     screen), because a text-free control that names what you already have
 *     tells a non-reader nothing;
 *   - the accessible name names that destination for the same reason;
 *   - the tap does NOT close the surrounding menu, so the screen changes behind
 *     the scrim and the control becomes its own undo — `nextTheme` is an
 *     involution, and "tap twice and you are back" is the only promise a
 *     wordless glyph can make. That is the state-in-place affordance AGENTS.md
 *     prefers over a message bubble.
 *
 * Three hand-written copies of that would be three chances to drift.
 *
 * ── Why the subscription lives HERE and not in the screens ──
 *
 * `useTheme` is `useSyncExternalStore` over a module-level value (see
 * `hooks/use-theme.ts`), so a toggle re-renders every subscriber. Keeping the
 * subscription inside this leaf means a toggle re-renders this button and the
 * canvases that subscribe on their own account (`Waveform`, `LiveScope`, via
 * `useLiveTheme`) — not the 4000-line recorder tree that merely contains it,
 * and not a Segments list mid-playback. The store's own docblock names this
 * mount site as the reason it applies the theme in the store rather than in a
 * hook effect: `BooksScreen` is unmounted while a chapter is open, so a toggle
 * from inside a chapter has to be correct with no Books copy mounted at all.
 *
 * ── What deliberately did NOT move with it ──
 *
 * The failure log (`FailureLogPanel`, #205) stays on the Books `≡` alone. It
 * needs the screen's system-Back layer registration for the Clear confirm it
 * portals over the menu (`onClearConfirmOpen`/`onClearConfirmClose`), and it is
 * a facilitator's end-of-session path rather than something reached mid-take —
 * the opposite of the toggle on both counts. #149 is the issue that owns that
 * split; it is a scope decision, not an oversight.
 */
export function ThemeControl({ tile = false }: { tile?: boolean } = {}) {
  const theme = useTheme();
  const dark = theme.theme === "dark";
  const icon = dark ? "sun" : "moon";
  const label = dark ? strings.useLightTheme : strings.useDarkTheme;
  // `tile`: the same control as an O4 menu tile (#949) — the plain well at the
  // far end of the grid, captioned with the destination's word, which its
  // accessible name already contains. Same three facts as above; only the
  // shape changes, so an O4 menu mounts this rather than a fourth copy.
  if (tile)
    return (
      <Tile
        tone="plain"
        icon={icon}
        size={32}
        label={label}
        caption={dark ? strings.tileLight : strings.tileDark}
        onClick={theme.toggle}
      />
    );
  return (
    <Control icon={icon} label={label} variant="quiet" onClick={theme.toggle} />
  );
}
