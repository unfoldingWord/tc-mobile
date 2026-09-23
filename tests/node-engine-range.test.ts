import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// #577: package.json's declared `engines.node` must not admit a Node line
// that a render-test dependency (jsdom, and its transitives @exodus/bytes
// and html-encoding-sniffer) declares itself incompatible with — concretely,
// the Node 23.x line, which sits between the ^22.12.0 and >=24.0.0 halves of
// their shared three-part range.
const ROOT = path.join(import.meta.dirname, "..");

const packageJson: { engines?: { node?: string } } = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
);

const ENGINE_RANGE = packageJson.engines?.node;

const packageLock: {
  packages: Record<string, { engines?: { node?: string } }>;
} = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

const JSDOM_RANGE = packageLock.packages["node_modules/jsdom"]?.engines?.node;

// The installed `semver` CLI (a transitive dev dependency already in the
// lockfile — see `node_modules/semver`) is an independent oracle for "does
// this Node version satisfy this range", the same check `npm`'s own
// engine-strict gate performs internally. This needs no network fetch and
// no second Node install: `-r <range> <version>` prints the version and
// exits 0 when it matches, and prints nothing and exits non-zero when it
// does not.
const SEMVER_BIN = path.join(ROOT, "node_modules", ".bin", "semver");

function satisfiesRange(range: string, version: string): boolean {
  try {
    const out = execFileSync(SEMVER_BIN, ["-r", range, version], {
      encoding: "utf8",
    }).trim();
    return out === version;
  } catch {
    return false;
  }
}

describe("declared engines.node range (#577)", () => {
  it("is declared", () => {
    expect(ENGINE_RANGE).toBeTruthy();
  });

  it("excludes Node 23.x, the line jsdom's own engine range excludes", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "23.0.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "23.6.0")).toBe(false);
  });

  it("still admits the stated floor, 22.12.0 (the floor is not raised by this reconciliation)", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "22.12.0")).toBe(true);
  });

  it('admits the rest of the 22.x line, including what CI\'s node-version: "22" resolves to', () => {
    expect(satisfiesRange(ENGINE_RANGE!, "22.99.99")).toBe(true);
  });

  it("admits Node 24, the next supported line", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "24.0.0")).toBe(true);
    expect(satisfiesRange(ENGINE_RANGE!, "24.5.0")).toBe(true);
  });

  it("this environment's own Node satisfies the declared range", () => {
    expect(satisfiesRange(ENGINE_RANGE!, process.versions.node)).toBe(true);
  });

  it("agrees with jsdom's own declared engine range at every version tested here", () => {
    expect(JSDOM_RANGE).toBeTruthy();
    for (const version of [
      "22.12.0",
      "22.99.99",
      "23.0.0",
      "23.6.0",
      "24.0.0",
      "24.5.0",
    ]) {
      expect(satisfiesRange(ENGINE_RANGE!, version)).toBe(
        satisfiesRange(JSDOM_RANGE!, version)
      );
    }
  });
});
