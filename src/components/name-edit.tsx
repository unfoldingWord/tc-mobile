import { useState } from "react";

import { Control } from "./control";
import { strings } from "./strings";

interface NameEditProps {
  /** The name to seed the field with — the current name, the placeholder a new
   *  book would get (#314), or "" to type a fresh one. */
  initialValue: string;
  /** The field's accessible name AND placeholder — the whole text layer of the input. */
  fieldLabel: string;
  /**
   * Accessible name of the commit control. Defaults to the rename wording;
   * New Book passes its own, because "Save name" would not tell a screen-reader
   * user that this activation is what creates the book (#314).
   */
  saveLabel?: string;
  /** Commit the typed name. The store normalises it (trim, blank handling). */
  onSave: (value: string) => void;
  /** Abandon the edit, leaving the name unchanged — or, on New Book, creating
   *  nothing at all. */
  onCancel: () => void;
}

/**
 * The app's ONE naming field: rename a book or a chapter in place (#264), and
 * name a book at creation (#314). One text field and a commit control, shared by
 * the Books and Segments ≡ menus and the New Book dialog, so the affordance,
 * the strings and the validation are written once.
 *
 * Enter commits, Escape abandons — the two keys a facilitator on a hardware
 * keyboard expects, alongside the tappable check for touch. The field
 * auto-focuses because it is only ever REVEALED by a deliberate tap ("Rename",
 * or New Book), never shown unbidden, so opening the soft keyboard is the
 * intent, not a surprise. The store owns normalisation — trim, and what a blank
 * value means — so this passes the raw value straight through and never
 * disables its own commit: a bare Confirm on the pre-filled New Book field is
 * the one-tap path, and even a cleared field resolves to the placeholder rather
 * than erroring.
 */
export function NameEdit({
  initialValue,
  fieldLabel,
  saveLabel = strings.saveName,
  onSave,
  onCancel,
}: NameEditProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <form
      className="name-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <input
        className="name-input"
        type="text"
        value={value}
        aria-label={fieldLabel}
        placeholder={fieldLabel}
        // A label, not a document: bounded so a runaway paste cannot become the
        // stored name. Display already truncates; this keeps the data sane too.
        maxLength={80}
        autoComplete="off"
        // Revealed by an explicit tap — "Rename", or New Book — so taking focus
        // (and the keyboard) is the intent, the one place autoFocus is right
        // outside the recovery overlay. On New Book the field arrives pre-filled,
        // so the caret lands on text the translator can accept as it stands.
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Stop the Escape here: the Menu binds a WINDOW-level keydown that
            // closes the whole panel on Escape and does not honour
            // `defaultPrevented`. Without this, one Escape fires both `onCancel`
            // AND the Menu's `onClose` — which on the rename path drops an armed
            // share via `share.reset()` (G1). What Cancel means is the CALLER's
            // decision, taken exactly once: the rename steps back to the action
            // list, New Book dismisses its dialog and creates nothing.
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {/* type="button" (Control's default), so Enter submits the form once via
          onSubmit rather than also firing this — one commit path, not two. */}
      <Control
        icon="check"
        label={saveLabel}
        variant="default"
        onClick={() => onSave(value)}
      />
    </form>
  );
}
