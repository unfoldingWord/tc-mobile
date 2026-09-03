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
}: ControlProps) {
  return (
    <button
      type="button"
      onClick={busy ? undefined : onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-busy={busy || undefined}
      aria-label={label}
      title={label}
      className={cn("control", VARIANT_CLASS[variant], className)}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
