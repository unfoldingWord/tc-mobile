import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  licenseTexts,
  thirdPartyLicenses,
  type ThirdPartyLicense,
} from "@/components/licenses";

/**
 * The LGPL and MIT/ISC obligations (#36) are met only if the disclosure is
 * *complete* and *accurate* and the licence text it points to actually ships.
 * These guard all three against drift:
 *
 * - every bundled runtime dependency is disclosed (a new `dependencies` entry
 *   with no notice fails here — Frank F1),
 * - the copyleft lamejs entry matches the installed dependency, and
 * - every shipped licence text exists, is non-empty, and the collected
 *   third-party notices name every dependency and carry a copyright line.
 *
 * Plain Node: `licenses.ts` is pure data with no DOM import.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

function read(href: string): string {
  return readFileSync(path.join(PUBLIC_DIR, href.replace(/^\//, "")), "utf8");
}

const pkg = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
) as { dependencies: Record<string, string> };

const lamejs = thirdPartyLicenses.find(
  (l) => l.name === "@breezystack/lamejs"
) as ThirdPartyLicense;

describe("third-party licence disclosure", () => {
  it("discloses every bundled runtime dependency", () => {
    const disclosed = new Set(thirdPartyLicenses.map((l) => l.name));
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(disclosed.has(dep), `${dep} is bundled but not disclosed`).toBe(
        true
      );
    }
  });

  it("discloses lamejs as LGPL-3.0", () => {
    expect(lamejs).toBeDefined();
    expect(lamejs.spdx).toBe("LGPL-3.0");
  });

  it("pins the disclosed lamejs version to the installed dependency", () => {
    const installed = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "node_modules/@breezystack/lamejs/package.json"),
        "utf8"
      )
    ) as { version: string };
    // A drift here means the bundled encoder changed but the notice did not.
    expect(lamejs.version).toBe(installed.version);
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

  it("collects a notice for every disclosed dependency", () => {
    const notices = read("/licenses/THIRD-PARTY-NOTICES.txt");
    for (const lib of thirdPartyLicenses) {
      expect(notices, `${lib.name} missing from THIRD-PARTY-NOTICES`).toContain(
        lib.name
      );
    }
    // The permissive licences require the copyright line to travel; the file
    // must actually carry them, not just the package names.
    expect(notices).toMatch(/Copyright/i);
  });
});
