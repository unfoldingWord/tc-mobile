import { forwardRef } from "react";

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
   * Take focus on mount. For a control that *is* the screen — the recovery
   * overlay — where landing anywhere else is landing nowhere; or for one that
   * has just BECOME the primary action of an already-focused surface, where the
   * thing the person is about to tap did not exist a moment ago.
   *
   * The second case is the failure-log panel's Share (`failure-log-panel.tsx`):
   * tap 1 prepares the report and swaps the quiet Share for an armed Send, and
   * the menu's own focus grab is keyed on `[open]` (`menu.tsx`) so it has
   * already happened and will not happen again. Without this, the control that
   * replaced the one under the person's finger is not the one focus is on.
   *
   * Not a licence to scatter it: two controls claiming focus on the same commit
   * is a race with no defined winner. One per surface (George R7 P3-3 — this
   * comment claimed "only the recovery overlay" while the panel had been using
   * it for two rounds).
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
  /**
   * This control is the next required action in the guided chain (#604), and
   * wears the guide ring while it is.
   *
   * Purely visual, and deliberately so: the ring says "here next" to someone
   * who may not read, and the accessible name already says what the control
   * does. Announcing a second "this is the next step" on every guided control
   * would put the guide in the way of an AT user who is navigating the screen
   * their own way — the same reason the disabled-row badge is `aria-hidden`.
   *
   * Which control this is at any moment is `guided-step.ts`'s answer, never a
   * local condition: a call site that decides for itself is how two rings end
   * up on screen at once.
   */
  guided?: boolean;
}

const VARIANT_CLASS: Record<ControlVariant, string> = {
  default: "",
  record: "control--record",
  play: "control--play",
  quiet: "control--quiet",
  primary: "control--primary",
};

/**
 * Forwards its ref to the underlying `<button>` (#491, focus-restore's
 * "fallback" landmark): a caller that needs to hand this control's live DOM
 * node to `useFocusRestore().restore({ fallback })` — because the control it
 * captured on open has since unmounted under a status-driven ternary, e.g.
 * "Share chapter" swapping for "Share now" — needs a ref that survives that
 * swap. Optional everywhere else; every existing call site that does not
 * pass one is unaffected.
 */
export const Control = forwardRef<HTMLButtonElement, ControlProps>(
  function Control(
    {
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
      guided,
    },
    ref
  ) {
    const shownHint = disabled && hint ? hint : null;
    const name = shownHint ? `${label}. ${shownHint.label}` : label;
    // A hinted control is inert via `aria-disabled` so it keeps its place in the
    // tab order and speaks its reason; everything else keeps the native attribute.
    const softDisabled = Boolean(disabled && hint);
    const button = (
      <button
        ref={ref}
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
          guided ? "is-guided" : undefined,
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
);
