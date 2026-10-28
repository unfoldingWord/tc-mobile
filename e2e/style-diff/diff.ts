import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The comparator half of the computed-style diff tool (#954).
 *
 * `diffRuns` is pure: it takes two loaded capture runs and returns what
 * differs, state by state, element by element and property by property.
 * `loadRun` reads a capture directory written by `e2e/style-diff/capture.ts`,
 * `formatReport` renders a report as the Markdown a PR comment carries, and
 * the CLI at the foot ties the three together (`npm run style:diff`).
 *
 * The unit tests are `tests/style-diff.test.ts`. How a lane runs the whole
 * tool is in `playwright.style-diff.config.ts`.
 */

/** One element's computed style: property name to computed value. */
export type StyleMap = Record<string, string>;

/** One snapshot of one page, as `capture.ts` writes it. */
export interface CaptureState {
  /** `<ordinal> p<page> <action>`, unique within its test. */
  key: string;
  url: string;
  /** Structural element path to style-map hash. */
  elements: Record<string, string>;
  /** Element path to the properties an animation or transition drove. */
  animated: Record<string, string[]>;
  /** Indices into the test's `selectors` table that matched an element. */
  matched: number[];
}

/** One test's capture file. */
export interface CaptureTest {
  id: string;
  project: string;
  spec: string;
  title: string;
  status: string;
  expectedStatus: string;
  captureErrors: number;
  errorSamples: string[];
  collapsed: number;
  selectors: string[];
  states: CaptureState[];
}

/** One whole capture directory, loaded. */
export interface CaptureRun {
  tests: CaptureTest[];
  styles: Record<string, StyleMap>;
  /** Every `@layer components` selector the run's pages loaded. */
  selectors: string[];
}

export interface DiffOptions {
  /** Custom properties renamed between the runs: old name to new name. */
  renameProps?: Record<string, string>;
  /** Properties left out of the comparison by name. The report prints them. */
  ignoreProps?: string[];
}

export interface Difference {
  property: string;
  before: string;
  after: string;
  /** How many (state, element) pairs carry this exact change. */
  count: number;
  samples: { path: string; state: string }[];
}

export interface DiffReport {
  statesCompared: number;
  statesOnlyInA: string[];
  statesOnlyInB: string[];
  failedTests: { run: "A" | "B"; id: string; status: string }[];
  captureErrors: { A: number; B: number };
  elementsCompared: number;
  valuesCompared: number;
  animatedExcluded: number;
  differences: Difference[];
  /** Components-layer selectors in run B that matched no element in any B state. */
  uncoveredSelectors: string[];
  ignored: string[];
  renamed: Record<string, string>;
}

/** The marker for "this element or property is not there in that run". */
export const ABSENT = "(absent)";
const SAMPLE_LIMIT = 3;

const stateId = (test: CaptureTest, state: CaptureState) =>
  `${test.id} | ${state.key}`;

const isFailed = (test: CaptureTest) => test.status !== test.expectedStatus;

/** A property an animation drove: the name itself, or a longhand of that shorthand. */
const drivenBy = (property: string, driven: readonly string[]) =>
  driven.some((d) => property === d || property.startsWith(`${d}-`));

export function diffRuns(
  a: CaptureRun,
  b: CaptureRun,
  options: DiffOptions = {}
): DiffReport {
  const renamed = options.renameProps ?? {};
  const ignored = new Set(options.ignoreProps ?? []);
  const statesA = new Map<string, CaptureState>();
  const statesB = new Map<string, CaptureState>();
  for (const t of a.tests)
    for (const s of t.states) statesA.set(stateId(t, s), s);
  for (const t of b.tests)
    for (const s of t.states) statesB.set(stateId(t, s), s);

  const report: DiffReport = {
    statesCompared: 0,
    statesOnlyInA: [...statesA.keys()].filter((k) => !statesB.has(k)).sort(),
    statesOnlyInB: [...statesB.keys()].filter((k) => !statesA.has(k)).sort(),
    failedTests: [
      ...a.tests
        .filter(isFailed)
        .map((t) => ({ run: "A" as const, id: t.id, status: t.status })),
      ...b.tests
        .filter(isFailed)
        .map((t) => ({ run: "B" as const, id: t.id, status: t.status })),
    ],
    captureErrors: {
      A: a.tests.reduce((n, t) => n + t.captureErrors, 0),
      B: b.tests.reduce((n, t) => n + t.captureErrors, 0),
    },
    elementsCompared: 0,
    valuesCompared: 0,
    animatedExcluded: 0,
    differences: [],
    uncoveredSelectors: [],
    ignored: [...ignored].sort(),
    renamed: { ...renamed },
  };

  const renameMap = (map: StyleMap): StyleMap => {
    const out: StyleMap = {};
    for (const [k, v] of Object.entries(map)) out[renamed[k] ?? k] = v;
    return out;
  };
  /** Each (hashA, hashB) pair is compared once; elements reuse the result. */
  const pairCache = new Map<
    string,
    { total: number; changes: [string, string, string][] }
  >();
  const compareMaps = (ha: string, hb: string) => {
    const cacheKey = `${ha}|${hb}`;
    const hit = pairCache.get(cacheKey);
    if (hit) return hit;
    const ma = renameMap(a.styles[ha] ?? {});
    const mb = b.styles[hb] ?? {};
    const props = new Set([...Object.keys(ma), ...Object.keys(mb)]);
    const changes: [string, string, string][] = [];
    for (const p of props) {
      const va = ma[p] ?? ABSENT;
      const vb = mb[p] ?? ABSENT;
      if (va !== vb) changes.push([p, va, vb]);
    }
    const result = { total: props.size, changes };
    pairCache.set(cacheKey, result);
    return result;
  };

  const groups = new Map<string, Difference>();
  const note = (
    property: string,
    before: string,
    after: string,
    path: string,
    state: string
  ) => {
    const key = JSON.stringify([property, before, after]);
    let group = groups.get(key);
    if (!group) {
      group = { property, before, after, count: 0, samples: [] };
      groups.set(key, group);
    }
    group.count += 1;
    if (group.samples.length < SAMPLE_LIMIT)
      group.samples.push({ path, state });
  };

  for (const [id, sa] of statesA) {
    const sb = statesB.get(id);
    if (!sb) continue;
    report.statesCompared += 1;
    const paths = new Set([
      ...Object.keys(sa.elements),
      ...Object.keys(sb.elements),
    ]);
    for (const path of paths) {
      const ha = sa.elements[path];
      const hb = sb.elements[path];
      if (ha === undefined || hb === undefined) {
        note(
          "(element)",
          ha === undefined ? ABSENT : "present",
          hb === undefined ? ABSENT : "present",
          path,
          id
        );
        continue;
      }
      report.elementsCompared += 1;
      const driven = [
        ...(sa.animated[path] ?? []).map((p) => renamed[p] ?? p),
        ...(sb.animated[path] ?? []),
      ];
      const { total, changes } = compareMaps(ha, hb);
      report.valuesCompared += total;
      for (const [property, before, after] of changes) {
        if (ignored.has(property)) continue;
        if (drivenBy(property, driven)) {
          report.animatedExcluded += 1;
          continue;
        }
        note(property, before, after, path, id);
      }
    }
  }

  report.differences = [...groups.values()].sort(
    (x, y) => y.count - x.count || x.property.localeCompare(y.property)
  );
  const matchedB = new Set<string>();
  for (const t of b.tests) {
    for (const s of t.states) {
      for (const i of s.matched) {
        const selector = t.selectors[i];
        if (selector !== undefined) matchedB.add(selector);
      }
    }
  }
  report.uncoveredSelectors = b.selectors
    .filter((s) => !matchedB.has(s))
    .sort();
  return report;
}

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;

/** Reads a capture directory. Throws when it holds no test files. */
export function loadRun(dir: string): CaptureRun {
  const testsDir = join(dir, "tests");
  const stylesDir = join(dir, "styles");
  if (!existsSync(testsDir))
    throw new Error(`no capture in ${dir}: ${testsDir} is missing`);
  const tests = readdirSync(testsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<CaptureTest>(join(testsDir, f)));
  if (tests.length === 0)
    throw new Error(`no capture in ${dir}: no test files`);
  const styles: Record<string, StyleMap> = {};
  if (existsSync(stylesDir)) {
    for (const f of readdirSync(stylesDir)) {
      if (f.endsWith(".json"))
        styles[f.slice(0, -5)] = readJson<StyleMap>(join(stylesDir, f));
    }
  }
  const selectorsFile = join(dir, "selectors.json");
  const selectors = existsSync(selectorsFile)
    ? readJson<string[]>(selectorsFile)
    : [];
  return { tests, styles, selectors };
}

export interface ReportContext {
  baseLabel: string;
  headLabel: string;
  /** Lines of detail shown before the rest is cut to a count. */
  cap?: number;
}

/** The report as Markdown, with the details capped at `cap` lines. */
export function formatReport(
  report: DiffReport,
  context: ReportContext
): string {
  const cap = context.cap ?? 200;
  const total = report.differences.length;
  const lines: string[] = [
    `Computed-style diff: A = ${context.baseLabel}, B = ${context.headLabel}`,
    "",
    "| Figure | Value |",
    "| --- | --- |",
    `| States compared | ${report.statesCompared} |`,
    `| States only in A | ${report.statesOnlyInA.length} |`,
    `| States only in B | ${report.statesOnlyInB.length} |`,
    `| Tests failed (A / B) | ${report.failedTests.filter((f) => f.run === "A").length} / ${report.failedTests.filter((f) => f.run === "B").length} |`,
    `| Capture errors (A / B) | ${report.captureErrors.A} / ${report.captureErrors.B} |`,
    `| Elements compared | ${report.elementsCompared} |`,
    `| Values compared | ${report.valuesCompared} |`,
    `| Values left out as animated | ${report.animatedExcluded} |`,
    `| Distinct differences | ${total} |`,
    `| Components-layer selectors matched in no B state | ${report.uncoveredSelectors.length} |`,
    `| Ignored properties | ${report.ignored.length === 0 ? "none" : report.ignored.join(", ")} |`,
    `| Renamed properties | ${
      Object.keys(report.renamed).length === 0
        ? "none"
        : Object.entries(report.renamed)
            .map(([o, n]) => `${o} → ${n}`)
            .join(", ")
    } |`,
    "",
  ];
  const detail: string[] = [];
  for (const d of report.differences) {
    const sample = d.samples[0];
    detail.push(
      `- \`${d.property}\`: \`${d.before}\` → \`${d.after}\` ×${d.count}` +
        (sample ? ` — e.g. \`${sample.path}\` in \`${sample.state}\`` : "")
    );
  }
  for (const s of report.statesOnlyInA)
    detail.push(`- state only in A: \`${s}\``);
  for (const s of report.statesOnlyInB)
    detail.push(`- state only in B: \`${s}\``);
  for (const f of report.failedTests)
    detail.push(`- test failed in ${f.run} (${f.status}): \`${f.id}\``);
  if (detail.length > 0) {
    const shown = detail.slice(0, cap);
    lines.push(
      "<details><summary>Differences, unmatched states and failed tests" +
        (detail.length > cap
          ? ` (first ${cap} of ${detail.length} lines)`
          : ` (${detail.length} lines)`) +
        "</summary>",
      "",
      ...shown,
      "",
      "</details>",
      ""
    );
  }
  if (report.uncoveredSelectors.length > 0) {
    const shown = report.uncoveredSelectors.slice(0, cap);
    lines.push(
      "<details><summary>Components-layer selectors matched in no B state" +
        (report.uncoveredSelectors.length > cap
          ? ` (first ${cap} of ${report.uncoveredSelectors.length})`
          : "") +
        "</summary>",
      "",
      ...shown.map((s) => `- \`${s}\``),
      "",
      "</details>",
      ""
    );
  }
  lines.push(
    "What this cannot see: states no e2e test reaches, `:hover`/`:active` the suite never produces, any engine but headless Chromium, and a real phone."
  );
  return lines.join("\n");
}

export interface CliArgs {
  a: string;
  b: string;
  options: DiffOptions;
  baseLabel: string;
  headLabel: string;
  json: boolean;
}

/** Parses `<dirA> <dirB> [--rename-prop old=new]… [--ignore prop]… [--base x] [--head y] [--json]`. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const dirs: string[] = [];
  const renameProps: Record<string, string> = {};
  const ignoreProps: string[] = [];
  let baseLabel = "";
  let headLabel = "";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--rename-prop") {
      const pair = value();
      const eq = pair.indexOf("=");
      if (eq <= 0 || eq === pair.length - 1)
        throw new Error(`--rename-prop takes old=new, got ${pair}`);
      renameProps[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (arg === "--ignore") ignoreProps.push(value());
    else if (arg === "--base") baseLabel = value();
    else if (arg === "--head") headLabel = value();
    else if (arg === "--json") json = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else dirs.push(arg);
  }
  const [a, b] = dirs;
  if (dirs.length !== 2 || a === undefined || b === undefined) {
    throw new Error(
      "usage: style:diff <dirA> <dirB> [--rename-prop old=new] [--ignore prop] [--base label] [--head label] [--json]"
    );
  }
  return {
    a,
    b,
    options: { renameProps, ignoreProps },
    baseLabel: baseLabel || a,
    headLabel: headLabel || b,
    json,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const report = diffRuns(loadRun(args.a), loadRun(args.b), args.options);
  process.stdout.write(
    args.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatReport(report, { baseLabel: args.baseLabel, headLabel: args.headLabel })}\n`
  );
  const clean =
    report.differences.length === 0 &&
    report.statesOnlyInA.length === 0 &&
    report.statesOnlyInB.length === 0 &&
    report.failedTests.length === 0;
  process.exitCode = clean ? 0 : 1;
}
