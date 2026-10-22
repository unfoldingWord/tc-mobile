import { SettingRow } from "./setting-row";
import { strings } from "@/lib/strings";
import { useTheme } from "@/hooks/use-theme";

/**
 * The theme toggle: the Settings screen's first row (#1575, #171).
 *
 * It lives ONLY there. #149 once mounted it in the chapter `⋮` and the
 * recorder `⋮` as well, so a translator in direct sun could switch mid-take;
 * the DRI's pick on #1623 (2026-10-22) was "Remove, Settings only", and the
 * Books `≡` lost it to the same screen. `tests/theme.test.ts` pins that none
 * of the three former mounts has come back.
 *
 * What stays true of the row:
 *
 *   - the glyph shows the DESTINATION, not the current state (a sun on a dark
 *     screen), because a text-free control that names what you already have
 *     tells a non-reader nothing;
 *   - the accessible name names that destination for the same reason;
 *   - the tap does NOT close Settings, so the screen changes behind it and the
 *     control becomes its own undo: `nextTheme` is an involution, and "tap
 *     twice and you are back" is the promise a wordless glyph can make.
 *
 * The subscription lives in this leaf, so a toggle re-renders this row and the
 * canvases that subscribe on their own account (`Waveform`, `LiveScope`, via
 * `useLiveTheme`), not the screen hosting it. The store applies the theme in
 * the store rather than in a hook effect because `BooksScreen` is unmounted
 * while a chapter is open (`hooks/use-theme.ts`).
 */
export function ThemeControl() {
  const theme = useTheme();
  const dark = theme.theme === "dark";
  return (
    <SettingRow
      icon={dark ? "sun" : "moon"}
      label={dark ? strings.useLightTheme : strings.useDarkTheme}
      onClick={theme.toggle}
    />
  );
}
