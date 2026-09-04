import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The Workbox precache manifest is generated at build time from the
// `workbox.globPatterns` in vite.config.ts, so what it contains cannot be
// asserted without a full production build. This pins the one knob that
// decides it.
//
// #177 removed the OBS thumbnails (public/obs/thumbs/*.jpg — 598 files, ~80%
// of the precache bytes) from the precache because no shipped screen reads
// them yet: a first install over a slow link should not fetch 2.6 MB of
// pictures nothing draws, and Workbox's atomic install restarts on any one
// failed fetch. This is a temporary, reader-gated exception (ADR 0006,
// 2026-09-04 amendment), NOT a permanent ban and NOT a switch to
// runtime-caching. When a screen reads `thumbUrl` (the Template Library, #33),
// `jpg` is deliberately RESTORED to the allowlist below — at which point this
// test's INTENDED constant is updated in the same change, on purpose. Until
// then the exact-set assertion fails on any drift: re-adding `jpg`, adding
// `obs/thumbs/*`, or broadening to `**/*` all break it.
const CONFIG = path.resolve(import.meta.dirname, "../vite.config.ts");
const SW = path.resolve(import.meta.dirname, "../dist/sw.js");

// The exact allowlist the app shell needs, and nothing more. `jpg` is absent
// by #177; restoring it is a deliberate edit here plus in vite.config.ts.
const INTENDED = ["**/*.{js,css,html,svg,png,woff2}"];

function globPatterns(): string[] {
  const source = readFileSync(CONFIG, "utf8");
  const match = source.match(/globPatterns:\s*\[([^\]]*)\]/);
  const body = match?.[1];
  if (body === undefined)
    throw new Error("could not find globPatterns in vite.config.ts");
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("workbox precache globPatterns", () => {
  it("matches the intended allowlist exactly", () => {
    // Exact-set, not a token scan: a broader glob (`**/*`) or an added
    // `obs/thumbs/*` must fail here just as re-adding `jpg` does. Changing the
    // precached set is a deliberate act, and updating this constant is how it
    // is recorded.
    expect(globPatterns()).toEqual(INTENDED);
  });

  it("does not precache jpg while no screen reads the thumbnails (#177)", () => {
    // Redundant with the exact-set check, kept for a pointed failure message
    // that names the reason and the gate.
    const jpgPrecached = globPatterns().some((p) => /\bjpe?g\b/i.test(p));
    expect(
      jpgPrecached,
      "globPatterns must exclude jpg until a screen reads thumbUrl (#177/#33); restoring it is a deliberate edit to INTENDED + vite.config.ts"
    ).toBe(false);
  });
});

// Cross-check against the built manifest when a production build is present.
// `npm test` runs before `npm run build` in `verify`, so dist/sw.js may be
// absent in a clean checkout or in CI; this asserts the real artifact whenever
// it exists rather than only the config that produces it.
describe.runIf(existsSync(SW))("built precache manifest (dist/sw.js)", () => {
  const sw = existsSync(SW) ? readFileSync(SW, "utf8") : "";

  it("carries no obs/thumbs entries", () => {
    const thumbs = [...sw.matchAll(/obs\/thumbs\/obs-[\d-]+\.jpg/g)];
    expect(
      thumbs,
      `unexpected thumbnails in precache: ${thumbs.length}`
    ).toHaveLength(0);
  });

  it("carries no jpg entries at all", () => {
    const jpgs = [...sw.matchAll(/[\w/.-]+\.jpe?g/g)].map((m) => m[0]);
    expect(
      jpgs,
      `unexpected jpg in precache: ${jpgs.slice(0, 3).join(", ")}`
    ).toHaveLength(0);
  });
});
