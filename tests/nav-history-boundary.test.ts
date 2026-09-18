import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
 * Both states are proven (AGENTS.md, "a gate is tested in both states"):
 *   - it FIRES on a real violation — `window.history.back()`, a bare
 *     `history.pushState()`, and `addEventListener("popstate", …)`;
 *   - it STAYS GREEN on a legitimate file — one that only mentions `popstate`
 *     in a comment (AST-invisible) and touches other browser APIs
 *     (`localStorage`), never `history`.
 *   - the file-identity exemption is checked with `--print-config`, not by
 *     linting `src/` for violations: the three rules resolve to `off` for
 *     `src/hooks/use-nav-stack.ts` and to `error` for another hook.
 *
 * The exemption's LOAD-BEARINGNESS (that removing the override flags the real
 * adapter) is proven by mutation in the PR body and by `npm run verify` staying
 * green WITH the override — it is not re-swept here.
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

/** The resolved level (0/1/2) of `ruleId` for `file`, via `eslint --print-config`.
 * This inspects the config for a path without linting the file's contents, so
 * the file-identity exemption is checked without sweeping `src/`. */
function ruleLevelFor(file: string, ruleId: string): number {
  const stdout = execFileSync(
    process.execPath,
    [ESLINT, "--print-config", file],
    { cwd: REPO, encoding: "utf8", stdio: "pipe", timeout: ESLINT_TIMEOUT_MS }
  );
  const config = JSON.parse(stdout) as {
    rules?: Record<string, [number | string, ...unknown[]] | number | string>;
  };
  const entry = config.rules?.[ruleId];
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

  it("EXEMPTS src/hooks/use-nav-stack.ts by file identity — the three rules resolve off there and error in another hook", () => {
    const adapter = "src/hooks/use-nav-stack.ts";
    const otherHook = "src/hooks/use-recorder.ts";
    for (const ruleId of [
      "no-restricted-globals",
      "no-restricted-properties",
      "no-restricted-syntax",
    ]) {
      expect(ruleLevelFor(adapter, ruleId)).toBe(0); // off for the adapter
      expect(ruleLevelFor(otherHook, ruleId)).toBe(2); // error for other hooks
    }
  }, 15000);
});
