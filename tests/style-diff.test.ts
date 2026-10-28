import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ABSENT,
  diffRuns,
  formatReport,
  loadRun,
  parseArgs,
  type CaptureRun,
  type CaptureState,
  type CaptureTest,
  type StyleMap,
} from "../e2e/style-diff/diff";

/**
 * The comparator of the computed-style diff tool (#954), in plain Node.
 *
 * Every case builds two small capture runs by hand and asks `diffRuns` what
 * differs. The capture half (`e2e/style-diff/capture.ts`) runs only inside
 * Playwright, so nothing here exercises it; what it reaches in a real run is
 * reported on the PR that runs it, never here.
 */

const BOOKS_CARD = "html>body[1]>div[1]";

function state(
  key: string,
  elements: Record<string, string>,
  extra: Partial<CaptureState> = {}
): CaptureState {
  return { key, url: "/", elements, animated: {}, matched: [], ...extra };
}

function test(
  states: CaptureState[],
  extra: Partial<CaptureTest> = {}
): CaptureTest {
  return {
    id: "shipped | books › a card",
    project: "shipped",
    spec: "books.spec.ts",
    title: "books › a card",
    status: "passed",
    expectedStatus: "passed",
    captureErrors: 0,
    errorSamples: [],
    collapsed: 0,
    selectors: [],
    states,
    ...extra,
  };
}

function run(
  styles: Record<string, StyleMap>,
  tests: CaptureTest[],
  selectors: string[] = []
): CaptureRun {
  return { tests, styles, selectors };
}

const card: StyleMap = {
  "border-radius": "12px",
  color: "rgb(0, 0, 0)",
  "--c-gap": "8px",
};

describe("diffRuns", () => {
  it("reports nothing when the two runs are identical", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h1: { ...card } }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })]),
    ]);
    const report = diffRuns(a, b);
    expect(report.differences).toEqual([]);
    expect(report.statesCompared).toBe(1);
    expect(report.elementsCompared).toBe(1);
    expect(report.valuesCompared).toBe(3);
    expect(report.statesOnlyInA).toEqual([]);
    expect(report.statesOnlyInB).toEqual([]);
  });

  it("reports exactly one difference when one value changes", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h2: { ...card, "border-radius": "10px" } }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h2" })]),
    ]);
    const report = diffRuns(a, b);
    expect(report.differences).toEqual([
      {
        property: "border-radius",
        before: "12px",
        after: "10px",
        count: 1,
        samples: [
          {
            path: BOOKS_CARD,
            state: "shipped | books › a card | 001 p0 page.goto",
          },
        ],
      },
    ]);
  });

  it("reports exactly one difference when one custom property changes", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h2: { ...card, "--c-gap": "6px" } }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h2" })]),
    ]);
    const report = diffRuns(a, b);
    expect(
      report.differences.map((d) => [d.property, d.before, d.after, d.count])
    ).toEqual([["--c-gap", "8px", "6px", 1]]);
  });

  it("reports a state found in only one run as unmatched, not dropped", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h1: card }, [
      test([
        state("001 p0 page.goto", { [BOOKS_CARD]: "h1" }),
        state("002 p0 locator.click", { [BOOKS_CARD]: "h1" }),
      ]),
    ]);
    const report = diffRuns(a, b);
    expect(report.statesOnlyInA).toEqual([]);
    expect(report.statesOnlyInB).toEqual([
      "shipped | books › a card | 002 p0 locator.click",
    ]);
    expect(report.statesCompared).toBe(1);
    expect(formatReport(report, { baseLabel: "a", headLabel: "b" })).toContain(
      "state only in B: `shipped | books › a card | 002 p0 locator.click`"
    );
  });

  it("maps a renamed custom property to no difference with --rename-prop, and reports it without", () => {
    const a = run({ h1: { color: "red", "--o4-scope": "1" } }, [
      test([state("001 p0 end", { html: "h1" })]),
    ]);
    const b = run({ h2: { color: "red", "--c-components-last": "1" } }, [
      test([state("001 p0 end", { html: "h2" })]),
    ]);
    const without = diffRuns(a, b);
    expect(
      without.differences.map((d) => [d.property, d.before, d.after])
    ).toEqual([
      ["--c-components-last", ABSENT, "1"],
      ["--o4-scope", "1", ABSENT],
    ]);
    const { options } = parseArgs([
      "A",
      "B",
      "--rename-prop",
      "--o4-scope=--c-components-last",
    ]);
    const mapped = diffRuns(a, b, options);
    expect(mapped.differences).toEqual([]);
    expect(mapped.renamed).toEqual({ "--o4-scope": "--c-components-last" });
  });

  it("groups one change across states and elements into one entry with a count", () => {
    const states = (h: string) => [
      state("001 p0 page.goto", {
        [BOOKS_CARD]: h,
        [`${BOOKS_CARD}>div[1]`]: h,
      }),
      state("002 p0 locator.click", { [BOOKS_CARD]: h }),
    ];
    const report = diffRuns(
      run({ h1: card }, [test(states("h1"))]),
      run({ h2: { ...card, color: "rgb(1, 1, 1)" } }, [test(states("h2"))])
    );
    expect(report.differences).toHaveLength(1);
    expect(report.differences[0]?.count).toBe(3);
    expect(report.differences[0]?.samples).toHaveLength(3);
  });

  it("reports an element present in only one run", () => {
    const report = diffRuns(
      run({ h1: card }, [test([state("001 p0 end", { [BOOKS_CARD]: "h1" })])]),
      run({ h1: card }, [
        test([
          state("001 p0 end", {
            [BOOKS_CARD]: "h1",
            [`${BOOKS_CARD}::before`]: "h1",
          }),
        ]),
      ])
    );
    expect(
      report.differences.map((d) => [d.property, d.before, d.after])
    ).toEqual([["(element)", ABSENT, "present"]]);
  });

  it("leaves out a property an animation drove in either run, longhands of a driven shorthand too, and counts it", () => {
    const a = run(
      { h1: { ...card, opacity: "0.2", "border-top-left-radius": "1px" } },
      [
        test([
          state(
            "001 p0 end",
            { [BOOKS_CARD]: "h1" },
            { animated: { [BOOKS_CARD]: ["opacity"] } }
          ),
        ]),
      ]
    );
    const b = run(
      { h2: { ...card, opacity: "0.7", "border-top-left-radius": "2px" } },
      [
        test([
          state(
            "001 p0 end",
            { [BOOKS_CARD]: "h2" },
            { animated: { [BOOKS_CARD]: ["border"] } }
          ),
        ]),
      ]
    );
    const report = diffRuns(a, b);
    expect(report.differences).toEqual([]);
    expect(report.animatedExcluded).toBe(2);
  });

  it("leaves out an --ignore property and prints it", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h2: { ...card, color: "blue" } }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h2" })]),
    ]);
    const { options } = parseArgs(["A", "B", "--ignore", "color"]);
    const report = diffRuns(a, b, options);
    expect(report.differences).toEqual([]);
    expect(report.ignored).toEqual(["color"]);
    expect(formatReport(report, { baseLabel: "a", headLabel: "b" })).toContain(
      "| Ignored properties | color |"
    );
  });

  it("lists tests that failed in either run", () => {
    const a = run({ h1: card }, [test([], { status: "timedOut" })]);
    const b = run({ h1: card }, [test([])]);
    expect(diffRuns(a, b).failedTests).toEqual([
      { run: "A", id: "shipped | books › a card", status: "timedOut" },
    ]);
  });

  it("lists the B-run components selectors that matched in no B state", () => {
    const b = run(
      { h1: card },
      [
        test([state("001 p0 end", { html: "h1" }, { matched: [0] })], {
          selectors: [":root .books-card"],
        }),
      ],
      [":root .books-card", ":root .books-card:hover", ".err-wide"]
    );
    expect(diffRuns(b, b).uncoveredSelectors).toEqual([
      ".err-wide",
      ":root .books-card:hover",
    ]);
  });
});

describe("formatReport", () => {
  it("caps the detail block and says how many lines there were", () => {
    const styles: Record<string, StyleMap> = {};
    const elA: Record<string, string> = {};
    const elB: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      styles[`a${i}`] = { width: `${i}px` };
      styles[`b${i}`] = { width: `${i + 100}px` };
      elA[`html>div[${i + 1}]`] = `a${i}`;
      elB[`html>div[${i + 1}]`] = `b${i}`;
    }
    const report = diffRuns(
      run(styles, [test([state("001 p0 end", elA)])]),
      run(styles, [test([state("001 p0 end", elB)])])
    );
    const text = formatReport(report, {
      baseLabel: "base",
      headLabel: "head",
      cap: 2,
    });
    expect(text).toContain("(first 2 of 5 lines)");
    expect(text.match(/^- `width`/gm)).toHaveLength(2);
    expect(text).toContain("A = base, B = head");
  });
});

describe("parseArgs", () => {
  it("refuses a malformed --rename-prop, an unknown option and a missing directory", () => {
    expect(() => parseArgs(["A", "B", "--rename-prop", "--o4-scope"])).toThrow(
      /old=new/
    );
    expect(() => parseArgs(["A", "B", "--bogus"])).toThrow(/unknown option/);
    expect(() => parseArgs(["A"])).toThrow(/usage/);
  });
});

describe("loadRun", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("reads tests, styles and selectors back, and refuses an empty directory", () => {
    dir = mkdtempSync(join(tmpdir(), "style-diff-"));
    expect(() => loadRun(dir)).toThrow(/no capture/);
    mkdirSync(join(dir, "tests"));
    expect(() => loadRun(dir)).toThrow(/no test files/);
    mkdirSync(join(dir, "styles"));
    const t = test([state("001 p0 end", { html: "h1" })]);
    writeFileSync(join(dir, "tests", "t.json"), JSON.stringify(t));
    writeFileSync(join(dir, "styles", "h1.json"), JSON.stringify(card));
    writeFileSync(join(dir, "selectors.json"), JSON.stringify([".a"]));
    expect(loadRun(dir)).toEqual({
      tests: [t],
      styles: { h1: card },
      selectors: [".a"],
    });
  });
});
