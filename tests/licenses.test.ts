import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appLicense,
  thirdPartyLicenses,
  type ThirdPartyLicense,
} from "@/components/licenses";

/**
 * The LGPL (#36) obligation is only met if the notice is *accurate* and the
 * licence text it links to actually ships. These guard both against drift:
 *
 * - the lamejs disclosure matches the installed dependency (a silent upgrade
 *   that changed the attribution would fail here), and
 * - every `/licenses/` link resolves to a real, non-empty file in `public/`
 *   that carries the licence it claims — the on-disk half the in-app panel
 *   cannot assert about itself.
 *
 * These run in plain Node: `licenses.ts` is pure data with no DOM import.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

/** The verbatim licence texts a `/licenses/*` href must map to on disk. */
function licenseFilePath(href: string): string {
  return path.join(PUBLIC_DIR, href.replace(/^\//, ""));
}

const lamejs = thirdPartyLicenses.find(
  (l) => l.name === "@breezystack/lamejs"
) as ThirdPartyLicense;

describe("third-party licence disclosure", () => {
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
  const linked = [
    appLicense.file,
    ...thirdPartyLicenses.flatMap((l) => l.files),
  ].filter((f) => f.href.startsWith("/licenses/"));

  it("links at least the app licence and the LGPL/GPL texts", () => {
    const hrefs = linked.map((f) => f.href);
    expect(hrefs).toContain("/licenses/MIT.txt");
    expect(hrefs).toContain("/licenses/GNU-LGPL-3.0.txt");
    expect(hrefs).toContain("/licenses/GNU-GPL-3.0.txt");
  });

  it.each(linked)("ships a real, non-empty file for $href", (file) => {
    const filePath = licenseFilePath(file.href);
    expect(existsSync(filePath), `${file.href} is not in public/`).toBe(true);
    expect(readFileSync(filePath, "utf8").trim().length).toBeGreaterThan(0);
  });

  it("ships the actual GNU LGPL v3 and GPL v3 texts", () => {
    const lgpl = readFileSync(
      licenseFilePath("/licenses/GNU-LGPL-3.0.txt"),
      "utf8"
    );
    const gpl = readFileSync(
      licenseFilePath("/licenses/GNU-GPL-3.0.txt"),
      "utf8"
    );
    expect(lgpl).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(lgpl).toContain("Version 3");
    expect(gpl).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(gpl).toContain("Version 3");
  });
});
