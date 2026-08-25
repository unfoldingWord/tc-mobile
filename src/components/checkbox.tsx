import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/**
 * The finished box, in its three drawn states (mockup 2). It sits on every
 * segment row and, unchanged, in the recorder header — one component so the
 * two places read identically and toggle the same flag.
 *
 *   finished  solid box + tick   enabled   status === "affirmed"
 *   empty     solid empty box    enabled   has a recording, not finished
 *   disabled  dashed grey box    disabled  no recording → cannot be finished
 *
 * "Never recorded" is disabled on purpose: you cannot finish what has no
 * audio, and the store rejects it too (`setSegmentFinished`), so the disabled
 * box is the visible half of an invariant, not merely a hint.
 */
type CheckboxState = "finished" | "empty" | "disabled";

interface CheckboxProps {
  state: CheckboxState;
  /**
   * Required. The box carries no text, so this is its whole accessible name —
   * e.g. "Mark segment 2 finished" / "Segment 3 has no recording yet".
   */
  label: string;
  /** Absent on a disabled box; the row still renders it, just inert. */
  onToggle?: () => void;
}

export function Checkbox({ state, label, onToggle }: CheckboxProps) {
  const finished = state === "finished";
  const disabled = state === "disabled";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={finished}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className="checkbox"
    >
      <span className={cn("checkbox__box", finished && "checkbox__box--on")}>
        {finished && <Icon name="check" size={18} />}
      </span>
    </button>
  );
}
