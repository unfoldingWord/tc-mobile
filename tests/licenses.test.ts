import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * Only the Capacitor native PLATFORM projects (`NATIVE_ONLY`) are excluded:
 * `@capacitor/android` and `@capacitor/ios` are Gradle / Xcode scaffolding that
 * no `src/` module imports, so they never reach the web bundle. Every other
 * `@capacitor/*` package IS walked — `src/hooks/` imports `@capacitor/core`,
 * `/app`, `/filesystem` and `/share`, so Vite bundles their web code (Frank F1,
 * bench round 1 on #144: a blanket `@capacitor/*` exclusion hid them). The
 * native app's own attribution — the full Gradle / CocoaPods / native-Capacitor
 * tree — is still a separate deliverable (#477). Workbox is injected from a
 * build-time (dev) dependency, so it is not in this closure and is disclosed as
 * a hand-listed inclusion.
 */
const NATIVE_ONLY = new Set(["@capacitor/android", "@capacitor/ios"]);

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
    (n) => nonDev.has(n) && !NATIVE_ONLY.has(n)
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
    const closure = runtimeClosure();
    // A floor, so a lockfile shape change that empties the walk fails here
    // instead of looping over nothing (George Low, bench round 1 on #144).
    expect(closure.size).toBeGreaterThanOrEqual(10);
    for (const dep of closure) {
      expect(
        disclosed.has(dep),
        `${dep} is bundled (runtime closure) but not disclosed`
      ).toBe(true);
    }
  });

  it("excludes only packages no src/ module imports", () => {
    // The exclusion above is honest only while nothing in src/ reaches a
    // NATIVE_ONLY package; an import of one would put it in the web bundle.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          const src = readFileSync(full, "utf8");
          for (const pkg of NATIVE_ONLY) {
            if (src.includes(`"${pkg}"`) || src.includes(`'${pkg}'`)) {
              offenders.push(`${path.relative(REPO_ROOT, full)} → ${pkg}`);
            }
          }
        }
      }
    };
    walk(path.join(REPO_ROOT, "src"));
    expect(offenders).toEqual([]);
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

  it.each(thirdPartyLicenses)(
    "labels $name with the licence its notice section carries",
    (lib) => {
      // The panel shows `lib.spdx`; the notices file shows a `name version —
      // licence` header over the verbatim text. All three must agree, or the
      // phone names one licence and hands over another (Frank F1, bench round 2
      // on #144: @capacitor/synapse was labelled ISC over the MIT text).
      const sections = read("/licenses/THIRD-PARTY-NOTICES.txt").split(
        /\n=+\n/
      );
      const section = sections.find((s) =>
        s.includes(`${lib.name} ${lib.version}`)
      );
      expect(section, `${lib.name} has no section`).toBeDefined();
      const header = (section ?? "")
        .split("\n")
        .find((l) => l.startsWith(`${lib.name} ${lib.version}`));
      expect(header).toMatch(
        new RegExp(`^\\S+ \\S+ — ${lib.spdx.replace(/[.]/g, "\\.")}(\\s|$)`)
      );
      // The MIT grant sentence is the MIT text; a section that carries it must
      // not be labelled with some other licence.
      if (section?.includes("Permission is hereby granted, free of charge")) {
        expect(lib.spdx, `${lib.name} ships the MIT text`).toBe("MIT");
      }
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

  it("hands the global menu's Back layer to About instead of leaving it behind", () => {
    // Frank F2 (bench round 1 on #144): the About row did a raw
    // `setMenuOpen(false)`, so `books:global-menu` stayed registered under the
    // visible About and a system Back spent itself on the hidden menu. This
    // pins the wiring as text; the Back behaviour itself is a browser-level
    // test (e2e/back-navigation.spec.ts) and is not claimed here.
    const screen = readSource("src/components/books-screen.tsx");
    const body = (name: string) => {
      const start = screen.indexOf(`const ${name} = useCallback(`);
      expect(start, `${name} not found`).toBeGreaterThan(-1);
      return screen.slice(start, screen.indexOf("}, [", start));
    };
    const open = body("openAbout");
    expect(open).toContain('layers.open("books:about")');
    expect(open).toContain("closeGlobalMenu()");
    const close = body("closeAbout");
    expect(close).toContain('layers.close("books:about-text")');
    expect(close).toContain('layers.close("books:about")');
    expect(body("viewLicenseText")).toContain(
      'layers.open("books:about-text")'
    );
    expect(body("closeLicenseText")).toContain(
      'layers.close("books:about-text")'
    );
    expect(screen).toContain("onClick={openAbout}");
    expect(screen).not.toMatch(/setMenuOpen\(false\);\s*setAboutOpen\(true\)/);
  });

  it("keeps the lamejs row's relink affordances (the note and the source link)", () => {
    const lamejs = thirdPartyLicenses.find(
      (l) => l.name === "@breezystack/lamejs"
    );
    // The boundary note and the library's own source are what an LGPL relinker
    // is owed on the row itself, not just in the licence text.
    expect(lamejs?.note, "lamejs lost its boundary note").toBeTruthy();
    expect(lamejs?.source?.path, "lamejs lost its source link").toBeTruthy();
    // The LAME acknowledgement the licence asks for (George Low, bench round 2).
    expect(lamejs?.acknowledges?.href).toBe("https://lame.sourceforge.net");
  });

  it("keeps Workbox, which the closure walk cannot see, in the disclosure", () => {
    // Workbox is a build-time (dev) dependency injected into the service
    // worker, so the runtime-closure test above never requires it; this pins
    // the hand-listed inclusion (George Low, bench round 2 on #144).
    expect(thirdPartyLicenses.map((l) => l.name)).toContain("workbox");
  });

  it("keeps Vite, whose module-preload polyfill the build injects, in the disclosure", () => {
    // The second build-time inclusion (Frank P2, bench round 1 on #1019): Vite
    // writes its polyfill into the entry chunk unless the config turns it off,
    // and Vite is a dev dependency the closure walk never visits. The built
    // bundle is checked in tests/dist-source-offer.test.ts; this is the
    // source-side pin, and it lapses only if the config disables the polyfill.
    const vite = readSource("vite.config.ts");
    if (!/polyfill:\s*false/.test(vite)) {
      expect(thirdPartyLicenses.map((l) => l.name)).toContain("vite");
    }
  });
});
