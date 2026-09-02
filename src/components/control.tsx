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
  hint,
}: ControlProps) {
  const shownHint = disabled && hint ? hint : null;
  const name = shownHint ? `${label}. ${shownHint.label}` : label;
  // A hinted control is inert via `aria-disabled` so it keeps its place in the
  // tab order and speaks its reason; everything else keeps the native attribute.
  const softDisabled = Boolean(disabled && hint);
  const button = (
    <button
      type="button"
      // The activation guard that makes `aria-disabled` honest. Without it the
      // row would be focusable AND clickable — worse than either state alone.
      onClick={softDisabled ? undefined : onClick}
      disabled={disabled && !softDisabled}
      aria-disabled={softDisabled || undefined}
      autoFocus={autoFocus}
      aria-label={name}
      title={name}
      className={cn("control", VARIANT_CLASS[variant], className)}
    >
      <Icon name={icon} size={size} />
    </button>
  );
  if (!shownHint?.icon) return button;
  // The badge is decorative for AT — the reason is already in the name — and a
  // SIBLING of the button, so the dimming that marks the control inert does not
  // also dim the mark explaining it.
  return (
    <span className="control-hinted">
      {button}
      <span className="control-hint" aria-hidden="true">
        <Icon name={shownHint.icon} size={12} />
      </span>
    </span>
  );
}
