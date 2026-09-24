import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// #161 (Q-12): Node is pinned nowhere Cloudflare Workers Builds reads.
// Workers Builds' build image detects a custom Node version from
// `.nvmrc`/`.node-version` (or a `NODE_VERSION` build-environment variable);
// see the PR body for the doc citation. CI's `setup-node` steps and the
// deploy platform must read the same one file so there is a single source
// of truth for the Node line, rather than a version pinned in ci.yml that
// the deploy never sees.
const ROOT = path.join(import.meta.dirname, "..");

const WORKFLOW_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/ios-testflight.yml",
  ".github/workflows/android-apk.yml",
  ".github/workflows/android-play.yml",
] as const;

const workflows = Object.fromEntries(
  WORKFLOW_FILES.map((file) => [
    file,
    readFileSync(path.join(ROOT, file), "utf8"),
  ])
) as Record<(typeof WORKFLOW_FILES)[number], string>;

const packageJson: { engines?: { node?: string } } = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
);
const ENGINE_RANGE = packageJson.engines?.node;

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

describe("every setup-node step reads .node-version (#161 Q-12)", () => {
  it.each(WORKFLOW_FILES)("%s has no bare setup-node step left", (file) => {
    const workflow = workflows[file];
    const useCount = (workflow.match(/actions\/setup-node@/g) ?? []).length;
    expect(useCount).toBeGreaterThan(0);

    const fileRefCount = (
      workflow.match(/node-version-file:\s*\.node-version/g) ?? []
    ).length;
    expect(fileRefCount).toBe(useCount);
  });

  it.each(WORKFLOW_FILES)("%s carries no literal node-version pin", (file) => {
    // Matches a literal `node-version: "22"`-shaped key but not the
    // `node-version-file:` key this PR standardizes on (the latter has a
    // `-file` between the key name and the colon, so it never matches
    // `node-version:` as a substring).
    expect(workflows[file]).not.toMatch(/node-version:\s*["']?\d/);
  });
});

describe(".node-version satisfies package.json's declared engines range", () => {
  const raw = readFileSync(path.join(ROOT, ".node-version"), "utf8").trim();

  it("is a concrete x.y.z version, not a range or a bare major", () => {
    expect(raw).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("satisfies engines.node", () => {
    expect(ENGINE_RANGE).toBeTruthy();
    expect(satisfiesRange(ENGINE_RANGE!, raw)).toBe(true);
  });
});
