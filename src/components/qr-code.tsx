import { encodeQr } from "@/lib/qr";

/** Quiet zone, in modules, on every side (ISO/IEC 18004 asks for four). */
const QUIET_ZONE = 4;

/** Drawn pixels per module: a whole number, so edges do not blur. */
const MODULE_PX = 5;

interface QrCodeProps {
  /** The text to encode. A text too long for the encoder throws. */
  text: string;
  /** The accessible name; the caller shows the same words beside it. */
  label: string;
}

/**
 * A QR code drawn as inline SVG: a light ground and one rect per dark module,
 * from the pure encoder (`lib/qr.ts`), with no canvas, no image file and no
 * network call (#1250).
 *
 * The ground and the modules are light and dark in BOTH themes on purpose — a
 * scanner wants dark modules on a light quiet zone, and a dark theme must not
 * invert it. The colours come from the `--s-qr-light` / `--s-qr-dark` roles
 * through the `.qr-light` / `.qr-dark` rules in `3-components.css`.
 *
 * It is an image with a name, not a link: the words a person reads beside it
 * carry the meaning, and the matrix is the one place the address lives.
 */
export function QrCode({ text, label }: QrCodeProps) {
  const { size, modules } = encodeQr(text);
  const full = size + 2 * QUIET_ZONE;
  const dark: { x: number; y: number }[] = [];
  modules.forEach((row, y) =>
    row.forEach((isDark, x) => {
      if (isDark) dark.push({ x: x + QUIET_ZONE, y: y + QUIET_ZONE });
    })
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${full} ${full}`}
      width={full * MODULE_PX}
      height={full * MODULE_PX}
      className="h-auto max-w-full"
    >
      <rect className="qr-light" width={full} height={full} />
      {dark.map(({ x, y }) => (
        <rect
          key={`${x},${y}`}
          className="qr-dark"
          x={x}
          y={y}
          width={1}
          height={1}
        />
      ))}
    </svg>
  );
}
