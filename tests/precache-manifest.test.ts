import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

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

// generateSW emits the manifest in one of TWO shapes, and which one depends on
// the ambient `NODE_ENV` rather than on anything in this repo:
//
//   NODE_ENV unset or "production"  ->  {url:"registerSW.js",revision:"..."}
//   NODE_ENV="development"          ->  { "url": "registerSW.js", ... }
//
// A parser that matches only the first is BLIND, not red, on the second: it
// returns `[]`, every `filter` over it finds no offender, and the assertion
// passes vacuously. The `toBeGreaterThan(0)` floor below is the only reason
// that surfaces as a failure at all — and it surfaces as a confusing one,
// since the manifest is fine and the reader is broken.
//
// The build-artifact caller (`npm run test:dist`) reads whichever shape the
// preceding build emitted. Support both development and production output;
// `NODE_ENV` must not change whether this parser can inspect the manifest.
//
// Matching both shapes is what makes this a reader of the manifest rather than
// a reader of the minifier.
const PRECACHE_URL = /"?url"?\s*:\s*"([^"]+)"/g;

/** The manifest's urls, parsed out of an emitted `sw.js` source. Split from
 *  the file read so both emitted shapes can be pinned without two builds. */
function parsePrecachedUrls(source: string): string[] {
  const match = source.match(/precacheAndRoute\(\[(.*?)\],/s);
  const body = match?.[1];
  if (body === undefined)
    throw new Error("could not find precacheAndRoute([...]) in dist/sw.js");
  return [...body.matchAll(PRECACHE_URL)].map((m) => m[1] ?? "");
}

function precachedUrls(): string[] {
  return parsePrecachedUrls(readFileSync(SW, "utf8"));
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
//   1. It needs a build, so it runs only where one is guaranteed to precede
//      it — `npm run test:dist`, which `npm run verify` invokes after `npm
//      run build` and which ci.yml's build-artifact step calls after its own.
//      Everywhere else it skips, and it skips whether or not a `dist/`
//      happens to be lying around. See `./dist-gate` for why the artifact's
//      presence decides nothing (#568).
//   2. What it reads is the last build's output. A green result is a
//      statement about that build, not an unconditional proof about source
//      that was never rebuilt.
//
// The always-on half of the invariant is the exact-allowlist assertion above:
// `json` cannot enter globPatterns without failing that, unskippably and with
// no build required.
// The manifest READER, pinned against both shapes generateSW emits, with no
// build required — so this runs in CI's Quality job and on a fresh clone,
// unlike the build-dependent block below. #522.
//
// Both directions are pinned on purpose (AGENTS.md, "a gate is tested in both
// states"): each shape must PARSE (green on a legitimate build) and each shape
// must SURFACE a version.json entry (red on the state the gate exists to
// catch). Pinning only the first would let the parser regress to matching
// nothing and still look green here.
describe("the precache manifest reader (#522)", () => {
  // Trimmed from real `dist/sw.js` output, one per NODE_ENV.
  const MINIFIED =
    'precacheAndRoute([{url:"registerSW.js",revision:"abc"},{url:"index.html",revision:"def"}],{});';
  const DEVELOPMENT = `precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "abc"
  }, {
    "url": "index.html",
    "revision": "def"
  }], {});`;

  it("parses the minified shape (NODE_ENV unset or production — what CI builds)", () => {
    expect(parsePrecachedUrls(MINIFIED)).toEqual([
      "registerSW.js",
      "index.html",
    ]);
  });

  it("parses the development shape (NODE_ENV=development — what uw-sandbox builds)", () => {
    expect(parsePrecachedUrls(DEVELOPMENT)).toEqual([
      "registerSW.js",
      "index.html",
    ]);
  });

  it("surfaces a version.json entry in the minified shape", () => {
    const offending = MINIFIED.replace("index.html", "version.json");
    expect(parsePrecachedUrls(offending)).toContain("version.json");
  });

  it("surfaces a version.json entry in the development shape", () => {
    const offending = DEVELOPMENT.replace("index.html", "version.json");
    expect(parsePrecachedUrls(offending)).toContain("version.json");
  });

  it("throws rather than returning [] when there is no manifest at all", () => {
    // A silent [] here is the failure mode this whole block exists to stop:
    // it would satisfy every `filter`-based assertion vacuously.
    expect(() => parsePrecachedUrls("// no service worker here")).toThrow(
      /precacheAndRoute/
    );
  });
});

// Which of these two build-artifact suites runs is decided by the caller,
// never by whether a `dist/` happens to be lying around from an earlier
// command — see `./dist-gate` (#568).
const GATE = resolveDistGate(existsSync(SW), "dist/sw.js");

describe.skipIf(GATE === "skip")(
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

// The skip above is a convenience for anyone running the suite without a
// build: a missing `dist/sw.js` skips rather than fails, so a plain `npm
// test` exits 0 with nothing built. A skip is also indistinguishable from a
// pass, so the gate makes the other half loud — `npm run test:dist` promises
// a build, and the shared resolver turns that promise into a module-scope
// throw rather than a case in this file that could be deleted.
// `REQUIRE_DIST_BUILD` is a purpose-built flag rather than the ambient `CI`
// variable, which is true wherever tests run, including the passes that
// legitimately have no build yet. See `./dist-gate` for why the loud half
// does not live here.

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
