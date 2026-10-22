/**
 * The pure core of the lane re-dispatch check (#1636, replacing #1613's
 * prose procedure). It takes parsed `gh … --json` output and decides; it
 * reads nothing and runs nothing, so tests drive it with fixture files.
 *
 * A run is `built`, `not built`, `started` or `unknown`, judged from its own
 * list `status`, the completion step of its one matching job, and on the APK
 * lane its artifact names. The run's own `conclusion` is never read: a run
 * whose job was skipped, a diagnostic APK and a Play `build_only` run all
 * conclude `success` without being a build. Anything the reads cannot settle
 * is a stop, never a guess. Dispatch stays the DRI's, human-only.
 */

/** Every list read passes this; a read that returns this many rows may be cut. */
export const LIST_LIMIT = 100;

/** `gh run list --status` values for a run that has not completed. */
export const OPEN_STATUSES = [
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
  "action_required",
];

/**
 * Per lane: the workflow file, the signing job's name prefix (the Play job
 * carries its track, `(internal)` or `(alpha)`), and the step whose success
 * means the build happened. Names are the workflows' own `name:` values.
 */
export const LANES = {
  apk: {
    workflow: "android-apk.yml",
    job: "Build release APK",
    step: "Build the release APK",
  },
  play: {
    workflow: "android-play.yml",
    job: "Build .aab and upload to Play",
    step: "Upload to Google Play",
  },
  testflight: {
    workflow: "ios-testflight.yml",
    job: "Build and upload to TestFlight",
    step: "Archive and upload to TestFlight",
  },
};

/** Lanes whose production runs block an RC of the same version (#1636). */
export const ANDROID_LANES = ["apk", "play"];

const RC_SUFFIX = /-rc\.\d+$/;
const VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/;

/** `1.2.0-rc.3` and `1.2.0` both give `1.2.0`; any other shape throws. */
export function versionCore(version) {
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new Error(`unexpected version ${JSON.stringify(version)}`);
  }
  return version.replace(RC_SUFFIX, "");
}

const fatal = (reason) => ({ token: "unknown", reason, fatal: true });

/** Job conclusions that say, with no step run, that the build did not happen. */
const NO_BUILD = new Set(["skipped", "cancelled", "failure", "timed_out"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const BRANCHES = ["staging", "main"];
const isLane = (lane) => typeof lane === "string" && Object.hasOwn(LANES, lane);

/** A step with no conclusion yet: GitHub sends `""` or `null` (#1613 r4). */
function unfinished(step) {
  return (
    step.conclusion === null ||
    step.conclusion === undefined ||
    step.conclusion === ""
  );
}

/**
 * One run's token. `run` is its row from the list read that returned it
 * (`databaseId`, `status`, `headSha`); `view` is `gh run view --json jobs`;
 * `artifacts` is the artifacts API response (APK lane). `fatal` marks a stop
 * whatever the run's version.
 */
export function classifyRun(lane, run, view, artifacts) {
  if (!isLane(lane)) return fatal(`unknown lane ${JSON.stringify(lane)}`);
  const spec = LANES[lane];
  const open = run.status !== "completed";
  if (!view || !Array.isArray(view.jobs)) {
    return fatal(`no job list for run ${run.databaseId}`);
  }
  const jobs = view.jobs.filter(
    (j) => typeof j.name === "string" && j.name.startsWith(spec.job)
  );
  if (jobs.length !== 1) {
    return fatal(
      `run ${run.databaseId} has ${jobs.length} jobs named "${spec.job}…", not 1`
    );
  }
  const steps = jobs[0].steps ?? [];
  const matches = steps.filter((s) => s.name === spec.step);
  if (matches.length > 1) {
    return fatal(
      `run ${run.databaseId} has ${matches.length} "${spec.step}" steps`
    );
  }
  const step = matches[0];
  if (!step) {
    if (open)
      return { token: "started", reason: "job has not reached its steps" };
    // Only a job that says it never ran is "not built"; a success, blank or
    // null conclusion with no steps is a gap in the read, so it stops.
    if (steps.length === 0 && NO_BUILD.has(jobs[0].conclusion)) {
      return {
        token: "not built",
        reason: `job ${jobs[0].conclusion} before any step`,
      };
    }
    return fatal(
      `run ${run.databaseId}'s job has no usable "${spec.step}" (conclusion ${JSON.stringify(jobs[0].conclusion)}, ${steps.length} steps)`
    );
  }
  if (unfinished(step)) {
    if (open)
      return { token: "started", reason: `"${spec.step}" not finished` };
    return {
      token: "unknown",
      reason: `run ${run.databaseId} completed with "${spec.step}" unfinished`,
    };
  }
  // `not built` needs a finished non-success STRING (#1640 George r1 (a)).
  if (typeof step.conclusion !== "string") {
    return fatal(
      `run ${run.databaseId}: "${spec.step}" conclusion is not a string`
    );
  }
  if (step.conclusion !== "success") {
    return { token: "not built", reason: `"${spec.step}" ${step.conclusion}` };
  }
  if (lane !== "apk")
    return { token: "built", reason: `"${spec.step}" success` };
  return classifyApkArtifacts(run, artifacts);
}

function classifyApkArtifacts(run, artifacts) {
  if (!artifacts || !Array.isArray(artifacts.artifacts)) {
    return fatal(`no artifact listing for run ${run.databaseId}`);
  }
  if (artifacts.total_count !== artifacts.artifacts.length) {
    return fatal(`artifact listing for run ${run.databaseId} is cut`);
  }
  // Without the run's full sha, or with a nameless entry, a listing that holds
  // the real APK would read as "not built".
  if (typeof run.headSha !== "string" || !FULL_SHA.test(run.headSha)) {
    return fatal(`run ${run.databaseId} has no full headSha`);
  }
  if (artifacts.artifacts.some((a) => !a || typeof a.name !== "string")) {
    return fatal(`artifact entry without a name on run ${run.databaseId}`);
  }
  const names = artifacts.artifacts.map((a) => a.name);
  if (names.length === 0) {
    // Retention is 14 days, so an empty list on a finished run cannot tell an
    // ordinary APK from a diagnostic one.
    if (run.status !== "completed")
      return { token: "started", reason: "APK built, not yet uploaded" };
    return {
      token: "unknown",
      reason: `run ${run.databaseId}: APK step succeeded, artifact listing empty`,
    };
  }
  // The run's OWN commit: a production run is judged by its headSha, never
  // by the commit being dispatched (#1613 r3).
  if (names.includes(`android-apk-${run.headSha}`)) {
    return { token: "built", reason: "ordinary APK artifact" };
  }
  return { token: "not built", reason: `artifacts: ${names.join(", ")}` };
}

function truncated(rows) {
  return !Array.isArray(rows) || rows.length >= LIST_LIMIT;
}

function judgeRows(lane, rows, input) {
  return rows.map((run) => ({
    run,
    ...classifyRun(
      lane,
      run,
      input.views[run.databaseId],
      input.artifacts[run.databaseId]
    ),
  }));
}

function summary(label, judged) {
  if (judged.length === 0) return `${label}: no runs`;
  return `${label}: ${judged.map((j) => `${j.run.databaseId} ${j.token} (${j.reason})`).join("; ")}`;
}

/**
 * The pre-dispatch decision. `input`: `{ lane, sha, branch, laneRuns,
 * openRuns: {status: rows}, prodRuns: {apk, play} (staging only), views,
 * artifacts, versions: {sha: version}, tip }`. Returns `{ lines, ok, reason }`;
 * `reason` is the first stop, or the OK line.
 */
export function decide(input) {
  const { lane, sha, branch } = input;
  // Types are erased at runtime: an unknown lane or branch would skip a rule.
  const refuse = (reason) => ({
    lines: [],
    ok: false,
    reason,
    stops: [reason],
  });
  if (!isLane(lane)) return refuse(`unknown lane ${JSON.stringify(lane)}`);
  if (!BRANCHES.includes(branch)) {
    return refuse(
      `branch ${JSON.stringify(branch)} is not "staging" or "main"`
    );
  }
  const lines = [];
  const stops = [];
  const read = (label, rows) => {
    if (truncated(rows)) {
      stops.push(
        `${label}: read returned ${LIST_LIMIT} rows or no list; it may be cut`
      );
      return [];
    }
    return rows;
  };

  // 1. Already built, or started, at this commit?
  const atSha = judgeRows(
    lane,
    read(`${lane} runs at ${sha}`, input.laneRuns),
    input
  );
  lines.push(summary(`${lane} at ${sha.slice(0, 12)}`, atSha));
  for (const j of atSha) {
    if (j.token === "built")
      stops.push(`run ${j.run.databaseId} already built ${sha}; record it`);
    else if (j.token === "started")
      stops.push(
        `run ${j.run.databaseId} has started; do not dispatch a second`
      );
    else if (j.token === "unknown") stops.push(j.reason);
  }

  // 2. Lane free? The concurrency group carries no branch.
  const open = OPEN_STATUSES.flatMap((s) =>
    read(`${lane} ${s}`, input.openRuns?.[s])
  );
  lines.push(
    `${lane} open: ${open.length === 0 ? "none" : open.map((r) => `${r.databaseId} ${r.status} on ${r.headBranch}`).join("; ")}`
  );
  if (open.length > 0)
    stops.push(
      `${lane} has an open run (${open[0].databaseId}); wait, then run this again`
    );

  // 3. Never an RC after production (DRI, 2026-10-22): every Android lane.
  if (branch === "staging") {
    let rc = null;
    try {
      rc = versionCore(input.versions?.[sha]);
    } catch (e) {
      stops.push(`version at ${sha}: ${e.message}`);
    }
    for (const prodLane of ANDROID_LANES) {
      const judged = judgeRows(
        prodLane,
        read(`${prodLane} main`, input.prodRuns?.[prodLane]),
        input
      );
      lines.push(summary(`${prodLane} production`, judged));
      for (const j of judged) {
        if (j.fatal) stops.push(j.reason);
        if (j.fatal || j.token === "not built" || rc === null) continue;
        let prod;
        try {
          prod = versionCore(input.versions?.[j.run.headSha]);
        } catch (e) {
          stops.push(`version at ${j.run.headSha}: ${e.message}`);
          continue;
        }
        if (prod === rc) {
          stops.push(
            `production run ${j.run.databaseId} (${prodLane}) is ${j.token} at ${prod}; no RC for a version with a production build`
          );
        }
      }
    }
  }

  // 4. `--ref <branch>` builds the tip at dispatch.
  lines.push(`${branch} tip: ${input.tip}`);
  if (input.tip !== sha)
    stops.push(`${branch} tip is ${input.tip}, not ${sha}`);

  if (stops.length > 0) return { lines, ok: false, reason: stops[0], stops };
  const ids = atSha.map((j) => j.run.databaseId).join(",");
  return {
    lines,
    ok: true,
    stops,
    reason: `OK to dispatch ${lane}${ids ? ` (runs at the commit before: ${ids})` : ""}`,
  };
}

/**
 * After the dispatch: `known` is the run ids at the commit before it. Only a
 * run NOT in `known` is the dispatch's (#1613 r4: an older run's terminal
 * token is not this dispatch's). `tip` is the branch tip read with it: a
 * moved tip is a stop, not a wait (#1641 George r1). Returns
 * `{ lines, state, reason }`.
 */
export function afterDispatch({
  lane,
  sha,
  laneRuns,
  known,
  views,
  artifacts,
  tip,
}) {
  if (!isLane(lane) || !Array.isArray(known)) {
    return {
      lines: [],
      state: "stop",
      reason: `unknown lane ${JSON.stringify(lane)} or no list of known runs`,
    };
  }
  if (truncated(laneRuns)) {
    return {
      lines: [],
      state: "stop",
      reason: `${lane} runs at ${sha}: read may be cut`,
    };
  }
  if (tip !== sha) {
    return { lines: [], state: "stop", reason: `tip is ${tip}, not ${sha}` };
  }
  const fresh = laneRuns.filter((r) => !known.includes(r.databaseId));
  const judged = judgeRows(lane, fresh, { views, artifacts });
  const lines = [summary(`${lane} new at ${sha.slice(0, 12)}`, judged)];
  if (judged.length === 0)
    return { lines, state: "wait", reason: `no new ${lane} run at ${sha} yet` };
  if (judged.length > 1)
    return {
      lines,
      state: "stop",
      reason: `${judged.length} new runs; tell the DRI`,
    };
  const [j] = judged;
  // The read is filtered by commit; a row at another commit means the read
  // is not what this check assumes (#1640 George r1 follow-up).
  if (j.run.headSha !== sha) {
    return {
      lines,
      state: "stop",
      reason: `new run ${j.run.databaseId} is not at ${sha}`,
    };
  }
  if (j.token === "started" || j.token === "built") {
    return {
      lines,
      state: "started",
      reason: `run ${j.run.databaseId} is ${j.token}; do not dispatch again`,
    };
  }
  return {
    lines,
    state: "stop",
    reason: `new run ${j.run.databaseId} is ${j.token} (${j.reason}); run the pre-dispatch check again`,
  };
}
