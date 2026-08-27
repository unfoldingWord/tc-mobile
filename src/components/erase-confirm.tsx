import { useEffect, useRef } from "react";

import { Control } from "./control";
import { Icon } from "./icon";

interface EraseConfirmProps {
  open: boolean;
  /** The confirming line, e.g. "Erase this recording?". Copy is supplied by the
   *  integrator (strings.ts), never read here — this surface is pure UI. */
  title: string;
  /** Accessible name of the destructive action. */
  confirmLabel: string;
  /** Accessible name of the safe action. */
  cancelLabel: string;
  /** The erase is in flight: both buttons disabled, and neither Escape nor a
   *  scrim tap dismisses, so a destructive op is not abandoned half-done. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The erase confirmation (B6, D-CONFIRM).
 *
 * A minimal-text dialog: a trash glyph, one line, and two choices. Destructive,
 * so focus lands on Cancel — the safe action — not on Erase, and Escape or a
 * scrim tap resolves to Cancel too.
 *
 * Presentational only: it holds no store or hook, and every label and outcome
 * arrives by prop. The scrim, focus trap, Escape-closes and scrim-tap-cancels
 * mirror `menu.tsx`; the a11y contract (role=dialog, aria-modal, aria-label,
 * Tab trapped inside) is the same.
 */
export function EraseConfirm({
  open,
  title,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: EraseConfirmProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Land on Cancel, not the first control in DOM order: this is destructive,
    // so a keyboard/switch user's default keypress must be the safe one.
    panel?.querySelector<HTMLElement>(".confirm-cancel")?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Mid-erase, Escape does nothing: the op is already committing.
        if (!busy) onCancel();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel; with the scrim covering everything behind,
      // wrapping is what makes it a real boundary.
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-scrim"
      // A tap on the scrim, but not the panel, cancels — unless mid-erase.
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="confirm-panel"
      >
        <Icon name="trash" size={32} className="confirm-glyph" />
        <span className="t-title">{title}</span>
        <div className="confirm-actions">
          <Control
            icon="back"
            label={cancelLabel}
            variant="quiet"
            disabled={busy}
            onClick={onCancel}
            className="confirm-cancel"
          />
          <Control
            icon="trash"
            label={confirmLabel}
            variant="record"
            disabled={busy}
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  );
}
