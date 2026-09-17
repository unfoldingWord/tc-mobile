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
 * Bisecting the real file (delete/simplify, re-lint, repeat) found the
 * trigger: ANY nested function defined inside a `catch (cause) { ... }`
 * block that references the caught binding, anywhere in a hook's body,
 * silences `react-hooks/refs` for the WHOLE of that hook — including an
 * unrelated ref write earlier in the same body. `useCallback`, `finally`,
 * and `setState` specifically are all NOT required — confirmed by cutting
 * each away in turn and re-linting. A second hook in the same FILE is
 * unaffected, so the bail-out is scoped per hook function, not per file, and
 * a `catch` with no such closure does not bail on its own. That is narrower
 * and stranger than "try/catch/finally inside useCallback" (this issue's
 * working theory) — it is the closure-over-the-catch-binding specifically.
 *
 * This test pins three probes. It does NOT, by itself, prevent a future hook
 * from combining a real render-time ref violation with the bail-out shape
 * below and shipping undetected — that would still slip past `react-hooks/refs`
 * exactly as #212 did, because the bail-out is a property of ESLint's own
 * analysis, not something a test on the side can intercept. What this file
 * pins is narrower and is what #212 actually asked for: (1) that the rule
 * still fires at all on an ordinary violation — so a future ESLint/plugin
 * upgrade, or a config accident, that disables `react-hooks/refs` outright is
 * caught here, in CI, rather than only in a reviewer's head — and (2) that
 * the specific bail-out shape is characterised, so a plugin fix that starts
 * reporting it again is noticed (the assertion flips) instead of the blind
 * spot silently narrowing further unremarked. The actual hazardous instance
 * (`use-save-take.ts`) is fixed separately by #213, and a tree sweep (see the
 * third commit's message) found no other hook in `src/` with this shape as of
 * that commit — closing the concrete risk is out-of-band from this gate, by
 * design; AGENTS.md and eslint.config.mjs both carry the same caveat beside
 * the rule so a reviewer sees it without needing to find this file.
 *
 *   - a plain render-time ref write, which MUST fire. This is the guarding
 *     assertion, proven non-vacuous by mutation (see the eslint.config.mjs
 *     edit below, done by hand and reverted) — it establishes that the check
 *     mechanism actually distinguishes a violation from silence, not that
 *     this specific probe reproduces #212's shape (it deliberately does not;
 *     the two probes below do).
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
 */

const REPO = join(import.meta.dirname, "..");
const PROBE_DIR = join(REPO, ".react-hooks-refs-probe");
const ESLINT = join(REPO, "node_modules", "eslint", "bin", "eslint.js");

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
      { cwd: REPO, encoding: "utf8", stdio: "pipe" }
    );
  } catch (err) {
    // Non-zero exit means at least one message — the JSON is still on stdout.
    stdout = String((err as { stdout?: string }).stdout ?? "");
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

  it("stays silent on the MINIMAL bisected bail-out trigger (#212's blind spot)", () => {
    // The reduction, not the realistic shape: a render-time ref write plus
    // nothing else but a `catch (cause)` block whose body defines a closure
    // that references `cause`. No `useCallback`, no `finally`, no
    // `setState` — each was cut away in turn against the real file and the
    // bail-out held every time. This is the fixture that must stay exactly
    // this small: trimming the closure's reference to `cause`, or the catch
    // block itself, makes the guarding case above start failing here
    // instead — which is the point, not a bug in the test.
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
});
