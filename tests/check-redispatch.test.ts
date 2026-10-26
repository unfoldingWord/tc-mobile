import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { main, parseArgs, REPO } from "../scripts/check-redispatch.mjs";
import { OPEN_STATUSES } from "../scripts/redispatch-core.mjs";

// The CLI half of #1636: it turns `gh … --json` output into the core's
// input and prints the verdict. The rules are tested in
// tests/redispatch-core.test.ts; this file pins the reads, the output and the
// entry path. Fixtures: tests/fixtures/redispatch/ (each says its source).

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures", "redispatch");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

const RC_SHA = "a87c2f6f1d44d020f096b9cf1b6028853b1121a6";
const PROD_SHA = "d0eb5456ff053bf036984c113d507c6dc98cc33a";

interface World {
  atCommit: unknown;
  prod: Record<string, unknown>;
  views: Record<string, unknown>;
  artifacts: Record<string, unknown>;
  versions: Record<string, string>;
  tip: string;
  open?: Record<string, unknown>;
}

function world(over: Partial<World> = {}): World {
  return {
    atCommit: [
      { databaseId: 37380372475, status: "completed", headSha: RC_SHA },
    ],
    prod: {
      "android-apk.yml": [
        { databaseId: 36948776880, status: "completed", headSha: PROD_SHA },
      ],
      "android-play.yml": [
        { databaseId: 36948498218, status: "completed", headSha: PROD_SHA },
      ],
    },
    views: {
      "37380372475": fixture("apk-cancelled-pending.view"),
      "36948776880": fixture("apk-prod-expired.view"),
      "36948498218": fixture("play-alpha-prod-built.view"),
    },
    artifacts: {
      "37380372475": fixture("apk-prod-expired.artifacts"),
      "36948776880": fixture("apk-prod-expired.artifacts"),
    },
    versions: { [RC_SHA]: "1.1.0-rc.1", [PROD_SHA]: "1.0.1" },
    tip: RC_SHA,
    ...over,
  };
}

/** A stand-in for `gh` that answers the reads the CLI makes, and records them. */
function fakeGh(w: World) {
  const calls: string[][] = [];
  const gh = (args: string[]): string => {
    calls.push(args);
    const flag = (name: string) => args[args.indexOf(name) + 1] ?? "";
    const answer = (): unknown => {
      if (args[0] === "run" && args[1] === "list") {
        const wf = flag("--workflow");
        if (args.includes("--commit")) return w.atCommit;
        if (args.includes("--status")) return w.open?.[flag("--status")] ?? [];
        if (flag("--branch") === "main") return w.prod[wf] ?? [];
      }
      if (args[0] === "run" && args[1] === "view")
        return w.views[args[2] ?? ""];
      if (args[0] === "api") {
        const p = args[1] ?? "";
        const art = /\/actions\/runs\/(\d+)\/artifacts\?per_page=100$/.exec(p);
        if (art) return w.artifacts[art[1] ?? ""];
        const pkg = /\/contents\/package\.json\?ref=([0-9a-f]{40})$/.exec(p);
        if (pkg) {
          const json = JSON.stringify({ version: w.versions[pkg[1] ?? ""] });
          return { content: Buffer.from(json).toString("base64") };
        }
        if (/\/git\/ref\/heads\/(staging|main)$/.test(p)) {
          return { object: { sha: w.tip } };
        }
      }
      throw new Error(`fake gh: no answer for ${args.join(" ")}`);
    };
    const out = answer();
    if (out === undefined)
      throw new Error(`fake gh: nothing for ${args.join(" ")}`);
    return JSON.stringify(out);
  };
  return { gh, calls };
}

function run(argv: string[], w: World) {
  const lines: string[] = [];
  const { gh, calls } = fakeGh(w);
  const status = main(argv, { gh, log: (l) => lines.push(l) });
  return { status, lines, calls };
}

const PRE = ["--lane", "apk", "--sha", RC_SHA];

describe("parseArgs", () => {
  it("reads both flag forms and defaults the branch to staging", () => {
    expect(parseArgs(["--lane=play", `--sha=${RC_SHA}`])).toEqual({
      lane: "play",
      sha: RC_SHA,
      branch: "staging",
      known: null,
      runId: null,
      attempt: null,
    });
    expect(parseArgs([...PRE, "--branch", "main", "--known", "1,2"])).toEqual({
      lane: "apk",
      sha: RC_SHA,
      branch: "main",
      known: [1, 2],
      runId: null,
      attempt: null,
    });
  });

  it.each(["1e2", "1.0", "1,", ",1", "-1", "0x1f", " 1"])(
    "George r1 on #1641: refuses the --known id list %j",
    (known) => {
      expect(() => parseArgs([...PRE, "--known", known])).toThrow(
        "--known must be run ids"
      );
    }
  );

  it("refuses a short sha, an unknown lane or branch, and stray flags", () => {
    expect(() => parseArgs(["--lane", "apk", "--sha", "a87c2f6"])).toThrow(
      "full 40-character"
    );
    expect(() => parseArgs(["--lane", "ios", "--sha", RC_SHA])).toThrow(
      "--lane must be"
    );
    expect(() => parseArgs([...PRE, "--branch", "develop"])).toThrow(
      "--branch must be"
    );
    expect(() => parseArgs([...PRE, "--dispatch"])).toThrow("needs a value");
    expect(() => parseArgs([...PRE, "--dispatch", "yes"])).toThrow(
      "unrecognized argument --dispatch"
    );
    expect(() => parseArgs([...PRE, "--known", "1,x"])).toThrow(
      "--known must be run ids"
    );
  });
});

describe("main: reads through gh and prints one verdict", () => {
  it("prints one line per read and OK to dispatch when the reads allow it", () => {
    const r = run(PRE, world());
    expect(r.status).toBe(0);
    expect(r.lines.at(-1)).toBe(
      "OK to dispatch apk (runs at the commit before: 37380372475)"
    );
    expect(r.lines.slice(0, -1).map((l) => l.split(":")[0])).toEqual([
      `apk at ${RC_SHA.slice(0, 12)}`,
      "apk open",
      "apk production",
      "play production",
      "staging tip",
    ]);
  });

  it("only reads: every call is a run list, a run view or a GET of the API, on this repo", () => {
    const { calls } = run(PRE, world());
    for (const args of calls) {
      const isList = args[0] === "run" && args[1] === "list";
      const isView = args[0] === "run" && args[1] === "view";
      const isApi = args[0] === "api" && args.length === 2;
      expect(isList || isView || isApi, args.join(" ")).toBe(true);
      if (isApi) expect(args[1]?.startsWith(`repos/${REPO}/`)).toBe(true);
      else expect(args[args.indexOf("--repo") + 1]).toBe(REPO);
      if (isList) {
        expect(args[args.indexOf("--limit") + 1]).toBe("100");
      }
    }
    const statuses = calls
      .filter((a) => a.includes("--status"))
      .map((a) => a[a.indexOf("--status") + 1]);
    expect(statuses).toEqual([...OPEN_STATUSES]);
  });

  it("#1640 deferral: prints every stop, then the first as the verdict", () => {
    const r = run(
      PRE,
      world({
        tip: PROD_SHA,
        versions: { [RC_SHA]: "1.0.1-rc.3", [PROD_SHA]: "1.0.1" },
      })
    );
    expect(r.status).toBe(1);
    const stops = r.lines.filter((l) => l.startsWith("stop: "));
    expect(stops).toEqual([
      "stop: production run 36948776880 (apk) is unknown at 1.0.1; no RC for a version with a production build",
      "stop: production run 36948498218 (play) is built at 1.0.1; no RC for a version with a production build",
      `stop: staging tip is ${PROD_SHA}, not ${RC_SHA}`,
    ]);
    expect(r.lines.at(-1)).toBe(`STOP: ${stops[0]?.slice(6)}`);
  });

  it("George r1 on #1641: the --known follow-up reads the tip and stops when it moved", () => {
    const r = run([...PRE, "--known", "37380372475"], world({ tip: PROD_SHA }));
    expect(r.status).toBe(1);
    expect(r.lines.at(-1)).toBe(`STOP: tip is ${PROD_SHA}, not ${RC_SHA}`);
    expect(
      r.calls.some((a) => a[1] === `repos/${REPO}/git/ref/heads/staging`)
    ).toBe(true);
  });

  it("stops on a production build of the RC's version", () => {
    const r = run(
      PRE,
      world({ versions: { [RC_SHA]: "1.0.1-rc.3", [PROD_SHA]: "1.0.1" } })
    );
    expect(r.status).toBe(1);
    expect(r.lines.at(-1)).toMatch(/^STOP: production run 36948776880 \(apk\)/);
  });

  it("does not read production runs or versions for a main dispatch", () => {
    const r = run([...PRE, "--branch", "main"], world({ tip: RC_SHA }));
    expect(r.status).toBe(0);
    expect(r.calls.some((a) => a.includes("--branch"))).toBe(false);
    expect(r.calls.some((a) => a[1]?.includes("contents/package.json"))).toBe(
      false
    );
  });

  it.each([
    ["the runs at the commit", { atCommit: { runs: [] } }],
    ["the production runs", { prod: { "android-play.yml": { runs: [] } } }],
    ["an open-status read", { open: { queued: { runs: [] } } }],
  ])(
    "George r3 on #1641: %s returned as a non-array is a failed read",
    (_, over) => {
      const r = run(PRE, world(over as Partial<World>));
      expect(r.status).toBe(1);
      expect(r.lines.at(-1)).toBe(
        "STOP: a read failed, tell the DRI: gh run list returned something that is not a list"
      );
    }
  );

  it("turns a failed read into a STOP, never an empty list", () => {
    // The stand-in throws, as `gh` exits non-zero, when it has no view.
    const r = run(PRE, world({ views: {} }));
    expect(r.status).toBe(1);
    expect(r.lines.at(-1)).toMatch(/^STOP: a read failed, tell the DRI: /);
  });

  it("refuses a run id that is not a number before passing it on", () => {
    const r = run(
      PRE,
      world({
        atCommit: [{ databaseId: "1 --method POST", status: "completed" }],
      })
    );
    expect(r.lines.at(-1)).toContain("is not a number");
    expect(r.calls.filter((a) => a[1] === "view")).toEqual([]);
  });

  it("returns 2 with a usage line on bad arguments", () => {
    const r = run(["--lane", "apk"], world());
    expect(r).toMatchObject({ status: 2, calls: [] });
    expect(r.lines).toEqual([
      "STOP: usage: --sha must be a full 40-character commit oid",
    ]);
  });

  it("after a dispatch, waits for a new run id and then reports it started", () => {
    const known = ["--known", "37380372475"];
    expect(run([...PRE, ...known], world()).lines.at(-1)).toBe(
      `WAIT: no new apk run at ${RC_SHA} yet`
    );
    const r = run(
      [...PRE, ...known],
      world({
        atCommit: [
          { databaseId: 37380372475, status: "completed", headSha: RC_SHA },
          { databaseId: 6, status: "waiting", headSha: RC_SHA },
        ],
        views: { "6": fixture("apk-waiting-reviewer.view") },
        artifacts: { "6": fixture("apk-prod-expired.artifacts") },
      })
    );
    expect(r.status).toBe(0);
    expect(r.lines.at(-1)).toBe(
      "STARTED: run 6 is started; do not dispatch again"
    );
  });

  it("George r3 on #1641: with no run at the commit, --known= is the follow-up and waits, not a second OK", () => {
    const empty = world({ atCommit: [] });
    expect(run(PRE, empty).lines.at(-1)).toBe("OK to dispatch apk");
    expect(parseArgs([...PRE, "--known="]).known).toEqual([]);
    const r = run([...PRE, "--known="], empty);
    expect(r.status).toBe(1);
    expect(r.lines.at(-1)).toBe(`WAIT: no new apk run at ${RC_SHA} yet`);
    const started = run(
      [...PRE, "--known="],
      world({
        atCommit: [{ databaseId: 6, status: "waiting", headSha: RC_SHA }],
        views: { "6": fixture("apk-waiting-reviewer.view") },
        artifacts: { "6": fixture("apk-prod-expired.artifacts") },
      })
    );
    expect(started.lines.at(-1)).toBe(
      "STARTED: run 6 is started; do not dispatch again"
    );
  });
});

describe("entry path: the real script, run by node from a path with a space", () => {
  // `isMainEntry` compares file URLs; a hand-built comparison once skipped
  // percent-encoding and never ran main() from a spaced path (check-deploy's
  // round-1 Frank F1). The script and the two modules it imports are copied
  // into a spaced directory, and a stand-in `gh` on PATH replays the answers
  // the in-process fake gave for the same argv.
  it("runs main(), reads through gh on PATH, and exits with the verdict", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "redispatch space "));
    try {
      for (const f of [
        "check-redispatch.mjs",
        "redispatch-core.mjs",
        "check-commit-messages.mjs",
      ]) {
        copyFileSync(path.join(ROOT, "scripts", f), path.join(dir, f));
      }
      const answers: Record<string, string> = {};
      const { gh } = fakeGh(world());
      main(PRE, {
        gh: (args) => (answers[args.join("\u0000")] = gh(args)),
        log: () => {},
      });
      writeFileSync(path.join(dir, "answers.json"), JSON.stringify(answers));
      const fake = path.join(dir, "gh");
      writeFileSync(
        fake,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          'const answers = JSON.parse(fs.readFileSync(__dirname + "/answers.json", "utf8"));',
          'const out = answers[process.argv.slice(2).join("\\u0000")];',
          'if (out === undefined) { process.stderr.write("no answer"); process.exit(1); }',
          "process.stdout.write(out);",
        ].join("\n")
      );
      writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
      chmodSync(fake, 0o755);
      const env = {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      };
      const script = path.join(dir, "check-redispatch.mjs");

      const ok = spawnSync(process.execPath, [script, ...PRE], {
        env,
        encoding: "utf8",
      });
      expect(ok.status).toBe(0);
      expect(ok.stdout.trim().split("\n").at(-1)).toBe(
        "OK to dispatch apk (runs at the commit before: 37380372475)"
      );

      const bad = spawnSync(process.execPath, [script, "--lane", "apk"], {
        env,
        encoding: "utf8",
      });
      expect(bad.status).toBe(2);
      expect(bad.stdout).toContain("STOP: usage:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
