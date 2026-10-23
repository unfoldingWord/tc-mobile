import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * #1616, the workflow half of the pre-upload guard. Each native lane's upload
 * job runs `scripts/check-redispatch.mjs --run-id …` before it uploads, and
 * the upload step runs only on the guard's `upload=true`. The guard's own
 * rules are unit-tested in tests/upload-guard.test.ts; this file reads the
 * three workflow files and runs each guard step's real shell, with the real
 * CLI, against a stand-in `gh` that answers like GitHub does (filtered by
 * workflow file and by commit). Both states (AGENTS.md "A gate is tested in
 * both states"): an earlier upload at this commit skips (green, no upload);
 * an earlier failed run, a different commit's upload and the other lane's
 * upload all leave this run to upload; a read that fails stops the job red.
 *
 * Read through the shared YAML comment strip (#822).
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "redispatch");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

const LANES = [
  {
    token: "apk",
    file: "android-apk.yml",
    job: "build",
    upload: [
      "      - name: Build the release APK\n",
      "      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
    ],
    exempt: "inputs.diagnostic",
    built: {
      view: "apk-staging-built.view",
      artifacts: "apk-staging-built.artifacts",
    },
    failed: {
      view: "apk-cancelled-pending.view",
      artifacts: "apk-prod-expired.artifacts",
    },
  },
  {
    token: "testflight",
    file: "ios-testflight.yml",
    job: "testflight",
    upload: ["      - name: Archive and upload to TestFlight\n"],
    exempt: null,
    built: { view: "ios-built.view", artifacts: null },
    failed: { view: "ios-job-skipped.view", artifacts: null },
  },
  {
    token: "play",
    file: "android-play.yml",
    job: "upload",
    upload: ["      - name: Upload to Google Play\n"],
    exempt: "inputs.build_only",
    built: { view: "play-internal-built.view", artifacts: null },
    failed: { view: "play-failed-before-upload.view", artifacts: null },
  },
] as const;

type Lane = (typeof LANES)[number];

const GUARD =
  "      - name: Skip the upload if this commit already uploaded on this lane\n";

function workflow(file: string): string {
  return stripYamlComments(
    readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8")
  );
}

/** The upload job's block: from its id to the next top-level job or EOF. */
function uploadJob(l: Lane): string {
  const text = workflow(l.file);
  const start = text.indexOf(`\n  ${l.job}:\n`);
  if (start < 0) throw new Error(`no ${l.job} job in ${l.file}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/^ {2}[A-Za-z0-9_-]+:\n/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** One step's block, from its first line to the next step. */
function step(block: string, head: string): string {
  const at = block.indexOf(head);
  if (at < 0) throw new Error(`no step ${head.trim()}`);
  if (block.indexOf(head, at + 1) >= 0)
    throw new Error(`two steps ${head.trim()}`);
  const next = block.indexOf("\n      - ", at + 1);
  return block.slice(at, next < 0 ? block.length : next + 1);
}

/** The guard step's `run: |` script, unindented. */
function guardScript(l: Lane): string {
  const s = step(uploadJob(l), GUARD);
  const run = /^ {8}run: \|\n/m.exec(s);
  if (!run) throw new Error("guard step has no run block");
  const out: string[] = [];
  for (const line of s.slice(run.index + run[0].length).split("\n")) {
    if (line && !line.startsWith("          ")) break;
    out.push(line.slice(10));
  }
  const script = out.join("\n").trim();
  if (script === "") throw new Error("empty guard script");
  return script;
}

/** The `LANE:` the guard step's own env sets. */
function stepLane(l: Lane): string {
  const m = /^ {10}LANE: (\S+)$/m.exec(step(uploadJob(l), GUARD));
  if (!m?.[1]) throw new Error(`guard step in ${l.file} sets no LANE`);
  return m[1];
}

const SHA = "a87c2f6f1d44d020f096b9cf1b6028853b1121a6";
const OTHER_SHA = "d0eb5456ff053bf036984c113d507c6dc98cc33a";
const ME = 5000;

interface Row {
  workflow: string;
  databaseId: number;
  status: string;
  headSha: string;
  view: unknown;
  artifacts?: unknown;
  /** The run's latest attempt number, as `gh run view --json attempt` reads it. */
  attempt?: number;
}

const dir = mkdtempSync(path.join(tmpdir(), "upload-guard-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A `gh` on PATH that answers from a world file, the way GitHub filters. */
const FAKE_GH = path.join(dir, "gh");
writeFileSync(
  FAKE_GH,
  `#!/usr/bin/env node
const fs = require("node:fs");
const w = JSON.parse(fs.readFileSync(process.env.FAKE_GH_WORLD, "utf8"));
if (w.fail) { process.stderr.write("HTTP 502\\n"); process.exit(1); }
const a = process.argv.slice(2);
const flag = (n) => a[a.indexOf(n) + 1];
let out;
if (a[0] === "run" && a[1] === "list") {
  out = w.rows
    .filter((r) => r.workflow === flag("--workflow") && r.headSha === flag("--commit"))
    .map(({ databaseId, status, headSha }) => ({ databaseId, status, headSha, headBranch: "staging" }));
} else if (a[0] === "run" && a[1] === "view") {
  const r = w.rows.find((x) => String(x.databaseId) === a[2]);
  out = flag("--json") === "attempt" ? { attempt: r.attempt ?? 1 }
    : a.includes("--attempt") ? w.attempts[a[2] + "#" + flag("--attempt")] : r.view;
} else if (a[0] === "api" && a[1].includes("/artifacts")) {
  out = w.rows.find((x) => String(x.databaseId) === a[1].split("/")[5]).artifacts;
} else if (a[0] === "api" && a[1].includes("/git/ref/heads/")) {
  out = { object: { sha: w.tip } };
} else { process.stderr.write("unexpected " + a.join(" ")); process.exit(9); }
process.stdout.write(JSON.stringify(out));
`
);
chmodSync(FAKE_GH, 0o755);

function runGuard(
  l: Lane,
  rows: Row[],
  extra: {
    attempt?: number;
    attempts?: Record<string, unknown>;
    fail?: boolean;
  } = {}
) {
  const world = path.join(dir, `world-${Math.random()}.json`);
  const own: Row = {
    workflow: l.file,
    databaseId: ME,
    status: "in_progress",
    headSha: SHA,
    view: { jobs: [] },
    // This run's own artifact listing, empty while it runs.
    artifacts: { total_count: 0, artifacts: [] },
  };
  writeFileSync(
    world,
    JSON.stringify({
      rows: [own, ...rows],
      attempts: extra.attempts ?? {},
      tip: SHA,
      fail: extra.fail ?? false,
    })
  );
  const output = path.join(dir, `out-${Math.random()}`);
  writeFileSync(output, "");
  const r = spawnSync("bash", ["-c", guardScript(l)], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: `${dir}:${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      FAKE_GH_WORLD: world,
      GITHUB_OUTPUT: output,
      GITHUB_SHA: SHA,
      GITHUB_REF_NAME: "staging",
      GITHUB_RUN_ID: String(ME),
      GITHUB_RUN_ATTEMPT: String(extra.attempt ?? 1),
      GH_TOKEN: "unused",
      // The lane token as the step itself sets it, not the test's copy.
      LANE: stepLane(l),
    },
  });
  return { ...r, output: readFileSync(output, "utf8") };
}

const rowOf = (
  l: Lane,
  id: number,
  read: { view: string; artifacts: string | null },
  headSha = SHA
): Row => ({
  workflow: l.file,
  databaseId: id,
  status: "completed",
  headSha,
  view: fixture(read.view),
  ...(read.artifacts ? { artifacts: fixture(read.artifacts) } : {}),
});

describe.each(LANES)("$file: the guard step's place (#1616)", (l) => {
  const job = uploadJob(l);

  it("runs the guard in the upload job, after node is set up and before npm ci", () => {
    const at = job.indexOf(GUARD);
    expect(at).toBeGreaterThan(
      job.indexOf("      - uses: actions/setup-node@")
    );
    expect(at).toBeLessThan(
      job.indexOf("      - name: Install dependencies\n")
    );
    expect(job).toContain("    concurrency:\n");
  });

  it("asks check:redispatch for this lane, commit, run and attempt", () => {
    const s = step(job, GUARD);
    expect(s).toMatch(/^ {8}id: guard$/m);
    expect(s).toContain(`          LANE: ${l.token}\n`);
    expect(s).toContain("          GH_TOKEN: ${{ github.token }}\n");
    expect(guardScript(l)).toContain(
      'node scripts/check-redispatch.mjs --lane "$LANE" --sha "$GITHUB_SHA" --branch "$GITHUB_REF_NAME" --run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT"'
    );
  });

  it("guards every run except the lane's own non-tester build", () => {
    const s = step(job, GUARD);
    if (l.exempt) expect(s).toContain(`        if: \${{ !${l.exempt} }}\n`);
    else expect(s).not.toMatch(/^ {8}if:/m);
  });

  it("can read the lane's runs: actions: read on the upload job", () => {
    expect(job).toMatch(
      /^ {4}permissions:\n {6}contents: read\n {6}actions: read\n/m
    );
  });

  it.each(l.upload)("uploads only on the guard's upload=true: %s", (head) => {
    const s = step(job, head);
    const cond = /^ {8}if: \$\{\{ (.*) \}\}$/m.exec(s)?.[1] ?? "";
    expect(cond).toContain("steps.guard.outputs.upload == 'true'");
    if (l.exempt)
      expect(cond.startsWith(l.exempt) || cond.startsWith(`!${l.exempt}`)).toBe(
        true
      );
  });
});

describe.each(LANES)("$file: the guard in both states", (l) => {
  const other = LANES.find((o) => o.file !== l.file)!;

  it("an earlier upload of this lane at this commit: skip, green, no upload", () => {
    const r = runGuard(l, [rowOf(l, 1, l.built)]);
    expect(r.status).toBe(0);
    expect(r.output).toBe("upload=false\n");
    expect(r.stdout).toContain(
      `::notice::SKIP: run 1 already uploaded ${SHA}. This run uploads nothing and ends green.`
    );
  });

  it("an earlier run uploaded on attempt 1 and skipped on its re-run: skip (#1658 Frank r2)", () => {
    const a = rowOf(l, 1, l.failed);
    const r = runGuard(
      l,
      [{ ...a, attempt: 2, artifacts: rowOf(l, 1, l.built).artifacts }],
      { attempts: { "1#1": fixture(l.built.view) } }
    );
    expect(r.status).toBe(0);
    expect(r.output).toBe("upload=false\n");
    expect(r.stdout).toContain(
      `SKIP: attempt 1 of run 1 already uploaded ${SHA}`
    );
  });

  it("an earlier FAILED or cancelled run at this commit: upload", () => {
    const r = runGuard(l, [rowOf(l, 1, l.failed)]);
    expect(r.status).toBe(0);
    expect(r.output).toBe("upload=true\n");
  });

  it("a re-run after a failed attempt: upload", () => {
    const r = runGuard(l, [], {
      attempt: 2,
      attempts: { [`${ME}#1`]: fixture(l.failed.view) },
    });
    expect(r.output).toBe("upload=true\n");
  });

  it("a different commit's upload on this lane: upload", () => {
    const r = runGuard(l, [rowOf(l, 1, l.built, OTHER_SHA)]);
    expect(r.output).toBe("upload=true\n");
  });

  it(`the other lane's upload at this commit (${other.file}): upload`, () => {
    const r = runGuard(l, [rowOf(other, 1, other.built)]);
    expect(r.output).toBe("upload=true\n");
  });

  it("a history read that fails: the job fails red before any upload", () => {
    const r = runGuard(l, [], { fail: true });
    expect(r.status).toBe(1);
    expect(r.output).toBe("");
    expect(r.stdout).toMatch(/::error::STOP: a read failed/);
  });
});
