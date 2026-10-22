import { Icon, type IconName } from "./icon";

/**
 * One row of the Settings screen (#1575): the glyph first, the words beside
 * it, and — for an on/off setting — the state drawn on the row itself. A
 * person who does not read finds the row by its glyph and sees what it is set
 * to without opening anything (AGENTS.md: state-in-place).
 *
 * `label` is the whole accessible name and is also the visible text, so the
 * name holds what is drawn (WCAG 2.5.3). `on` is omitted for a row whose tap
 * is an action rather than a two-state switch (the theme, which names its
 * destination): an absent `aria-pressed` and a `false` one say different
 * things, so it is only set for a real switch.
 */
export function SettingRow({
  icon,
  label,
  on,
  onClick,
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={on ? "setting-row is-on" : "setting-row"}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      <Icon name={icon} size={26} />
      <span className="setting-row-text">{label}</span>
      {on === undefined ? null : (
        <span className="setting-switch" aria-hidden="true" />
      )}
    </button>
  );
}
