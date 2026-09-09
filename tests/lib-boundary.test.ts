import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

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
// Not `npx`: execFileSync returns the CHILD's stdout, and npx prints its own
// lines there (a warn-exec notice, an install prompt). The "compiles cleanly"
// assertions below are `toBe("")`, so one npx line would fail a passing
// compile. Spawn the resolved compiler directly.
const TSC = join(REPO, "node_modules", "typescript", "bin", "tsc");

/** Compile `source` under tsconfig.lib.json's options; return tsc's output. */
function compileInLib(source: string): string {
  writeFileSync(join(PROBE_DIR, "probe.ts"), source);
  try {
    execFileSync(
      process.execPath,
      [TSC, "-p", join(PROBE_DIR, "tsconfig.json")],
      {
        cwd: REPO,
        encoding: "utf8",
        stdio: "pipe",
      }
    );
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

describe("the lib/ DOM boundary — what the gate actually covers", () => {
  it("compiles the real lib/ sources, not an empty program", () => {
    // Everything below asserts how tsconfig.lib.json BEHAVES. None of it would
    // notice if `include` stopped matching src/lib — narrow it to
    // src/types/**, and tsc still exits 0, these probes still pass, and
    // src/lib/audio/format.ts could take `x: AudioContext` with green CI
    // because the app typecheck has the DOM. Pin the inputs too.
    const files = execFileSync(
      process.execPath,
      [TSC, "-p", join(REPO, "tsconfig.lib.json"), "--listFilesOnly"],
      { cwd: REPO, encoding: "utf8", stdio: "pipe" }
    );
    expect(files).toContain(posix.join("src", "lib", "audio", "format.ts"));
    expect(files).toContain(posix.join("src", "lib", "storage", "db.ts"));
    expect(files).toContain(posix.join("src", "types", "domain.ts"));
  });

  it("bans navigator and localStorage as VALUES in the lib/ eslint config", () => {
    // The compile gate cannot catch these: @types/node declares `var
    // navigator` and `var localStorage`, so they type-check inside lib/ — and
    // Node 22 really has `navigator`, so a unit test would not catch it
    // either. eslint's no-restricted-globals is the only thing standing here.
    // Without this case, deleting them from BROWSER_ONLY_GLOBALS leaves
    // typecheck:lib green, every probe below green, and lint green.
    //
    // Asserted against the RESOLVED config for a real lib file rather than by
    // linting a fixture: a fixture would have to live under src/lib for the
    // rule to match it, and a stray file there breaks `tsc -b` if this test is
    // interrupted.
    const config = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(REPO, "node_modules", "eslint", "bin", "eslint.js"),
          "--print-config",
          join("src", "lib", "audio", "format.ts"),
        ],
        { cwd: REPO, encoding: "utf8", stdio: "pipe" }
      )
    ) as { rules: Record<string, unknown[]> };

    const banned = (config.rules["no-restricted-globals"] ?? [])
      .slice(1)
      .map((entry) => (entry as { name: string }).name);

    for (const name of [
      "navigator",
      "localStorage",
      "sessionStorage",
      "window",
      "document",
      "AudioContext",
      "MediaRecorder",
    ]) {
      expect(banned).toContain(name);
    }
  });

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
