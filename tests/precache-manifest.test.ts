import { existsSync, readFileSync, readdirSync } from "node:fs";
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
// runtime-caching. When a screen reads `thumbUrl` (the Template Library, #33),
// `jpg` must be RESTORED to `globPatterns` (and INTENDED below updated in the
// same change, on purpose) — otherwise the tiles are precached nowhere, there
// is no runtimeCaching, and a field install strands on broken images. The
// reader-gated test below fails exactly that omission.
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

// The `navigateFallbackDenylist` entry, lifted out of vite.config.ts as a live
// RegExp rather than retyped here — a copy would pass while the config's own
// pattern regressed, which is exactly the class of bug this pins.
function navigateFallbackDenylist(): RegExp {
  const source = readFileSync(CONFIG, "utf8");
  const match = source.match(
    /navigateFallbackDenylist:\s*\[\s*\/(.*?)\/[gimsuy]*\s*\]/
  );
  const body = match?.[1];
  if (body === undefined)
    throw new Error(
      "could not find a single-entry navigateFallbackDenylist in vite.config.ts"
    );
  return new RegExp(body);
}

// The emitted service worker's precache manifest, when a build exists.
// generateSW inlines it as `precacheAndRoute([{url:"...",revision:...},...])`.
const SW = path.join(ROOT, "dist", "sw.js");

function precachedUrls(): string[] {
  const source = readFileSync(SW, "utf8");
  const match = source.match(/precacheAndRoute\(\[(.*?)\],/s);
  const body = match?.[1];
  if (body === undefined)
    throw new Error("could not find precacheAndRoute([...]) in dist/sw.js");
  return [...body.matchAll(/url:"([^"]+)"/g)].map((m) => m[1] ?? "");
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

// A shipped module "reads" a thumbnail when it imports or calls `thumbUrl`.
// A bare doc-comment mention (e.g. src/types/obs.ts) is not a reader, so match
// an import of the symbol or a call `thumbUrl(` — not the identifier alone.
function thumbUrlReaders(): string[] {
  return tsFiles(SRC)
    .filter((file) => file !== CATALOG)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /import[^;]*\bthumbUrl\b/.test(source) || /\bthumbUrl\s*\(/.test(source)
      );
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

describe("navigateFallbackDenylist keeps /version.json off the SPA shell", () => {
  // round-5 George G-F2: round 3 added the denylist entry but anchored it
  // `/^\/version\.json$/`. Workbox tests `navigateFallbackDenylist` against
  // the request URL's `pathname + search`, so the `$` meant the entry did NOT
  // match `/version.json?t=<timestamp>` — precisely the cache-busting URL form
  // `scripts/check-deploy.mjs` builds — and a browser navigation to that URL
  // on an installed PWA was still served the cached index.html shell. The
  // round-3 comment in vite.config.ts claimed otherwise.
  const denylist = navigateFallbackDenylist();

  it("matches the bare path", () => {
    expect(denylist.test("/version.json")).toBe(true);
  });

  it("matches the cache-busting query form check-deploy.mjs actually fetches", () => {
    expect(denylist.test("/version.json?t=1757520000000")).toBe(true);
  });

  it("does not match a different file that merely starts the same way", () => {
    expect(denylist.test("/version.jsonfoo")).toBe(false);
    expect(denylist.test("/version.json.bak")).toBe(false);
  });

  it("does not match an unrelated route", () => {
    expect(denylist.test("/other.json")).toBe(false);
    expect(denylist.test("/books/1")).toBe(false);
  });
});

// round-5 George G-F3: "version.json is never precached" was protected only
// indirectly, by `.json` sitting outside globPatterns — nothing read the
// manifest workbox actually emitted. This does, and it catches the routes the
// glob check cannot see (an `additionalManifestEntries`, a workbox option or
// plugin change that injects an entry directly).
//
// TWO limitations, stated rather than glossed, because a reader must not take
// a green run here for more than it is:
//
//   1. It needs a build. `npm run verify` runs the suite BEFORE `npm run
//      build`, and CI builds in a separate job that runs no tests — so on a
//      tree that has never been built there is nothing to read and this is
//      skipped rather than failing a fresh clone or CI's quality job.
//   2. What it reads is the LAST build's output, which within a single
//      `verify` is the build from before the current source change. A green
//      result is therefore a statement about that build, not a proof about
//      uncommitted source. Two consecutive verifies converge.
//
// The always-on half of the invariant is the exact-allowlist assertion above:
// `json` cannot enter globPatterns without failing that, unskippably and with
// no build required.
describe.skipIf(!existsSync(SW))(
  "the emitted precache manifest (dist/sw.js, requires a prior `npm run build`)",
  () => {
    it("never contains version.json", () => {
      const urls = precachedUrls();
      // Non-empty, or an empty parse would vacuously satisfy the assertion.
      expect(urls.length).toBeGreaterThan(0);
      const offenders = urls.filter(
        (url) => url === "version.json" || url.endsWith("/version.json")
      );
      expect(
        offenders,
        "version.json must never be precached: a post-promotion check fetching it has to reach the origin, not a service-worker cache (AGENTS.md, 'Confirming a deploy and rolling one back')"
      ).toEqual([]);
    });
  }
);

describe("OBS thumbnail precache is reader-gated (#177 / ADR 0006)", () => {
  const readers = thumbUrlReaders();
  const jpgPrecached = globPatterns().some((p) => /\bjpe?g\b/i.test(p));

  if (readers.length === 0) {
    it("keeps jpg out of the precache while no screen reads thumbUrl", () => {
      // Today: no src module reads thumbUrl, so the thumbnails must not be
      // precached (#177). Restoring jpg here without a reader would be dead
      // precache weight.
      expect(
        jpgPrecached,
        "no src module reads thumbUrl, so jpg must stay out of globPatterns (#177)"
      ).toBe(false);
    });
  } else {
    it("restores jpg to the precache once a screen reads thumbUrl", () => {
      // A reader landed (e.g. B7 Template Library, #33). The thumbnails now
      // render on screen, so they must be precached again — otherwise a field
      // install strands on broken tiles, the exact case ADR 0006 rejected
      // runtime-caching to avoid.
      expect(
        jpgPrecached,
        `these modules read thumbUrl, so jpg must be restored to globPatterns (and INTENDED) or field installs strand on broken tiles (ADR 0006): ${readers.join(", ")}`
      ).toBe(true);
    });
  }
});
