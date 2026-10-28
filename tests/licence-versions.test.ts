import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  expandNoticeVersions,
  installedManifest,
  installedVersion,
  installedVersions,
  missingVersionReason,
  noticeNameForUrl,
  noticeVersionTokens,
  unversionedPackages,
} from "../scripts/licence-versions.mjs";

/**
 * The helper behind the derived licence versions (#1381). The suites that use
 * it against the real tree are `tests/licenses.test.ts` and
 * `tests/native-licenses.test.ts`; these pin its own contract on a synthetic
 * `node_modules`, including the two ways it must refuse.
 */

function fakeRoot(
  packages: Record<string, { version?: string; license?: string }>
): string {
  const root = mkdtempSync(path.join(tmpdir(), "licence-versions-"));
  for (const [name, manifest] of Object.entries(packages)) {
    const dir = path.join(root, "node_modules", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  }
  return root;
}

describe("installedVersions", () => {
  it("reads plain and scoped packages from their installed manifests", () => {
    const root = fakeRoot({
      plain: { version: "1.2.3" },
      "@scope/pkg": { version: "4.5.6" },
    });
    expect(installedVersions(root, ["plain", "@scope/pkg"])).toEqual({
      plain: "1.2.3",
      "@scope/pkg": "4.5.6",
    });
  });

  it("omits a package that is not installed, or names no version", () => {
    const root = fakeRoot({ nameless: {} });
    expect(installedVersions(root, ["missing", "nameless"])).toEqual({});
    expect(installedManifest(root, "missing")).toBeNull();
  });
});

describe("saying what is wrong with a package (#1415)", () => {
  it("tells a missing package from one whose manifest names no usable version", () => {
    const root = fakeRoot({
      nameless: {},
      emptied: { version: "" },
      fine: { version: "1.0.0" },
    });
    expect(missingVersionReason(root, "missing")).toBe("is not installed");
    expect(missingVersionReason(root, "nameless")).toMatch(
      /installed but its package\.json has no usable version/
    );
    expect(missingVersionReason(root, "emptied")).toMatch(/no usable version/);
    expect(missingVersionReason(root, "fine")).toBeNull();
  });

  it("lists the unversioned packages with their reasons", () => {
    const root = fakeRoot({ nameless: {}, fine: { version: "1.0.0" } });
    expect(
      unversionedPackages(root, ["fine", "missing", "nameless", "missing"])
    ).toEqual([
      { pkg: "missing", reason: "is not installed" },
      {
        pkg: "nameless",
        reason: "is installed but its package.json has no usable version",
      },
    ]);
  });

  it("does not take an Object.prototype member for a versioned package", () => {
    // `"constructor" in {}` is true; membership must be an own-property test.
    const root = fakeRoot({});
    expect(unversionedPackages(root, ["constructor", "toString"])).toEqual([
      { pkg: "constructor", reason: "is not installed" },
      { pkg: "toString", reason: "is not installed" },
    ]);
  });

  it("puts the reason in the expandNoticeVersions error", () => {
    expect(() =>
      expandNoticeVersions(
        "x {{version:x}}",
        () => undefined,
        "X.txt",
        () => "is installed but its package.json has no usable version"
      )
    ).toThrow(/names a package that is installed but its package\.json has no/);
  });
});

describe("noticeNameForUrl (dev server, #1415)", () => {
  it("matches a notice at the root base, with or without a query", () => {
    expect(noticeNameForUrl("/licenses/MIT.txt")).toBe("MIT.txt");
    expect(noticeNameForUrl("/licenses/MIT.txt?t=1", "/")).toBe("MIT.txt");
  });

  it("matches under a base other than /, and not without it", () => {
    expect(noticeNameForUrl("/x/licenses/MIT.txt", "/x/")).toBe("MIT.txt");
    expect(noticeNameForUrl("/licenses/MIT.txt", "/x/")).toBeNull();
  });

  it("refuses a path that is not a notice", () => {
    expect(noticeNameForUrl("/licenses/../secret.txt")).toBeNull();
    expect(noticeNameForUrl("/other/MIT.txt")).toBeNull();
    expect(noticeNameForUrl("/licenses/MIT.json")).toBeNull();
  });
});

describe("installedVersion (#1415)", () => {
  it("reads an installed version and nothing else", () => {
    const root = fakeRoot({ plain: { version: "1.2.3" } });
    expect(installedVersion(root, "plain")).toBe("1.2.3");
    expect(installedVersion(root, "missing")).toBeUndefined();
  });

  it("makes a token named like an Object.prototype member fail the fill", () => {
    const root = fakeRoot({});
    for (const name of ["constructor", "toString"]) {
      expect(installedVersion(root, name)).toBeUndefined();
      expect(() =>
        expandNoticeVersions(
          `x {{version:${name}}}`,
          (pkg) => installedVersion(root, pkg),
          "X.txt"
        )
      ).toThrow(/names a package that is not installed/);
    }
  });
});

describe("expandNoticeVersions", () => {
  const versions: Record<string, string> = {
    plain: "1.2.3",
    "@scope/pkg": "4.5.6",
  };
  const versionOf = (pkg: string) => versions[pkg];

  it("fills every token, scoped names included, and leaves other text alone", () => {
    const text =
      "plain {{version:plain}} — MIT\n@scope/pkg {{version:@scope/pkg}} — ISC\nandroidx.core:core 1.17.0 — Apache-2.0\n";
    expect(expandNoticeVersions(text, versionOf)).toBe(
      "plain 1.2.3 — MIT\n@scope/pkg 4.5.6 — ISC\nandroidx.core:core 1.17.0 — Apache-2.0\n"
    );
    expect(noticeVersionTokens(text)).toEqual(["plain", "@scope/pkg"]);
  });

  it("throws on a package that is not installed instead of shipping a token", () => {
    expect(() =>
      expandNoticeVersions("gone {{version:gone}} — MIT", versionOf, "X.txt")
    ).toThrow(
      /X\.txt: \{\{version:gone\}\} names a package that is not installed/
    );
  });

  it("does not treat a typed version as a token", () => {
    expect(noticeVersionTokens("plain 1.2.3 — MIT")).toEqual([]);
  });
});
