/**
 * The drawn icon set.
 *
 * Platform emoji are banned in UI chrome: they render differently on every
 * device, clash with the palette, and make a screen read as a template. These
 * are plain paths on a 22-unit grid, inheriting `currentColor` so a control's
 * state colours its glyph for free.
 */

export type IconName =
  | "back"
  | "play"
  | "pause"
  | "record"
  | "stop"
  | "plus"
  | "prev"
  | "next"
  | "trash"
  | "alert"
  | "retry"
  | "menu"
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "zoom-in"
  | "zoom-out"
  | "selection"
  | "scissors"
  | "paste"
  | "undo"
  | "redo"
  | "eye"
  | "eye-off";

const PATHS: Record<IconName, React.ReactNode> = {
  back: (
    <path
      d="M14 5 8 11l6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  play: <path d="M8 5.5 16 11l-8 5.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="7" y="6" width="3" height="10" rx="1.2" fill="currentColor" />
      <rect x="12" y="6" width="3" height="10" rx="1.2" fill="currentColor" />
    </>
  ),
  record: <circle cx="11" cy="11" r="6" fill="currentColor" />,
  stop: (
    <rect x="6.5" y="6.5" width="9" height="9" rx="2" fill="currentColor" />
  ),
  plus: (
    <path
      d="M11 5v12M5 11h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  prev: (
    <path
      d="M13 5 7 11l6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  next: (
    <path
      d="M9 5l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  trash: (
    <>
      <path
        d="M5 7h12M9 7V5.5h4V7M7 7l.8 9.5h6.4L15 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  alert: (
    <>
      <path
        d="M11 3.6 19.4 18.4H2.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M11 8.8v3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="11" cy="15.4" r="1.05" fill="currentColor" />
    </>
  ),
  retry: (
    <>
      <path
        d="M17 11a6 6 0 1 1-1.9-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16.6 3.2v3.9h-3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  // Three rules — the global menu (hamburger). B2's menu shell opens from it.
  menu: (
    <path
      d="M4 7h14M4 11h14M4 15h14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  // The finished tick, drawn inside the checkbox when a segment is affirmed.
  check: (
    <path
      d="M5 11.5 9.2 15.5 17 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Book disclosure: down = expanded, right = collapsed. Kept as two glyphs
  // rather than one rotated so the affordance reads without a transform.
  "chevron-down": (
    <path
      d="M5 8l6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "chevron-right": (
    <path
      d="M8 5l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Zoom toggle, two glyphs for two states (recorder §4.4). Arrows spread
  // apart = the whole segment fits the viewport (100%); arrows drawn toward
  // the centre = a quarter of it fills the viewport (25%), the finer view.
  "zoom-out": (
    <path
      d="M10 11H4m0 0 3-3M4 11l3 3M12 11h6m0 0-3-3m3 3-3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  "zoom-in": (
    <path
      d="M4 11h6m0 0-3-3m3 3-3 3M18 11h-6m0 0 3-3m-3 3 3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Selection-frame toggle: the two brackets that frame the picked span (mockup
  // 4). Drawn as a facing pair so the button reads as "enclose a region".
  selection: (
    <path
      d="M9 5.5H6v11h3M13 5.5h3v11h-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Cut: two finger loops and crossing blades. Appears below the waveform once a
  // selection exists (mockup 4).
  scissors: (
    <>
      <circle
        cx="6.5"
        cy="7.4"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="6.5"
        cy="14.6"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8.3 8.6 17 15M8.3 13.4 17 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  // Paste: audio dropping onto the centerline (mockup 5). A down arrow over the
  // line it inserts at.
  paste: (
    <path
      d="M11 4v8m-3.5-3.5L11 12l3.5-3.5M6 16h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Undo: an arrow curving back to the left (↶), toolbar control.
  undo: (
    <path
      d="M8.5 6.5 5 10l3.5 3.5M5 10h6.5a4.5 4.5 0 0 1 0 9H9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Redo: undo mirrored (↝), lives in the recorder menu.
  redo: (
    <path
      d="M13.5 6.5 17 10l-3.5 3.5M17 10h-6.5a4.5 4.5 0 0 0 0 9H13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // VU-meter "show": an open eye (an almond with a pupil). The menu toggle pairs
  // it with `eye-off` to read as visible/hidden.
  eye: (
    <>
      <path
        d="M2.5 11S6 5.5 11 5.5 19.5 11 19.5 11 16 16.5 11 16.5 2.5 11 2.5 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="11"
        cy="11"
        r="2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </>
  ),
  // VU-meter "hide": the same eye, struck through — the level strip is off.
  "eye-off": (
    <>
      <path
        d="M2.5 11S6 5.5 11 5.5 19.5 11 19.5 11 16 16.5 11 16.5 2.5 11 2.5 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M4.5 4.5 17.5 17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 22, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
