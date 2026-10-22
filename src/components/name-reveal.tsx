import { createPortal } from "react-dom";

import type { RevealedName } from "@/hooks/use-hold-reveal";

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
 * which would cut or misplace a bubble drawn inside them. It sits above the
 * name (the finger is on the name), or below it when the name is near the top
 * of the screen.
 */
export function NameReveal({ reveal }: { reveal: RevealedName | null }) {
  if (!reveal) return null;
  const above = reveal.top > 96;
  return createPortal(
    <div
      className="name-reveal"
      aria-hidden="true"
      dir="auto"
      style={
        above
          ? { top: reveal.top, transform: "translateY(calc(-100% - 8px))" }
          : { top: reveal.top + reveal.height + 8 }
      }
    >
      {reveal.text}
    </div>,
    document.body
  );
}
