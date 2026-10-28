import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CaptureState, CaptureTest } from "../e2e/style-diff/diff";

/**
 * The comparator's command line, run the way `npm run style:diff` runs it:
 * `node e2e/style-diff/diff.ts <A> <B>` in a child process, so the exit code
 * and the verdict line are the entry path's own, not the exported function's
 * (#954, Frank R1 P2 on #1778).
 *
 * A run is clean only when both sides recorded states, at least one state
 * matched, neither side had a capture error, and nothing differs. Each case
 * here breaks exactly one of those and reads the reason the report gives.
 */

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "e2e", "style-diff", "diff.ts");

let scratch = "";
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

function captureDir(
  name: string,
  states: CaptureState[],
  captureErrors = 0
): string {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "styles"), { recursive: true });
  const test: CaptureTest = {
    id: "shipped | books › a card",
    project: "shipped",
    spec: "books.spec.ts",
    title: "books › a card",
    status: "passed",
    expectedStatus: "passed",
    captureErrors,
    errorSamples: [],
    collapsed: 0,
    selectors: [],
    states,
  };
  writeFileSync(join(dir, "tests", "t.json"), JSON.stringify(test));
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
  return { code: run.status, verdict, stderr: run.stderr };
}

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
    const r = cli(captureDir("a", []), captureDir("b", []));
    expect(r.code).toBe(1);
    expect(r.verdict).toBe(
      "Verdict: not clean — no states recorded in A; no states recorded in B; no state matched between the runs"
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
