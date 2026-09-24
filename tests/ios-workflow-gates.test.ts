import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

// The workflow's "Select Xcode" step pipes into `ruby -e` (Gem::Version
// numeric sort), so the "iOS Xcode selection" block below execs the real
// `ruby` on this machine. #667: that made the block fail, not skip, on a
// Linux dev box without ruby on PATH, and the pre-push hook runs the whole
// suite regardless of what the branch touches.
function rubyAvailable(env: NodeJS.ProcessEnv): boolean {
  return spawnSync("ruby", ["-v"], { env }).status === 0;
}

const hasRuby = rubyAvailable(process.env);

describe("ruby availability detection", () => {
  it("is true when ruby resolves on PATH", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "ruby-present-"));
    fixtures.push(bin);
    writeFileSync(path.join(bin, "ruby"), "#!/bin/bash\nexit 0\n", {
      mode: 0o755,
    });
    expect(rubyAvailable({ PATH: bin })).toBe(true);
  });

  it("is false when ruby is not on PATH", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "ruby-absent-"));
    fixtures.push(bin);
    expect(rubyAvailable({ PATH: bin })).toBe(false);
  });
});

// Independent of whether THIS machine has ruby: builds a PATH with a real
// bash but no ruby anywhere on it, and runs the workflow's own extracted
// script against it. This is the #667 incident reproduced verbatim (down to
// the "ruby: command not found" text and the resulting exit status), so it
// stays red-provable without needing a ruby-less CI runner and without
// depending on the skip guard below.
it("reproduces the reported failure: Select Xcode needs ruby on PATH", () => {
  const stubBin = mkdtempSync(
    path.join(tmpdir(), "ios-xcode-gate-noruby-stubs-")
  );
  fixtures.push(stubBin);
  writeFileSync(
    path.join(stubBin, "ls"),
    '#!/bin/bash\nprintf "%s\\n" "/Applications/Xcode_26.9.app"\n',
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(stubBin, "sudo"),
    '#!/bin/bash\nprintf "SELECTED:%s\\n" "$*"\n',
    { mode: 0o755 }
  );
  writeFileSync(
    path.join(stubBin, "xcodebuild"),
    '#!/bin/bash\necho "fixture xcodebuild"\n',
    { mode: 0o755 }
  );

  const bashOnlyBin = mkdtempSync(
    path.join(tmpdir(), "ios-xcode-gate-noruby-bash-")
  );
  fixtures.push(bashOnlyBin);
  // Resolve the host's bash rather than hard-coding a path: macOS ships it
  // at /bin/bash only, and a dangling symlink makes the spawn ENOENT.
  const hostBash = spawnSync("bash", ["-c", "command -v bash"], {
    encoding: "utf8",
  }).stdout.trim();
  expect(path.isAbsolute(hostBash), hostBash).toBe(true);
  symlinkSync(hostBash, path.join(bashOnlyBin, "bash"));

  const result = run(step("Select Xcode"), {
    PATH: `${stubBin}:${bashOnlyBin}`,
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ruby: command not found");
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

describe.skipIf(!hasRuby)(
  "iOS Xcode selection (requires ruby on PATH; skipped without it — see the reproduction above)",
  () => {
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
    it.each([
      { name: "no installed candidates", versions: [] },
      {
        name: "only unsupported candidates",
        versions: ["260.1", "26.10_beta"],
      },
    ])(
      "fails closed without a stable Xcode 26 candidate: $name",
      ({ versions }) => {
        const result = select(versions);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Xcode 26 not found");
        expect(result.stdout).not.toContain("SELECTED:");
      }
    );
  }
);

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
  const disagreeAnnotation =
    "Emitted OBS thumbnails disagree with the reader-gated jpg policy";
  const noGlobPatternsAnnotation = "No globPatterns found in vite.config.ts";
  // #667: each row states the annotation the gate must emit, instead of a
  // shared block deriving it from `config`'s string shape — a fixture row
  // added later with a config the deriving check doesn't recognize can no
  // longer silently inherit the wrong expectation.
  it.each([
    {
      name: "current policy without thumbnails",
      config: current,
      thumbnails: false,
      status: 0,
      annotation: null,
    },
    {
      name: "rogue includeAssets or additionalManifestEntries thumbnail",
      config: current,
      thumbnails: true,
      status: 1,
      annotation: disagreeAnnotation,
    },
    {
      name: "restored jpg policy with thumbnails",
      config: restored,
      thumbnails: true,
      status: 0,
      annotation: null,
    },
    {
      name: "restored jpg policy missing thumbnails",
      config: restored,
      thumbnails: false,
      status: 1,
      annotation: disagreeAnnotation,
    },
    {
      name: "missing config declaration",
      config: "",
      thumbnails: false,
      status: 1,
      annotation: noGlobPatternsAnnotation,
    },
    {
      name: "empty config declaration",
      config: "globPatterns: []",
      thumbnails: false,
      status: 1,
      annotation: noGlobPatternsAnnotation,
    },
  ])("$name", ({ config, thumbnails, status, annotation }) => {
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
    if (status === 1) {
      expect(annotation).toEqual(expect.any(String));
      expect(annotation).not.toHaveLength(0);
      expect(result.stderr).toContain(`::error::${annotation}`);
      expect(result.stderr).not.toContain("at file:");
      expect(result.stdout).not.toContain("Bundle built, clean, and synced");
    } else {
      expect(annotation).toBeNull();
      expect(result.stderr + result.stdout).not.toContain("::error::");
      expect(result.stdout).toContain("Bundle built, clean, and synced");
    }
  });
});
