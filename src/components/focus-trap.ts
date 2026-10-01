/**
 * The Tab half of a modal focus trap, shared by `Menu` and `EraseConfirm`
 * (#160, L-15).
 *
 * Both dialogs had the same twelve lines and the same selector — `menu.tsx`
 * behind a `FOCUSABLE` const, `erase-confirm.tsx` as an inline string literal,
 * so the two copies could not even be found by searching for the name.
 *
 * ONLY the Tab wrap is here, and that is deliberate rather than a half-done
 * extraction. The rest of the two traps looks alike and is not:
 *
 *   Escape        `Menu` honours `defaultPrevented` and closes; `EraseConfirm`
 *                 ALWAYS calls `preventDefault` — including mid-erase, when
 *                 its cancel is a no-op — so one Escape over a stacked confirm
 *                 cannot also tear down the menu behind it.
 *   Listener      `Menu` binds on the bubble phase, `EraseConfirm` on CAPTURE,
 *                 because the menu binds first and would otherwise read
 *                 `defaultPrevented` as false and close before the topmost
 *                 dialog ran.
 *   Handler refs  `Menu` syncs through a passive effect; `EraseConfirm` uses
 *                 `useLayoutEffect`, because a passive sync leaves a window in
 *                 which an Escape fires against a stale `busy`.
 *
 * Each of those is a separately reasoned decision with its own comment at its
 * own call site. Folding them into one parameterised hook would turn three
 * documented choices into three booleans, which is how a deduplication loses
 * behaviour. The Tab wrap is the part with no such choice in it.
 */

/**
 * Focusable controls inside a trapped panel — NATIVELY disabled ones excluded
 * on purpose; `aria-disabled` ones deliberately kept.
 *
 * A natively disabled button can never be `document.activeElement`, so it must
 * be skipped for BOTH the initial focus (landing on it focuses nothing,
 * stranding the user behind the scrim) and the Tab-wrap boundary (a disabled
 * `last` never turns the wrap). The recorder menu's Erase is disabled at
 * idle/no-clip while Edit stays live (it commits then edits a live/paused take,
 * #134), which is exactly when the two panels sharing one selector matters.
 *
 * A row carrying a hint (#135) is `aria-disabled` instead, and so MATCHES this
 * selector by design: it is focusable, announces its reason, and holds its
 * place in the Tab order. Only the open-edge landing filters those out — see
 * the `actionable` list in `menu.tsx`, which is the other half of this rule.
 */
export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside `panel`: wrap from the last focusable to the first, and from
 * the first back to the last under Shift.
 *
 * With a scrim covering everything behind, the wrap is what makes the scrim a
 * real boundary rather than paint. A panel holding nothing focusable is left
 * alone — Tab escapes — which is why both dialogs keep at least one control
 * enabled while busy rather than relying on this.
 *
 * Call it having already established that the key is Tab; it does not check.
 */
export function wrapTab(panel: HTMLElement, e: KeyboardEvent): void {
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
}
