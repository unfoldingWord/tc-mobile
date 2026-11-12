import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * #1935: ci.yml's run-level `concurrency` group must give every push to a
 * long-lived branch (develop, staging, main) a group of its own, while a pull
 * request's runs still share one group and cancel the superseded run.
 *
 * Why a per-commit group for push: GitHub keeps at most one running and one
 * pending run per group, and a newly queued run cancels the pending one
 * whatever `cancel-in-progress` says; that setting only reaches the RUNNING
 * one. With one group per branch, merges landing faster than one CI run left
 * every queued commit but the newest with a cancelled run and no jobs.
 *
 * The gate is run in both states (AGENTS.md, "A gate is tested in both
 * states"): a burst of pushes must keep every run, and quick pushes to one PR
 * must still cancel the older run. The queue model is GitHub's documented
 * rule, kept small; the group and cancel expressions are read from ci.yml and
 * evaluated, so a change to either changes the answers. The model also runs
 * on the pre-#1935 expression, to show it can see the defect at all.
 *
 * What this cannot show: GitHub's real scheduler. Whether a burst of real
 * merges keeps every run is a post-merge check on the Actions tab.
 *
 * Read through the shared YAML comment strip (#822): a `#` line holding an
 * old expression must not satisfy a positive pin.
 */

const CI = stripYamlComments(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
);

interface Concurrency {
  group: string;
  cancelInProgress: string;
}

/** The top-level `concurrency:` mapping, before `jobs:`. Any other shape throws. */
function runLevelConcurrency(text: string): Concurrency {
  const jobsAt = text.search(/^jobs:\n/m);
  if (jobsAt < 0) throw new Error("no jobs: key");
  const lines = text.slice(0, jobsAt).split("\n");
  const at = lines.findIndex((l) => l.startsWith("concurrency:"));
  if (at < 0) throw new Error("no run-level concurrency");
  if (lines[at]?.trimEnd() !== "concurrency:") {
    throw new Error(`unrecognised concurrency shape: ${lines[at]}`);
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "") continue;
    const m = /^ {2}([a-z-]+): *(.*?) *$/.exec(line);
    if (!m) break;
    fields.set(m[1] ?? "", m[2] ?? "");
  }
  const group = fields.get("group");
  const cancelInProgress = fields.get("cancel-in-progress");
  if (fields.size !== 2 || !group || !cancelInProgress) {
    throw new Error(`unrecognised concurrency keys: ${[...fields.keys()]}`);
  }
  return { group, cancelInProgress };
}

/** One CI run, as far as the `github` context in the group can see it. */
interface Run {
  id: string;
  event: "push" | "pull_request";
  ref: string;
  sha: string;
}

type Value = string | boolean;

/**
 * A small evaluator for the subset of GitHub's expression syntax the group
 * uses: `github.*` properties, single-quoted strings, `==`, `!=`, `&&`, `||`
 * and parentheses. `&&` and `||` return an operand, as GitHub's do, which is
 * what makes `a && b || c` a ternary. `==` on strings ignores case, as
 * GitHub's does. Anything else throws, so an unmodelled form fails loudly.
 */
function evalExpression(src: string, run: Run): Value {
  const context: Record<string, string> = {
    "github.workflow": "CI",
    "github.event_name": run.event,
    "github.ref": run.ref,
    "github.sha": run.sha,
  };
  const tokens =
    src.match(/'(?:[^']|'')*'|==|!=|&&|\|\||\(|\)|[A-Za-z_][\w.-]*|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const truthy = (v: Value) => v !== false && v !== "";
  const primary = (): Value => {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`unexpected end: ${src}`);
    if (t === "(") {
      const v = or();
      if (tokens[i++] !== ")") throw new Error(`missing ): ${src}`);
      return v;
    }
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t === "true" || t === "false") return t === "true";
    if (Object.hasOwn(context, t)) return context[t] as string;
    throw new Error(`unmodelled token ${t} in ${src}`);
  };
  const equality = (): Value => {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = tokens[i++];
      const right = primary();
      const same = String(left).toLowerCase() === String(right).toLowerCase();
      left = op === "==" ? same : !same;
    }
    return left;
  };
  const and = (): Value => {
    let left = equality();
    while (peek() === "&&") {
      i++;
      const right = equality();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = (): Value => {
    let left = and();
    while (peek() === "||") {
      i++;
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const value = or();
  if (i !== tokens.length) throw new Error(`trailing tokens in ${src}`);
  return value;
}

/** A YAML scalar with every `${{ … }}` filled in. */
function interpolate(scalar: string, run: Run): string {
  return scalar.replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, expr: string) =>
    String(evalExpression(expr, run))
  );
}

/**
 * GitHub's queue, per group: at most one running and one pending run. A run
 * entering a free group runs. With `cancel-in-progress` true it cancels the
 * running and the pending run and runs itself. Otherwise it becomes the
 * pending run, and a run already pending is cancelled to make room. Every
 * arrival is modelled as landing while the earlier ones are still going,
 * which is the burst that #1935 observed.
 */
function burst(config: Concurrency, arrivals: Run[]) {
  const running = new Map<string, Run>();
  const pending = new Map<string, Run>();
  const cancelled: string[] = [];
  for (const run of arrivals) {
    const group = interpolate(config.group, run);
    const cancel = interpolate(config.cancelInProgress, run);
    if (cancel !== "true" && cancel !== "false") {
      throw new Error(`cancel-in-progress is not a boolean: ${cancel}`);
    }
    const holder = running.get(group);
    if (!holder) {
      running.set(group, run);
      continue;
    }
    const waiting = pending.get(group);
    if (cancel === "true") {
      cancelled.push(holder.id);
      if (waiting) cancelled.push(waiting.id);
      pending.delete(group);
      running.set(group, run);
      continue;
    }
    if (waiting) cancelled.push(waiting.id);
    pending.set(group, run);
  }
  return { cancelled };
}

const sha = (c: string) => c.repeat(40);
const push = (branch: string, c: string): Run => ({
  id: `${branch}@${c}`,
  event: "push",
  ref: `refs/heads/${branch}`,
  sha: sha(c),
});
const prPush = (pr: number, c: string): Run => ({
  id: `pr${pr}@${c}`,
  event: "pull_request",
  ref: `refs/pull/${pr}/merge`,
  sha: sha(c),
});

/** The group and cancel flag ci.yml carried before #1935. */
const BEFORE_1935: Concurrency = {
  group: "${{ github.workflow }}-${{ github.ref }}",
  cancelInProgress: "${{ github.event_name == 'pull_request' }}",
};

const config = runLevelConcurrency(CI);

describe("ci.yml: run-level concurrency (#1935)", () => {
  it.each(["develop", "staging", "main"])(
    "a burst of pushes to %s keeps every run",
    (branch) => {
      const merges = ["a", "b", "c", "d"].map((c) => push(branch, c));
      expect(burst(config, merges).cancelled).toEqual([]);
    }
  );

  it("quick pushes to one PR still cancel the superseded runs", () => {
    const pushes = [prPush(12, "a"), prPush(12, "b"), prPush(12, "c")];
    expect(burst(config, pushes).cancelled).toEqual(["pr12@a", "pr12@b"]);
  });

  it("one PR's pushes never cancel another PR's run", () => {
    expect(burst(config, [prPush(12, "a"), prPush(13, "b")]).cancelled).toEqual(
      []
    );
  });

  it("a PR run and a develop push never share a group", () => {
    expect(
      burst(config, [prPush(12, "a"), push("develop", "a")]).cancelled
    ).toEqual([]);
  });

  it("the same commit pushed to two branches keeps both runs", () => {
    expect(
      burst(config, [push("staging", "a"), push("main", "a")]).cancelled
    ).toEqual([]);
  });

  it("a push never cancels a run in progress", () => {
    expect(interpolate(config.cancelInProgress, push("develop", "a"))).toBe(
      "false"
    );
    expect(interpolate(config.cancelInProgress, prPush(12, "a"))).toBe("true");
  });

  it("the model sees the defect: the pre-#1935 group cancels queued pushes", () => {
    const merges = ["a", "b", "c", "d"].map((c) => push("develop", c));
    expect(burst(BEFORE_1935, merges).cancelled).toEqual([
      "develop@b",
      "develop@c",
    ]);
  });

  it("the evaluator refuses a context it does not model", () => {
    expect(() =>
      evalExpression("github.head_ref", push("develop", "a"))
    ).toThrow(/unmodelled token/);
  });

  it.each(["toString", "constructor", "hasOwnProperty"])(
    "the evaluator refuses the inherited key %s",
    (token) => {
      expect(() => evalExpression(token, push("develop", "a"))).toThrow(
        /unmodelled token/
      );
    }
  );
});
