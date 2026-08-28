import { useEffect, useRef } from "react";

/**
 * Return focus to whatever held it when a dialog opened, once that dialog closes.
 *
 * A modal (the `Menu`, `EraseConfirm`) traps focus while it is open and lands
 * focus inside itself on the open edge. But on close nothing hands focus back:
 * it falls to the document, dropping a keyboard/switch/AT user at the top of the
 * page instead of the control they opened the dialog from. Capturing the trigger
 * on the open edge and restoring it on the close edge keeps them in place. This
 * matters for this app's population — people who may not read, where switch
 * access is a real input path — which is why it is worth doing rather than a
 * nicety to skip (#73).
 *
 * Call this BEFORE the effect that moves focus into the panel, so the captured
 * `activeElement` is still the trigger and not the panel control that effect is
 * about to focus. Effects run in declaration order.
 *
 * Guarded on the trigger still being connected: a dialog that closes because the
 * surface it lived on is being torn down (a recorder erase that exits the sheet)
 * has no trigger to return to, and focusing a detached node is a silent no-op at
 * best. `isConnected` is the check that keeps this from fighting an unmount.
 */
export function useRestoreFocusOnClose(open: boolean): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [open]);
}
