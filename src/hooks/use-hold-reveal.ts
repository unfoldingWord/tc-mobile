import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { createHoldReveal, type HoldReveal } from "@/hooks/hold-reveal";

/** How long the release's click is swallowed after a name was shown. */
const CLICK_GUARD_MS = 600;
/** The bubble's floor from the screen's side edge. */
export const REVEAL_GUTTER_PX = 16;

/** Where the name sat when the hold completed, in viewport px. */
export interface RevealPlace {
  readonly top: number;
  readonly bottom: number;
  /** From the screen's inline-start edge: left, or right in a right-to-left page. */
  readonly start: number;
  readonly rtl: boolean;
  readonly viewHeight: number;
  readonly viewWidth: number;
}

export interface HoldRevealHandle {
  /**
   * The name element's `onPointerDown`. It claims the press only when the
   * name is cut off (`scrollWidth > clientWidth` at touch-down): then the
   * press stops at the name, so the row's reorder hold never starts. A name
   * that fits is left alone and its press reaches the reorder as before.
   */
  readonly holdStart: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Where to draw the whole name while it is shown, else `null`. */
  readonly place: RevealPlace | null;
}

/**
 * Hold a cut-off name to read it whole (S14, #1284). The DOM half of
 * `hold-reveal.ts`: it decides whether a press is claimed, listens for the
 * rest of that press on `window`, swallows the one click a revealed press's
 * release would land (no open, no toggle), and reports where the name sat so
 * `components/name-reveal.tsx` can draw it.
 *
 * A screen reader never needs this: every name it is wired to is already in
 * its control's accessible name, whole.
 *
 * What no test here can see (jsdom has no layout and no touch): whether
 * `scrollWidth > clientWidth` reads the ellipsis the same way on a phone's
 * engine, and whether a browser pan reaches this as `pointercancel` before
 * the hold completes. Those are the device check.
 */
export function useHoldReveal(): HoldRevealHandle {
  const [place, setPlace] = useState<RevealPlace | null>(null);
  const machine = useRef<HoldReveal | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const guardClick = useCallback((target: Element) => {
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && target.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      done();
    };
    const timer = window.setTimeout(() => done(), CLICK_GUARD_MS);
    const done = () => {
      window.clearTimeout(timer);
      window.removeEventListener("click", onClick, true);
    };
    window.addEventListener("click", onClick, true);
  }, []);

  const holdStart = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!e.isPrimary || e.button !== 0) return;
      const el = e.currentTarget;
      // The one rule that keeps this from fighting the reorder hold: only a
      // name that is actually cut off claims the press.
      if (el.scrollWidth <= el.clientWidth) return;
      // Built in the handler, not during render (`react-hooks/refs`).
      const g = (machine.current ??= createHoldReveal({
        show: () => {
          const node = anchor.current;
          if (!node) return;
          const r = node.getBoundingClientRect();
          const rtl = document.documentElement.dir === "rtl";
          const viewWidth = window.innerWidth;
          setPlace({
            top: r.top,
            bottom: r.bottom,
            start: Math.max(
              REVEAL_GUTTER_PX,
              rtl ? viewWidth - r.right : r.left
            ),
            rtl,
            viewHeight: window.innerHeight,
            viewWidth,
          });
        },
        hide: () => setPlace(null),
      }));
      if (g.phase() !== "idle") return;
      // The press is the name's now: the row's (or the book's) reorder hold,
      // on the button around it, never sees it.
      e.stopPropagation();
      anchor.current = el;
      const pointerId = e.pointerId;
      const hold = el.closest("button") ?? el;
      g.press(pointerId, e.clientX, e.clientY);

      const finish = () => {
        detach.current?.();
        detach.current = null;
      };
      const onMove = (ev: PointerEvent) =>
        g.move(ev.pointerId, ev.clientX, ev.clientY);
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const swallow = g.up(pointerId);
        finish();
        if (swallow) guardClick(hold);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        g.cancel();
        finish();
      };
      const onDown = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) g.otherPointer();
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") g.dismiss();
      };
      // A long press on Android raises the context menu; not while this
      // press is the name's.
      const onContextMenu = (ev: Event) => {
        if (g.phase() !== "idle") ev.preventDefault();
      };
      const onScroll = () => g.scrolled();
      const onLeave = () => {
        g.cancel();
        finish();
      };
      const onHidden = () => {
        if (document.visibilityState === "hidden") onLeave();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("keydown", onKey);
      window.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("blur", onLeave);
      document.addEventListener("visibilitychange", onHidden);
      detach.current?.();
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("blur", onLeave);
        document.removeEventListener("visibilitychange", onHidden);
      };
    },
    [guardClick]
  );

  // Leaving the screen with a name up: take it down, let go of the press.
  useEffect(
    () => () => {
      machine.current?.cancel();
      detach.current?.();
      detach.current = null;
    },
    []
  );

  return { holdStart, place };
}
