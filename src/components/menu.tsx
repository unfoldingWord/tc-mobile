import { useEffect, useRef } from "react";

import { Control } from "./control";
import { strings } from "./strings";

interface MenuProps {
  open: boolean;
  onClose: () => void;
  /**
   * The menu's contents. Empty this lane by design: Template Library is B7
   * (#33), the recorder menu is B6. An empty labelled panel is honest and
   * operable infrastructure — it opens, traps focus, and closes — not a stub,
   * because the mechanism is exactly what those batches mount into.
   */
  children?: React.ReactNode;
}

/**
 * The global menu, opened from the hamburger.
 *
 * This lane ships the surface, not entries: a scrim, a focus trap, close on
 * Escape or a scrim tap, and a heading a screen reader announces. That is the
 * reusable mechanism B6 and B7 both fill, so it earns its place now even while
 * it holds nothing.
 */
export function Menu({ open, onClose, children }: MenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Land focus inside the panel so a keyboard/switch user is not left behind
    // the scrim on the page they just covered.
    panel?.querySelector<HTMLElement>("button")?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel: with nothing behind it reachable, focus
      // wrapping is what makes the scrim a real boundary and not just paint.
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])'
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="menu-scrim"
      // A tap on the scrim, but not on the panel, closes.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={strings.menuTitle}
        className="menu-panel"
      >
        <div className="flex items-center justify-between">
          <span className="t-title">{strings.menuTitle}</span>
          <Control
            icon="back"
            label={strings.menuClose}
            variant="quiet"
            onClick={onClose}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
