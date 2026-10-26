import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { REVEAL_GUTTER_PX, type RevealPlace } from "@/hooks/use-hold-reveal";

/** The bubble's distance from the name it shows. */
const GAP_PX = 8;

/**
 * A held, cut-off name shown whole (S14, #1284): above where it was cut,
 * wrapping to as many lines as it needs. `hooks/use-hold-reveal.ts` decides
 * when, and where the name sat; this only draws it.
 *
 * Portalled to `<body>` so no list's overflow clips it, `position: fixed`
 * from the name's own rectangle, and moved below the name when there is no
 * room above. `aria-hidden`: it is a picture of text the control's own
 * accessible name already carries whole, so a screen reader never needs it.
 * `dir="auto"`, like the name itself, so a right-to-left name reads right.
 */
export function NameReveal({
  text,
  place,
}: {
  text: string;
  place: RevealPlace | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !place) return;
    if (el.getBoundingClientRect().top >= REVEAL_GUTTER_PX) return;
    el.style.bottom = "auto";
    el.style.top = `${place.bottom + GAP_PX}px`;
  }, [place]);
  if (!place) return null;
  const style: CSSProperties = {
    bottom: `${place.viewHeight - place.top + GAP_PX}px`,
    maxWidth: `${Math.max(0, place.viewWidth - place.start - REVEAL_GUTTER_PX)}px`,
    [place.rtl ? "right" : "left"]: `${place.start}px`,
  };
  return createPortal(
    <div
      ref={ref}
      className="name-reveal"
      aria-hidden="true"
      dir="auto"
      style={style}
    >
      {text}
    </div>,
    document.body
  );
}
