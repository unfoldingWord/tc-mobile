import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  afterDispatch,
  classifyRun,
  decide,
  LIST_LIMIT,
  OPEN_STATUSES,
  versionCore,
  type ArtifactList,
  type DecideInput,
  type RunRow,
  type RunView,
} from "../scripts/redispatch-core.mjs";

// #1636: the lane re-dispatch decision, replacing #1613's prose procedure.
// Each finding from #1613's review rounds 1-4 is a case below, named for the
// round that raised it. Fixtures live in tests/fixtures/redispatch/; each
// file's `_source` says whether it is a real `gh` read or a constructed edit
// of one, and what was changed. The versions in the `decide` cases are
// scenario values, not the package.json those commits actually carry.

const DIR = path.join(import.meta.dirname, "fixtures", "redispatch");
const view = (name: string): RunView =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.view.json`), "utf8"));
const arts = (name: string): ArtifactList =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.artifacts.json`), "utf8"));

// Real commits: the one the 2026-10-20 staging push runs built, and the
// `main` commit the fixtures' production runs built.
const RC_SHA = "a87c2f6f1d44d020f096b9cf1b6028853b1121a6";
const PROD_SHA = "d0eb5456ff053bf036984c113d507c6dc98cc33a";

const row = (
  databaseId: number,
  status: string,
  headSha: string,
  headBranch = "staging"
): RunRow => ({ databaseId, status, headSha, headBranch });

describe("classifyRun: one run's token", () => {
  it("real APK staging run with its ordinary artifact is built", () => {
    const r = classifyRun(
      "apk",
      row(39457261742, "completed", RC_SHA),
      view("apk-staging-built"),
      arts("apk-staging-built")
    );
    expect(r.token).toBe("built");
  });

  it("real APK run cancelled while pending (job, no steps) is not built", () => {
    const r = classifyRun(
      "apk",
      row(37380372475, "completed", RC_SHA),
      view("apk-cancelled-pending"),
      arts("apk-prod-expired")
    );
    expect(r.token).toBe("not built");
  });

  it("real iOS run is built; a real skipped signing job is not built", () => {
    const run = row(1, "completed", RC_SHA);
    expect(
      classifyRun("testflight", run, view("ios-built"), undefined).token
    ).toBe("built");
    expect(
      classifyRun("testflight", run, view("ios-job-skipped"), undefined).token
    ).toBe("not built");
  });

  it("Frank r2: the Play job is matched by prefix, (internal) and (alpha) alike", () => {
    const run = row(1, "completed", PROD_SHA, "main");
    expect(
      classifyRun("play", run, view("play-internal-built"), undefined).token
    ).toBe("built");
    expect(
      classifyRun("play", run, view("play-alpha-prod-built"), undefined).token
    ).toBe("built");
  });

  it("Frank r1: a real Play build_only run (upload skipped) is not built", () => {
    const r = classifyRun(
      "play",
      row(36476824983, "completed", RC_SHA),
      view("play-build-only"),
      undefined
    );
    expect(r).toEqual({
      token: "not built",
      reason: '"Upload to Google Play" skipped',
    });
  });

  it("a real Play run that failed before its upload is not built", () => {
    const r = classifyRun(
      "play",
      row(36581999554, "completed", RC_SHA),
      view("play-failed-before-upload"),
      undefined
    );
    expect(r.token).toBe("not built");
  });

  it("Frank r3: a failed Play run whose upload step succeeded is built", () => {
    const r = classifyRun(
      "play",
      row(1, "completed", PROD_SHA, "main"),
      view("play-upload-then-artifact-failed"),
      undefined
    );
    expect(r.token).toBe("built");
  });

  it('Frank r4: an empty-string step conclusion on an open run is started, never "not built"', () => {
    const r = classifyRun(
      "play",
      row(1, "in_progress", PROD_SHA, "main"),
      view("play-alpha-in-progress-empty"),
      undefined
    );
    expect(r.token).toBe("started");
  });

  it("a null step conclusion on an open run is started", () => {
    const r = classifyRun(
      "play",
      row(1, "in_progress", PROD_SHA, "main"),
      view("play-alpha-in-progress-null"),
      undefined
    );
    expect(r.token).toBe("started");
  });

  it('an empty-string step conclusion on a completed run is unknown, never "not built"', () => {
    const r = classifyRun(
      "apk",
      row(1, "completed", RC_SHA),
      view("apk-in-progress-empty"),
      arts("apk-staging-built")
    );
    expect(r.token).toBe("unknown");
  });

  it("a signing job waiting on its reviewer, with no steps, is started", () => {
    const r = classifyRun(
      "apk",
      row(1, "waiting", RC_SHA),
      view("apk-waiting-reviewer"),
      undefined
    );
    expect(r.token).toBe("started");
  });

  it("two matching jobs are a fatal stop", () => {
    const r = classifyRun(
      "apk",
      row(1, "completed", RC_SHA),
      view("apk-two-jobs"),
      arts("apk-staging-built")
    );
    expect(r).toMatchObject({ token: "unknown", fatal: true });
    expect(r.reason).toContain("has 2 jobs");
  });

  it("a renamed job (no match) is a fatal stop", () => {
    const r = classifyRun(
      "apk",
      row(1, "completed", RC_SHA),
      view("apk-job-renamed"),
      arts("apk-staging-built")
    );
    expect(r).toMatchObject({ token: "unknown", fatal: true });
    expect(r.reason).toContain("has 0 jobs");
  });

  it("George r4: a renamed completion step on a job with steps is a fatal stop, not not built", () => {
    const r = classifyRun(
      "apk",
      row(1, "completed", RC_SHA),
      view("apk-step-renamed"),
      arts("apk-staging-built")
    );
    expect(r).toMatchObject({ token: "unknown", fatal: true });
  });

  it("a diagnostic-only APK is not built", () => {
    const r = classifyRun(
      "apk",
      row(1, "completed", RC_SHA),
      view("apk-staging-built"),
      arts("apk-diagnostic")
    );
    expect(r.token).toBe("not built");
  });

  it("George r3: the APK artifact is named by the judged run's own headSha", () => {
    const prodRun = row(36948776880, "completed", PROD_SHA, "main");
    expect(
      classifyRun(
        "apk",
        prodRun,
        view("apk-prod-expired"),
        arts("apk-prod-ordinary")
      ).token
    ).toBe("built");
    // The same listing judged as a run at the RC commit holds no artifact of it.
    expect(
      classifyRun(
        "apk",
        row(1, "completed", RC_SHA),
        view("apk-prod-expired"),
        arts("apk-prod-ordinary")
      ).token
    ).toBe("not built");
  });

  it("a real expired APK listing on a completed run is unknown", () => {
    const r = classifyRun(
      "apk",
      row(36948776880, "completed", PROD_SHA, "main"),
      view("apk-prod-expired"),
      arts("apk-prod-expired")
    );
    expect(r.token).toBe("unknown");
    expect(r.fatal).toBeUndefined();
  });

  it("a missing or cut APK artifact listing is a fatal stop", () => {
    const run = row(1, "completed", RC_SHA);
    expect(
      classifyRun("apk", run, view("apk-staging-built"), undefined)
    ).toMatchObject({ fatal: true });
    expect(
      classifyRun(
        "apk",
        run,
        view("apk-staging-built"),
        arts("apk-artifacts-cut")
      )
    ).toMatchObject({ fatal: true });
  });

  it("a missing run view is a fatal stop", () => {
    expect(
      classifyRun("play", row(1, "completed", RC_SHA), undefined, undefined)
    ).toMatchObject({ fatal: true });
  });

  // George #1640 r1 finding 1: "not built" only on positive evidence.
  it.each([["success"], [""], [null]])(
    "George #1640 r1: a completed job with no steps and conclusion %j is a fatal stop, not not built",
    (conclusion) => {
      const v: RunView = {
        jobs: [{ name: "Build release APK", conclusion, steps: [] }],
      };
      expect(
        classifyRun("apk", row(1, "completed", RC_SHA), v, undefined)
      ).toMatchObject({ token: "unknown", fatal: true });
    }
  );

  it("George #1640 r1: an APK run with no full headSha is a fatal stop", () => {
    for (const headSha of [undefined, "", RC_SHA.slice(0, 12)]) {
      expect(
        classifyRun(
          "apk",
          { databaseId: 1, status: "completed", headSha },
          view("apk-staging-built"),
          arts("apk-staging-built")
        )
      ).toMatchObject({ token: "unknown", fatal: true });
    }
  });

  it("George #1640 r1: an artifact entry without a string name is a fatal stop", () => {
    const listing = {
      total_count: 1,
      artifacts: [{} as { name: string }],
    };
    expect(
      classifyRun(
        "apk",
        row(1, "completed", RC_SHA),
        view("apk-staging-built"),
        listing
      )
    ).toMatchObject({ token: "unknown", fatal: true });
  });

  it("George #1640 r1: an unknown lane is a fatal stop, not a throw", () => {
    expect(
      classifyRun(
        "APK" as never,
        row(1, "completed", RC_SHA),
        view("apk-staging-built"),
        arts("apk-staging-built")
      )
    ).toMatchObject({ token: "unknown", fatal: true });
  });
});

describe("versionCore: -rc.N stripped in code", () => {
  it("strips the suffix and leaves a release alone", () => {
    expect(versionCore("1.2.0-rc.3")).toBe("1.2.0");
    expect(versionCore("1.2.0")).toBe("1.2.0");
  });

  it("throws on any other shape rather than compare it", () => {
    expect(() => versionCore("1.2.0-beta.1")).toThrow(/unexpected version/);
    expect(() => versionCore(undefined)).toThrow(/unexpected version/);
  });
});

/** A staging RC dispatch of the APK lane that should be allowed. */
function clean(over: Partial<DecideInput> = {}): DecideInput {
  return {
    lane: "apk",
    sha: RC_SHA,
    branch: "staging",
    laneRuns: [row(37380372475, "completed", RC_SHA)],
    openRuns: Object.fromEntries(OPEN_STATUSES.map((s) => [s, []])),
    prodRuns: {
      apk: [row(36948776880, "completed", PROD_SHA, "main")],
      play: [row(36948498218, "completed", PROD_SHA, "main")],
    },
    views: {
      37380372475: view("apk-cancelled-pending"),
      36948776880: view("apk-prod-expired"),
      36948498218: view("play-alpha-prod-built"),
    },
    artifacts: {
      37380372475: arts("apk-prod-expired"),
      36948776880: arts("apk-prod-expired"),
    },
    versions: { [RC_SHA]: "1.1.0-rc.1", [PROD_SHA]: "1.0.1" },
    tip: RC_SHA,
    ...over,
  };
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => row(i + 1, "completed", RC_SHA));

describe("decide: the pre-dispatch verdict", () => {
  it("allows a dispatch when every read is clean, and lists the runs already there", () => {
    const r = decide(clean());
    expect(r.ok).toBe(true);
    expect(r.reason).toBe(
      "OK to dispatch apk (runs at the commit before: 37380372475)"
    );
  });

  it("stops when a run at the commit already built it", () => {
    const r = decide(
      clean({
        laneRuns: [row(39457261742, "completed", RC_SHA)],
        views: { ...clean().views, 39457261742: view("apk-staging-built") },
        artifacts: {
          ...clean().artifacts,
          39457261742: arts("apk-staging-built"),
        },
      })
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("already built");
  });

  it("stops when a run at the commit has started (waiting on its reviewer)", () => {
    const r = decide(
      clean({
        laneRuns: [row(5, "waiting", RC_SHA)],
        views: { ...clean().views, 5: view("apk-waiting-reviewer") },
      })
    );
    expect(r.reason).toContain("do not dispatch a second");
  });

  it("stops when the lane has an open run on another branch", () => {
    const openRuns = clean().openRuns ?? {};
    const r = decide(
      clean({
        openRuns: {
          ...openRuns,
          in_progress: [row(9, "in_progress", PROD_SHA, "main")],
        },
      })
    );
    expect(r.reason).toContain("has an open run (9)");
  });

  it("stops when the tip moved", () => {
    const r = decide(clean({ tip: PROD_SHA }));
    expect(r.reason).toBe(`staging tip is ${PROD_SHA}, not ${RC_SHA}`);
  });

  it("stops on a read of exactly the row limit, for A, D and F", () => {
    expect(decide(clean({ laneRuns: rows(LIST_LIMIT) })).reason).toContain(
      "may be cut"
    );
    const openRuns = { ...(clean().openRuns ?? {}), queued: rows(LIST_LIMIT) };
    expect(decide(clean({ openRuns })).reason).toContain("may be cut");
    const prodRuns = { ...clean().prodRuns, play: rows(LIST_LIMIT) };
    expect(decide(clean({ prodRuns })).reason).toContain("may be cut");
  });

  it("stops when a list read is missing", () => {
    expect(decide(clean({ laneRuns: undefined })).ok).toBe(false);
  });

  describe("never an RC after production (DRI, 2026-10-22)", () => {
    it("stops on a built production run of the same version, rc stripped on the RC side", () => {
      const r = decide(
        clean({
          prodRuns: { apk: [], play: clean().prodRuns?.play },
          versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
        })
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(
        "production run 36948498218 (play) is built at 1.0.1"
      );
    });

    it("George r4: strips -rc.N on the production side too", () => {
      const r = decide(
        clean({
          prodRuns: { apk: [], play: clean().prodRuns?.play },
          versions: { [RC_SHA]: "1.0.1-rc.2", [PROD_SHA]: "1.0.1-rc.2" },
        })
      );
      expect(r.reason).toContain("is built at 1.0.1");
    });

    it("an unknown (expired) production APK of the same version stops", () => {
      const r = decide(
        clean({
          prodRuns: { apk: clean().prodRuns?.apk, play: [] },
          versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
        })
      );
      expect(r.reason).toContain("(apk) is unknown at 1.0.1");
    });

    it("George r4: an in-progress production run on the OTHER Android lane stops, judged by its own list status", () => {
      const r = decide(
        clean({
          prodRuns: {
            apk: [],
            play: [row(77, "in_progress", PROD_SHA, "main")],
          },
          views: { ...clean().views, 77: view("play-alpha-in-progress-empty") },
          versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
        })
      );
      expect(r.reason).toContain(
        "production run 77 (play) is started at 1.0.1"
      );
    });

    it("Frank r3: a production run that failed after its upload succeeded stops", () => {
      const r = decide(
        clean({
          prodRuns: { apk: [], play: [row(78, "completed", PROD_SHA, "main")] },
          views: {
            ...clean().views,
            78: view("play-upload-then-artifact-failed"),
          },
          versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
        })
      );
      expect(r.reason).toContain("production run 78 (play) is built");
    });

    it("a production build_only run of the same version does not stop", () => {
      const r = decide(
        clean({
          prodRuns: { apk: [], play: [row(79, "completed", PROD_SHA, "main")] },
          views: { ...clean().views, 79: view("play-build-only") },
          versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
        })
      );
      expect(r.ok).toBe(true);
    });

    it("a production run with two matching jobs stops whatever its version", () => {
      const r = decide(
        clean({
          prodRuns: { apk: [row(80, "completed", PROD_SHA, "main")], play: [] },
          views: { ...clean().views, 80: view("apk-two-jobs") },
          artifacts: { ...clean().artifacts, 80: arts("apk-prod-ordinary") },
        })
      );
      expect(r.reason).toContain("has 2 jobs");
    });

    it("stops when a version cannot be read, on either side", () => {
      expect(
        decide(clean({ versions: { [PROD_SHA]: "1.0.1" } })).reason
      ).toContain(`version at ${RC_SHA}`);
      expect(
        decide(clean({ versions: { [RC_SHA]: "1.1.0-rc.1" } })).reason
      ).toContain(`version at ${PROD_SHA}`);
    });

    it("is not applied to a production (main) dispatch", () => {
      const r = decide(
        clean({ branch: "main", prodRuns: undefined, versions: undefined })
      );
      expect(r.ok).toBe(true);
    });

    it("George #1640 r1: a branch other than exactly staging or main stops, so the rule cannot be skipped", () => {
      const sameVersion = {
        prodRuns: { apk: [], play: clean().prodRuns?.play },
        versions: { [RC_SHA]: "1.0.1-rc.4", [PROD_SHA]: "1.0.1" },
      };
      expect(decide(clean(sameVersion)).ok).toBe(false);
      const r = decide(clean({ ...sameVersion, branch: "Staging" as never }));
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("branch");
    });
  });

  it("George #1640 r1: an unknown lane stops, with empty lists or with runs", () => {
    const empty = decide(
      clean({ lane: "APK" as never, branch: "main", laneRuns: [] })
    );
    expect(empty.ok).toBe(false);
    expect(empty.reason).toContain("lane");
    expect(decide(clean({ lane: "APK" as never, branch: "main" })).ok).toBe(
      false
    );
  });
});

describe("afterDispatch: only a run id not seen before the dispatch counts", () => {
  const base = {
    lane: "apk" as const,
    sha: RC_SHA,
    known: [37380372475],
    views: { 37380372475: view("apk-cancelled-pending") },
    artifacts: {},
  };

  it("George r4 (step 4): an older not-built run is not the dispatch's verdict; wait", () => {
    const r = afterDispatch({
      ...base,
      laneRuns: [row(37380372475, "completed", RC_SHA)],
    });
    expect(r.state).toBe("wait");
  });

  it("a new run waiting on its reviewer has started", () => {
    const r = afterDispatch({
      ...base,
      laneRuns: [
        row(37380372475, "completed", RC_SHA),
        row(6, "waiting", RC_SHA),
      ],
      views: { ...base.views, 6: view("apk-waiting-reviewer") },
    });
    expect(r.state).toBe("started");
  });

  it("a new run cancelled while pending sends the DRI back to the pre-dispatch check", () => {
    const r = afterDispatch({
      ...base,
      laneRuns: [row(7, "completed", RC_SHA)],
      views: { 7: view("apk-cancelled-pending") },
    });
    expect(r.state).toBe("stop");
    expect(r.reason).toContain("run the pre-dispatch check again");
  });

  it("stops on a read of exactly the row limit", () => {
    expect(afterDispatch({ ...base, laneRuns: rows(LIST_LIMIT) }).state).toBe(
      "stop"
    );
  });

  it("George #1640 r1: stops, not throws, when known is not a list or the lane is unknown", () => {
    expect(
      afterDispatch({ ...base, known: undefined as never, laneRuns: [] }).state
    ).toBe("stop");
    expect(
      afterDispatch({ ...base, lane: "APK" as never, laneRuns: [] }).state
    ).toBe("stop");
  });
});
