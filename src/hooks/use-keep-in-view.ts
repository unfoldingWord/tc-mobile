import { useEffect, useRef, type RefObject } from "react";

/**
 * Keep one child of a scrolling box in view (#947, DRI pick (a) on #1023,
 * "Bounded, scrolls"): the O4 share overlay caps its chip row at about three
 * rows and scrolls inside it, and this moves the row so the current chip is
 * visible whenever the current index changes. Returns the ref to put on the
 * box.
 *
 * It sets the BOX's own `scrollTop`, and only when the child is not already
 * fully visible, by the least distance that shows it — the "nearest" rule. It
 * never calls `scrollIntoView`, which would also scroll every scrolling
 * ancestor, the page included. Layout is read once per index change, not on
 * every render.
 *
 * Motion is the stylesheet's, not this hook's: assigning `scrollTop` follows
 * the box's computed `scroll-behavior`, which `o4/share.css` sets to `smooth`
 * only under `prefers-reduced-motion: no-preference`. Under reduced motion
 * the jump is instant.
 *
 * The box must be the children's offset parent (`position: relative`), so a
 * child's `offsetTop` is measured from the box. `index < 0` means there is
 * nothing to keep in view, and the box is left where it is.
 */
export function useKeepInView<T extends HTMLElement>(
  index: number
): RefObject<T | null> {
  const box = useRef<T | null>(null);
  useEffect(() => {
    const el = box.current;
    if (el === null || index < 0) return;
    // A cast, not `instanceof HTMLElement`: the chip row holds only spans,
    // and a test that stubs `window` without the element globals would throw
    // on the bare `HTMLElement` reference.
    const child = el.children[index] as HTMLElement | undefined;
    if (child === undefined) return;
    const top = child.offsetTop;
    const bottom = top + child.offsetHeight;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (top < viewTop) el.scrollTop = top;
    else if (bottom > viewBottom) el.scrollTop = bottom - el.clientHeight;
  }, [index]);
  return box;
}
