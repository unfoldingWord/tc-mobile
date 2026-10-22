import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { RevealedName } from "@/hooks/use-hold-reveal";
import { placeReveal } from "@/lib/view/hold-reveal";

/**
 * A cut-off name, shown whole while a finger holds it (#1284, S14).
 *
 * It says nothing but the name: no label, no hint, no close control. It is
 * `aria-hidden` because the control the name belongs to already carries the
 * whole name as its accessible name, so a screen reader never needs the
 * gesture; and `pointer-events: none` (`o4/controls.css`), so it can never
 * take the press it was raised by.
 *
 * Drawn in a portal on `<body>`, in the viewport's coordinates: the lists the
 * rows sit in clip their overflow, and a lifted row is transformed, either of
 * which would cut or misplace a bubble drawn inside them. Its rendered height
 * is measured before paint and `placeReveal` puts it above the name (the
 * finger is on the name) when it fits there, below when it does not, and
 * inside the screen either way.
 */
export function NameReveal({ reveal }: { reveal: RevealedName | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !reveal) return;
    const top = placeReveal(
      reveal.top,
      reveal.height,
      el.getBoundingClientRect().height,
      window.innerHeight
    );
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [reveal]);
  if (!reveal) return null;
  return createPortal(
    <div
      ref={ref}
      className="name-reveal"
      aria-hidden="true"
      dir="auto"
      style={{ top: 0, visibility: "hidden" }}
    >
      {reveal.text}
    </div>,
    document.body
  );
}
