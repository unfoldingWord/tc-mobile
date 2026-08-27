import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/**
 * The finished box, in its three drawn states (mockup 2). Since the v0.1.2 row
 * rework (#79) the segment list no longer uses it — a row shows a green
 * `.row-status` circle instead — so this is now the RECORDER HEADER's control
 * only, where the square 3-state box toggles the finished flag.
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
  /**
   * Temporarily inert without changing the drawn state — e.g. while a save is
   * refreshing the list, so an in-flight reload cannot race a toggle. Distinct
   * from `state==="disabled"`, which is the dashed never-recorded box.
   */
  disabled?: boolean;
}

export function Checkbox({
  state,
  label,
  onToggle,
  disabled: inert = false,
}: CheckboxProps) {
  const finished = state === "finished";
  // The dashed, faded "nothing to finish here" glyph belongs to the
  // never-recorded STATE, not to being momentarily `inert`: a recorded box held
  // during a save reload must not read as never-recorded (G10). So the modifier
  // keys on the state; the HTML `disabled` still covers both (state or inert).
  const neverRecorded = state === "disabled";
  const disabled = inert || neverRecorded;
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
      <span
        className={cn(
          "checkbox__box",
          finished && "checkbox__box--on",
          neverRecorded && "checkbox__box--none"
        )}
      >
        {finished && <Icon name="check" size={18} />}
      </span>
    </button>
  );
}
