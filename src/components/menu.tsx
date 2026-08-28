import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
  // The header (title + Close). Held so the open-edge focus can skip past it to
  // the first real action rather than landing on the dismiss control.
  const headerRef = useRef<HTMLDivElement | null>(null);
  // Read `onClose` from the keydown listener without re-subscribing it. Both B6
  // consumers pass an inline `onClose` and open the menu over a TICKING parent —
  // the recorder menu is now live mid-take (elapsedMs every 100 ms) and the row
  // menu sits on a list that repaints every 60 ms during playback. Keying the
  // effect on `onClose` would re-run it — and re-grab focus — on every tick,
  // yanking a keyboard user off the entry they were on (George R-B6, the same
  // defect EraseConfirm already fixed). A ref keeps the handler current without
  // that churn, so the effect binds once per open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Land focus inside the panel ONCE on the open edge — first ENABLED control,
  // never a disabled one (focusing it is a no-op that strands the user behind
  // the scrim — Frank R-B6) — and not again on every parent render.
  //
  // Skip the header's Close to land on the first ACTION: a menu that opens with
  // focus on its dismiss control invites an immediate close, and a one-action
  // menu (Share chapter, B7) makes that the wrong first target (George R-B7).
  // Fall back to the panel's first focusable, which is Close on an empty menu.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE)
    );
    const target =
      focusables.find((el) => !headerRef.current?.contains(el)) ??
      focusables[0];
    target?.focus();
  }, [open]);

  // The focus trap + Escape, bound once per open; reads `onClose` via the ref.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
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
  }, [open]);

  if (!open) return null;

  // Portalled to <body>, out of the caller's subtree. A caller that goes `inert`
  // to hide its own background from AT (the Segments list does this while a
  // dialog is up) must not thereby inert the open menu itself — which it would
  // if the menu rendered inline inside it. The scrim is `position: fixed`, so
  // the DOM parent never mattered for layout. (Frank/George R-B6.)
  return createPortal(
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
        <div ref={headerRef} className="flex items-center justify-between">
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
    </div>,
    document.body
  );
}
