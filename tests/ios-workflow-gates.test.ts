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

import { stripYamlComments } from "./support";

const workflow = readFileSync(
  new URL("../.github/workflows/ios-testflight.yml", import.meta.url),
  "utf8"
);
// The same file without comments, for the assertions that read the YAML as
// text, so a commented-out key or step cannot satisfy them (#822). `step()`
// keeps reading `workflow` itself: it runs a step's script, and a `#` inside
// that script is the script's business.
const workflowCode = stripYamlComments(workflow);
// ci.yml: only read for the "quality" job's ruby-visibility step (#958 item 3
// below) — everything else in this file is about ios-testflight.yml.
const ciWorkflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8"
);
/** The `quality:` job's body, from its header to the next top-level job
 *  (`build:`), stripped of comments — same extraction shape as
 *  `ci-commit-messages-range.test.ts`'s `commitMessagesJob()`. */
function qualityJobCode(): string {
  const match = /\n {2}quality:\n([\s\S]*?)\n {2}build:/.exec(ciWorkflow);
  if (!match?.[1]) throw new Error("quality job not found in ci.yml");
  return stripYamlComments(match[1]);
}
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

// One environment policy for every subprocess this file spawns: always start
// from the full parent environment and layer explicit overrides on top,
// never swap PATH (or anything else) out wholesale. A version-manager shim
// (asdf, rbenv) can depend on vars beyond PATH to resolve `ruby`, so reducing
// a single call site here to `{ PATH }` alone would risk a false "ruby not
// available" skip that silently drops the seven Xcode-selection cases below.
// One named function, used everywhere a subprocess env is built, keeps that
// choice a single edit instead of a per-call-site guess (#958 item 2).
function subprocessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

function run(script: string, env: Record<string, string> = {}, cwd?: string) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    env: subprocessEnv(env),
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

// Routed through the same shared policy as every other subprocess call in
// this file, rather than passing `process.env` straight through — see
// `subprocessEnv` above.
const hasRuby = rubyAvailable(subprocessEnv());

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

describe("subprocess environment policy (#958 item 2)", () => {
  it("subprocessEnv layers overrides onto the full parent environment rather than replacing it", () => {
    const marker = "TC_MOBILE_TEST_958_MARKER";
    const env = subprocessEnv({ [marker]: "present" });
    for (const [key, value] of Object.entries(process.env)) {
      if (key === marker) continue;
      expect(env[key]).toBe(value);
    }
    expect(env[marker]).toBe("present");
  });

  it("run() carries a parent-only variable through to the child, not just PATH", () => {
    process.env.TC_MOBILE_TEST_958_PARENT_VAR = "carried-through";
    try {
      const result = run('printf %s "$TC_MOBILE_TEST_958_PARENT_VAR"');
      expect(result.stdout).toBe("carried-through");
    } finally {
      delete process.env.TC_MOBILE_TEST_958_PARENT_VAR;
    }
  });

  it("resolves a ruby shim that needs a non-PATH state variable, unlike the PATH-only reduction the issue warns against", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "ruby-shim-958-"));
    fixtures.push(bin);
    // Simulates an asdf/rbenv-style shim: this stub only succeeds when its
    // own version-manager state variable is present, the way a real shim's
    // `ruby` wrapper consults its own environment before delegating.
    writeFileSync(
      path.join(bin, "ruby"),
      '#!/bin/bash\n[ -n "$TC_MOBILE_TEST_958_SHIM_MARKER" ] && exit 0 || exit 1\n',
      { mode: 0o755 }
    );
    process.env.TC_MOBILE_TEST_958_SHIM_MARKER = "1";
    try {
      // The point fix the issue warns against: restricting the check to
      // PATH alone reports this shim as unavailable even though it works.
      expect(rubyAvailable({ PATH: bin })).toBe(false);
      // The shared policy layers PATH onto the full parent environment, so
      // the shim's own state variable survives and the check is accurate.
      expect(rubyAvailable(subprocessEnv({ PATH: bin }))).toBe(true);
    } finally {
      delete process.env.TC_MOBILE_TEST_958_SHIM_MARKER;
    }
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
    env: subprocessEnv(),
  }).stdout.trim();
  expect(path.isAbsolute(hostBash), hostBash).toBe(true);
  symlinkSync(hostBash, path.join(bashOnlyBin, "bash"));

  // run() inherits the parent environment, and bash translates "command not
  // found" under a non-English locale; pin C so the stderr check below holds.
  const result = run(step("Select Xcode"), {
    PATH: `${stubBin}:${bashOnlyBin}`,
    LANG: "C",
    LC_ALL: "C",
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ruby: command not found");
});

// The preflight ref/promotion gate is covered for both native lanes in
// tests/native-lanes-on-promotion.test.ts (#1281).

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

describe("CI surfaces ruby availability before this suite runs (#958 item 3)", () => {
  it("is still in ci.yml where this test reads it from", () => {
    expect(() => qualityJobCode()).not.toThrow();
    expect(qualityJobCode()).toContain("run: npm test");
  });

  it("runs `ruby -v` before the Test step, so a runner-image change that drops ruby is a visible log line rather than a silent skip of the seven Xcode-selection cases above", () => {
    const job = qualityJobCode();
    const rubyIndex = job.search(/run:\s*ruby -v/);
    const testIndex = job.indexOf("run: npm test");
    expect(rubyIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(-1);
    expect(rubyIndex).toBeLessThan(testIndex);
  });
});

it("runs the canonical artifact checks after build and before sync", () => {
  const name = "Check the built artifacts";
  expect(step(name)).toBe("npm run test:dist");
  const at = (step: string) => workflowCode.indexOf(`- name: ${step}`);
  expect(at("Build the web bundle")).toBeGreaterThan(-1);
  expect(at(name)).toBeGreaterThan(at("Build the web bundle"));
  expect(at(name)).toBeLessThan(at("Sync dist/ into the iOS project"));
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

// #923: this check moved out of "Guard the synced bundle" and into its own
// step, "OBS thumbnail precache policy (web build; #177 / ADR 0006)", which
// runs against the WEB build BEFORE "Rebuild dist/ for the native shell"
// overwrites dist/sw.js with the native self-destroying worker — that worker
// never precaches anything at all, so comparing IT against globPatterns would
// either never agree once jpg is legitimately restored, or silently stop
// meaning anything. Only the fixture files this step actually reads
// (vite.config.ts, dist/sw.js) are written here; the step makes no claim
// about ios/App/App/public or dist/manifest.webmanifest — those stay covered
// by "Guard the synced bundle" itself, exercised generically below.
describe("the OBS thumbnail precache policy (web build)", () => {
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
    const root = mkdtempSync(path.join(tmpdir(), "ios-thumbnail-gate-"));
    fixtures.push(root);
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "vite.config.ts"), config);
    writeFileSync(
      path.join(root, "dist/sw.js"),
      'precacheAndRoute([{url:"index.html",revision:"a"}' +
        (thumbnails ? ',{url:"obs/thumbs/01/01.jpg",revision:"b"}' : "") +
        "],{});"
    );
    const result = run(
      step("OBS thumbnail precache policy (web build; #177 / ADR 0006)"),
      {},
      root
    );
    expect(result.status, result.stderr + result.stdout).toBe(status);
    if (status === 1) {
      expect(annotation).toEqual(expect.any(String));
      expect(annotation).not.toHaveLength(0);
      expect(result.stderr).toContain(`::error::${annotation}`);
      expect(result.stderr).not.toContain("at file:");
    } else {
      expect(annotation).toBeNull();
      expect(result.stderr + result.stdout).not.toContain("::error::");
    }
  });
});

// The rest of "Guard the synced bundle" — existence checks and the e2e-leak
// sweep — runs against whatever dist/ the native rebuild left behind and
// whatever cap sync copied into ios/. Exercised generically (not per
// OBS-thumbnail case, which no longer lives here — see the describe block
// above) so a regression in the existence/leak checks themselves still has a
// red state to go to.
describe("Guard the synced bundle (existence + e2e-leak, native dist)", () => {
  function bundleFixture({
    swPresent = true,
    manifestPresent = true,
    e2eLeak = false,
    syncedIndexPresent = true,
  }: {
    swPresent?: boolean;
    manifestPresent?: boolean;
    e2eLeak?: boolean;
    syncedIndexPresent?: boolean;
  } = {}) {
    const root = mkdtempSync(path.join(tmpdir(), "ios-bundle-guard-"));
    fixtures.push(root);
    mkdirSync(path.join(root, "dist"));
    mkdirSync(path.join(root, "ios/App/App/public"), { recursive: true });
    if (swPresent) {
      // The native build's own shape (#923) — no precache manifest.
      writeFileSync(
        path.join(root, "dist/sw.js"),
        "self.addEventListener('activate', () => {});"
      );
    }
    if (manifestPresent) {
      writeFileSync(path.join(root, "dist/manifest.webmanifest"), "{}");
    }
    if (e2eLeak) {
      writeFileSync(path.join(root, "dist/leak.js"), "window.__e2e = true;");
    }
    if (syncedIndexPresent) {
      writeFileSync(
        path.join(root, "ios/App/App/public/index.html"),
        "<!doctype html>"
      );
    }
    return root;
  }

  it("passes on a clean native-shaped bundle", () => {
    const root = bundleFixture();
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("Bundle built, clean, and synced");
  });

  it("fails closed when dist/sw.js is missing", () => {
    const root = bundleFixture({ swPresent: false });
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::dist/sw.js missing");
  });

  it("fails closed when the manifest is missing", () => {
    const root = bundleFixture({ manifestPresent: false });
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::manifest missing");
  });

  it("fails closed when the e2e harness leaked into dist/", () => {
    const root = bundleFixture({ e2eLeak: true });
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("e2e harness (__e2e) leaked");
  });

  it("fails closed when cap sync did not copy the bundle into ios/", () => {
    const root = bundleFixture({ syncedIndexPresent: false });
    const result = run(step("Guard the synced bundle"), {}, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "cap sync did not copy the web bundle into ios/"
    );
  });
});
