import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  blocksSettle,
  countsAsChange,
  keptChildren,
  SETTLE_DOM_MS,
  SETTLE_MS,
  SETTLE_QUIET_MS,
  settleVerdict,
  SKIP,
  unsettledReasons,
} from "../e2e/style-diff/capture";
import {
  ABSENT,
  diffRuns,
  formatReport,
  loadRun,
  parseArgs,
  roundValue,
  verdict,
  type CaptureRun,
  type CaptureState,
  type CaptureTest,
  type StyleMap,
} from "../e2e/style-diff/diff";
import { TOLERATED, type ToleratedState } from "../e2e/style-diff/tolerated";

/**
 * The comparator of the computed-style diff tool (#954), in plain Node.
 *
 * Every case builds two small capture runs by hand and asks `diffRuns` what
 * differs. The capture half (`e2e/style-diff/capture.ts`) runs only inside
 * Playwright; of it, only the pure helpers it also sends into the page
 * (`keptChildren`, `blocksSettle`, `countsAsChange`, `settleVerdict`,
 * `unsettledReasons`) are exercised here.
 * What a real run reaches is reported on the PR that runs it, never here.
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

  it("compares a state one run collapsed into the state before it, rather than leaving it unmatched", () => {
    // Run A kept "002" because "001" read differently there (it did not
    // settle); run B's "002" repeated its "001" and was collapsed into it.
    const a = run({ h1: card }, [
      test([
        state(
          "001 p0 locator.click",
          { [BOOKS_CARD]: "h1" },
          { unsettled: ["DOM still changing"] }
        ),
        state("002 p0 end", { [BOOKS_CARD]: "h1" }),
      ]),
    ]);
    const b = run({ h1: card, h2: { ...card, color: "rgb(1, 1, 1)" } }, [
      test([state("001 p0 locator.click", { [BOOKS_CARD]: "h1" })], {
        sameAs: { "002 p0 end": "001 p0 locator.click" },
      }),
    ]);
    const report = diffRuns(a, b);
    expect(report.statesOnlyInA).toEqual([]);
    expect(report.statesOnlyInB).toEqual([]);
    expect(report.statesCompared).toBe(1);
    expect(report.differences).toEqual([]);

    // The alias carries the state it repeated, so a real change still shows.
    const changed = run({ h2: { ...card, color: "rgb(1, 1, 1)" } }, [
      test([state("001 p0 locator.click", { [BOOKS_CARD]: "h2" })], {
        sameAs: { "002 p0 end": "001 p0 locator.click" },
      }),
    ]);
    expect(
      diffRuns(a, changed).differences.map((d) => [d.property, d.count])
    ).toEqual([["color", 1]]);
  });

  it("counts an alias of a state that did not settle as not settled too", () => {
    const b = run({ h1: card }, [
      test(
        [
          state(
            "001 p0 locator.click",
            { [BOOKS_CARD]: "h1" },
            { unsettled: ["DOM still changing"] }
          ),
        ],
        { sameAs: { "002 p0 end": "001 p0 locator.click" } }
      ),
    ]);
    const report = diffRuns(b, b);
    expect(report.unsettled.map((u) => [u.run, u.state])).toEqual([
      ["A", "shipped | books › a card | 001 p0 locator.click"],
      ["A", "shipped | books › a card | 002 p0 end"],
      ["B", "shipped | books › a card | 001 p0 locator.click"],
      ["B", "shipped | books › a card | 002 p0 end"],
    ]);
    expect(report.statesCompared).toBe(0);
  });

  it("refuses an alias that names no state of its test", () => {
    const bad = run({ h1: card }, [
      test([state("001 p0 page.goto", { [BOOKS_CARD]: "h1" })], {
        sameAs: { "002 p0 end": "009 p0 nothing" },
      }),
    ]);
    expect(() => diffRuns(bad, bad)).toThrow(/009 p0 nothing/);
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

  it("reports a property that only shares a driven name's prefix", () => {
    const changed = {
      "border-top-left-radius": ["1px", "2px"],
      "flex-direction": ["row", "column"],
      "overflow-wrap": ["normal", "anywhere"],
      "transform-origin": ["0px 0px", "50px 50px"],
    } as const;
    const side = (i: 0 | 1) =>
      Object.fromEntries(
        Object.entries(changed).map(([p, v]) => [p, v[i]])
      ) as StyleMap;
    const animated = {
      animated: {
        [BOOKS_CARD]: ["border", "flex", "overflow", "transform"],
      },
    };
    const a = run({ h1: { ...card, ...side(0) } }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h1" }, animated)]),
    ]);
    const b = run({ h2: { ...card, ...side(1) } }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h2" }, animated)]),
    ]);
    const report = diffRuns(a, b);
    expect(report.differences.map((d) => d.property).sort()).toEqual(
      Object.keys(changed).sort()
    );
    expect(report.animatedExcluded).toBe(0);
  });

  it("throws when a state names a style its run did not load", () => {
    const a = run({ h1: card }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h1" })]),
    ]);
    const b = run({ h1: card }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "missing" })]),
    ]);
    expect(() => diffRuns(a, b)).toThrow(
      "run B names style missing, which it did not load"
    );
  });

  it("leaves out a property an animation drove in either run, longhands of a driven shorthand too, and counts it", () => {
    const a = run(
      { h1: { ...card, opacity: "0.2", "border-top-width": "1px" } },
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
      { h2: { ...card, opacity: "0.7", "border-top-width": "2px" } },
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

describe("roundValue", () => {
  it("rounds a long decimal to three places, in place", () => {
    expect(roundValue("37.37500000000001%")).toBe("37.375%");
    expect(roundValue("matrix(1, 0, 0, 1, 12.33333, -0.6666667)")).toBe(
      "matrix(1, 0, 0, 1, 12.333, -0.667)"
    );
    expect(roundValue("-0.00001px")).toBe("0px");
    expect(roundValue("6.875e-14%")).toBe("0%");
    expect(roundValue("1.23456e+2px")).toBe("123.456px");
    expect(roundValue("translate(1e-7px, 2.5px)")).toBe(
      "translate(0px, 2.5px)"
    );
  });

  it("leaves a short decimal and any number inside a word alone", () => {
    for (const value of [
      "37.375%",
      "1.5px",
      "#0b1016",
      'url("/assets/index-a1.23456.js")',
      'url("/fonts/inter-v1.23456")',
      "rgb(11, 16, 22)",
    ]) {
      expect(roundValue(value)).toBe(value);
    }
  });

  it("leaves a CSS string and a url's contents alone, and rounds around them", () => {
    for (const value of [
      'url("/images/1.23441/icon.png")',
      "url(/images/1.23441/icon.png)",
      '"1.23441"',
      "'1.23441'",
      '"a \\" 1.23441"',
    ]) {
      expect(roundValue(value)).toBe(value);
    }
    expect(roundValue('url("/i/1.23441.png") 12.33333px "2.00001"')).toBe(
      'url("/i/1.23441.png") 12.333px "2.00001"'
    );
  });
});

describe("diffRuns and rounding", () => {
  const cut = (left: string) =>
    run({ h: { ...card, "--o4-cut-left": left } }, [
      test([state("001 p0 end", { [BOOKS_CARD]: "h" })]),
    ]);

  it("reports no difference between values that differ only past three places", () => {
    const report = diffRuns(cut("37.375%"), cut("37.37500000000001%"));
    expect(report.differences).toEqual([]);
  });

  it("still reports a changed image url or string past three places", () => {
    const styled = (prop: string, v: string) =>
      run({ h: { ...card, [prop]: v } }, [
        test([state("001 p0 end", { [BOOKS_CARD]: "h" })]),
      ]);
    const pairs: [string, string, string][] = [
      [
        "background-image",
        'url("/i/1.23441/x.png")',
        'url("/i/1.23449/x.png")',
      ],
      ["content", '"1.23441"', '"1.23449"'],
    ];
    for (const [prop, a, b] of pairs) {
      const report = diffRuns(styled(prop, a), styled(prop, b));
      expect(report.differences.map((d) => d.property)).toEqual([prop]);
    }
  });

  it("still reports a difference at the third place", () => {
    const report = diffRuns(cut("37.375%"), cut("37.376%"));
    expect(
      report.differences.map((d) => [d.property, d.before, d.after])
    ).toEqual([["--o4-cut-left", "37.375%", "37.376%"]]);
  });
});

describe("keptChildren", () => {
  const el = (localName: string, id = "") => ({ localName, id });

  it("numbers the app's root the same with the launch overlay present or gone", () => {
    const root = el("div", "root");
    const withOverlay = keptChildren(
      [el("div", "launch-intro"), el("script"), root, el("div")],
      SKIP
    );
    const without = keptChildren([el("script"), root, el("div")], SKIP);
    expect(withOverlay).toEqual(without);
    expect(without.map(([c, i]) => [c.id || c.localName, i])).toEqual([
      ["root", 1],
      ["div", 2],
    ]);
  });

  it("skips head and the elements that never render", () => {
    const kept = keptChildren(
      ["head", "style", "link", "meta", "template", "noscript", "body"].map(
        (n) => el(n)
      ),
      SKIP
    );
    expect(kept.map(([c, i]) => [c.localName, i])).toEqual([["body", 1]]);
  });
});

describe("blocksSettle", () => {
  it("holds the snapshot for a running or pending animation that ends", () => {
    expect(
      blocksSettle({ playState: "running", pending: false, endTime: 300 })
    ).toBe(true);
    expect(
      blocksSettle({ playState: "paused", pending: true, endTime: 300 })
    ).toBe(true);
  });

  it("does not hold it for an infinite, finished or paused one", () => {
    expect(
      blocksSettle({ playState: "running", pending: false, endTime: Infinity })
    ).toBe(false);
    expect(
      blocksSettle({ playState: "finished", pending: false, endTime: 300 })
    ).toBe(false);
    expect(
      blocksSettle({ playState: "paused", pending: false, endTime: 300 })
    ).toBe(false);
  });
});

describe("countsAsChange", () => {
  // A node stands for itself by name; `skipped` says which names sit in a
  // skipped element, as the page's `closest` check does.
  const inOverlay = new Set(["launch-intro", "launch-intro img"]);
  const skipped = (node: string) => inOverlay.has(node);
  const record = (
    target: string,
    addedNodes: string[] = [],
    removedNodes: string[] = []
  ) => ({ target, addedNodes, removedNodes });

  it("does not count the launch overlay leaving body", () => {
    expect(countsAsChange(record("body", [], ["launch-intro"]), skipped)).toBe(
      false
    );
    expect(countsAsChange(record("body", ["launch-intro"]), skipped)).toBe(
      false
    );
  });

  it("does not count a change inside a skipped element", () => {
    expect(countsAsChange(record("launch-intro img"), skipped)).toBe(false);
  });

  it("counts a change outside, and a list change that moves any kept node", () => {
    expect(countsAsChange(record("header"), skipped)).toBe(true);
    expect(countsAsChange(record("body", ["div"]), skipped)).toBe(true);
    expect(
      countsAsChange(record("body", ["div"], ["launch-intro"]), skipped)
    ).toBe(true);
  });
});

describe("settleVerdict", () => {
  const bounds = {
    quietMs: SETTLE_QUIET_MS,
    domMs: SETTLE_DOM_MS,
    settleMs: SETTLE_MS,
  };
  // A page that has been quiet, with nothing animating, since the wait began.
  const quiet = { frames: 2, elapsed: 120, sinceBusy: 120, sinceAnimated: 120 };
  const at = (clock: Partial<typeof quiet>) =>
    settleVerdict({ ...quiet, ...clock }, bounds);

  it("keeps the bounds the tolerated list was reasoned from", () => {
    // `tolerated.ts`'s spring-back reason adds the quiet window to a 200 ms
    // mutation and lands on the DOM bound, so a change here moves it.
    expect(bounds).toEqual({ quietMs: 100, domMs: 300, settleMs: 2000 });
  });

  it("settles once the page has been quiet for the window, over two frames", () => {
    expect(at({ sinceBusy: 100 })).toBe("settled");
    expect(at({ sinceBusy: 99.9 })).toBe("wait");
    expect(at({ frames: 1, sinceBusy: 150 })).toBe("wait");
  });

  it("settles even past both bounds when the last frame was quiet", () => {
    expect(at({ frames: 40, elapsed: 2500, sinceBusy: 100 })).toBe("settled");
  });

  it("stops at the DOM bound when the DOM keeps changing with nothing animating", () => {
    expect(at({ frames: 20, elapsed: 300.1, sinceBusy: 10 })).toBe("dom bound");
    expect(at({ frames: 20, elapsed: 300, sinceBusy: 10 })).toBe("wait");
    // An animation that ended a whole window ago no longer counts as running.
    expect(
      at({ frames: 20, elapsed: 300.1, sinceBusy: 10, sinceAnimated: 100 })
    ).toBe("dom bound");
  });

  it("waits past the DOM bound while an animation ran inside the window", () => {
    expect(
      at({ frames: 60, elapsed: 1000, sinceBusy: 0, sinceAnimated: 99.9 })
    ).toBe("wait");
    expect(
      at({ frames: 120, elapsed: 2000, sinceBusy: 0, sinceAnimated: 0 })
    ).toBe("wait");
  });

  it("stops at the animation bound when an animation keeps running", () => {
    expect(
      at({ frames: 120, elapsed: 2000.1, sinceBusy: 0, sinceAnimated: 0 })
    ).toBe("animation bound");
  });

  it("names the DOM bound when both have run out and nothing animates", () => {
    expect(
      at({ frames: 120, elapsed: 2000.1, sinceBusy: 10, sinceAnimated: 500 })
    ).toBe("dom bound");
  });

  it("runs from its own source, as the page receives it", () => {
    const fromSource = new Function(
      `return (${settleVerdict.toString()})`
    )() as typeof settleVerdict;
    expect(fromSource({ ...quiet, sinceBusy: 100 }, bounds)).toBe("settled");
    expect(
      fromSource(
        { ...quiet, elapsed: 2000.1, sinceBusy: 0, sinceAnimated: 0 },
        bounds
      )
    ).toBe("animation bound");
  });
});

describe("unsettledReasons", () => {
  const quietMs = SETTLE_QUIET_MS;

  it("says the DOM was still changing when it changed inside the window", () => {
    expect(unsettledReasons(99.9, [], quietMs)).toEqual(["DOM still changing"]);
    expect(
      unsettledReasons(10, ["span pulse", "div transition opacity"], quietMs)
    ).toEqual(["DOM still changing", "div transition opacity", "span pulse"]);
  });

  it("names what was running, and only that, when the DOM was quiet", () => {
    expect(unsettledReasons(100, ["span pulse"], quietMs)).toEqual([
      "span pulse",
    ]);
    expect(
      unsettledReasons(Infinity, ["div transition opacity", "a b"], quietMs)
    ).toEqual(["a b", "div transition opacity"]);
  });

  it("is never empty: an animation that ended inside the window says so", () => {
    expect(unsettledReasons(Infinity, [], quietMs)).toEqual([
      "an animation ended inside the quiet window",
    ]);
    expect(unsettledReasons(100, [], quietMs)).toEqual([
      "an animation ended inside the quiet window",
    ]);
  });

  it("runs from its own source, as the page receives it", () => {
    const fromSource = new Function(
      `return (${unsettledReasons.toString()})`
    )() as typeof unsettledReasons;
    expect(fromSource(10, ["span pulse"], quietMs)).toEqual([
      "DOM still changing",
      "span pulse",
    ]);
  });
});

describe("an unsettled state", () => {
  const sheet = (opacity: string, unsettled?: string[]) =>
    run({ h: { ...card, opacity } }, [
      test([
        state(
          "002 p0 locator.click",
          { [BOOKS_CARD]: "h" },
          unsettled ? { unsettled } : {}
        ),
      ]),
    ]);

  it("is reported as its own kind, not compared, and keeps the verdict from clean", () => {
    const report = diffRuns(
      sheet("1"),
      sheet("0.4", ["div transition opacity"])
    );
    expect(report.unsettled).toEqual([
      {
        run: "B",
        state: "shipped | books › a card | 002 p0 locator.click",
        animations: ["div transition opacity"],
      },
    ]);
    expect(report.differences).toEqual([]);
    expect(report.statesCompared).toBe(0);
    expect(verdict(report)).toContain("states that did not settle (A 0 / B 1)");
    const text = formatReport(report, { baseLabel: "a", headLabel: "b" });
    expect(text).toContain("| States that did not settle (A / B) | 0 / 1 |");
    expect(text).toContain(
      "- state did not settle in B: `shipped | books › a card | 002 p0 locator.click` — still running: `div transition opacity`"
    );
  });

  it("does not count a settled state as unsettled", () => {
    const report = diffRuns(sheet("1"), sheet("1", []));
    expect(report.unsettled).toEqual([]);
    expect(report.statesCompared).toBe(1);
    expect(verdict(report)).toEqual([]);
  });
});

describe("the tolerated list", () => {
  const ID = "shipped | books › a card";
  const PLAY = "012 p0 locator.click";
  const SPRING = "006 p0 mouse.up";
  const list: ToleratedState[] = [
    { test: ID, state: PLAY, reason: "audio plays", settles: "never" },
    {
      test: ID,
      state: SPRING,
      reason: "springs back at the bound",
      settles: "sometimes",
    },
  ];
  const still = { unsettled: ["DOM still changing"] };
  /** One test holding `keys`, each unsettled when it is in `moving`. */
  const capture = (keys: string[], moving: string[]) =>
    run({ h: card }, [
      test(
        keys.map((k) =>
          state(k, { [BOOKS_CARD]: "h" }, moving.includes(k) ? still : {})
        )
      ),
    ]);
  const all = [PLAY, SPRING, "020 p0 end"];

  it("tolerates a listed state that did not settle, and keeps the verdict clean", () => {
    const a = capture(all, [PLAY, SPRING]);
    const report = diffRuns(a, a, { tolerated: list });
    expect(report.unsettled).toEqual([]);
    expect(report.tolerated.map((t) => [t.run, t.state])).toEqual([
      ["A", `${ID} | ${PLAY}`],
      ["A", `${ID} | ${SPRING}`],
      ["B", `${ID} | ${PLAY}`],
      ["B", `${ID} | ${SPRING}`],
    ]);
    expect(report.statesCompared).toBe(1);
    expect(verdict(report)).toEqual([]);
    const text = formatReport(report, { baseLabel: "a", headLabel: "b" });
    expect(text).toContain("| Tolerated unsettled states (A / B) | 2 / 2 |");
    expect(text).toContain(
      `- tolerated in A: \`${ID} | ${PLAY}\` — audio plays`
    );
  });

  it("still fails on an unsettled state the list does not name", () => {
    const a = capture(all, [PLAY, "020 p0 end"]);
    const report = diffRuns(a, capture(all, [PLAY]), { tolerated: list });
    expect(report.unsettled.map((u) => [u.run, u.state])).toEqual([
      ["A", `${ID} | 020 p0 end`],
    ]);
    expect(verdict(report)).toEqual(["states that did not settle (A 1 / B 0)"]);
  });

  it("fails on a listed never-settling state that settled, and prints a stale tolerance line", () => {
    const report = diffRuns(capture(all, [PLAY]), capture(all, []), {
      tolerated: list,
    });
    expect(
      report.staleTolerances.map((s) => [s.run, s.state, s.settles])
    ).toEqual([
      ["A", `${ID} | ${SPRING}`, "sometimes"],
      ["B", `${ID} | ${PLAY}`, "never"],
      ["B", `${ID} | ${SPRING}`, "sometimes"],
    ]);
    expect(verdict(report)).toEqual(["stale tolerances: 1"]);
    const text = formatReport(report, { baseLabel: "a", headLabel: "b" });
    expect(text).toContain(
      `Stale tolerance in B: \`${ID} | ${PLAY}\` settled — fails: listed as never settling (audio plays)`
    );
  });

  it("only warns when a listed sometimes-settling state settled", () => {
    const a = capture(all, [PLAY]);
    const report = diffRuns(a, a, { tolerated: list });
    expect(verdict(report)).toEqual([]);
    const text = formatReport(report, { baseLabel: "a", headLabel: "b" });
    expect(text).toContain(
      `Stale tolerance in A: \`${ID} | ${SPRING}\` settled — warning: listed as settling in some runs (springs back at the bound)`
    );
    expect(text.split("\n")[2]).toBe("Verdict: clean");
  });

  it("fails on a listed state a run did not capture", () => {
    const report = diffRuns(
      capture(all, [PLAY, SPRING]),
      capture([PLAY, "020 p0 end"], [PLAY]),
      { tolerated: list }
    );
    expect(report.toleratedNotCaptured).toEqual([
      { run: "B", state: `${ID} | ${SPRING}` },
    ]);
    expect(verdict(report)).toContain("tolerated states not captured: 1");
    expect(formatReport(report, { baseLabel: "a", headLabel: "b" })).toContain(
      `- tolerated state not captured in B: \`${ID} | ${SPRING}\``
    );
  });

  it("matches a listed state a run collapsed into the one before it", () => {
    const b = run({ h: card }, [
      test([state("005 p0 mouse.move", { [BOOKS_CARD]: "h" })], {
        sameAs: { [SPRING]: "005 p0 mouse.move" },
      }),
    ]);
    const report = diffRuns(b, b, {
      tolerated: [list[1] as ToleratedState],
    });
    expect(report.toleratedNotCaptured).toEqual([]);
    expect(verdict(report)).toEqual([]);
  });

  it("holds unique, well-formed entries, each with a reason", () => {
    const ids = TOLERATED.map((t) => `${t.test} | ${t.state}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOLERATED) {
      expect(t.state).toMatch(/^\d{3} p\d+ \S+$/);
      expect(t.test).toMatch(/^[\w-]+ \| \S/);
      expect(t.reason).toMatch(/^\S.*\S$/);
    }
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

/**
 * The capture config's projects (#954): every project `playwright.config.ts`
 * lists, moved to the capture ports, except the ones named as not captured.
 * The provisional-template build (#1450) is one of those: the capture is of
 * the shipped app, and that build is not something it compares.
 */
describe("the capture config's projects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function captureConfig() {
    vi.stubEnv("STYLE_CAPTURE_DIR", tmpdir());
    vi.stubEnv("STYLE_DIFF_DIST", "dist");
    vi.stubEnv("STYLE_DIFF_DIST_E2E", "dist-e2e");
    vi.resetModules();
    return (await import("../playwright.style-diff.config")).default;
  }

  it("loads with its environment, leaves the template-packages project out, and moves every other project to 4340 or 4341", async () => {
    const config = await captureConfig();
    const base = (await import("../playwright.config")).default;
    const names = (config.projects ?? []).map((p) => p.name);
    expect(names).not.toContain("chromium-template-packages");
    expect(names).toEqual(
      (base.projects ?? [])
        .map((p) => p.name)
        .filter((n) => n !== "chromium-template-packages")
    );
    expect(names.length).toBeGreaterThan(0);
    for (const project of config.projects ?? []) {
      expect(["4340", "4341"]).toContain(
        new URL(String(project.use?.baseURL)).port
      );
    }
  });

  it("still throws for a project on a port it has no entry for, unless that project is named as not captured", async () => {
    const { captureProjects, NOT_CAPTURED } =
      await import("../playwright.style-diff.config");
    const at = (name: string, port: number) => ({
      name,
      use: { baseURL: `http://127.0.0.1:${port}` },
    });
    expect(() => captureProjects([at("chromium-new-build", 4399)])).toThrow(
      "no style-diff port for http://127.0.0.1:4399"
    );
    expect(NOT_CAPTURED).toEqual(["chromium-template-packages"]);
    expect(
      captureProjects([
        at("chromium-template-packages", 4302),
        at("chromium-shipped-build", 4301),
      ])
    ).toEqual([at("chromium-shipped-build", 4341)]);
  });
});
