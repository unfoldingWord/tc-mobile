import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  createHoldReveal,
  isCutOff,
  type HoldReveal,
} from "@/lib/view/hold-reveal";

/** A name being shown whole, and the box it was cut off in (viewport px). */
export interface RevealedName {
  readonly text: string;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** How long a released hold's own click is kept from landing. */
const CLICK_GUARD_MS = 600;

export interface HoldRevealHandle {
  /** The name on show, or `null`. */
  readonly revealed: RevealedName | null;
  /**
   * Spread onto the element that draws the name (one line, `overflow:
   * hidden`, ellipsis). `data-hold-reveal` is the stylesheet's hook to keep a
   * long press from selecting text or raising the phone's callout.
   */
  readonly nameProps: {
    readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => boolean;
    readonly "data-hold-reveal": "";
  };
}

/**
 * The DOM half of touch-and-hold to read a cut-off name (#1284, S14).
 * `lib/view/hold-reveal.ts` decides the timing; this hook measures the name,
 * listens for the finger and keeps the hold from reaching anything else.
 *
 * It claims a press ONLY when the name is actually cut off at the moment the
 * finger lands (`scrollWidth > clientWidth`). A name that fits has nothing to
 * reveal, so its press bubbles to the row untouched and the row's own hold
 * (reorder, #953) behaves exactly as before. A claimed press stops there: it
 * does not reach the row's `onPointerDown`, so no reorder lift starts, and
 * the click the release would land on the row's open button is swallowed
 * once. The name is shown while the finger stays, and put away on release, on
 * a second touch, on Escape, on a scroll or cancel, when the page is hidden,
 * and after a cap.
 *
 * The name is already the control's accessible name on every row that uses
 * this, so nothing here is announced.
 *
 * Browser behaviour no Node test can observe (no layout, no touch): that the
 * press is claimed only for a cut-off name, and the release click guard.
 * `e2e/hold-reveal-name.spec.ts` runs both in Chromium.
 */
export function useHoldReveal(): HoldRevealHandle {
  const [revealed, setRevealed] = useState<RevealedName | null>(null);
  const active = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => active.current?.stop(), []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>): boolean => {
      // A mouse's right or middle button is not a hold.
      if (e.pointerType === "mouse" && e.button !== 0) return false;
      if (active.current) return false;
      const el = e.currentTarget;
      if (!isCutOff(el.scrollWidth, el.clientWidth)) return false;

      e.stopPropagation();
      const text = el.textContent ?? "";
      const pointerId = e.pointerId;
      const guardTarget = el.closest("button") ?? el;
      let didReveal = false;

      const hold: HoldReveal = createHoldReveal({
        reveal: () => {
          didReveal = true;
          const box = el.getBoundingClientRect();
          setRevealed({
            text,
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          });
        },
        dismiss: () => setRevealed(null),
      });

      const onMove = (m: PointerEvent) => {
        if (m.pointerId === pointerId) hold.move(m.clientX, m.clientY);
      };
      const onUp = (u: PointerEvent) => {
        if (u.pointerId !== pointerId) return;
        hold.release();
        stop();
        if (didReveal) guardClick();
      };
      // A second finger, a cancel, Escape, the page going away: all end it.
      const onOtherDown = (d: PointerEvent) => {
        if (d.pointerId !== pointerId) {
          hold.cancel();
          stop();
        }
      };
      const onCancel = () => {
        hold.cancel();
        stop();
      };
      const onKey = (k: KeyboardEvent) => {
        if (k.key === "Escape") onCancel();
      };
      const onHidden = () => {
        if (document.visibilityState === "hidden") onCancel();
      };
      // A long press raises the context menu on Android; refuse it for this
      // press, as the reorder gesture does.
      const onContext = (c: Event) => c.preventDefault();

      const guardClick = () => {
        const onClick = (c: MouseEvent) => {
          if (c.target instanceof Node && guardTarget.contains(c.target)) {
            c.preventDefault();
            c.stopPropagation();
          }
          doneGuard();
        };
        const timer = window.setTimeout(() => doneGuard(), CLICK_GUARD_MS);
        const doneGuard = () => {
          window.clearTimeout(timer);
          window.removeEventListener("click", onClick, true);
        };
        window.addEventListener("click", onClick, true);
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("pointerdown", onOtherDown);
        window.removeEventListener("contextmenu", onContext);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        document.removeEventListener("visibilitychange", onHidden);
        if (active.current === handle) active.current = null;
      };
      const handle = {
        stop: () => {
          hold.cancel();
          stop();
        },
      };
      active.current = handle;

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("pointerdown", onOtherDown);
      window.addEventListener("contextmenu", onContext);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      document.addEventListener("visibilitychange", onHidden);
      hold.press(e.clientX, e.clientY);
      return true;
    },
    []
  );

  return {
    revealed,
    nameProps: { onPointerDown, "data-hold-reveal": "" },
  };
}
