import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * #1616: each native lane's `concurrency` group sits on the job that signs
 * and uploads, never on the whole run, and carries the lane alone.
 *
 * Why the job and not the run: GitHub keeps one pending run per group and
 * replaces it with a newer one. A run-level group is entered by every run,
 * including one whose preflight decides not to upload, so such a run could
 * replace a pending upload that then never happens (#1307 round 1 for the APK
 * and TestFlight lanes; #1316 item 1 for Play).
 *
 * Why the lane and nothing else: staging and main stamp one unix-timestamp
 * build number per app (versionCode, CFBundleVersion), and a second Play edit
 * invalidates the first, so two uploads of one lane must never overlap,
 * whatever commit or branch they come from. `scripts/redispatch-core.mjs`
 * reads "lane free?" across both branches for the same reason. A key holding
 * the commit, the ref or the run would let two uploads of one lane run at once.
 *
 * What the group does NOT do: a second run of the same commit queues behind
 * the first and then builds again. Whether a lane may be dispatched again is
 * `npm run check:redispatch`'s answer (#1636), not this file's.
 *
 * The gate is run in both states (AGENTS.md, "A gate is tested in both
 * states"): the states it exists to catch, and the legitimate ones the
 * runbook relies on (a re-run after a failed run, a different commit, the
 * other lane). The model below is GitHub's documented concurrency rule, kept
 * small on purpose; it is read from the workflow files, so a change to a
 * group's place, key or cancel flag changes its answers.
 *
 * Read through the shared YAML comment strip (#822): a `#` line holding the
 * old group must not satisfy a positive pin.
 */

const LANES = [
  { file: "android-apk.yml", job: "build", group: "android-apk" },
  { file: "ios-testflight.yml", job: "testflight", group: "ios-testflight" },
  { file: "android-play.yml", job: "upload", group: "android-play" },
] as const;

type Lane = (typeof LANES)[number];

function workflow(file: string): string {
  return stripYamlComments(
    readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8"
    )
  );
}

/** The top-level keys' text, before `jobs:`. */
function header(text: string): string {
  const at = text.search(/^jobs:\n/m);
  if (at < 0) throw new Error("no jobs: key");
  return text.slice(0, at);
}

/** Each job's block under `jobs:`, keyed by its id (two-space indent). */
function jobs(text: string): Map<string, string> {
  const body = text.slice(text.search(/^jobs:\n/m) + "jobs:\n".length);
  const out = new Map<string, string>();
  const starts = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)];
  if (starts.length === 0) throw new Error("no jobs found");
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? body.length;
    out.set(m[1] ?? "", body.slice(m.index, end));
  });
  return out;
}

interface Concurrency {
  group: string;
  cancelInProgress: boolean;
}

/**
 * The `concurrency:` mapping at `indent` spaces in `block`, or null. Any
 * other shape (a bare string, a missing or extra key) throws, so a form this
 * reader does not know fails instead of reading as "no group".
 */
function concurrencyAt(block: string, indent: number): Concurrency | null {
  const pad = " ".repeat(indent);
  const lines = block.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${pad}concurrency:`));
  if (at < 0) return null;
  if (lines[at]?.trimEnd() !== `${pad}concurrency:`) {
    throw new Error(`unrecognised concurrency shape: ${lines[at]}`);
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "") continue;
    const m = new RegExp(`^${pad}  ([a-z-]+): *(.*?) *$`).exec(line);
    if (!m) break;
    fields.set(m[1] ?? "", m[2] ?? "");
  }
  const group = fields.get("group");
  const cancel = fields.get("cancel-in-progress");
  if (
    fields.size !== 2 ||
    !group ||
    (cancel !== "true" && cancel !== "false")
  ) {
    throw new Error(`unrecognised concurrency keys: ${[...fields.keys()]}`);
  }
  return { group, cancelInProgress: cancel === "true" };
}

/** Where a lane's group lives, read from its file. */
function laneConfig(lane: Lane) {
  const text = workflow(lane.file);
  const byJob = new Map(
    [...jobs(text)].map(([id, block]) => [id, concurrencyAt(block, 4)])
  );
  return { runLevel: concurrencyAt(header(text), 0), byJob };
}

/** One run of a lane, as far as the concurrency rule can see it. */
interface Run {
  lane: Lane;
  sha: string;
  ref: "staging" | "main";
  runId: number;
  attempt: number;
  /** Did preflight let it reach the upload job? */
  uploads: boolean;
}

const EXPRESSION = /\$\{\{\s*([^}]+?)\s*\}\}/g;

/** The group key a run holds, with any `${{ github.* }}` filled in. */
function evaluate(group: string, run: Run): string {
  const context = new Map<string, string>([
    ["github.workflow", run.lane.file],
    ["github.sha", run.sha],
    ["github.ref", `refs/heads/${run.ref}`],
    ["github.ref_name", run.ref],
    ["github.run_id", String(run.runId)],
    ["github.run_attempt", String(run.attempt)],
  ]);
  return group.replace(EXPRESSION, (_, expr: string) => {
    const value = context.get(expr);
    if (value === undefined) throw new Error(`unmodelled expression ${expr}`);
    return value;
  });
}

/** The group a run enters, if any, and its cancel flag. */
function entered(run: Run): Concurrency | null {
  const { runLevel, byJob } = laneConfig(run.lane);
  if (runLevel) return { ...runLevel, group: evaluate(runLevel.group, run) };
  if (!run.uploads) return null;
  const own = byJob.get(run.lane.job);
  return own ? { ...own, group: evaluate(own.group, run) } : null;
}

type Outcome = "runs" | "queued" | "cancels the in-flight upload";

/**
 * GitHub's rule for a new entrant: with no holder of its group it runs; with
 * one, it waits, unless cancel-in-progress cancels the holder.
 */
function arrive(inFlight: Run[], next: Run): Outcome | "enters no group" {
  const mine = entered(next);
  if (!mine) return "enters no group";
  const held = inFlight.some((r) => entered(r)?.group === mine.group);
  if (!held) return "runs";
  return mine.cancelInProgress ? "cancels the in-flight upload" : "queued";
}

/**
 * GitHub's queue for one group (#1674): at most one running and one pending
 * entrant. A new entrant runs if the group is free; otherwise it becomes the
 * pending one, and an already-pending entrant is CANCELLED to make room (the
 * documented rule, with cancel-in-progress: false). That is why a run that
 * does not upload must not enter the group: it would take the pending slot
 * from an upload that then never happens. `arrive` above models one holder;
 * this models the slot, so a second waiter is counted rather than dropped.
 * `enter` is the group-entry rule, injectable so the failure state can be run.
 */
interface Queue {
  running: Run | null;
  pending: Run | null;
  cancelled: Run[];
}

function enqueue(
  arrivals: Run[],
  enter: (r: Run) => Concurrency | null = entered
): Queue {
  const q: Queue = { running: null, pending: null, cancelled: [] };
  for (const r of arrivals) {
    const mine = enter(r);
    if (!mine) continue;
    if (!q.running) {
      q.running = r;
    } else if (q.pending) {
      q.cancelled.push(q.pending);
      q.pending = r;
    } else {
      q.pending = r;
    }
  }
  return q;
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const lane = (file: Lane["file"]) => LANES.find((l) => l.file === file)!;
const run = (l: Lane, over: Partial<Run> = {}): Run => ({
  lane: l,
  sha: SHA_A,
  ref: "staging",
  runId: 1000,
  attempt: 1,
  uploads: true,
  ...over,
});

describe.each(LANES)("$file: the group sits on the upload job (#1616)", (l) => {
  const { runLevel, byJob } = laneConfig(l);

  it("has no run-level concurrency group", () => {
    expect(runLevel).toBeNull();
  });

  it(`puts group ${l.group} on the ${l.job} job and on no other job`, () => {
    expect(byJob.get(l.job)).toEqual({
      group: l.group,
      cancelInProgress: false,
    });
    for (const [id, c] of byJob) if (id !== l.job) expect(c).toBeNull();
  });

  it("keys the group on the lane alone, with no commit, ref or run", () => {
    const own = byJob.get(l.job);
    expect(own).not.toBeNull();
    expect(own?.group).not.toMatch(/\$\{\{/);
  });

  it("is the job that holds the signing environment", () => {
    const block = jobs(workflow(l.file)).get(l.job) ?? "";
    expect(block).toMatch(/^ {4}environment: (release-signing|play-upload)$/m);
  });
});

describe.each(LANES)("$file: what the group catches", (l) => {
  it("a run whose preflight does not upload enters no group, so it cannot replace a pending upload", () => {
    expect(entered(run(l, { uploads: false }))).toBeNull();
    expect(arrive([run(l)], run(l, { runId: 1001, uploads: false }))).toBe(
      "enters no group"
    );
  });

  it("a second dispatch of the same commit waits for the in-flight upload and never cancels it", () => {
    expect(arrive([run(l)], run(l, { runId: 1001 }))).toBe("queued");
  });

  it("a staging and a main upload of one lane never overlap", () => {
    expect(
      arrive([run(l)], run(l, { runId: 1001, ref: "main", sha: SHA_B }))
    ).toBe("queued");
  });
});

describe.each(LANES)("$file: the legitimate states still go through", (l) => {
  it("a re-run after a failed run is not held: the failed run left the group", () => {
    // A completed run, failed or not, holds nothing; the re-run is the same
    // run id at the next attempt.
    expect(arrive([], run(l, { attempt: 2 }))).toBe("runs");
  });

  it("a new dispatch after a failed run is not held either", () => {
    expect(arrive([], run(l, { runId: 1001 }))).toBe("runs");
  });

  it("a different commit waits its turn; it is not refused and cancels nothing", () => {
    expect(arrive([run(l)], run(l, { runId: 1001, sha: SHA_B }))).toBe(
      "queued"
    );
  });

  it.each(LANES.filter((o) => o.file !== l.file))(
    "the other lane, $file, runs alongside it",
    (other) => {
      expect(arrive([run(l)], run(other, { runId: 2000 }))).toBe("runs");
    }
  );
});

describe.each(LANES)(
  "$file: the queue holds the waiting upload (#1674)",
  (l) => {
    const holder = run(l);
    const waiter = run(l, { runId: 1001, sha: SHA_B });

    it("an upload behind a holder is the pending entrant", () => {
      const q = enqueue([holder, waiter]);
      expect(q.running).toBe(holder);
      expect(q.pending).toBe(waiter);
      expect(q.cancelled).toEqual([]);
    });

    it("a non-upload run arriving after the waiter does not take its slot", () => {
      const q = enqueue([
        holder,
        waiter,
        run(l, { runId: 1002, uploads: false }),
      ]);
      expect(q.pending).toBe(waiter);
      expect(q.cancelled).toEqual([]);
    });

    it("a non-upload run alone enters no group and holds nothing", () => {
      const q = enqueue([run(l, { uploads: false })]);
      expect(q).toEqual({ running: null, pending: null, cancelled: [] });
    });

    it("a third upload cancels the first waiter: two waiters are not both kept", () => {
      const second = run(l, { runId: 1002 });
      const q = enqueue([holder, waiter, second]);
      expect(q.pending).toBe(second);
      expect(q.cancelled).toEqual([waiter]);
    });

    it("would drop the waiter if a non-upload run did enter the group", () => {
      const everyRunEnters = (r: Run): Concurrency | null => {
        const own = laneConfig(r.lane).byJob.get(r.lane.job) ?? null;
        return own ? { ...own, group: evaluate(own.group, r) } : null;
      };
      const q = enqueue(
        [holder, waiter, run(l, { runId: 1002, uploads: false })],
        everyRunEnters
      );
      expect(q.cancelled).toEqual([waiter]);
    });
  }
);

describe("the model reads the files, not a constant", () => {
  // The states above depend on what each file says; these pin the model's
  // own reading so a key it cannot evaluate fails instead of passing.
  it("refuses an expression it does not model", () => {
    expect(() =>
      evaluate("x-${{ github.event_name }}", run(lane("android-apk.yml")))
    ).toThrow(/unmodelled/);
  });

  it("would let two commits overlap if the key held the commit", () => {
    const keyed = (r: Run) => evaluate("android-apk-${{ github.sha }}", r);
    const l = lane("android-apk.yml");
    expect(keyed(run(l))).toBe(`android-apk-${SHA_A}`);
    expect(keyed(run(l, { sha: SHA_B }))).toBe(`android-apk-${SHA_B}`);
  });

  it("rejects a concurrency shape it cannot read", () => {
    expect(() => concurrencyAt("concurrency: android-apk\n", 0)).toThrow(
      /unrecognised/
    );
    expect(() => concurrencyAt("concurrency:\n  group: x\n", 0)).toThrow(
      /unrecognised/
    );
  });
});
