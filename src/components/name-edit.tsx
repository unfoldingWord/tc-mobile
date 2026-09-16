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
  /**
   * The commit is in flight. Passed straight through to the save Control's OWN
   * `busy` (never `disabled`): `Control`'s docblock is explicit that `busy`
   * exists so a committing control can swallow activation and announce
   * `aria-busy` WITHOUT dropping out of the tab order the way a native
   * `disabled` would — Frank R4 P2 caught exactly that on the first pass here,
   * a focused "Create book" going natively disabled mid-commit and stranding
   * a keyboard/switch user with no focused control left in the still-open
   * dialog. `disabled` is the wrong half of `EraseConfirm` to imitate; `busy`
   * is the one Control ships for this. Optional and defaulted false: the
   * rename call sites have no in-flight window worth signalling (their menu
   * already re-renders on the write's own error/close paths).
   */
  busy?: boolean;
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
 * intent, not a surprise.
 *
 * This field never validates and never disables its own commit: it passes the
 * raw value straight through, and what a blank one MEANS belongs to the caller's
 * store, which is the only place that knows. The three are deliberately
 * different — `renameBook` keeps the current name, `renameChapter` clears the
 * label back to the "Chapter N" default, `createBook` falls back to the
 * "Book NNN" placeholder — so do not read any one of them as this component's
 * contract (George R1 P3-5).
 */
export function NameEdit({
  initialValue,
  fieldLabel,
  saveLabel = strings.saveName,
  onSave,
  onCancel,
  busy = false,
}: NameEditProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <form
      className="name-edit"
      onSubmit={(e) => {
        e.preventDefault();
        // Enter still submits the form while busy (the input has no
        // `disabled`/`readOnly` of its own — see below, and #385) — swallow
        // it here so it cannot re-invoke `onSave` behind the busy Control's
        // back (Control does not native-disable on `busy`, by design).
        if (busy) return;
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
            // One Escape must resolve to ONE cancel. The Menu binds a
            // WINDOW-level keydown that closes the whole panel, and on the
            // rename path that also drops an armed share via `share.reset()`
            // (G1) — so a double-fire is a real loss, not a cosmetic one.
            // `preventDefault` above is what Menu actually checks
            // (`menu.tsx`, `if (e.defaultPrevented) return`); `stopPropagation`
            // is belt-and-braces, kept so this does not silently start
            // double-firing if that check is ever removed (George R1 P3-6).
            // What Cancel MEANS is the caller's decision: the rename steps back
            // to the action list, New Book dismisses its dialog and creates
            // nothing.
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
        busy={busy}
        onClick={() => onSave(value)}
      />
    </form>
  );
}
