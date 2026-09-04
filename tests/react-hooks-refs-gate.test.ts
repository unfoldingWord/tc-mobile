import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The `react-hooks/refs` gate, asserted rather than described.
 *
 * #212: on `develop`, `src/hooks/use-save-take.ts` wrote
 * `onSavedRef.current = onSaved` during render — a real `react-hooks/refs`
 * violation — and `npm run lint` reported nothing. The rule was enabled the
 * whole time (`pluginReactHooks.configs.recommended.rules` in
 * `eslint.config.mjs`); it only started firing once PR #180 simplified the
 * `commit` callback. So the rule's own analysis was bailing out of that hook
 * body, silently, before #180 — and the bail-out is a property of the hook's
 * *shape*, not of whether the file happens to violate the rule.
 *
 * This test pins two probes:
 *   - a plain render-time ref write, which MUST fire. This is the guarding
 *     assertion: it is what would have caught #212 before the fact, and
 *     mutation (see the eslint.config.mjs edit below, done by hand and
 *     reverted) is how it is proven to guard anything at all.
 *   - the develop-era `commit` shape reproduced standalone: a `useCallback`
 *     whose `catch (cause) { ... }` block passes a `setState` updater that
 *     closes over `cause` — the exact pattern `use-save-take.ts` had, minus
 *     its real imports. Bisecting the real file (see the PR body) found the
 *     bail-out does not need `useCallback`, `finally`, or even `setState`
 *     specifically: ANY nested function defined inside a `catch` block that
 *     references the caught binding, anywhere in a hook's body, silences
 *     `react-hooks/refs` for the WHOLE of that hook — including an unrelated
 *     ref write earlier in the same body. A second hook in the same FILE is
 *     unaffected, so the bail-out is scoped per hook function, not per file.
 *     That is narrower and stranger than "try/catch/finally inside
 *     useCallback" (this issue's working theory) or a `catch` clause on its
 *     own (a `catch` with no such closure does not bail) — it is the
 *     closure-over-the-catch-binding specifically.
 */

const REPO = join(import.meta.dirname, "..");
const PROBE_DIR = join(REPO, ".react-hooks-refs-probe");
const ESLINT = join(REPO, "node_modules", "eslint", "bin", "eslint.js");

interface EslintMessage {
  ruleId: string | null;
}
interface EslintResult {
  messages: EslintMessage[];
}

/** Lint `source` as a standalone probe file; return the rule ids ESLint reported. */
function lintProbe(name: string, source: string): string[] {
  const file = join(PROBE_DIR, `${name}.tsx`);
  writeFileSync(file, source);
  let stdout: string;
  try {
    // eslint exits 0 when clean; capture stdout either way.
    // --no-ignore: the probe dir is in eslint.config.mjs's `ignores` (so a
    // leftover probe from an interrupted run does not fail a real `eslint .`
    // sweep), which would otherwise make an explicitly-targeted probe file
    // lint as empty here too.
    stdout = execFileSync(
      process.execPath,
      [ESLINT, "--no-ignore", "--format", "json", file],
      { cwd: REPO, encoding: "utf8", stdio: "pipe" }
    );
  } catch (err) {
    // Non-zero exit means at least one message — the JSON is still on stdout.
    stdout = String((err as { stdout?: string }).stdout ?? "");
  }
  const [result] = JSON.parse(stdout) as EslintResult[];
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
}

beforeAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
});

describe("react-hooks/refs — what the gate actually catches", () => {
  // Each case spawns a real eslint process, which under a full parallel
  // `vitest run` can run past the 5s default (tests/lib-boundary.test.ts
  // hits the same cost spawning tsc). 15s leaves headroom without hiding a
  // genuine hang.
  it("fires on a plain render-time ref write", () => {
    // The guarding assertion. Proven by mutation, not just by running once:
    // with `"react-hooks/refs": "off"` spliced into this probe's own ESLint
    // invocation (done by hand — see the PR body for the exact diff and the
    // failure it produced), this assertion fails, so the case is not
    // vacuously true.
    const rules = lintProbe(
      "plain-write",
      `import { useRef } from "react";

export function usePlainRefsProbe(value: number) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
`
    );
    expect(rules).toContain("react-hooks/refs");
  }, 15000);

  it("stays silent on the develop-era use-save-take.ts commit shape (#212's blind spot)", () => {
    // Standalone reproduction of the shape `commit` had in use-save-take.ts
    // before #180: a `useCallback` with a render-time ref write earlier in
    // the same hook body, and a `try { ... } catch (cause) { ... } finally
    // { ... }` whose catch branch hands a `setState` updater a closure that
    // captures `cause`. Real deps (`saveTake`, `succeedSave`, `failSave`,
    // `saveFailureKind`) are stubbed so the probe lints standalone; the
    // shape that matters is preserved verbatim.
    //
    // This assertion is a CHARACTERIZATION, not a requirement — it records
    // what eslint-plugin-react-hooks 7.1.1 actually does with this shape. If
    // a plugin upgrade starts reporting `react-hooks/refs` here too, this
    // assertion fails; when that happens, this is a known bug fixed
    // upstream, not a regression, and the note in eslint.config.mjs (and the
    // matching AGENTS.md entry) should be deleted along with this comment.
    const rules = lintProbe(
      "bailed-commit-shape",
      `import { useCallback, useRef, useState } from "react";

type PendingTake = { clipId: string };

function saveTake(...args: unknown[]): Promise<void> {
  return Promise.resolve(args as never);
}
function succeedSave(held: unknown, clipId: string): unknown {
  return { held, clipId };
}
function failSave(held: unknown, clipId: string, kind: unknown): unknown {
  return { held, clipId, kind };
}
function saveFailureKind(cause: unknown): unknown {
  return cause;
}

export function useBailedRefsProbe(onSaved?: () => void) {
  const [, setPending] = useState<PendingTake | null>(null);
  const savingRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const commit = useCallback(async (take: PendingTake): Promise<boolean> => {
    savingRef.current = true;
    try {
      await saveTake(take.clipId);
      setPending((held) => succeedSave(held, take.clipId) as PendingTake);
      onSavedRef.current?.();
      return true;
    } catch (cause) {
      setPending(
        (held) =>
          failSave(held, take.clipId, saveFailureKind(cause)) as PendingTake
      );
      return false;
    } finally {
      savingRef.current = false;
    }
  }, []);

  return { commit };
}
`
    );
    expect(rules).not.toContain("react-hooks/refs");
  }, 15000);
});
