import { Menu } from "./menu";
import { SettingRow } from "./setting-row";
import { ThemeControl } from "./theme-control";
import { useAlwaysChapterNumberSetting } from "@/hooks/use-settings";
import { strings } from "@/lib/strings";

/**
 * The Settings screen (#1575): the one home for app settings, opened by the
 * gear in the Books header (the DRI, 2026-10-22: "Gear icon on Books header").
 *
 * A `Menu`, like About & licenses beside it, so the focus trap, Escape, the
 * `inert` shelf and the Back layer are the reviewed ones; a `.settings-list`
 * inside it is what `o4/menus.css` keys the full-width panel on. Its header
 * control is the back chevron, named "Back to books".
 *
 * Rows, in order: the theme (moved here from the ≡ menu, `ThemeControl`'s row
 * form), then S12's chapter-number switch. A later setting is another row.
 * Each subscribes in its own leaf, so a toggle re-renders that row and the
 * screens that read the value, not this panel.
 */
export function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Menu
      open={open}
      onClose={onClose}
      title={strings.settingsTitle}
      closeLabel={strings.backToBooks}
      back
    >
      <div className="settings-list">
        <ThemeControl row />
        <ChapterNumbersRow />
      </div>
    </Menu>
  );
}

function ChapterNumbersRow() {
  const { on, toggle } = useAlwaysChapterNumberSetting();
  return (
    <SettingRow
      icon="book-open"
      label={strings.settingsChapterNumbers}
      on={on}
      onClick={toggle}
    />
  );
}
