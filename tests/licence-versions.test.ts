import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  expandNoticeVersions,
  installedManifest,
  installedVersions,
  noticeVersionTokens,
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
