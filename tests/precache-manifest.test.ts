import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The Workbox precache manifest is generated at build time from the
// `workbox.globPatterns` in vite.config.ts, so what it contains cannot be
// asserted without a full production build. This pins the one knob that
// decides it, and couples that knob to whether a screen actually reads the
// thumbnails.
//
// #177 removed the OBS thumbnails (public/obs/thumbs/*.jpg — 598 files, ~80%
// of the precache bytes) from the precache because no shipped screen reads
// them yet: a first install over a slow link should not fetch 2.6 MB of
// pictures nothing draws, and Workbox's atomic install restarts on any one
// failed fetch. This is a temporary, reader-gated exception (ADR 0006,
// 2026-09-04 amendment), NOT a permanent ban and NOT a switch to
// runtime-caching. When a screen reads OBS frame imagery — via `thumbUrl` or
// a hand-built /obs/thumbs/ path (the Template Library, #33, is the expected
// case) — `jpg` must be RESTORED to `globPatterns` (and INTENDED below
// updated in the same change, on purpose) — otherwise the tiles are
// precached nowhere, there is no runtimeCaching, and a field install strands
// on broken images. The reader-gated test below fails exactly that omission.
// #219 widened what counts as "reads" beyond the `thumbUrl` identifier — see
// `OBS_IMAGERY_PATTERNS` below. (A `frame.image` CDN read is deliberately
// NOT one of the matched patterns — see the comment there, #232 round-1
// review, finding C1.)
const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(ROOT, "vite.config.ts");
const SRC = path.join(ROOT, "src");
// The definition site of `thumbUrl`; excluded so defining it is not read as a
// reader of it.
const CATALOG = path.join(SRC, "lib", "obs", "catalog.ts");

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

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// A shipped module "reads" OBS frame imagery — the thing the precache
// decision actually turns on — two ways, neither of which requires going
// through the `thumbUrl` symbol (#219):
//
// 1. Imports or calls `thumbUrl`. A bare doc-comment mention (e.g.
//    src/types/obs.ts) is not a reader, so this matches an import of the
//    symbol or a call `thumbUrl(` — not the identifier alone.
// 2. Hand-builds the `/obs/thumbs/…` path itself instead of calling
//    `thumbUrl` — the same bundled file, reached without the symbol the old
//    check tracked.
//
// Deliberately NOT matched:
//
// - `frame.image` (matched, then dropped again — #232 round-1 review,
//   finding C1). `ObsFrame.image` (src/types/obs.ts) is an *absolute*
//   `cdn.door43.org` URL, a different URL space from the same-origin
//   `/obs/thumbs/…` this guard actually controls. Workbox never intercepts a
//   cross-origin CDN request, so restoring `jpg` to `globPatterns` would not
//   serve a `frame.image` reader at all — it would just add ~2.5 MB / 598
//   dead precache entries. A screen that reads `frame.image` needs a
//   different remedy (use `thumbUrl` instead of the CDN URL), not this gate.
//   The comment that previously justified matching it cited the pre-pivot
//   recording view as precedent for that CDN path being real; that view is
//   gone (removed in B2–B4, see README.md), so the precedent no longer
//   exists in the tree.
// - The door43.org CDN host as a bare string (dropped in an earlier QA
//   round, `4c3ef0f`). That pattern is too wide — it fires on any comment,
//   doc link, or unrelated fetch that happens to name the host, and a false
//   positive here fails CI with "jpg must be restored" until 2.5 MB of
//   thumbnails are added back.
const OBS_IMAGERY_PATTERNS = [
  /import[^;]*\bthumbUrl\b/,
  /\bthumbUrl\s*\(/,
  /\/obs\/thumbs\//,
];

function obsThumbnailReaders(): string[] {
  return tsFiles(SRC)
    .filter((file) => file !== CATALOG)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return OBS_IMAGERY_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map((file) => path.relative(ROOT, file));
}

describe("workbox precache globPatterns", () => {
  it("matches the intended allowlist exactly", () => {
    // Exact-set, not a token scan: a broader glob (`**/*`) or an added
    // `obs/thumbs/*` must fail here just as re-adding `jpg` does. Changing the
    // precached set is a deliberate act, and updating INTENDED is how it is
    // recorded.
    expect(globPatterns()).toEqual(INTENDED);
  });
});

describe("OBS thumbnail precache is reader-gated (#177 / ADR 0006)", () => {
  const readers = obsThumbnailReaders();
  const jpgPrecached = globPatterns().some((p) => /\bjpe?g\b/i.test(p));

  if (readers.length === 0) {
    it("keeps jpg out of the precache while no screen reads OBS frame imagery", () => {
      // Today: no src module reads a thumbnail (via `thumbUrl` or a
      // hand-built /obs/thumbs/ path), so the thumbnails must not be
      // precached (#177). Restoring jpg here without a reader would be dead
      // precache weight.
      expect(
        jpgPrecached,
        "no src module reads OBS frame imagery, so jpg must stay out of globPatterns (#177)"
      ).toBe(false);
    });
  } else {
    it("restores jpg to the precache once a screen reads OBS frame imagery", () => {
      // A reader landed (e.g. B7 Template Library, #33) — whether through
      // `thumbUrl` or a hand-built /obs/thumbs/ path. The thumbnails now
      // render on screen, so they must be precached again — otherwise a
      // field install strands on broken tiles, the exact case ADR 0006
      // rejected runtime-caching to avoid.
      expect(
        jpgPrecached,
        `these modules read OBS frame imagery, so jpg must be restored to globPatterns (and INTENDED) or field installs strand on broken tiles (ADR 0006): ${readers.join(", ")}`
      ).toBe(true);
    });
  }
});
