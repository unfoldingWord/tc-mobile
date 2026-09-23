import { useRef, useState } from "react";

import { Control } from "./control";
import { confirmControlAffordance } from "./control-affordance";
import { strings } from "./strings";

interface NameEditProps {
  /** The name to seed the field with — the current name, the default a new book
   *  (#314) or chapter (#609) would get, or "" to type a fresh one. */
  initialValue: string;
  /** Select the offered default once, so initial typing replaces it. */
  selectInitialValue?: boolean;
  /** The field's accessible name AND placeholder — the whole text layer of the input. */
  fieldLabel: string;
  /**
   * Accessible name of the commit control. Defaults to the rename wording; the
   * two creation prompts pass their own, because "Save name" would not tell a
   * screen-reader user that this activation is what creates the book (#314) or
   * the chapter (#609).
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
   *
   * The glyph/label swap while busy, and the Escape/re-tap guards below, come
   * from the SAME table Share's `ready` state uses (`control-affordance.ts`,
   * #383/#354): a busy Confirm never reads as idle for the length of the
   * write, on either caller.
   */
  busy?: boolean;
}

/**
 * The app's ONE naming field: rename a book or a chapter in place (#264), and
 * name a book (#314) or a chapter (#609) at creation. One text field and a
 * commit control, shared by the Books and Segments ≡ menus and both creation
 * prompts, so the affordance, the strings and the validation are written once.
 *
 * Enter commits, Escape abandons — the two keys a facilitator on a hardware
 * keyboard expects, alongside the tappable check for touch. The field
 * auto-focuses because it is only ever REVEALED by a deliberate tap ("Rename",
 * or either `+`), never shown unbidden, so opening the soft keyboard is the
 * intent, not a surprise.
 *
 * This field never validates and never disables its own commit: it passes the
 * raw value straight through, and what a blank one MEANS belongs to the caller's
 * store, which is the only place that knows. The four are deliberately
 * different — `renameBook` keeps the current name, `renameChapter` clears the
 * label back to the "Chapter N" default, `createBook` falls back to the
 * "Book NNN" placeholder, `addChapter` stores no label at all — so do not read
 * any one of them as this component's contract (George R1 P3-5).
 */
export function NameEdit({
  initialValue,
  selectInitialValue = false,
  fieldLabel,
  saveLabel = strings.saveName,
  onSave,
  onCancel,
  busy = false,
}: NameEditProps) {
  const [value, setValue] = useState(initialValue);
  const selectedInitialValue = useRef(false);
  const affordance = confirmControlAffordance(busy);
  return (
    <form
      className="name-edit"
      onSubmit={(e) => {
        e.preventDefault();
        // Enter still submits the form while busy (the input is `readOnly`,
        // not `disabled`, below — #385) — swallow it here so it cannot
        // re-invoke `onSave` behind the busy Control's own onClick guard
        // (`control.tsx`; Control does not native-disable on `busy`, by
        // design, so this form-level guard is the only thing stopping Enter).
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
        // Revealed by an explicit tap — "Rename", or either `+` — so taking
        // focus (and the keyboard) is the intent, the one place autoFocus is
        // right outside the recovery overlay. On both creation prompts the field
        // arrives pre-filled, so the caret lands on text the translator can
        // accept as it stands.
        autoFocus
        onFocus={(event) => {
          if (selectInitialValue && !selectedInitialValue.current) {
            selectedInitialValue.current = true;
            event.currentTarget.select();
          }
        }}
        // Frozen while the write is in flight (George R1 P2, #384): `onSave`
        // already closed over the value it was called with, so a keystroke
        // typed after that tap (the field keeps focus; nothing moves it to
        // Confirm) would be visible next to a busy Confirm without ever
        // reaching disk — a live field beside a wait mark reading as "this is
        // what is being saved/created" when it is not.
        readOnly={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // One Escape must resolve to ONE cancel. Menu's own WINDOW-level
            // keydown listener DOES honour `defaultPrevented` (`menu.tsx`'s
            // Escape handler returns early when it sees it) — which is
            // exactly why calling preventDefault/stopPropagation on this
            // native event, before React's synthetic dispatch reaches Menu,
            // keeps a single Escape from firing both `onCancel` (return to
            // the action list) AND Menu's `onClose`. On the rename path that
            // second fire would also drop an armed share via `share.reset()`
            // (G1) — a double-fire is a real loss, not a cosmetic one. What
            // Cancel MEANS is the caller's decision: the rename steps back to
            // the action list, a creation prompt dismisses itself and creates
            // nothing — but either way, only on ONE keypress.
            e.stopPropagation();
            // While busy, a no-op — like EraseConfirm's Cancel while erasing —
            // NOT a call to `onCancel` (Frank r2, #384). The commit already in
            // flight cannot be aborted; calling `onCancel` would only clear the
            // busy UI and return to idle while that write kept running, so it
            // could still land moments later with nothing open to show it —
            // directly contradicting `onCancel`'s own contract. The wait this
            // leaves the field in is bounded by a single IndexedDB write, not
            // indefinite.
            if (busy) return;
            onCancel();
          }
        }}
      />
      {/* type="button" (Control's default), so Enter submits the form once via
          onSubmit rather than also firing this — one commit path, not two.
          `busy` (not `disabled`): the control stays focused and readable to
          AT through the write, and its own onClick guard (control.tsx) already
          no-ops a re-tap while busy — see `affordance`/`control-affordance.ts`
          for the glyph table (#383). */}
      <Control
        icon={affordance.icon}
        label={busy ? strings.savingName : saveLabel}
        variant="default"
        busy={affordance.busy}
        onClick={() => onSave(value)}
      />
    </form>
  );
}
