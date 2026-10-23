import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../scripts/check-redispatch.mjs";
import {
  guardUpload,
  LIST_LIMIT,
  type ArtifactList,
  type GuardInput,
  type Lane,
  type RunRow,
  type RunView,
} from "../scripts/redispatch-core.mjs";

// #1616: the pre-upload guard. Inside each native lane's upload job (which
// holds the lane's concurrency group), a step asks whether a run of THIS lane
// at THIS commit already uploaded. The answer comes from the same
// `classifyRun` that `npm run check:redispatch` uses (#1636), so a run the
// re-dispatch check calls `built` is the run the guard skips for. Both
// states (AGENTS.md "A gate is tested in both states"): an earlier upload
// skips; an earlier failed or cancelled run, a different commit and the
// other lane all upload. Fixtures: tests/fixtures/redispatch/ (each says its
// source).

const DIR = path.join(import.meta.dirname, "fixtures", "redispatch");
const view = (name: string): RunView =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.view.json`), "utf8"));
const arts = (name: string): ArtifactList =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.artifacts.json`), "utf8"));

// The commit the real 2026-10-20 staging fixtures built.
const SHA = "a87c2f6f1d44d020f096b9cf1b6028853b1121a6";
const OTHER_SHA = "d0eb5456ff053bf036984c113d507c6dc98cc33a";
const ME = 5000;

const row = (databaseId: number, status = "completed", headSha = SHA) => ({
  databaseId,
  status,
  headSha,
  headBranch: "staging",
});

/** A lane's real "uploaded" read, and a real "did not upload" one. */
const BUILT: Record<Lane, { view: RunView; artifacts?: ArtifactList }> = {
  apk: {
    view: view("apk-staging-built"),
    artifacts: arts("apk-staging-built"),
  },
  play: { view: view("play-internal-built") },
  testflight: { view: view("ios-built") },
};
const FAILED: Record<Lane, { view: RunView; artifacts?: ArtifactList }> = {
  apk: {
    view: view("apk-cancelled-pending"),
    artifacts: arts("apk-prod-expired"),
  },
  play: { view: view("play-failed-before-upload") },
  testflight: { view: view("ios-job-skipped") },
};

/** This run's own row: open, its upload job the one running now. */
const MINE: RunRow = row(ME, "in_progress");

function input(
  lane: Lane,
  others: Array<{ id: number; read: (typeof BUILT)[Lane]; sha?: string }>,
  over: Partial<GuardInput> = {}
): GuardInput {
  const views: Record<number, RunView> = {};
  const artifacts: Record<number, ArtifactList | undefined> = {};
  for (const o of others) {
    views[o.id] = o.read.view;
    artifacts[o.id] = o.read.artifacts;
  }
  const base: GuardInput = {
    lane,
    sha: SHA,
    runId: ME,
    attempt: 1,
    laneRuns: [MINE, ...others.map((o) => row(o.id, "completed", o.sha))],
    views,
    artifacts,
    priorAttempts: [],
    otherAttempts: {},
    ...over,
  };
  // Unless a case says otherwise, every other run is on its first attempt.
  if (!over.otherAttempts && Array.isArray(base.laneRuns)) {
    for (const r of base.laneRuns as RunRow[]) {
      if (r.databaseId !== ME)
        base.otherAttempts[r.databaseId] = { attempt: 1, views: [] };
    }
  }
  return base;
}

const LANES: Lane[] = ["apk", "play", "testflight"];

describe.each(LANES)("guardUpload, %s lane", (lane) => {
  it("skips when an earlier run of this lane at this commit uploaded", () => {
    const r = guardUpload(input(lane, [{ id: 1, read: BUILT[lane] }]));
    expect(r.decision).toBe("skip");
    expect(r.reason).toBe(`run 1 already uploaded ${SHA}`);
  });

  it("uploads when the earlier run at this commit failed or was cancelled", () => {
    const r = guardUpload(input(lane, [{ id: 1, read: FAILED[lane] }]));
    expect(r.decision).toBe("upload");
  });

  it("uploads when no other run of this lane is at this commit", () => {
    expect(guardUpload(input(lane, [])).decision).toBe("upload");
  });

  it("a re-run of a FAILED run uploads: its earlier attempt did not", () => {
    const r = guardUpload(
      input(lane, [], {
        attempt: 2,
        priorAttempts: [{ attempt: 1, view: FAILED[lane].view }],
        artifacts: { [ME]: FAILED[lane].artifacts },
      })
    );
    expect(r.decision).toBe("upload");
  });

  it("a re-run of a run that uploaded skips", () => {
    const r = guardUpload(
      input(lane, [], {
        attempt: 2,
        priorAttempts: [{ attempt: 1, view: BUILT[lane].view }],
        artifacts: { [ME]: BUILT[lane].artifacts },
      })
    );
    expect(r).toMatchObject({
      decision: "skip",
      reason: `attempt 1 of this run already uploaded ${SHA}`,
    });
  });

  it("upload, then a re-run that skipped, then a new dispatch: still skips (#1658 Frank r2)", () => {
    // Run 1's latest attempt skipped its upload, so its latest view reads
    // "not built"; its first attempt is the one that uploaded.
    const r = guardUpload(
      input(lane, [{ id: 1, read: FAILED[lane] }], {
        artifacts: { 1: BUILT[lane].artifacts },
        otherAttempts: {
          1: { attempt: 2, views: [{ attempt: 1, view: BUILT[lane].view }] },
        },
      })
    );
    expect(r).toMatchObject({
      decision: "skip",
      reason: `attempt 1 of run 1 already uploaded ${SHA}`,
    });
  });

  it("another run's earlier FAILED attempt and its latest not built: upload", () => {
    const r = guardUpload(
      input(lane, [{ id: 1, read: FAILED[lane] }], {
        otherAttempts: {
          1: { attempt: 2, views: [{ attempt: 1, view: FAILED[lane].view }] },
        },
      })
    );
    expect(r.decision).toBe("upload");
  });

  it("an open re-run of a run that uploaded, still waiting for its upload job: skip", () => {
    const r = guardUpload(
      input(lane, [], {
        laneRuns: [MINE, row(2, "queued")],
        views: { 2: { jobs: [] } },
        artifacts: { 2: BUILT[lane].artifacts },
        otherAttempts: {
          2: { attempt: 2, views: [{ attempt: 1, view: BUILT[lane].view }] },
        },
      })
    );
    expect(r.decision).toBe("skip");
  });

  it("an open run at this commit that has not reached its upload job does not block", () => {
    // It waits behind this job's group; the guard in ITS upload job sees
    // this run's result when its turn comes.
    for (const jobs of [[], [{ name: "Preflight", status: "completed" }]]) {
      const r = guardUpload(
        input(lane, [], {
          laneRuns: [MINE, row(2, "queued")],
          views: { 2: { jobs } },
        })
      );
      expect(r.decision).toBe("upload");
    }
  });
});

describe("guardUpload: the legitimate neighbours", () => {
  it("a different commit's upload does not block (a row at another commit is a stop, not a skip)", () => {
    // The read is filtered by commit, so another commit never reaches the
    // guard; a row that does means the read is not what the guard assumes.
    const r = guardUpload(
      input("play", [{ id: 1, read: BUILT.play, sha: OTHER_SHA }])
    );
    expect(r.decision).toBe("stop");
    expect(r.reason).toBe(`run 1 is at ${OTHER_SHA}, not ${SHA}`);
  });

  it("the other lane's upload is never read: its runs are another workflow", () => {
    // A Play run that uploaded, fed to the APK lane, has no APK job.
    const r = guardUpload(input("apk", [{ id: 1, read: BUILT.play }]));
    expect(r.decision).toBe("stop");
  });
});

describe("guardUpload: anything the reads cannot settle stops (redispatch-core's rule)", () => {
  it("stops on a cut read", () => {
    const rows = Array.from({ length: LIST_LIMIT }, (_, i) => row(i + 1));
    expect(
      guardUpload(input("play", [], { laneRuns: [MINE, ...rows] })).decision
    ).toBe("stop");
  });

  it("stops when the list read is not a list", () => {
    expect(
      guardUpload(input("play", [], { laneRuns: { message: "Not Found" } }))
        .decision
    ).toBe("stop");
  });

  it("stops when this run is missing from its own read", () => {
    expect(guardUpload(input("play", [], { laneRuns: [] })).reason).toBe(
      `this run (${ME}) is not in the read at ${SHA}`
    );
  });

  it("stops when an earlier attempt is missing", () => {
    const r = guardUpload(input("testflight", [], { attempt: 3 }));
    expect(r).toMatchObject({ decision: "stop" });
  });

  it("stops when another run's attempt count, or one of its earlier attempts, was not read", () => {
    const missing = guardUpload(
      input("play", [{ id: 1, read: FAILED.play }], { otherAttempts: {} })
    );
    expect(missing.reason).toBe("run 1's attempt count was not read");
    const gap = guardUpload(
      input("play", [{ id: 1, read: FAILED.play }], {
        otherAttempts: { 1: { attempt: 3, views: [] } },
      })
    );
    expect(gap.decision).toBe("stop");
    expect(gap.reason).toBe("attempt 1 of run 1 was not read");
  });

  it("stops when another run's upload job is running beside this one", () => {
    const running = structuredClone(view("play-internal-built"));
    for (const j of running.jobs ?? []) j.status = "in_progress";
    const r = guardUpload(
      input("play", [], {
        laneRuns: [MINE, row(2, "in_progress")],
        views: { 2: running },
      })
    );
    expect(r.decision).toBe("stop");
  });

  it("an APK run whose job finished but whose artifact is not listed yet is unknown, so a stop", () => {
    const r = guardUpload(
      input("apk", [], {
        laneRuns: [MINE, row(2, "in_progress")],
        views: { 2: view("apk-staging-built") },
        artifacts: { 2: { total_count: 0, artifacts: [] } },
      })
    );
    expect(r.decision).toBe("stop");
  });

  it("a stop outranks a skip: the job fails red rather than reading half the history", () => {
    const r = guardUpload(
      input("play", [{ id: 1, read: BUILT.play }], { attempt: 2 })
    );
    expect(r.decision).toBe("stop");
  });
});

/** A stand-in for `gh`: the guard's reads only, recorded. */
function fakeGh(w: {
  runs: unknown;
  views: Record<string, unknown>;
  attempts?: Record<string, unknown>;
  runAttempts?: Record<string, number>;
  artifacts?: Record<string, unknown>;
  fail?: boolean;
}) {
  const calls: string[][] = [];
  const gh = (args: string[]): string => {
    calls.push(args);
    if (w.fail) throw Object.assign(new Error("x"), { stderr: "HTTP 502" });
    const flag = (name: string) => args[args.indexOf(name) + 1] ?? "";
    if (args[0] === "run" && args[1] === "list") return JSON.stringify(w.runs);
    if (args[0] === "run" && args[1] === "view") {
      const id = args[2] ?? "";
      if (flag("--json") === "attempt")
        return JSON.stringify({ attempt: w.runAttempts?.[id] ?? 1 });
      if (args.includes("--attempt"))
        return JSON.stringify(w.attempts?.[`${id}#${flag("--attempt")}`]);
      return JSON.stringify(w.views[id]);
    }
    if (args[0] === "api" && (args[1] ?? "").includes("/artifacts"))
      return JSON.stringify(w.artifacts?.[(args[1] ?? "").split("/")[4] ?? ""]);
    if (args[0] === "api" && (args[1] ?? "").includes("/git/ref/heads/"))
      return JSON.stringify({ object: { sha: SHA } });
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls };
}

const GUARD_ARGS = (lane: Lane, attempt = 1) => [
  "--lane",
  lane,
  "--sha",
  SHA,
  "--run-id",
  String(ME),
  "--attempt",
  String(attempt),
];

describe("check:redispatch --run-id: the CLI the upload job runs", () => {
  it("prints SKIP and exits 3 when an earlier run uploaded", () => {
    const { gh, calls } = fakeGh({
      runs: [row(ME, "in_progress"), row(1)],
      views: { [ME]: { jobs: [] }, 1: view("ios-built") },
    });
    const log: string[] = [];
    expect(
      main(GUARD_ARGS("testflight"), { gh, log: (l) => log.push(l) })
    ).toBe(3);
    expect(log.at(-1)).toBe(`SKIP: run 1 already uploaded ${SHA}`);
    // The lane's own workflow, filtered by this commit: never another lane.
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        "--workflow",
        "ios-testflight.yml",
        "--commit",
        SHA,
      ])
    );
  });

  it("prints UPLOAD and exits 0 after a failed run", () => {
    const { gh } = fakeGh({
      runs: [row(ME, "in_progress"), row(1)],
      views: { [ME]: { jobs: [] }, 1: view("play-failed-before-upload") },
    });
    const log: string[] = [];
    expect(main(GUARD_ARGS("play"), { gh, log: (l) => log.push(l) })).toBe(0);
    expect(log.at(-1)).toMatch(/^UPLOAD: /);
  });

  it("reads each earlier attempt of this run on a re-run", () => {
    const { gh, calls } = fakeGh({
      runs: [row(ME, "in_progress")],
      views: { [ME]: { jobs: [] } },
      attempts: { [`${ME}#1`]: view("play-failed-before-upload") },
    });
    const log: string[] = [];
    expect(main(GUARD_ARGS("play", 2), { gh, log: (l) => log.push(l) })).toBe(
      0
    );
    expect(calls).toContainEqual(
      expect.arrayContaining(["view", String(ME), "--attempt", "1"])
    );
  });

  it("reads each earlier attempt of another run, and skips for one that uploaded", () => {
    const { gh, calls } = fakeGh({
      runs: [row(ME, "in_progress"), row(1)],
      views: { [ME]: { jobs: [] }, 1: view("play-failed-before-upload") },
      runAttempts: { 1: 2 },
      attempts: { "1#1": view("play-internal-built") },
    });
    const log: string[] = [];
    expect(main(GUARD_ARGS("play"), { gh, log: (l) => log.push(l) })).toBe(3);
    expect(log.at(-1)).toBe(
      `SKIP: attempt 1 of run 1 already uploaded ${SHA}`
    );
    expect(calls).toContainEqual(
      expect.arrayContaining(["view", "1", "--attempt", "1"])
    );
  });

  it("refuses a --run-id that is not a safe integer", () => {
    const log: string[] = [];
    const args = GUARD_ARGS("apk");
    args[args.indexOf("--run-id") + 1] = "99999999999999999999";
    expect(main(args, { log: (l) => log.push(l) })).toBe(2);
    expect(log.at(-1)).toBe("STOP: usage: --run-id must be a run id");
  });

  it("prints STOP and exits 1 when a read fails", () => {
    const { gh } = fakeGh({ runs: [], views: {}, fail: true });
    const log: string[] = [];
    expect(main(GUARD_ARGS("apk"), { gh, log: (l) => log.push(l) })).toBe(1);
    expect(log.at(-1)).toMatch(/^STOP: a read failed/);
  });

  it("refuses --run-id beside --known", () => {
    const log: string[] = [];
    expect(
      main([...GUARD_ARGS("apk"), "--known=1"], { log: (l) => log.push(l) })
    ).toBe(2);
  });
});
