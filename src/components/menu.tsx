import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Control } from "./control";
import { strings } from "./strings";

/**
 * Focusable controls inside the panel — NATIVELY disabled ones excluded on
 * purpose; `aria-disabled` ones deliberately kept.
 *
 * A natively disabled button can never be `document.activeElement`, so it must
 * be skipped for BOTH the initial focus (landing on it focuses nothing,
 * stranding the user behind the scrim) and the Tab-wrap boundary (a disabled
 * `last` never turns the wrap). The recorder menu's Redo and Erase are disabled
 * at idle/no-clip while the VU toggle stays live, which is exactly when a single
 * shared selector matters. Mirrors EraseConfirm.
 *
 * A row carrying a hint (#135) is `aria-disabled` instead, and so MATCHES this
 * selector by design: it is focusable, announces its reason, and holds its place
 * in the Tab order. Only the open-edge landing filters those out — see the
 * `actionable` list below, which is the other half of this rule.
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
   * The menu's contents. The global menu opened from the hamburger holds the
   * About & licenses entry (#36); the recorder and the share flows open the same
   * surface with their own entries. Template Library is still B7 (#33).
   */
  children?: React.ReactNode;
  /**
   * Re-land the open-edge focus whenever this changes, not only when the menu
   * opens. A menu whose body swaps in place while it stays open — the About
   * panel popping between its list and an in-drawer licence text (#36) — would
   * otherwise orphan focus on the node that just unmounted. Leave it undefined
   * (the default) and focus lands once per open, as before.
   */
  focusKey?: string | number;
  /**
   * The header control's label and spoken name. Defaults to "Close menu"; a
   * caller whose `onClose` does something other than close — the About panel's
   * pops an in-drawer text back to its list (#36) — passes the matching verb so
   * the control does not say "Close" while it goes back.
   */
  closeLabel?: string;
}

/**
 * The global menu, opened from the hamburger — and the reusable modal surface
 * the recorder and the share flows reuse.
 *
 * It ships the mechanism: a scrim, a focus trap, close on Escape or a scrim tap,
 * and a heading a screen reader announces. Callers fill it with entries.
 */
export function Menu({
  open,
  onClose,
  title = strings.menuTitle,
  children,
  focusKey,
  closeLabel = strings.menuClose,
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
  //
  // Re-runs on `focusKey` too, so a body that swaps while the menu stays open
  // (the About list ⇄ a licence text, #36) re-lands focus on the new content.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE)
    );
    // Hinted rows are `aria-disabled`, not natively disabled (#135), so they now
    // MATCH `FOCUSABLE` and hold their place in the Tab order — which is the
    // point: that is how a keyboard or switch user hears the reason. They are
    // still the wrong place to LAND on open, so the open-edge focus skips them
    // and falls back only if the menu holds nothing actionable.
    const actionable = focusables.filter(
      (el) => el.getAttribute("aria-disabled") !== "true"
    );
    const target =
      actionable.find((el) => !headerRef.current?.contains(el)) ??
      focusables.find((el) => !headerRef.current?.contains(el)) ??
      focusables[0];
    target?.focus();
  }, [open, focusKey]);

  // The focus trap + Escape, bound once per open; reads `onClose` via the ref.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A child already handled this Escape (the rename field calls
        // preventDefault on its own Cancel — G1). Honour it: closing the whole
        // menu here would double-fire and drop an armed share via share.reset().
        // This reads a flag on the one shared native event, so it holds no matter
        // how React delegates the portalled field's synthetic event.
        if (e.defaultPrevented) return;
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
            label={closeLabel}
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
