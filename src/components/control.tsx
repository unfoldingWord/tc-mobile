import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icon";
import type { RowHint } from "./menu-row-state";

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
   * WHY the control is disabled, when it is (#135). Read only while `disabled`,
   * and appended to the accessible name, so the reason travels with the control
   * rather than in a message bubble. Callers derive it from the same predicate
   * that sets `disabled` (`menu-row-state.ts`).
   */
  hint?: RowHint | null;
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={name}
      title={name}
      className={cn("control", VARIANT_CLASS[variant], className)}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
