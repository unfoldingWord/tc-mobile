import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

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
  /** The erase is in flight: Erase disables, while Cancel stays enabled so the
   *  focus trap is never empty — but its action, like Escape and a scrim tap, is
   *  guarded to a no-op, so a destructive op is not abandoned half-done. */
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
  // Read from the keydown listener without re-subscribing it. The listener is
  // bound once per open (below); keying it on `busy`/`onCancel` instead would
  // re-run the whole effect — and re-fire the focus grab — on every parent
  // render, which while a take plays is every 60 ms, yanking a keyboard user off
  // Erase before they can confirm (George R-B6). Refs updated each render keep
  // the handler current without that churn.
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  // Synced in a LAYOUT effect, not during render (refs must not be written
  // while rendering) and not in a passive `useEffect` (share-progress.tsx's
  // identical bug, Frank at `9832a8b` P2, #491): a passive effect is
  // scheduled after the browser paints, so a keydown queued in that same
  // window can fire against a STALE `busyRef` — here, an Escape landing
  // between `onConfirm` setting the parent's `busy` and this effect
  // catching up, read as "not busy" and cancelled a confirm that had already
  // started committing. A layout effect runs synchronously right after the
  // DOM mutation, before paint or any queued event, so the refs are current
  // by the time anything could react to what just rendered — the keydown
  // listener reads the latest values without the effect that binds it
  // re-running.
  useLayoutEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  });

  // The synchronous in-flight latch. `busy` reaches this component only after the
  // parent renders and a passive effect syncs `busyRef` — a window in which the
  // guard is still false. For a NON-destructive control that is harmless, but
  // here an Escape/Cancel/scrim in that window would tear the dialog down while
  // clearSegmentTake is committing, un-inert the recorder sheet, and let Back's
  // close() SAVE over the erase (Frank R-B6). So confirm latches this ref
  // synchronously, before onConfirm runs; every cancel path checks it. Reset on
  // the open edge so a reused dialog starts clean.
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (open) inFlightRef.current = false;
  }, [open]);

  // The one cancel path. Blocked the instant Erase is activated (`inFlightRef`),
  // and while the parent reports `busy` (belt-and-braces). Stable identity (reads
  // only refs) so the bound-once keydown effect can depend on it without
  // re-binding.
  const cancel = useCallback(() => {
    if (inFlightRef.current || busyRef.current) return;
    onCancelRef.current();
  }, []);
  const beginConfirm = () => {
    if (inFlightRef.current) return; // also the synchronous double-activation guard
    inFlightRef.current = true;
    onConfirm();
  };

  // Land on Cancel, the safe action, ONCE on the closed→open edge — not the
  // first control in DOM order (this is destructive), and not on every render.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(".confirm-cancel")?.focus();
  }, [open]);

  // When the erase commits, Erase disables (below). If it held focus, focus
  // would fall out of the panel to the document, breaking the trap for a
  // keyboard/switch user mid-op. Move it to Cancel — which stays enabled, its
  // action guarded to a no-op — so focus stays inside the dialog (#77). Fires
  // only on the busy edge; on the open edge `busy` is false, so it never fights
  // the Cancel-focus grab above.
  useEffect(() => {
    if (open && busy) {
      panelRef.current?.querySelector<HTMLElement>(".confirm-cancel")?.focus();
    }
  }, [open, busy]);

  // The focus trap + Escape, bound once per open. Reads `busy`/`onCancel`
  // through refs so a parent re-render never re-attaches it or re-grabs focus.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Marked handled, ALWAYS — including mid-erase, when `cancel` is a
        // no-op. This dialog can be stacked over an open `Menu` (the failure
        // log's Clear, George R2 P3-3, is armed from inside the menu rather
        // than after closing it, so a mis-tap returns to the panel with an
        // armed share intact). `menu.tsx` closes on Escape unless a child
        // claims it, reading `defaultPrevented` on this same native event —
        // the contract its rename field already uses. Without this, one Escape
        // would cancel the confirm and tear down the menu behind it.
        e.preventDefault();
        // Mid-erase, Escape does nothing: the op is already committing.
        cancel();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel; with the scrim covering everything behind,
      // wrapping is what makes it a real boundary. Cancel stays enabled while
      // busy (see below), so the trap is never empty and Tab cannot escape.
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    // CAPTURE, not bubble. This dialog can be stacked over an open `Menu` (the
    // failure log's Clear, George R2 P3-3), and `menu.tsx` binds its own window
    // keydown when it opens — which is BEFORE this one, so on the bubble phase
    // the menu would read `defaultPrevented` as false and close itself before
    // this handler ever ran. Capturing puts the topmost dialog first, which is
    // what "modal" means, and it is what makes the `defaultPrevented` contract
    // `menu.tsx` already documents for its rename field work here too.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, cancel]);

  if (!open) return null;

  // Portalled to <body>, like Menu: on the recorder path this dialog is rendered
  // inside `.recorder-scrim` (z 60), so without the portal its own z-index would
  // only compete INSIDE that stacking context and the portalled menu (z 80) would
  // paint over it. At <body> its z 90 sits above both (George R-B6). It also
  // keeps the confirm out of any caller subtree that goes `inert`.
  return createPortal(
    <div
      className="confirm-scrim"
      // A tap on the scrim, but not the panel, cancels — unless mid-erase.
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
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
            // Deliberately NOT disabled while busy: disabling both buttons would
            // empty the focus trap and let Tab escape the dialog (George R-B6,
            // the same disabled-last-item hole this round closed in menu.tsx).
            // The action is guarded by `cancel()` instead — a tap once Erase is
            // activated is a no-op — so the trap stays honest.
            onClick={cancel}
            className="confirm-cancel"
          />
          <Control
            icon="trash"
            label={confirmLabel}
            variant="record"
            disabled={busy}
            onClick={beginConfirm}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
