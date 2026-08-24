import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The lib/ boundary, asserted rather than described.
 *
 * AGENTS.md calls "lib/ must stay free of DOM, Web Audio and MediaRecorder"
 * the rule that matters most, and until 2026-08-24 nothing enforced it at all.
 * Two mechanisms now do, and neither is complete on its own:
 *
 *   - eslint no-restricted-globals catches VALUE references, in the editor.
 *   - tsconfig.lib.json compiles lib/ with no DOM lib, catching TYPE positions.
 *
 * The compile gate has a residual: `"types": ["node"]` pulls in Node's own web
 * globals, so `Navigator` and `Storage` type-check inside lib/. That is a
 * deliberate line — everything in that set runs in plain Node and in a Worker,
 * which is the property the rule protects — but a line nobody checks drifts.
 * This test pins both halves.
 */

const REPO = join(import.meta.dirname, "..");
const PROBE_DIR = join(REPO, ".lib-boundary-probe");

/** Compile `source` under tsconfig.lib.json's options; return tsc's output. */
function compileInLib(source: string): string {
  writeFileSync(join(PROBE_DIR, "probe.ts"), source);
  try {
    execFileSync("npx", ["tsc", "-p", join(PROBE_DIR, "tsconfig.json")], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
    });
    return "";
  } catch (err) {
    // tsc exits non-zero on a type error and puts diagnostics on stdout.
    return String((err as { stdout?: string }).stdout ?? "");
  }
}

beforeAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(
    join(PROBE_DIR, "tsconfig.json"),
    JSON.stringify({
      extends: "../tsconfig.lib.json",
      include: ["probe.ts"],
    }),
    { flag: "w" }
  );
});

afterAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
});

describe("the lib/ DOM boundary", () => {
  it.each([
    "AudioContext",
    "OfflineAudioContext",
    "AudioBuffer",
    "MediaRecorder",
    "MediaStream",
    "HTMLAudioElement",
  ])("rejects %s in type position", (name) => {
    const out = compileInLib(`export function f(x: ${name}): number {
  return Object.keys(x).length;
}
`);
    expect(out).toContain(`Cannot find name '${name}'`);
  });

  it("rejects document and window in type position", () => {
    const out = compileInLib(`export const a: typeof document = null as never;
export const b: typeof window = null as never;
`);
    expect(out).toContain("Cannot find name 'document'");
    expect(out).toContain("Cannot find name 'window'");
  });

  it("accepts the Node-available types lib/ genuinely uses", () => {
    // Blob is what lib/storage types its media records on. If this ever fails,
    // the fix is to restore the type, not to widen the gate.
    expect(
      compileInLib(`export function f(b: Blob): number { return b.size; }
`)
    ).toBe("");
  });

  it("documents the residual: Node's own web globals still type-check", () => {
    // NOT a bug, and NOT to be "fixed" by widening the ban — Navigator and
    // Storage exist in plain Node and in a Worker, so they do not break the
    // Node-testability the rule protects. This test exists so the line is a
    // recorded decision rather than a surprise. If it starts failing because
    // @types/node dropped them, that is a real change worth noticing.
    expect(
      compileInLib(`export function f(n: Navigator): number {
  return n.hardwareConcurrency;
}
`)
    ).toBe("");
  });
});
