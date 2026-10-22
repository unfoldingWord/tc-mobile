#!/usr/bin/env node
/**
 * May a native lane be dispatched again by hand? (#1636.) Read-only: this
 * script never dispatches. Dispatch stays the DRI's, human-only
 * (docs/release/promotion-v1.0.0.md §3a step 7).
 *
 *   npm run check:redispatch -- --lane apk --sha <40-char oid> [--branch staging|main]
 *   npm run check:redispatch -- --lane apk --sha <oid> --known <id,id,...>
 *
 * The first form reads the lane's runs at the commit, its open runs on every
 * branch, every Android lane's production (`main`) runs when the dispatch is
 * a staging RC, and the branch tip, then prints one line per read and a last
 * line, `OK to dispatch <lane>` or `STOP: <reason>`. The OK line lists the
 * run ids at the commit; after the dispatch, the second form (`--known`
 * those ids) prints `STARTED`, `WAIT` or `STOP` for a NEW run. The rules
 * live in `redispatch-core.mjs`; this file only reads.
 */

import { execFileSync } from "node:child_process";

import { isMainEntry } from "./check-commit-messages.mjs";
import {
  afterDispatch,
  ANDROID_LANES,
  decide,
  LANES,
  LIST_LIMIT,
  OPEN_STATUSES,
} from "./redispatch-core.mjs";

// Reads `gh … --json` through `execFileSync` (no shell, so no text is ever
// interpolated into one) and hands the parsed JSON to the core.

export const REPO = "unfoldingWord/tc-mobile";
const SHA = /^[0-9a-f]{40}$/;

export function parseArgs(argv) {
  const out = { branch: "staging", known: null };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--lane") out.lane = value;
    else if (flag === "--sha") out.sha = value;
    else if (flag === "--branch") out.branch = value;
    else if (flag === "--known") {
      out.known = value === "" ? [] : value.split(",").map(Number);
    } else throw new Error(`unrecognized argument ${flag}`);
  }
  if (!Object.hasOwn(LANES, out.lane ?? ""))
    throw new Error("--lane must be apk, play or testflight");
  if (!SHA.test(out.sha ?? ""))
    throw new Error("--sha must be a full 40-character commit oid");
  if (!["staging", "main"].includes(out.branch))
    throw new Error("--branch must be staging or main");
  if (out.known && !out.known.every(Number.isSafeInteger))
    throw new Error("--known must be run ids");
  return out;
}

function defaultGh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Every read the core needs, through `gh` (injected in tests). */
export function gather({ lane, sha, branch, known }, ghText = defaultGh) {
  const gh = (args) => JSON.parse(ghText(args));
  const list = (l, extra) =>
    gh([
      "run",
      "list",
      "--repo",
      REPO,
      "--workflow",
      LANES[l].workflow,
      ...extra,
      "--limit",
      String(LIST_LIMIT),
      "--json",
      "databaseId,status,headSha,headBranch",
    ]);
  const views = {};
  const artifacts = {};
  const readRuns = (l, rows) => {
    for (const run of Array.isArray(rows) ? rows : []) {
      const id = run.databaseId;
      if (!Number.isSafeInteger(id))
        throw new Error(`run id ${JSON.stringify(id)} is not a number`);
      if (known?.includes(id)) continue;
      views[id] = gh([
        "run",
        "view",
        String(id),
        "--repo",
        REPO,
        "--json",
        "jobs",
      ]);
      if (l === "apk")
        artifacts[id] = gh([
          "api",
          `repos/${REPO}/actions/runs/${id}/artifacts?per_page=100`,
        ]);
    }
  };
  const laneRuns = list(lane, ["--commit", sha]);
  readRuns(lane, laneRuns);
  if (known) return { lane, sha, laneRuns, known, views, artifacts };

  const openRuns = Object.fromEntries(
    OPEN_STATUSES.map((s) => [s, list(lane, ["--status", s])])
  );
  const prodRuns = {};
  const versions = {};
  if (branch === "staging") {
    for (const l of ANDROID_LANES) {
      prodRuns[l] = list(l, ["--branch", "main"]);
      readRuns(l, prodRuns[l]);
    }
    const shas = new Set([
      sha,
      ...Object.values(prodRuns)
        .flat()
        .map((r) => r.headSha),
    ]);
    for (const s of shas) {
      if (typeof s !== "string" || !SHA.test(s)) continue; // absent: the core stops
      const file = gh(["api", `repos/${REPO}/contents/package.json?ref=${s}`]);
      versions[s] = JSON.parse(
        Buffer.from(file.content, "base64").toString("utf8")
      ).version;
    }
  }
  const tip = gh(["api", `repos/${REPO}/git/ref/heads/${branch}`]).object.sha;
  return {
    lane,
    sha,
    branch,
    laneRuns,
    openRuns,
    prodRuns,
    views,
    artifacts,
    versions,
    tip,
  };
}

/** Prints the lines and the verdict; returns the exit status (0 only for OK or STARTED). */
export function main(argv, { gh = defaultGh, log = console.log } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    log(`STOP: usage: ${e.message}`);
    return 2;
  }
  try {
    const input = gather(opts, gh);
    if (opts.known) {
      const r = afterDispatch(input);
      r.lines.forEach((line) => log(line));
      log(
        `${r.state === "started" ? "STARTED" : r.state === "wait" ? "WAIT" : "STOP"}: ${r.reason}`
      );
      return r.state === "started" ? 0 : 1;
    }
    const r = decide(input);
    r.lines.forEach((line) => log(line));
    log(r.ok ? r.reason : `STOP: ${r.reason}`);
    return r.ok ? 0 : 1;
  } catch (e) {
    log(
      `STOP: a read failed, tell the DRI: ${String(e.stderr || e.message).trim()}`
    );
    return 1;
  }
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
