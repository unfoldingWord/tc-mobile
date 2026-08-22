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
  | "share"
  | "prev"
  | "next"
  | "speaker"
  | "trash"
  | "alert"
  | "retry";

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
  share: (
    <>
      <path
        d="M11 15V5m0 0L7.5 8.5M11 5l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 13v3h11v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
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
  speaker: (
    <>
      <path d="M4 8.5h3L11 5v12L7 13.5H4z" fill="currentColor" />
      <path
        d="M14 8c1.2 1.1 1.2 4.9 0 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
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
