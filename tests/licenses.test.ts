import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { licenseTexts, thirdPartyLicenses } from "@/components/licenses";

/**
 * The LGPL and MIT/ISC obligations (#36) are met only if the disclosure is
 * *complete* and *accurate* and the licence text it points to actually ships.
 * These guard all three against drift:
 *
 * - every bundled runtime dependency is disclosed (a new `dependencies` entry
 *   with no notice fails here — Frank F1, round 1),
 * - every disclosed version matches the installed package (George G6), and
 * - every shipped licence text exists and is non-empty, and each dependency's
 *   own copyright travels in its section of the notices file (Frank F1, r2).
 *
 * A final block pins the *reachability* wiring the disk checks miss — the
 * precache glob, the navigate-fallback denylist, the panel mount, and the lamejs
 * row's relink affordances — since a complete disclosure that no one can reach
 * on the phone does not meet #36.
 *
 * Plain Node: `licenses.ts` is pure data with no DOM import.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

function read(href: string): string {
  return readFileSync(path.join(PUBLIC_DIR, href.replace(/^\//, "")), "utf8");
}

function installedVersion(name: string): string {
  return (
    JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "node_modules", name, "package.json"),
        "utf8"
      )
    ) as { version: string }
  ).version;
}

/**
 * The production runtime packages the **web app** actually pulls: the
 * `package-lock.json` non-dev closure reachable from the web-side top-level
 * dependencies. A *transitive* bundled dependency (e.g. `scheduler`, pulled by
 * react-dom) is included — that is the drift this guards — because the walk
 * follows every runtime edge; a top-level-only check would miss it.
 *
 * The Capacitor native shell (#262) is deliberately NOT walked. `@capacitor/*`
 * and the packages reachable *only* through it (`tslib`, `@capacitor/synapse`)
 * are native-project scaffolding, not part of the web bundle this in-app notice
 * describes. The native app's own attribution — the full Gradle / CocoaPods /
 * native-Capacitor tree, of which these npm packages are a fraction — is a
 * separate, larger deliverable (#477), not this web-PWA notice. So the walk
 * starts from the root's non-`@capacitor/*` runtime deps and follows only what
 * they reach: a package pulled by *both* the web side and Capacitor stays
 * required (it is reached from the web side), so nothing actually bundled slips
 * through the exclusion. Workbox is injected from a build-time (dev) dependency,
 * so it is not in this closure and is disclosed as a hand-listed inclusion.
 */
function runtimeClosure(): Set<string> {
  const lock = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package-lock.json"), "utf8")
  ) as {
    packages: Record<
      string,
      {
        dev?: boolean;
        link?: boolean;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      }
    >;
  };
  const nameOf = (p: string) => p.replace(/^.*node_modules\//, "");
  // Every non-dev runtime package by name, and its runtime dependency edges.
  const nonDev = new Set<string>();
  const edges = new Map<string, Set<string>>();
  for (const [p, meta] of Object.entries(lock.packages)) {
    if (!p.startsWith("node_modules/") || meta.dev || meta.link) continue;
    const name = nameOf(p);
    nonDev.add(name);
    const children = new Set([
      ...Object.keys(meta.dependencies ?? {}),
      ...Object.keys(meta.optionalDependencies ?? {}),
    ]);
    edges.set(name, new Set([...(edges.get(name) ?? []), ...children]));
  }
  // BFS from the web-side roots (root runtime deps minus the Capacitor shell),
  // staying inside the non-dev closure.
  const reachable = new Set<string>();
  const queue = Object.keys(lock.packages[""]?.dependencies ?? {}).filter(
    (n) => nonDev.has(n) && !n.startsWith("@capacitor/")
  );
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (reachable.has(name) || !nonDev.has(name)) continue;
    reachable.add(name);
    for (const child of edges.get(name) ?? []) {
      if (nonDev.has(child) && !reachable.has(child)) queue.push(child);
    }
  }
  return reachable;
}

describe("third-party licence disclosure", () => {
  it("discloses every package in the production runtime closure", () => {
    const disclosed = new Set(thirdPartyLicenses.map((l) => l.name));
    for (const dep of runtimeClosure()) {
      expect(
        disclosed.has(dep),
        `${dep} is bundled (runtime closure) but not disclosed`
      ).toBe(true);
    }
  });

  it("discloses lamejs as the copyleft LGPL-3.0 dependency", () => {
    const lamejs = thirdPartyLicenses.find(
      (l) => l.name === "@breezystack/lamejs"
    );
    expect(lamejs?.spdx).toBe("LGPL-3.0");
  });

  it.each(thirdPartyLicenses)("pins $name to the installed version", (lib) => {
    // A drift here means a bundled component was bumped but the notice and the
    // panel still advertise the old version (George G6). Workbox shows its
    // family name but resolves to `workbox-build` in node_modules.
    expect(lib.version).toBe(installedVersion(lib.pinPackage ?? lib.name));
  });
});

describe("bundled licence texts", () => {
  it("links the app licence, the third-party notices, and the LGPL/GPL texts", () => {
    const hrefs = licenseTexts.map((t) => t.href);
    expect(hrefs).toContain("/licenses/MIT.txt");
    expect(hrefs).toContain("/licenses/THIRD-PARTY-NOTICES.txt");
    expect(hrefs).toContain("/licenses/GNU-LGPL-3.0.txt");
    expect(hrefs).toContain("/licenses/GNU-GPL-3.0.txt");
  });

  it.each(licenseTexts)("ships a real, non-empty file for $href", (text) => {
    const filePath = path.join(PUBLIC_DIR, text.href.replace(/^\//, ""));
    expect(existsSync(filePath), `${text.href} is not in public/`).toBe(true);
    expect(readFileSync(filePath, "utf8").trim().length).toBeGreaterThan(0);
  });

  it("ships the actual GNU LGPL v3 and GPL v3 texts", () => {
    expect(read("/licenses/GNU-LGPL-3.0.txt")).toContain(
      "GNU LESSER GENERAL PUBLIC LICENSE"
    );
    expect(read("/licenses/GNU-GPL-3.0.txt")).toContain(
      "GNU GENERAL PUBLIC LICENSE"
    );
  });

  it.each(thirdPartyLicenses)(
    "carries $name's own notice in its section",
    (lib) => {
      // Split the notices file into per-package sections (separated by a rule
      // of `=`), find this package's section, and assert its marker is IN that
      // section — so dropping one package's copyright fails that package alone,
      // which a single global /Copyright/ match did not (Frank F1, round 2).
      const sections = read("/licenses/THIRD-PARTY-NOTICES.txt").split(
        /\n=+\n/
      );
      // Match the unique section header (`name version`), not a bare name — the
      // file's preamble also mentions lamejs by name.
      const section = sections.find((s) =>
        s.includes(`${lib.name} ${lib.version}`)
      );
      expect(
        section,
        `${lib.name} has no section in the notices`
      ).toBeDefined();
      expect(section).toContain(lib.noticeMarker);
    }
  );
});

/**
 * The disclosure being complete on disk does not make it *reachable* in the
 * shipped app. These are the cheap Node pins the disk checks miss: nothing above
 * fails if the panel is unmounted, the precache glob loses `txt` (so the field
 * fetch 404s offline), the navigate-fallback stops sparing `.txt`, or the lamejs
 * row loses the relink affordances. They read the wiring files as text — no
 * renderer — and assert the properties #36 exists to guarantee. The rendered
 * behaviour (focus, the failed-fetch Notice) still needs a browser and is not
 * claimed here.
 */
function readSource(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

describe("reachability wiring (#36)", () => {
  it("precaches the licence texts and spares them from the SPA fallback", () => {
    const vite = readSource("vite.config.ts");
    // The config line, not a comment that merely mentions the word — develop's
    // versionJsonPlugin docblock says "globPatterns extensions" (no colon).
    const globLine = vite.split("\n").find((l) => l.includes("globPatterns:"));
    expect(globLine, "no globPatterns in vite.config.ts").toBeDefined();
    // `txt` in the precache glob is what makes `public/licenses/*.txt` resolve
    // offline; dropping it 404s the notice in the field.
    expect(globLine).toContain("txt");
    // And the navigate-fallback must not answer a `.txt` miss with the app shell
    // (George G1) — the denylist still has to match `.txt`.
    expect(vite).toContain("navigateFallbackDenylist");
    expect(vite).toMatch(/navigateFallbackDenylist:\s*\[[^\]]*\\\.txt/);
  });

  it("mounts the About panel from the global menu", () => {
    const screen = readSource("src/components/books-screen.tsx");
    // The only route to the whole surface: the menu entry (labelled
    // `strings.aboutOpen`) and the panel it opens. Unmount either and the disk
    // disclosure is unreachable on the phone.
    expect(screen).toContain("AboutPanel");
    expect(screen).toContain("strings.aboutOpen");
  });

  it("keeps the lamejs row's relink affordances (the note and the source link)", () => {
    const lamejs = thirdPartyLicenses.find(
      (l) => l.name === "@breezystack/lamejs"
    );
    // The boundary note and the library's own source are what an LGPL relinker
    // is owed on the row itself, not just in the licence text.
    expect(lamejs?.note, "lamejs lost its boundary note").toBeTruthy();
    expect(lamejs?.source?.href, "lamejs lost its source link").toBeTruthy();
  });
});
