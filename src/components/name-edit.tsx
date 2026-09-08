import { useState } from "react";

import { Control } from "./control";
import { strings } from "./strings";

interface NameEditProps {
  /** The name to seed the field with — the current name, or "" to type a fresh one. */
  initialValue: string;
  /** The field's accessible name AND placeholder — the whole text layer of the input. */
  fieldLabel: string;
  /** Commit the typed name. The store normalises it (trim, blank handling). */
  onSave: (value: string) => void;
  /** Abandon the edit, leaving the name unchanged. */
  onCancel: () => void;
}

/**
 * Rename a book or a chapter in place (#264): one text field and a commit
 * control, shared by the Books and Segments ≡ menus so the affordance is
 * written once.
 *
 * Enter commits, Escape abandons — the two keys a facilitator on a hardware
 * keyboard expects, alongside the tappable check for touch. The field
 * auto-focuses because it is REVEALED by a deliberate "Rename" tap (never shown
 * unbidden), so opening the soft keyboard is the intent, not a surprise. The
 * store owns normalisation, so this passes the raw value straight through.
 */
export function NameEdit({
  initialValue,
  fieldLabel,
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
        // Revealed by an explicit Rename tap, so taking focus (and the keyboard)
        // is the intent — the one place autoFocus is right outside the recovery
        // overlay.
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Stop the Escape here: the Menu binds a WINDOW-level keydown that
            // closes the whole panel on Escape and does not honour
            // `defaultPrevented`. Without this, one Escape fires both `onCancel`
            // (return to the action list) AND the Menu's `onClose` — which drops
            // an armed share via `share.reset()` (G1). Cancel must only step back
            // to the action list, never dismiss the menu.
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {/* type="button" (Control's default), so Enter submits the form once via
          onSubmit rather than also firing this — one commit path, not two. */}
      <Control
        icon="check"
        label={strings.saveName}
        variant="default"
        onClick={() => onSave(value)}
      />
    </form>
  );
}
