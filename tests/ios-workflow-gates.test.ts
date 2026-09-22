import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/ios-testflight.yml", import.meta.url),
  "utf8"
);
const fixtures: string[] = [];

function step(name: string): string {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const rest = workflow.slice(start);
  const next = rest.slice(1).search(/^      - /m);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  const run = /^        run: (.+)$/m.exec(block);
  if (!run) throw new Error(`Missing run in ${name}`);
  if (run[1] !== "|") return run[1]!;
  const lines = block
    .slice(run.index + run[0].length)
    .split("\n")
    .slice(1);
  const script: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

function run(script: string, env: Record<string, string> = {}, cwd?: string) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...env },
  });
}

afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

describe("iOS dispatch ref gate", () => {
  it("takes the branch/tag type from GitHub", () => {
    expect(workflow).toContain("REF_TYPE: ${{ github.ref_type }}");
  });
  it.each([
    ["staging", "branch", "false", 0],
    ["main", "branch", "false", 0],
    ["staging", "tag", "false", 1],
    ["main", "tag", "false", 1],
    ["develop", "branch", "false", 1],
    ["feature/experiment", "branch", "false", 1],
    ["staging", "tag", "true", 0],
    ["main", "tag", "true", 0],
    ["feature/experiment", "branch", "true", 0],
    ["v0.3.0", "tag", "true", 0],
  ])("%s (%s), override %s exits %i", (REF, REF_TYPE, ALLOW_ANY, status) => {
    expect(
      run(step("Require staging/main (or an explicit override)"), {
        REF,
        REF_TYPE,
        ALLOW_ANY,
      }).status
    ).toBe(status);
  });
});

describe("iOS Xcode selection", () => {
  function select(versions: string[]) {
    const bin = mkdtempSync(path.join(tmpdir(), "ios-xcode-gate-"));
    fixtures.push(bin);
    writeFileSync(
      path.join(bin, "ls"),
      '#!/bin/bash\nif [ -n "$XCODE_FIXTURE" ]; then printf "%s\\n" "$XCODE_FIXTURE"; else exit 1; fi\n',
      { mode: 0o755 }
    );
    writeFileSync(
      path.join(bin, "sudo"),
      '#!/bin/bash\nprintf "SELECTED:%s\\n" "$*"\n',
      { mode: 0o755 }
    );
    writeFileSync(
      path.join(bin, "xcodebuild"),
      '#!/bin/bash\necho "fixture xcodebuild"\n',
      { mode: 0o755 }
    );
    return run(step("Select Xcode"), {
      PATH: `${bin}:${process.env.PATH}`,
      XCODE_FIXTURE: versions
        .map((v) => `/Applications/Xcode_${v}.app`)
        .join("\n"),
    });
  }
  it.each([
    [["26.9", "26.10"], "26.10"],
    [["26.10.2", "26.10.10", "26.9"], "26.10.10"],
    [["26", "26.0.1"], "26.0.1"],
    [["26.1"], "26.1"],
    [["260.1", "26.9", "26.10_beta"], "26.9"],
  ])("selects the newest stable Xcode from %j", (versions, expected) => {
    const result = select(versions);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `SELECTED:xcode-select -s /Applications/Xcode_${expected}.app/Contents/Developer`
    );
  });
  it.each([[], ["260.1", "26.10_beta"]])(
    "fails closed without a stable Xcode 26 candidate: %j",
    (...versions) => {
      const result = select(versions);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Xcode 26 not found");
      expect(result.stdout).not.toContain("SELECTED:");
    }
  );
});

it("runs the canonical artifact checks after build and before sync", () => {
  const name = "Check the built artifacts";
  expect(step(name)).toBe("npm run test:dist");
  expect(workflow.indexOf(`- name: ${name}`)).toBeGreaterThan(
    workflow.indexOf("- name: Build the web bundle")
  );
  expect(workflow.indexOf(`- name: ${name}`)).toBeLessThan(
    workflow.indexOf("- name: Sync dist/ into the iOS project")
  );
});

it.each([0, 23])("propagates the artifact suite exit status %i", (status) => {
  const bin = mkdtempSync(path.join(tmpdir(), "ios-artifact-gate-"));
  fixtures.push(bin);
  writeFileSync(
    path.join(bin, "npm"),
    '#!/bin/bash\n[ "$*" = "run test:dist" ] || exit 99\nexit "$ARTIFACT_STATUS"\n',
    { mode: 0o755 }
  );
  expect(
    run(step("Check the built artifacts"), {
      PATH: `${bin}:${process.env.PATH}`,
      ARTIFACT_STATUS: String(status),
    }).status
  ).toBe(status);
});

describe("the emitted iOS thumbnail precache", () => {
  const current = 'globPatterns: ["**/*.{js,css,html,svg,png,woff2}"]';
  const restored = 'globPatterns: ["**/*.{js,css,html,svg,png,jpg,woff2}"]';
  it.each([
    {
      name: "current policy without thumbnails",
      config: current,
      thumbnails: false,
      status: 0,
    },
    {
      name: "rogue includeAssets or additionalManifestEntries thumbnail",
      config: current,
      thumbnails: true,
      status: 1,
    },
    {
      name: "restored jpg policy with thumbnails",
      config: restored,
      thumbnails: true,
      status: 0,
    },
    {
      name: "restored jpg policy missing thumbnails",
      config: restored,
      thumbnails: false,
      status: 1,
    },
    {
      name: "missing config declaration",
      config: "",
      thumbnails: false,
      status: 1,
    },
    {
      name: "empty config declaration",
      config: "globPatterns: []",
      thumbnails: false,
      status: 1,
    },
  ])("$name", ({ config, thumbnails, status }) => {
    const root = mkdtempSync(path.join(tmpdir(), "ios-bundle-gate-"));
    fixtures.push(root);
    mkdirSync(path.join(root, "dist"));
    mkdirSync(path.join(root, "ios/App/App/public"), { recursive: true });
    writeFileSync(path.join(root, "vite.config.ts"), config);
    writeFileSync(
      path.join(root, "dist/sw.js"),
      'precacheAndRoute([{url:"index.html",revision:"a"}' +
        (thumbnails ? ',{url:"obs/thumbs/01/01.jpg",revision:"b"}' : "") +
        "],{});"
    );
    writeFileSync(path.join(root, "dist/manifest.webmanifest"), "{}");
    writeFileSync(
      path.join(root, "ios/App/App/public/index.html"),
      "<!doctype html>"
    );
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status, result.stderr + result.stdout).toBe(status);
  });
});
