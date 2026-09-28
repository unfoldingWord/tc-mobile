import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The `react-hooks/refs` gate, asserted rather than described.
 *
 * The blind spot tracked by #212 is a nested function inside `catch (cause)`
 * that references the caught binding. The fixtures distinguish that shape
 * from a plain render-time ref write and from a closure over a hoisted value.
 * The minimal fixture does not require `useCallback`, `finally`, or `setState`.
 *
 * These are synthetic probes under `.react-hooks-refs-probe/`, not a sweep of
 * `src/`. They cannot prevent a live hook from combining a ref violation with
 * the bail-out shape. Live occurrences require separate review.
 *
 * The silent cases characterize the plugin's blind spot, not desired behavior.
 * If a plugin update reports those violations, the assertions and the matching
 * notes in AGENTS.md and eslint.config.mjs need review.
 *
 *   - a plain render-time ref write, which MUST fire, guards against the rule
 *     being disabled. It deliberately does not contain the bail-out shape.
 *   - the MINIMAL bisected trigger: the same render-time ref write, plus
 *     nothing but a `catch (cause)` whose body defines a closure referencing
 *     `cause`. No `useCallback`, no `finally`, no `setState` — so a later
 *     reader cannot "simplify" this fixture without noticing the bail-out
 *     stops.
 *   - the full develop-era `commit` shape, belt and braces: `useCallback`,
 *     `try/catch/finally`, and `setState` updaters closing over `cause` in
 *     both branches — the exact pattern `use-save-take.ts` had, minus its
 *     real imports. Kept alongside the minimal case so the realistic shape
 *     that actually shipped stays pinned too, not just its reduction.
 *   - the FIX shape, which MUST fire: a `catch (cause)` block that still
 *     defines a nested function, but where that function closes over a value
 *     already read from `cause` (a hoisted `const`), never over `cause`
 *     itself — the `use-books.ts` hoist from George round 3 on #433, plus a
 *     render-time ref write elsewhere in the hook. Without this probe,
 *     nothing pins that "hoist the value first" is what actually escapes the
 *     bail-out, as opposed to "any nested function inside `catch`" being the
 *     trigger — which would make the `use-books.ts` fix a no-op while both
 *     silent probes above kept passing (George round 4).
 */

const REPO = join(import.meta.dirname, "..");
const PROBE_DIR = join(REPO, ".react-hooks-refs-probe");
const ESLINT = join(REPO, "node_modules", "eslint", "bin", "eslint.js");

// Below each `it(...)`'s 15000ms vitest timeout (see lintProbe's docblock) —
// execFileSync is synchronous, so vitest's own timeout cannot interrupt a
// blocked child; this is the only thing that can (Frank, round 2).
const ESLINT_TIMEOUT_MS = 10000;

interface EslintMessage {
  ruleId: string | null;
  fatal?: boolean;
}
interface EslintResult {
  messages: EslintMessage[];
}

/** Lint `source` as a standalone probe file; return the rule ids ESLint reported.
 *
 * A `not.toContain("react-hooks/refs")` assertion (the two blind-spot probes
 * below) is satisfied just as well by an EMPTY rule list from a genuine
 * "silent" analysis as by an empty list from ESLint never analysing the file
 * at all — a parse/fatal error on the probe source would produce the same
 * `[]` and pass the assertion vacuously (Frank, round 1). ESLint marks a
 * parse failure with `fatal: true` on the message rather than a `ruleId`, so
 * that case is checked for and thrown on BEFORE reducing to rule ids, turning
 * a silently-vacuous pass into a loud test failure instead.
 *
 * `execFileSync` runs synchronously, which blocks vitest's own event loop, so
 * the per-`it` 15000ms timeout below cannot fire while ESLint is still
 * running — it can only be checked once this function returns (Frank, round
 * 2). `timeout: ESLINT_TIMEOUT_MS` makes Node itself kill a hung child before
 * that, and the `ETIMEDOUT` branch below turns that into a clear failure
 * instead of `JSON.parse` choking on whatever partial stdout a killed process
 * left behind.
 */
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
      { cwd: REPO, encoding: "utf8", stdio: "pipe", timeout: ESLINT_TIMEOUT_MS }
    );
  } catch (err) {
    const failure = err as {
      stdout?: string;
      code?: string;
      signal?: string | null;
    };
    // execFileSync's OWN timeout kill does NOT set `.killed` on the thrown
    // error (that flag belongs to the async ChildProcess API) — it sets
    // `.code === "ETIMEDOUT"` and `.signal`, confirmed against Node's actual
    // behaviour, not assumed from the async API's shape.
    if (failure.code === "ETIMEDOUT") {
      throw new Error(
        `ESLint did not finish linting probe "${name}" within ` +
          `${ESLINT_TIMEOUT_MS}ms and was killed (signal ${failure.signal ?? "unknown"}) — ` +
          `treat this as a hang, not a lint result.`
      );
    }
    // Non-zero exit means at least one message — the JSON is still on stdout.
    stdout = String(failure.stdout ?? "");
  }
  const [result] = JSON.parse(stdout) as EslintResult[];
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal);
  if (fatal.length > 0) {
    throw new Error(
      `ESLint could not analyse probe "${name}" (fatal/parse error), so its ` +
        `messages prove nothing about react-hooks/refs: ${JSON.stringify(fatal)}`
    );
  }
  return messages
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

  it("stays silent on the MINIMAL bisected bail-out trigger (#212's blind spot)", () => {
    // A render-time ref write plus a catch-local closure over `cause`.
    // Keep the fixture minimal so the caught binding is the distinguishing
    // feature, without `useCallback`, `finally`, or `setState`.
    //
    // CHARACTERIZATION, not a requirement — records what
    // eslint-plugin-react-hooks 7.1.1 actually does with this shape. If a
    // plugin upgrade starts reporting `react-hooks/refs` here too, this
    // assertion fails; when that happens, this is a known bug fixed
    // upstream, not a regression, and the note in eslint.config.mjs (and the
    // matching AGENTS.md entry) should be deleted along with this comment.
    const rules = lintProbe(
      "minimal-bailout",
      `import { useRef } from "react";

export function useMinimalBailedRefsProbe(value: number) {
  const ref = useRef(value);
  ref.current = value;

  async function commit() {
    try {
      await Promise.resolve();
      return true;
    } catch (cause) {
      const handle = () => {
        void cause;
      };
      handle();
      return false;
    }
  }

  return { ref, commit };
}
`
    );
    expect(rules).not.toContain("react-hooks/refs");
  }, 15000);

  it("stays silent on the full develop-era use-save-take.ts commit shape too (belt and braces)", () => {
    // Standalone reproduction of the shape `commit` actually had in
    // use-save-take.ts before #180: a `useCallback` with a render-time ref
    // write earlier in the same hook body, and a
    // `try { ... } catch (cause) { ... } finally { ... }` whose catch branch
    // hands a `setState` updater a closure that captures `cause`. Real deps
    // (`saveTake`, `succeedSave`, `failSave`, `saveFailureKind`) are stubbed
    // so the probe lints standalone; the shape that matters is preserved
    // verbatim. Kept alongside the minimal probe above — that one pins the
    // reduction, this one pins the shape that actually shipped.
    //
    // CHARACTERIZATION, not a requirement — see the comment on the minimal
    // case above; the same "this is not a bug to be fixed here" applies.
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

  it("fires on a render-time ref write next to a catch(cause) that hoists the caught value before its nested updater (the use-books.ts fix shape, George round 4 on #433)", () => {
    // Pins the FIX, not just the trigger: `catch (cause)` can still define a
    // nested function here — the guard is that the nested function closes
    // over a value already read from `cause` BEFORE the closure, never over
    // `cause` itself. Without this probe, "any nested function inside catch"
    // could be (mis)read as the trigger, the src/hooks/use-books.ts hoist
    // would be a no-op, both silent probes above would still pass, and a
    // render-time ref write on the Books shelf would ship the same way #212
    // did.
    //
    // Standalone reproduction of the shape use-books.ts's load effect has
    // after the round-3 fix: a `useEffect` running an async IIFE, `catch
    // (cause)` hoisting `message` before a `setState` updater that
    // references `message`, not `cause` — plus a render-time ref write
    // elsewhere in the hook, which MUST still fire.
    const rules = lintProbe(
      "hoisted-cause-still-fires",
      `import { useEffect, useRef, useState } from "react";

export function useHoistedCauseRefsProbe(value: number) {
  const ref = useRef(value);
  ref.current = value;

  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await Promise.resolve();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setFailure((prev) => prev ?? message);
      }
    })();
  }, []);

  return { ref, failure };
}
`
    );
    expect(rules).toContain("react-hooks/refs");
  }, 15000);
});
