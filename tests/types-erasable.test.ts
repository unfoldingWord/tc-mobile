import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `types/` holds domain types and nothing else — asserted rather than described.
 *
 * `eslint.config.mjs`'s layer header defines the onion's innermost ring as
 * "types/ → Domain types (no internal dependencies)", and `tsconfig.lib.json`
 * compiles `src/types` alongside `src/lib` on the strength of that. Nothing
 * checked it. `no-restricted-imports` governs which layer may import which; it
 * says nothing about a layer growing runtime code of its own, so
 * `src/types/view.ts` had accumulated a constant and two functions
 * (`ROW_PEAK_BUCKETS`, `segmentRowState`, `firstNotFinished` — audit finding
 * L-17, #160), and `src/types/failure.ts` a third, with no check in the tree
 * reading for any of them.
 *
 * This is the `types/` analogue of `tests/lib-boundary.test.ts`: the same
 * shape, for the ring one step further in. The property it pins is
 * ERASABILITY — a `src/types/**` module must compile to nothing, so deleting
 * the whole directory could only ever be a type error, never a behaviour
 * change.
 *
 * WHY THE TRANSPILER AND NOT A GREP. A regex for `export const` / `export
 * function` over the raw file is the trap `tests/touch-policy.test.ts` fell
 * into and AGENTS.md names: a docblock that mentions `export function` in
 * prose false-hits, and the natural repair is to weaken the pattern until it
 * can no longer catch the real thing. Transpiling answers the actual question
 * — does anything survive type erasure? — and `removeComments: true` makes a
 * comment structurally incapable of registering. Single-file transpile is also
 * exactly the right lens: `isolatedModules: true` in `tsconfig.app.json`
 * already guarantees each module is erasable on its own terms, with no
 * cross-file type information needed.
 */

const REPO = join(import.meta.dirname, "..");
const TYPES_DIR = join(REPO, "src", "types");

/** Minimal host `ts.formatDiagnostics` needs to render a message. */
const DIAGNOSTIC_HOST: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => REPO,
  getCanonicalFileName: (f) => f,
  getNewLine: () => "\n",
};

/**
 * What survives type erasure in `source`, normalised — or throws.
 *
 * `transpileModule` only reports diagnostics when asked (`reportDiagnostics:
 * true`); without that flag a file that fails to parse still returns
 * `outputText`, often the empty-module marker itself (#708 item 1: a
 * truncated `export type Foo = ` reports one diagnostic but still emits
 * `export {};`). A caller that reads only `outputText` cannot tell that file
 * apart from a legitimate type-only one, so the gate must fail CLOSED —
 * throw — the moment there is anything to report, before the emptiness
 * check ever runs.
 *
 * A module with no runtime content still emits the `export {};` marker that
 * keeps it a module rather than a script, so that one statement is erased
 * here too — it is a shape, not behaviour.
 */
function runtimeEmit(source: string, fileName: string): string {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
      removeComments: true,
    },
  });
  if (diagnostics && diagnostics.length > 0) {
    throw new Error(ts.formatDiagnostics(diagnostics, DIAGNOSTIC_HOST));
  }
  return outputText.replace(/export\s*\{\s*\}\s*;?/g, "").trim();
}

/** Every `.ts` file under `src/types`, repo-relative and slash-separated. */
function typeModules(): string[] {
  return readdirSync(TYPES_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => relative(REPO, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}

describe("the erasability predicate", () => {
  // The gate in its RED state. Without these, a `runtimeEmit` that returned ""
  // for everything — a swallowed transpile error, a normalisation that ate the
  // whole output — would report the sweep below as clean for the rest of the
  // repository's life.
  it.each([
    ["a constant", "export const BUCKETS = 120;"],
    ["a function", "export function pick(n: number) {\n  return n > 0;\n}"],
    ["a class", "export class Box {\n  value = 1;\n}"],
    ["an enum", "export enum Tone {\n  Info,\n}"],
    ["a side effect", "console.log('hello');"],
    // The one a grep over the raw text would miss and erasure catches: the
    // module's own name is type-only, but re-exporting a VALUE is runtime work.
    ["a value re-export", "export { computePeaks } from '@/lib/audio/peaks';"],
  ])("reports %s as runtime content", (_label, source) => {
    expect(runtimeEmit(source, "probe.ts")).not.toBe("");
  });

  // The gate in its GREEN state, on every shape `src/types` legitimately uses
  // — so "erasable" cannot quietly come to mean "we stopped looking".
  it.each([
    ["an interface", "export interface Row {\n  readonly id: string;\n}"],
    ["a type alias", "export type Tone = 'info' | 'alert';"],
    ["a type-only import", "import type { Peaks } from './audio';"],
    ["a type-only re-export", "export type { Peaks } from './audio';"],
  ])("reports %s as erasable", (_label, source) => {
    expect(runtimeEmit(source, "probe.ts")).toBe("");
  });

  // The THIRD state the predicate must not collapse into "erasable": a file
  // that does not transpile at all. `ts.transpileModule` reports this as a
  // diagnostic, not an exception, so a caller that reads only `outputText`
  // never sees it — and a truncated type alias transpiles to the same
  // `export {};` marker a legitimate type-only file does (#708 item 1).
  it("reports a file that fails to transpile as a failure, not as erasable", () => {
    expect(() => runtimeEmit("export type Foo = ", "probe.ts")).toThrow();
  });
});

describe("src/types is erasable", () => {
  const modules = typeModules();

  // A non-emptiness floor. `readdirSync` over a moved or renamed directory
  // returns [], and `it.each([])` is a silent pass — the sweep would report
  // clean having read nothing at all.
  it("finds the type modules to check", () => {
    expect(modules.length).toBeGreaterThanOrEqual(4);
    expect(modules).toContain("src/types/domain.ts");
  });

  it.each(modules)("%s compiles to nothing", (file) => {
    const source = readFileSync(join(REPO, file), "utf8");
    // The message carries the surviving code: a failure should say WHAT has to
    // move, not merely that something did.
    expect(runtimeEmit(source, file)).toBe("");
  });
});
