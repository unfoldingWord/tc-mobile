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
// Not `npx`: execFileSync returns the CHILD's stdout, and npx prints its own
// lines there (a warn-exec notice, an install prompt). The "compiles cleanly"
// assertions below are `toBe("")`, so one npx line would fail a passing
// compile. Spawn the resolved compiler directly.
const TSC = join(REPO, "node_modules", "typescript", "bin", "tsc");
const ESLINT = join(REPO, "node_modules", "eslint", "bin", "eslint.js");

/**
 * Compile `source`, written as `filename` under tsconfig.lib.json's options;
 * return tsc's output. `filename`'s extension is what exercises L-6b's
 * widened `include` — `probe.tsx` only enters the program at all because
 * `tsconfig.lib.json` now lists `*.tsx` alongside `*.ts`.
 */
function compileInLibNamed(source: string, filename: string): string {
  writeFileSync(join(PROBE_DIR, filename), source);
  writeFileSync(
    join(PROBE_DIR, "tsconfig.json"),
    JSON.stringify({
      extends: "../tsconfig.lib.json",
      include: [filename],
    }),
    { flag: "w" }
  );
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

/** Compile `source` under tsconfig.lib.json's options; return tsc's output. */
function compileInLib(source: string): string {
  return compileInLibNamed(source, "probe.ts");
}

/**
 * Lint `source` as if it were saved at `relPath` (relative to the repo root),
 * without writing it anywhere real — `eslint --stdin` resolves the config
 * block for `relPath` the same way it would for a file that actually lived
 * there, which is what lets this probe a forbidden `src/lib/**` or
 * `src/types/**` import without ever creating the file (`.lib-boundary-probe`
 * exists only for tsc, which has no stdin mode). Returns eslint's stdout, or
 * "" when the source is clean.
 */
function lintFile(source: string, relPath: string): string {
  try {
    execFileSync(
      process.execPath,
      [ESLINT, "--stdin", "--stdin-filename", relPath],
      {
        cwd: REPO,
        input: source,
        encoding: "utf8",
        stdio: "pipe",
      }
    );
    return "";
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? "");
  }
}

beforeAll(() => {
  rmSync(PROBE_DIR, { recursive: true, force: true });
  mkdirSync(PROBE_DIR, { recursive: true });
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
    expect(files).toContain(join("src", "lib", "audio", "format.ts"));
    expect(files).toContain(join("src", "lib", "storage", "db.ts"));
    expect(files).toContain(join("src", "types", "domain.ts"));
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
        [ESLINT, "--print-config", join("src", "lib", "audio", "format.ts")],
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

/**
 * The onion-layer gates, closing three holes #159 found in them (L-6):
 *
 *   a. `no-restricted-imports` only sees a static `import ... from "..."`
 *      specifier — `await import("@/hooks/x")` and `new URL("../hooks/x.ts",
 *      import.meta.url)` reach the same forbidden layer through a value the
 *      rule never inspects. Verified with `eslint --stdin` probes at
 *      2026-09-04: the static form errored, both dynamic forms returned zero
 *      errors. `no-restricted-syntax` now covers both, in the same `deny()`
 *      call, so the layer list and messages cannot drift from the static rule.
 *   b. The `types/` and `lib/` blocks in eslint.config.mjs were scoped to
 *      `*.ts`, and tsconfig.lib.json's `include` was `*.ts`-only, so a file at
 *      `src/lib/audio/x.tsx` using `window` and `new AudioContext()` produced
 *      zero ESLint and zero `tsc` diagnostics where the identical `.ts` file
 *      produced two. `.tsx` is now forbidden outright under `lib/` and
 *      `types/`, and `tsconfig.lib.json`'s `include` covers `.tsx` too so tsc
 *      also sees the file.
 *   c. `src/data/` appeared in no layer block, so `types/` could import the
 *      bundled OBS catalogue JSON unchecked. `lib/obs/catalog.ts` reads it
 *      legitimately (a dynamic `import()` of static JSON, no code and no DOM
 *      surface), so only `types/` is denied.
 */
describe("the onion layer gates — dynamic imports, .tsx and src/data (L-6)", () => {
  const HOOKS_MESSAGE = "lib cannot import hooks (onion architecture)";

  it("flags a dynamic import from lib into hooks — @/ alias form", () => {
    const out = lintFile(
      'export async function f() {\n  const m = await import("@/hooks/audio-io");\n  return m;\n}\n',
      join("src", "lib", "audio", "probe.ts")
    );
    expect(out).toContain("no-restricted-syntax");
    expect(out).toContain(`${HOOKS_MESSAGE} (dynamic import)`);
  });

  it("flags a dynamic import from lib into hooks — relative form", () => {
    // The relative form is the one an editor auto-import can produce
    // silently — no import in src/ uses it today, but the rule has to hold
    // when one appears, same as the static no-restricted-imports rule above.
    const out = lintFile(
      'export async function f() {\n  const m = await import("../../hooks/audio-io");\n  return m;\n}\n',
      join("src", "lib", "audio", "probe.ts")
    );
    expect(out).toContain(`${HOOKS_MESSAGE} (dynamic import)`);
  });

  it("flags new URL(...) reaching hooks/ from lib/", () => {
    const out = lintFile(
      'export const u = new URL("../hooks/x.ts", import.meta.url);\n',
      join("src", "lib", "audio", "probe.ts")
    );
    expect(out).toContain(
      `${HOOKS_MESSAGE} (new URL(...) reaching another layer)`
    );
  });

  it("does not flag a legal dynamic import from lib/", () => {
    // `import("@/lib/...")` stays inside the layer, and `import("fflate")` is
    // a bare package specifier — neither matches the hooks/components/app
    // patterns above, so this must stay clean or the selectors are too broad.
    const out = lintFile(
      "export async function f() {\n" +
        '  const a = await import("@/lib/audio/format");\n' +
        '  const b = await import("fflate");\n' +
        "  return { a, b };\n" +
        "}\n",
      join("src", "lib", "audio", "probe.ts")
    );
    expect(out).toBe("");
  });

  it("forbids .tsx under lib/ outright, regardless of content", () => {
    const out = lintFile(
      "export const x = 1;\n",
      join("src", "lib", "audio", "probe.tsx")
    );
    expect(out).toContain("lib/ and types/ stay DOM-free and framework-free");
  });

  it("forbids .tsx under types/ outright, regardless of content", () => {
    const out = lintFile(
      "export const x = 1;\n",
      join("src", "types", "probe.tsx")
    );
    expect(out).toContain("lib/ and types/ stay DOM-free and framework-free");
  });

  it("tsconfig.lib.json's widened include lets tsc see a .tsx file at all", () => {
    // Before L-6b, this filename fell outside `include` entirely, so it was
    // absent from the program and produced NO diagnostic no matter what it
    // referenced. Same source as the `.ts` "rejects %s in type position"
    // cases above — pinning that `.tsx` now gets the identical treatment.
    const out = compileInLibNamed(
      "export function f(x: AudioContext): number {\n" +
        "  return Object.keys(x).length;\n" +
        "}\n",
      "probe.tsx"
    );
    expect(out).toContain("Cannot find name 'AudioContext'");
  });

  it("denies types/ importing src/data statically", () => {
    const out = lintFile(
      'import catalog from "@/data/obs-catalog.json";\nexport const c = catalog;\n',
      join("src", "types", "probe.ts")
    );
    expect(out).toContain("types cannot import data (onion architecture)");
  });

  it("does not deny lib/ importing src/data — catalog.ts's real dependency", () => {
    const out = lintFile(
      'import catalog from "@/data/obs-catalog.json";\nexport const c = catalog;\n',
      join("src", "lib", "obs", "probe.ts")
    );
    expect(out).toBe("");
  });

  it("lints the real lib/obs/catalog.ts clean — the live example of the data exception", () => {
    // catalog.ts is the one real file this rule exists to keep legal: it
    // reaches src/data/obs-catalog.json via a dynamic import(), which must
    // stay clean now that lib/ is exercised by both the static and the
    // dynamic-import gates above.
    expect(
      execFileSync(
        process.execPath,
        [ESLINT, join("src", "lib", "obs", "catalog.ts")],
        { cwd: REPO, encoding: "utf8", stdio: "pipe" }
      )
    ).toBe("");
  });
});
