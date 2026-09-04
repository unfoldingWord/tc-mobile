import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The Workbox precache manifest is generated at build time from the
// `globPatterns` in vite.config.ts, so the manifest's contents cannot be
// asserted without a full production build. This guards the one knob that
// decides them: #177 removed the OBS thumbnails (public/obs/thumbs/*.jpg —
// 598 files, ~80% of the bytes) from the precache because no shipped screen
// reads them, and a first install over a slow link should not fetch 2.6 MB of
// pictures nothing draws. If `jpg` is re-added to globPatterns the thumbnails
// silently return to the precache; this test fails first.

const CONFIG = path.resolve(import.meta.dirname, "../vite.config.ts");

function globPatterns(): string[] {
  const source = readFileSync(CONFIG, "utf8");
  const match = source.match(/globPatterns:\s*\[([^\]]*)\]/);
  const body = match?.[1];
  if (body === undefined)
    throw new Error("could not find globPatterns in vite.config.ts");
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("workbox precache globPatterns", () => {
  it("does not precache jpg, so the OBS thumbnails stay out of the manifest", () => {
    const patterns = globPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    const jpgPrecached = patterns.some((p) => /\bjpe?g\b/i.test(p));
    expect(
      jpgPrecached,
      `globPatterns must exclude jpg until a screen reads the thumbnails (#177): ${JSON.stringify(patterns)}`
    ).toBe(false);
  });

  it("still precaches the app shell extensions", () => {
    const patterns = globPatterns();
    // The shell must be fully precached for offline-first to hold; only the
    // unread thumbnails are excluded.
    for (const ext of ["js", "css", "html"]) {
      const covered = patterns.some((p) => new RegExp(`\\b${ext}\\b`).test(p));
      expect(covered, `globPatterns must still cover ${ext}`).toBe(true);
    }
  });
});
