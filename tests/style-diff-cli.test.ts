import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CaptureState, CaptureTest } from "../e2e/style-diff/diff";
import { TOLERATED } from "../e2e/style-diff/tolerated";

/**
 * The comparator's command line, run the way `npm run style:diff` runs it:
 * `node e2e/style-diff/diff.ts <A> <B>` in a child process, so the exit code
 * and the verdict line are the entry path's own, not the exported function's
 * (#954, Frank R1 P2 on #1778).
 *
 * A run is clean only when both sides recorded states, at least one state
 * matched, neither side had a capture error, nothing differs, and every state
 * that did not settle is one `TOLERATED` names, which the CLI always applies.
 * Each capture here therefore holds every listed state, unsettled, unless a
 * case says otherwise; each case breaks exactly one condition and reads the
 * reason the report gives.
 */

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "e2e", "style-diff", "diff.ts");

let scratch = "";
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

interface Listed {
  /** Leave the listed states out of the capture entirely. */
  absent?: boolean;
  /** Listed state ids (`<test> | <state>`) captured settled. */
  settled?: string[];
  /** Listed state ids left out of the capture. */
  omit?: string[];
}

function testFile(
  id: string,
  states: CaptureState[],
  captureErrors = 0
): CaptureTest {
  const [project = "", ...title] = id.split(" | ");
  return {
    id,
    project,
    spec: "a.spec.ts",
    title: title.join(" | "),
    status: "passed",
    expectedStatus: "passed",
    captureErrors,
    errorSamples: [],
    collapsed: 0,
    selectors: [],
    states,
  };
}

function captureDir(
  name: string,
  states: CaptureState[],
  captureErrors = 0,
  listed: Listed = {}
): string {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "styles"), { recursive: true });
  const tests = [testFile("shipped | books › a card", states, captureErrors)];
  if (!listed.absent) {
    const byTest = new Map<string, CaptureState[]>();
    for (const t of TOLERATED) {
      const id = `${t.test} | ${t.state}`;
      if (listed.omit?.includes(id)) continue;
      const s = state(t.state);
      if (!listed.settled?.includes(id)) s.unsettled = ["DOM still changing"];
      byTest.set(t.test, [...(byTest.get(t.test) ?? []), s]);
    }
    for (const [id, s] of byTest) tests.push(testFile(id, s));
  }
  tests.forEach((t, i) =>
    writeFileSync(join(dir, "tests", `t${i}.json`), JSON.stringify(t))
  );
  writeFileSync(
    join(dir, "styles", "h1.json"),
    JSON.stringify({ color: "red" })
  );
  writeFileSync(join(dir, "selectors.json"), "[]");
  return dir;
}

const state = (key: string): CaptureState => ({
  key,
  url: "/",
  elements: { "html>body[1]": "h1" },
  animated: {},
  matched: [],
});

function cli(a: string, b: string) {
  const run = spawnSync(process.execPath, [CLI, a, b], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const verdict =
    run.stdout.split("\n").find((l) => l.startsWith("Verdict:")) ?? "";
  return { code: run.status, verdict, stdout: run.stdout, stderr: run.stderr };
}

const idOf = (i: number) => {
  const t = TOLERATED[i];
  if (!t) throw new Error(`TOLERATED has no entry ${i}`);
  return { id: `${t.test} | ${t.state}`, entry: t };
};

describe("style:diff exit code and verdict", () => {
  it("exits 0 on a valid identical pair and says it is clean", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const r = cli(
      captureDir("a", [state("001 p0 page.goto")]),
      captureDir("b", [state("001 p0 page.goto")])
    );
    expect(r.stderr).toBe("");
    expect(r.verdict).toBe("Verdict: clean");
    expect(r.code).toBe(0);
  });

  it("exits nonzero when either side had a capture error, and names it", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const r = cli(
      captureDir("a", [state("001 p0 page.goto")], 2),
      captureDir("b", [state("001 p0 page.goto")])
    );
    expect(r.code).toBe(1);
    expect(r.verdict).toBe("Verdict: not clean — capture errors (A 2 / B 0)");
  });

  it("exits nonzero when a side recorded no states, and names it", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const none = { absent: true };
    const r = cli(captureDir("a", [], 0, none), captureDir("b", [], 0, none));
    expect(r.code).toBe(1);
    expect(r.verdict).toBe(
      `Verdict: not clean — tolerated states not captured: ${TOLERATED.length * 2}; no states recorded in A; no states recorded in B; no state matched between the runs`
    );
  });

  it("exits nonzero when no state matched, and names it", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const r = cli(
      captureDir("a", [state("001 p0 page.goto")]),
      captureDir("b", [state("001 p0 page.reload")])
    );
    expect(r.code).toBe(1);
    expect(r.verdict).toBe(
      "Verdict: not clean — states only in A: 1; states only in B: 1; no state matched between the runs"
    );
  });
});

describe("style:diff and the tolerated list", () => {
  it("exits nonzero when a listed state was not captured, and names it", () => {
    // Neither run holds it, as after a renamed test: a dead entry.
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const { id } = idOf(0);
    const r = cli(
      captureDir("a", [state("001 p0 page.goto")], 0, { omit: [id] }),
      captureDir("b", [state("001 p0 page.goto")], 0, { omit: [id] })
    );
    expect(r.code).toBe(1);
    expect(r.verdict).toBe(
      "Verdict: not clean — tolerated states not captured: 2"
    );
    expect(r.stdout).toContain(
      `- tolerated state not captured in A: \`${id}\``
    );
    expect(r.stdout).toContain(
      `- tolerated state not captured in B: \`${id}\``
    );
  });

  it("exits nonzero when a never-settling listed state settled, and prints the stale line", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const never = TOLERATED.findIndex((t) => t.settles === "never");
    const { id, entry } = idOf(never);
    const r = cli(
      captureDir("a", [state("001 p0 page.goto")], 0, { settled: [id] }),
      captureDir("b", [state("001 p0 page.goto")])
    );
    expect(r.code).toBe(1);
    expect(r.verdict).toBe("Verdict: not clean — stale tolerances: 1");
    expect(r.stdout).toContain(
      `Stale tolerance in A: \`${id}\` settled — fails: listed as never settling (${entry.reason})`
    );
  });

  it("still fails on an unsettled state the list does not name", () => {
    scratch = mkdtempSync(join(tmpdir(), "style-diff-cli-"));
    const moving = { ...state("002 p0 locator.click"), unsettled: ["x"] };
    const r = cli(
      captureDir("a", [state("001 p0 page.goto"), moving]),
      captureDir("b", [state("001 p0 page.goto"), moving])
    );
    expect(r.code).toBe(1);
    expect(r.verdict).toBe(
      "Verdict: not clean — states that did not settle (A 1 / B 1)"
    );
  });
});
