import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The invariant-1 history boundary, asserted rather than described (#452 PR2,
 * docs/design/back-navigation.md: "Enforced by a lint rule banning `history.*`
 * calls outside `hooks/use-nav-stack.ts`"). `HISTORY_BOUNDARY_RULES` in
 * `eslint.config.mjs` bans the `history` object at its access points — the bare
 * `history` global, `window.history` / `globalThis.history`, `onpopstate`, and
 * `addEventListener("popstate", …)` — across the `app`/`components`/`hooks`
 * layers, and is turned back off for the adapter itself.
 *
 * This test lints SYNTHETIC probes only — it never sweeps `src/`. The probes
 * live in `.nav-history-probe/` at the repo root; that path is added to the
 * `eslint.config.mjs` hooks-block `files` so a probe is linted against the REAL
 * hooks-layer rule (not a throwaway config a mutation could not catch), and to
 * `ignores` so a leftover does not fail a real `eslint .` — the test forces it
 * with `--no-ignore`. Being outside `src/`, a leftover probe cannot reach
 * knip's `src/**` project either.
 *
 * The cases assert both states (AGENTS.md, "a gate is tested in both states"):
 *   - it FIRES on a real violation — `window.history.back()`, a bare
 *     `history.pushState()`, and `addEventListener("popstate", …)`;
 *   - it STAYS GREEN on a legitimate file — one that only mentions `popstate`
 *     in a comment (AST-invisible) and touches other browser APIs
 *     (`localStorage`), never `history`.
 *   - the file-identity exemption is checked with ESLint's `calculateConfigForFile` (the config `--print-config` prints), not by
 *     linting `src/` for violations: the two history-OBJECT rules
 *     (`no-restricted-globals` / `no-restricted-properties`) resolve to `off`
 *     for `src/hooks/use-nav-stack.ts` and to `error` for another hook, while
 *     `no-restricted-syntax` stays ENABLED there with its popstate selector
 *     narrowed out (George R3 P3-4) — so it reads `error` for both.
 *
 * The config checks do not lint the real adapter or test removal of its
 * exemption. The repository lint command checks the adapter itself.
 */

const REPO = join(import.meta.dirname, "..");
const PROBE_DIR = join(REPO, ".nav-history-probe");
const ESLINT = join(REPO, "node_modules", "eslint", "bin", "eslint.js");

// See react-hooks-refs-gate.test.ts: execFileSync is synchronous, so vitest's
// per-it timeout cannot interrupt a blocked child; only Node's own kill can.
const ESLINT_TIMEOUT_MS = 10000;

interface EslintMessage {
  ruleId: string | null;
  fatal?: boolean;
}
interface EslintResult {
  messages: EslintMessage[];
}

/** Lint `source` as a standalone probe; return the rule ids ESLint reported.
 *
 * A `not.toContain(...)` assertion is satisfied just as well by an EMPTY list
 * from a genuine clean analysis as by one from a parse/fatal error, so a fatal
 * message is checked for and thrown on BEFORE reducing to rule ids — a silently
 * vacuous pass becomes a loud failure instead. `--no-ignore` forces ESLint to
 * lint the probe even though `.nav-history-probe` is in the config's `ignores`.
 */
function lintProbe(name: string, source: string): string[] {
  const file = join(PROBE_DIR, `${name}.tsx`);
  writeFileSync(file, source);
  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      [ESLINT, "--no-ignore", "--format", "json", file],
      { cwd: REPO, encoding: "utf8", stdio: "pipe", timeout: ESLINT_TIMEOUT_MS }
    );
  } catch (err) {
    const failure = err as {
      stdout?: string;
      code?: string;
      signal?: string | null;
    };
    if (failure.code === "ETIMEDOUT") {
      throw new Error(
        `ESLint did not finish linting probe "${name}" within ` +
          `${ESLINT_TIMEOUT_MS}ms and was killed (signal ${failure.signal ?? "unknown"}) — ` +
          `treat this as a hang, not a lint result.`
      );
    }
    stdout = String(failure.stdout ?? "");
  }
  const [result] = JSON.parse(stdout) as EslintResult[];
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal);
  if (fatal.length > 0) {
    throw new Error(
      `ESLint could not analyse probe "${name}" (fatal/parse error), so its ` +
        `messages prove nothing about the history boundary: ${JSON.stringify(fatal)}`
    );
  }
  return messages
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
}

/** The resolved config entry of `ruleId` for `file`, via the ESLint Node API's
 * `calculateConfigForFile` — the same resolution `--print-config` prints. This
 * inspects the config for a path without linting the file's contents, so the
 * file-identity exemption is checked without sweeping `src/`. One in-process
 * instance is shared, so the flat config is loaded once rather than once per
 * spawned `eslint` child (#1382). It is built on first use, so only the case
 * that needs it pays for it. That is a cost choice, not a safety one:
 * constructing the instance does not read the flat config, which is read
 * inside `calculateConfigForFile`, so a broken config surfaces in the cases
 * that resolve it (and in the probe cases through their spawned `eslint`), not
 * at collection (#1389). */
let configEslint: ESLint | undefined;

type RuleEntry = [number | string, ...unknown[]] | number | string | undefined;

async function ruleEntryFor(file: string, ruleId: string): Promise<RuleEntry> {
  configEslint ??= new ESLint({ cwd: REPO });
  const config = (await configEslint.calculateConfigForFile(file)) as {
    rules?: Record<string, RuleEntry>;
  };
  return config.rules?.[ruleId];
}

/** The `selector` string of every option, failing closed on shape: an option
 * that is not an object with a string `selector` throws, so a string-form
 * restriction cannot be dropped from both sides of an equality (#1414). */
function selectorsOf(options: readonly unknown[]): string[] {
  return options.map((o, i) => {
    const selector =
      typeof o === "object" && o !== null
        ? (o as { selector?: unknown }).selector
        : undefined;
    if (typeof selector !== "string") {
      throw new Error(
        `no-restricted-syntax option ${i} has no string selector: ${JSON.stringify(o)}`
      );
    }
    return selector;
  });
}

/** The `selector` strings in `ruleId`'s resolved options for `file`. */
async function restrictedSelectorsFor(
  file: string,
  ruleId: string
): Promise<string[]> {
  const entry = await ruleEntryFor(file, ruleId);
  return selectorsOf(Array.isArray(entry) ? entry.slice(1) : []);
}

/** The one selector `eslint.config.mjs` subtracts for the adapter
 * (`HISTORY_POPSTATE_SELECTOR`), matched whole so a different selector whose
 * text merely contains "popstate" is not mistaken for it. The config does not
 * export it; the FIRES case above fails if the config's selector drifts, and
 * the `toHaveLength(1)` below fails if this copy does. */
const POPSTATE_SELECTOR =
  "CallExpression[callee.property.name='addEventListener'][arguments.0.value='popstate']";
const isPopstate = (s: string): boolean => s === POPSTATE_SELECTOR;

/** The resolved level (0/1/2) of `ruleId` for `file`. */
async function ruleLevelFor(file: string, ruleId: string): Promise<number> {
  const entry = await ruleEntryFor(file, ruleId);
  const level = Array.isArray(entry) ? entry[0] : entry;
  if (level === "off" || level === 0) return 0;
  if (level === "warn" || level === 1) return 1;
  if (level === "error" || level === 2) return 2;
  return 0;
}

beforeAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
});

describe("the #452 history boundary — what the lint rule catches", () => {
  it("FIRES no-restricted-properties on window.history.back()", () => {
    const rules = lintProbe(
      "window-history-back",
      `export function leave(): void {
  window.history.back();
}
`
    );
    expect(rules).toContain("no-restricted-properties");
  }, 15000);

  it("FIRES no-restricted-globals on a bare history.pushState()", () => {
    const rules = lintProbe(
      "bare-history-pushstate",
      `export function stamp(): void {
  history.pushState({ tc: true, index: 1 }, "");
}
`
    );
    expect(rules).toContain("no-restricted-globals");
  }, 15000);

  it('FIRES no-restricted-syntax on addEventListener("popstate", …)', () => {
    const rules = lintProbe(
      "addeventlistener-popstate",
      `export function subscribe(handler: (e: PopStateEvent) => void): void {
  window.addEventListener("popstate", handler);
}
`
    );
    expect(rules).toContain("no-restricted-syntax");
  }, 15000);

  it("STAYS GREEN on a legitimate file — popstate only in a comment, and other browser APIs are fine", () => {
    // A comment mentioning popstate/history is invisible to the AST, and
    // localStorage/window.addEventListener for a NON-popstate event are not the
    // history boundary. None of the three history rules may fire here.
    const rules = lintProbe(
      "legit-no-history",
      `// This hook does not touch history or popstate — routing goes through
// use-nav-stack.ts. It only reads localStorage and listens for pagehide.
export function useThing(): string | null {
  window.addEventListener("pagehide", () => {});
  return window.localStorage.getItem("k");
}
`
    );
    expect(rules).not.toContain("no-restricted-properties");
    expect(rules).not.toContain("no-restricted-globals");
    expect(rules).not.toContain("no-restricted-syntax");
  }, 15000);

  it("EXEMPTS src/hooks/use-nav-stack.ts by file identity — the history-OBJECT rules resolve off there and error in another hook; no-restricted-syntax stays enabled, its popstate selector narrowed out (George R3 P3-4)", async () => {
    const adapter = "src/hooks/use-nav-stack.ts";
    const otherHook = "src/hooks/use-recorder.ts";
    // The history OBJECT bans (`history` global, `window.history`,
    // `onpopstate`) are turned fully off for the adapter — it owns them.
    for (const ruleId of [
      "no-restricted-globals",
      "no-restricted-properties",
    ]) {
      expect(await ruleLevelFor(adapter, ruleId)).toBe(0); // off for the adapter
      expect(await ruleLevelFor(otherHook, ruleId)).toBe(2); // error for other hooks
    }
    // no-restricted-syntax is NOT blanket-off for the adapter (George R3 P3-4):
    // the rule stays enabled with only the history popstate selector subtracted,
    // so a future non-history hooks selector still reaches this file.
    // `ruleLevelFor` returns only the level, so it reads `error` (2) here just
    // as for any other hook; the selector set is pinned by the next case.
    expect(await ruleLevelFor(adapter, "no-restricted-syntax")).toBe(2);
    expect(await ruleLevelFor(otherHook, "no-restricted-syntax")).toBe(2);
  }, 15000);

  it("no-restricted-syntax keeps the popstate selector for other hooks and subtracts only that one for the adapter", async () => {
    const adapter = "src/hooks/use-nav-stack.ts";
    const otherHook = "src/hooks/use-recorder.ts";
    const adapterSelectors = await restrictedSelectorsFor(
      adapter,
      "no-restricted-syntax"
    );
    const otherSelectors = await restrictedSelectorsFor(
      otherHook,
      "no-restricted-syntax"
    );
    const notPopstate = (s: string) => !isPopstate(s);
    // Subtracted for the adapter, present for the hook sampled here
    // (src/hooks/use-recorder.ts), not asserted for every hook.
    expect(otherSelectors.filter(isPopstate)).toHaveLength(1);
    expect(adapterSelectors.filter(isPopstate)).toEqual([]);
    // Still enabled for the next selector: the adapter's list is the other
    // hooks' list minus popstate, and it is not empty.
    expect(adapterSelectors.length).toBeGreaterThan(0);
    expect(adapterSelectors).toEqual(otherSelectors.filter(notPopstate));
  }, 15000);

  it("selectorsOf fails closed on an option without a string selector, and exactly matches the popstate selector", () => {
    expect(selectorsOf([{ selector: "A" }, { selector: "B" }])).toEqual([
      "A",
      "B",
    ]);
    expect(() => selectorsOf(["CallExpression"])).toThrow(/option 0/);
    expect(() => selectorsOf([{ selector: "A" }, { selector: 7 }])).toThrow(
      /option 1/
    );
    expect(() => selectorsOf([null])).toThrow(/option 0/);
    expect(isPopstate(POPSTATE_SELECTOR)).toBe(true);
    expect(
      isPopstate(`${POPSTATE_SELECTOR}, Identifier[name='popstate']`)
    ).toBe(false);
    expect(isPopstate("Identifier[name='popstate']")).toBe(false);
  });
});
