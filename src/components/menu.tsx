import { useEffect, useRef } from "react";

import { Control } from "./control";
import { strings } from "./strings";

/**
 * Focusable controls inside the panel — disabled ones excluded on purpose.
 *
 * A disabled button can never be `document.activeElement`, so it must be skipped
 * for BOTH the initial focus (landing on it focuses nothing, stranding the user
 * behind the scrim) and the Tab-wrap boundary (a disabled `last` never turns the
 * wrap). The recorder menu's Redo and Erase are disabled at idle/no-clip while
 * the VU toggle stays live, which is exactly when a single shared selector
 * matters. Mirrors EraseConfirm.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface MenuProps {
  open: boolean;
  onClose: () => void;
  /**
   * Panel heading, announced by a screen reader. Defaults to the global menu's
   * title; the recorder opens the same surface with its own title (Redo now, VU
   * and Erase in B6).
   */
  title?: string;
  /**
   * The menu's contents. Empty on the global menu this lane: Template Library is
   * B7 (#33). An empty labelled panel is honest and operable infrastructure — it
   * opens, traps focus, and closes — not a stub, because the mechanism is exactly
   * what that batch mounts into.
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
export function Menu({
  open,
  onClose,
  title = strings.menuTitle,
  children,
}: MenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Land focus inside the panel so a keyboard/switch user is not left behind
    // the scrim on the page they just covered. First ENABLED control, never a
    // disabled one (focusing it is a no-op that strands them — Frank R-B6).
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel: with nothing behind it reachable, focus
      // wrapping is what makes the scrim a real boundary and not just paint.
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
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
        aria-label={title}
        className="menu-panel"
      >
        <div className="flex items-center justify-between">
          <span className="t-title">{title}</span>
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
