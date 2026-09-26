import { type CSSProperties, type Ref } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import { strings } from "@/lib/strings";

interface O4BookDeleteAskProps {
  /** The book the ask names. */
  name: string;
  /** The book's cover colour, already resolved (`lib/cover-colour.ts`). */
  coverHex: string;
  /** The delete is in flight: Delete disables; Keep stays in the Tab order. */
  busy: boolean;
  /** Keep's button, so the screen can land focus on it (the safe action). */
  keepRef: Ref<HTMLButtonElement>;
  onKeep: () => void;
  onDelete: () => void;
}

/**
 * The O4 book sheet asking before it deletes (#980, G6; #949 D16 → B).
 *
 * The book ≡ sheet's own contents while a delete is armed: the book's small
 * cover and name as the header, then 13's two equal-size buttons, Keep and
 * Delete — as the O4 workbench draws G6. It renders inside the SAME `<Menu>`
 * the Rename / Share / Delete actions were in, so the sheet's focus trap,
 * Escape and scrim are the ones already reviewed; the screen decides what
 * Escape, the scrim and Back mean while this is up (`books-screen.tsx`).
 *
 * The two buttons reuse `EraseConfirm`'s `confirm-actions` / `confirm-cancel`
 * markup on purpose, so `o4/dialogs.css` gives them 13's shape rather than a
 * second copy of it here. The header reuses the menu sheets' `o4-sheet-head`
 * row (`o4/menus.css`); the cover and name rules are the Books area's
 * (`o4/books.css`).
 *
 * Presentational: every outcome arrives by prop. O4 only — the current look
 * keeps the floating `EraseConfirm` card.
 */
export function O4BookDeleteAsk({
  name,
  coverHex,
  busy,
  keepRef,
  onKeep,
  onDelete,
}: O4BookDeleteAskProps) {
  return (
    <div
      className="books-delete-ask"
      role="group"
      // The question the floating card's title asked, so a screen reader
      // entering the group still hears which book is about to go.
      aria-label={strings.deleteBookConfirmTitle(name)}
    >
      <div className="o4-sheet-head">
        <span
          className="books-cover is-sm"
          aria-hidden="true"
          // A cover colour is the book's identity, not a themed role — the
          // same inline custom property the shelf's cover uses.
          style={{ "--book-cover": coverHex } as CSSProperties}
        >
          <Icon name="book" size={24} />
        </span>
        <span className="books-sheet-name">{name}</span>
      </div>
      <div className="confirm-actions">
        <Control
          ref={keepRef}
          icon="back"
          label={strings.keepBook}
          variant="quiet"
          // Not disabled while busy, for EraseConfirm's reason: disabling both
          // would empty the trap. The screen guards its action instead.
          onClick={onKeep}
          className="confirm-cancel"
        />
        <Control
          icon="trash"
          label={strings.deleteBookYes}
          variant="record"
          disabled={busy}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}
