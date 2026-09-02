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

const pkg = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
) as { dependencies: Record<string, string> };

describe("third-party licence disclosure", () => {
  it("discloses every bundled runtime dependency", () => {
    const disclosed = new Set(thirdPartyLicenses.map((l) => l.name));
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(disclosed.has(dep), `${dep} is bundled but not disclosed`).toBe(
        true
      );
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
