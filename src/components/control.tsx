import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";

type ControlVariant = "default" | "record" | "play" | "quiet" | "primary";

interface ControlProps {
  icon: IconName;
  /**
   * Required. The visible UI carries no text, so this label is the *entire*
   * accessible name — a zero-text screen still needs a complete text layer.
   */
  label: string;
  onClick?: () => void;
  variant?: ControlVariant;
  disabled?: boolean;
  size?: number;
  className?: string;
  /**
   * Take focus on mount. Only for a control that *is* the screen — the
   * recovery overlay — where landing anywhere else is landing nowhere.
   */
  autoFocus?: boolean;
  /**
   * Work started from this control is in flight. Sets `aria-busy` and swallows
   * further activations while true, WITHOUT unmounting or natively disabling the
   * button — so it keeps focus. A native `disabled` (or unmounting it) drops
   * focus, stranding an AT/switch user behind the scrim; the recovery panel's
   * Try again is the case this exists for (#137). The caller relabels for busy.
   */
  busy?: boolean;
  /**
   * WHY the control is disabled, when it is (#135). Read only while `disabled`.
   *
   * Passing a hint changes HOW the control is made inert: it goes
   * `aria-disabled` rather than natively `disabled`, so it stays focusable and
   * its name — which carries the reason — is announced to keyboard and switch
   * users, while activation is blocked in the handler. A natively disabled
   * button is skipped by Tab entirely, which put the reason out of reach of
   * exactly the users who most needed it (Frank + George, round 2).
   *
   * Structurally typed, not imported from the ≡-menu module: this is the generic
   * control, used at eight unrelated call sites, and it should not depend on a
   * recorder-row type (George, round 2). `RowHint` is assignable to it.
   */
  hint?: { readonly icon?: IconName; readonly label: string } | null;
  /**
   * This control is a two-state TOGGLE, and this is its state (#286, #91).
   *
   * Sets `aria-pressed` and paints the `is-on` mark while true. Both halves
   * matter and neither replaces the other: `aria-pressed` is the only machine-
   * readable statement that the control has a state at all, and the mark is the
   * only one a sighted non-reader can use. Omit it entirely for a plain action
   * button — an absent `aria-pressed` and a `false` one say different things, so
   * this must not default.
   *
   * The failure it exists for: a toggle whose glyph shows what a tap WILL do is
   * read as what the control currently IS. The first external tester did exactly
   * that on both the level meter and the zoom, so the glyph is no longer asked
   * to carry the state by itself.
   */
  pressed?: boolean;
}

const VARIANT_CLASS: Record<ControlVariant, string> = {
  default: "",
  record: "control--record",
  play: "control--play",
  quiet: "control--quiet",
  primary: "control--primary",
};

export function Control({
  icon,
  label,
  onClick,
  variant = "default",
  disabled,
  size,
  className,
  autoFocus,
  busy,
  hint,
  pressed,
}: ControlProps) {
  const shownHint = disabled && hint ? hint : null;
  const name = shownHint ? `${label}. ${shownHint.label}` : label;
  // A hinted control is inert via `aria-disabled` so it keeps its place in the
  // tab order and speaks its reason; everything else keeps the native attribute.
  const softDisabled = Boolean(disabled && hint);
  const button = (
    <button
      type="button"
      // The activation guard that makes both soft-disable states honest: a
      // `busy` control (work in flight, #137) and a hinted `aria-disabled` one
      // (#135) each stay focusable but must not fire. Without this an
      // aria-disabled row would be focusable AND clickable — worse than either
      // state alone.
      onClick={busy || softDisabled ? undefined : onClick}
      // `busy` never sets the native attribute even when `disabled` is also
      // true — a busy control must keep focus (an AT/switch user stranded behind
      // the scrim otherwise). Native `disabled` is only for the hard-disabled,
      // non-hinted, non-busy case (#137 F1: the busy × disabled cell is
      // unreachable today, but the prop's whole point is this guarantee).
      disabled={Boolean(disabled && !softDisabled && !busy)}
      aria-disabled={softDisabled || undefined}
      aria-busy={busy || undefined}
      // `false` is meaningful here — it says "this is a toggle and it is off" —
      // so only an ABSENT `pressed` drops the attribute.
      aria-pressed={pressed}
      autoFocus={autoFocus}
      aria-label={name}
      title={name}
      className={cn(
        "control",
        VARIANT_CLASS[variant],
        pressed ? "is-on" : undefined,
        className
      )}
    >
      <Icon name={icon} size={size} />
    </button>
  );
  // The wrapper is keyed on whether this control CAN carry a hint (the prop was
  // passed at all), never on whether it currently does. Switching the rendered
  // root between <button> and <span> as a row gains a badge would remount the
  // button and DESTROY it while focused — and with the sheet and list both
  // `inert` and the menu's focus grab bound to `[open]`, focus would land
  // nowhere behind the scrim. Reachable: ≡ open mid-take, a #59 interruption
  // flips `busy`, and the focused Mark row gains its badge (George, round 3).
  // With a stable root, gaining a badge adds an inner sibling and mutates
  // attributes on the same button.
  if (hint === undefined) return button;
  return (
    <span className="control-hinted">
      {button}
      {/* Decorative for AT — the reason is already in the accessible name — and
          a SIBLING of the button, so the dimming that marks the control inert
          does not also dim the mark explaining it. */}
      {shownHint?.icon ? (
        <span className="control-hint" aria-hidden="true">
          <Icon name={shownHint.icon} size={12} />
        </span>
      ) : null}
    </span>
  );
}
