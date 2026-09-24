import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANVAS_FALLBACK_FAINT,
  CANVAS_FALLBACK_LIVE,
  CANVAS_FALLBACK_VOICE,
  withCanvasFallback,
} from "@/components/canvas-fallback-colors";

/**
 * #506 item 1 — the canvas fallback hexes `waveform.tsx` and `live-scope.tsx`
 * paint when a themed token read comes back empty.
 *
 * What this pins: (1) `withCanvasFallback`'s own empty/non-empty behaviour —
 * a pure function, so this is a real unit test, not a stand-in for a canvas
 * render; and (2) that both components route their fallback reads through
 * this module's helper and constants rather than each carrying its own
 * literal hex, by reading the two source files as text. The #197 render
 * harness cannot run a `useLayoutEffect` canvas draw (no effects execute), so
 * this does not claim the fallback ever actually paints — that stays a named
 * residual (see the module's own docblock, and #506 item 2 for the on-device
 * question this does not answer).
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const COMPONENTS = path.join(ROOT, "src", "components");

const waveformSource = readFileSync(
  path.join(COMPONENTS, "waveform.tsx"),
  "utf8"
);
const liveScopeSource = readFileSync(
  path.join(COMPONENTS, "live-scope.tsx"),
  "utf8"
);

describe("withCanvasFallback", () => {
  it("returns the trimmed read when it is non-empty", () => {
    expect(withCanvasFallback("#123456", "#000000")).toBe("#123456");
    expect(withCanvasFallback("  #123456  ", "#000000")).toBe("#123456");
  });

  it("returns the fallback only when the read is empty or whitespace-only", () => {
    expect(withCanvasFallback("", "#000000")).toBe("#000000");
    expect(withCanvasFallback("   ", "#000000")).toBe("#000000");
  });
});

describe("waveform.tsx and live-scope.tsx share the fallback module", () => {
  it("both import withCanvasFallback from ./canvas-fallback-colors", () => {
    expect(waveformSource).toMatch(/from ["']\.\/canvas-fallback-colors["']/);
    expect(waveformSource).toContain("withCanvasFallback(");
    expect(liveScopeSource).toMatch(/from ["']\.\/canvas-fallback-colors["']/);
    expect(liveScopeSource).toContain("withCanvasFallback(");
  });

  it("carry no hardcoded copy of the fallback hexes of their own", () => {
    // The one guard that actually catches drift: if either component ever
    // grows its own literal fallback hex again (instead of importing the
    // shared constant), this fails even though the import checks above still
    // pass.
    for (const hex of [
      CANVAS_FALLBACK_VOICE,
      CANVAS_FALLBACK_FAINT,
      CANVAS_FALLBACK_LIVE,
    ]) {
      expect(waveformSource).not.toContain(`"${hex}"`);
      expect(liveScopeSource).not.toContain(`"${hex}"`);
    }
  });

  it("waveform.tsx uses the voice and faint constants; live-scope.tsx uses voice and live", () => {
    expect(waveformSource).toContain("CANVAS_FALLBACK_VOICE");
    expect(waveformSource).toContain("CANVAS_FALLBACK_FAINT");
    expect(liveScopeSource).toContain("CANVAS_FALLBACK_VOICE");
    expect(liveScopeSource).toContain("CANVAS_FALLBACK_LIVE");
  });
});
