import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { thirdPartyLicenses } from "@/components/licenses";

/**
 * The lamejs source kept in this repository (#36; the DRI ruling on #144's
 * Frank round 6 escalation) must be the source of the version the app
 * actually installs. The About screen links `third_party/lamejs-<version>/` at
 * the build's full commit; that link is only worth anything if the folder at
 * that commit holds the matching release. These checks tie the folder to
 * `package-lock.json`, to the installed package, and to the upstream commit
 * its PROVENANCE.md names.
 *
 * If the lock moves to a new lamejs version, this file fails until a new
 * folder is vendored from that version's upstream commit and the constants
 * below are updated with it.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = "@breezystack/lamejs";

/** npm's `gitHead` for @breezystack/lamejs 1.2.7 (`npm view … gitHead`). */
const VENDORED_GIT_HEAD = "1fb0ef5fa177413107e2e107d054a9b994e3f79c";

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function lockedVersion(): string {
  const lock = readJson<{
    packages: Record<string, { version?: string }>;
  }>(path.join(REPO_ROOT, "package-lock.json"));
  const entry = lock.packages[`node_modules/${PACKAGE}`];
  expect(entry?.version, `${PACKAGE} is not in package-lock.json`).toBeTruthy();
  return entry!.version!;
}

const lamejs = thirdPartyLicenses.find((l) => l.name === PACKAGE);
const vendoredPath = lamejs?.source?.path ?? "";
const VENDORED_DIR = path.join(REPO_ROOT, vendoredPath);
const INSTALLED_DIR = path.join(REPO_ROOT, "node_modules", PACKAGE);

describe("the vendored lamejs source matches the locked version", () => {
  it("links a third_party folder named for the locked version", () => {
    expect(vendoredPath).toBe(`third_party/lamejs-${lockedVersion()}`);
    expect(existsSync(VENDORED_DIR), `${vendoredPath} is missing`).toBe(true);
  });

  it("holds the package.json of the locked name and version", () => {
    const pkg = readJson<{ name: string; version: string }>(
      path.join(VENDORED_DIR, "package.json")
    );
    expect(pkg.name).toBe(PACKAGE);
    expect(pkg.version).toBe(lockedVersion());
  });

  it("carries the same LICENSE and type declarations as the installed package", () => {
    // Byte equality with the files npm installed: a folder vendored from some
    // other revision is unlikely to match both.
    for (const file of ["LICENSE", "type.d.ts"]) {
      expect(
        readFileSync(path.join(VENDORED_DIR, file), "utf8"),
        `${vendoredPath}/${file} differs from the installed package`
      ).toBe(readFileSync(path.join(INSTALLED_DIR, file), "utf8"));
    }
  });

  it("carries the build entry the published dist is built from", () => {
    expect(existsSync(path.join(VENDORED_DIR, "src", "js", "index.js"))).toBe(
      true
    );
    expect(existsSync(path.join(VENDORED_DIR, "vite.config.ts"))).toBe(true);
  });
});

describe("the vendored folder records where it came from", () => {
  const provenancePath = path.join(VENDORED_DIR, "PROVENANCE.md");

  it("has a LICENSE and a PROVENANCE.md", () => {
    expect(existsSync(path.join(VENDORED_DIR, "LICENSE"))).toBe(true);
    expect(existsSync(provenancePath)).toBe(true);
  });

  it("names the full 40-hex npm gitHead as both the gitHead and the upstream commit", () => {
    const provenance = readFileSync(provenancePath, "utf8");
    const row = (field: string): string | undefined =>
      new RegExp(`^\\|\\s*${field}\\s*\\|\\s*\`([^\`]*)\``, "m").exec(
        provenance
      )?.[1];
    for (const field of ["npm `gitHead`", "Upstream commit"]) {
      const value = row(field.replace(/`/g, "`?"));
      expect(value, `PROVENANCE.md has no "${field}" row`).toBeDefined();
      expect(value).toMatch(/^[0-9a-f]{40}$/);
      expect(value).toBe(VENDORED_GIT_HEAD);
    }
    expect(row("npm version")).toBe(lockedVersion());
  });
});

describe("the lamejs source link", () => {
  // Any 40-hex value stands in for the build's commit; the build injects the
  // real one (tests/dist-source-offer.test.ts checks the built bundle).
  const BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567";

  beforeEach(() => {
    vi.stubGlobal("__BUILD_SHA_FULL__", BUILD_COMMIT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the vendored folder in this repository at the build's full commit", () => {
    // `href` is written out as one literal so the build folds it; this ties
    // that literal to `path`, which the checks above tie to package-lock.
    expect(lamejs?.source?.href).toBe(
      `https://github.com/unfoldingWord/tc-mobile/tree/${BUILD_COMMIT}/${vendoredPath}`
    );
  });
});
