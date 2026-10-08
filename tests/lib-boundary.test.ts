import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Every case spawns tsc or eslint through execFileSync (0.6-4 s each); under a
// loaded machine the default 5 s budget expires. 15 s follows
// nav-history-boundary.test.ts. vitest cannot interrupt execFileSync, so this
// only marks a slow case failed after it returns; it is not a hang guard.
vi.setConfig({ testTimeout: 15_000, hookTimeout: 60_000 });

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

interface EslintMessage {
  ruleId: string | null;
  message: string;
}

/**
 * Lint `source` as if it were `stdinFilename` (a repo-relative path), using
 * the real `eslint.config.mjs` at the repo root. `--stdin`/`--stdin-filename`
 * resolves the file-glob config for that path without a real file on disk —
 * `no-restricted-imports`, `no-restricted-syntax` and `no-restricted-globals`
 * are all purely syntactic, so no module resolution or type info is needed.
 */
function lintStdin(source: string, stdinFilename: string): EslintMessage[] {
  try {
    const raw = execFileSync(
      process.execPath,
      [
        ESLINT,
        "--stdin",
        "--stdin-filename",
        stdinFilename,
        "--format",
        "json",
      ],
      { cwd: REPO, encoding: "utf8", stdio: "pipe", input: source }
    );
    return (JSON.parse(raw) as Array<{ messages: EslintMessage[] }>)[0]!
      .messages;
  } catch (err) {
    const out = (err as { stdout?: string }).stdout ?? "[]";
    return (JSON.parse(out) as Array<{ messages: EslintMessage[] }>)[0]!
      .messages;
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

/**
 * #159 L-6 — three holes the audit found in the gates above, none of them
 * about DOM globals: `no-restricted-imports` only sees STATIC
 * import/export declarations, the lib/ and types/ eslint blocks and
 * tsconfig.lib.json's `include` were `.ts`-only, and `src/data/` appeared in
 * no layer block at all. The `it`s below pin these three holes closed, plus
 * one baseline sanity check (below) that the existing static-import ban
 * still holds (#815).
 */
describe("#159 L-6 — dynamic import and new URL(..., import.meta.url)", () => {
  it("still bans a STATIC upward import from lib/ (baseline sanity)", () => {
    const messages = lintStdin(
      'import { x } from "@/hooks/y";\nexport const y = x;\n',
      "src/lib/audio/probe.ts"
    );
    expect(messages.map((m) => m.ruleId)).toContain("no-restricted-imports");
  });

  // Each probe file is placed so its specifier really resolves to src/hooks:
  // `../hooks/y` from src/lib/audio/ would reach src/lib/hooks, a lib/
  // sibling, so the one-level case is linted from src/lib/ itself (#838).
  it.each([
    ["@/hooks/y", "src/lib/audio/probe.ts"],
    ["../hooks/y", "src/lib/probe.ts"],
    ["../../hooks/y", "src/lib/audio/probe.ts"],
  ])("bans a dynamic import(%s) of hooks from %s", (specifier, file) => {
    const messages = lintStdin(
      `export async function f() { return (await import("${specifier}")).default; }\n`,
      file
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-syntax" })
    );
  });

  it.each(["components", "app"])(
    "bans a dynamic import() of %s from lib/",
    (layer) => {
      const messages = lintStdin(
        `export async function f() { return (await import("@/${layer}/y")).default; }\n`,
        "src/lib/audio/probe.ts"
      );
      expect(messages).toContainEqual(
        expect.objectContaining({ ruleId: "no-restricted-syntax" })
      );
    }
  );

  it("bans new URL(..., import.meta.url) in lib/, regardless of target", () => {
    const messages = lintStdin(
      'export const w = new URL("../hooks/mp3.worker.ts", import.meta.url);\n',
      "src/lib/audio/probe.ts"
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-syntax" })
    );
  });

  it("bans a dynamic import() of lib/ from types/ (types denies lib/ too)", () => {
    const messages = lintStdin(
      'export async function f() { return (await import("@/lib/audio/format")).default; }\n',
      "src/types/probe.ts"
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-syntax" })
    );
  });

  it("leaves a dynamic import() of a SIBLING lib/ module legal", () => {
    // Not an onion violation: lib/ importing lib/. Mutating either
    // dynamicImportDeny layer list to include "lib" would fail this.
    const messages = lintStdin(
      'export async function f() { return (await import("@/lib/audio/format")).default; }\n',
      "src/lib/audio/probe.ts"
    );
    expect(messages).toEqual([]);
  });

  it("leaves a dynamic import() of an npm package legal", () => {
    const messages = lintStdin(
      'export async function f() { return (await import("zustand")).default; }\n',
      "src/lib/audio/probe.ts"
    );
    expect(messages).toEqual([]);
  });

  it("leaves lib/obs/catalog.ts's own dynamic import() of data/ legal", () => {
    // The one dynamic import src/lib makes today (grep -rn "import(" src/lib
    // confirms it). This is the case the selectors above must NOT catch.
    const messages = lintStdin(
      'export async function f() { return (await import("@/data/obs-catalog.json")).default; }\n',
      "src/lib/audio/probe.ts"
    );
    expect(messages).toEqual([]);
  });
});

describe("#159 L-6 — the .tsx escape", () => {
  it("bans a browser global as a VALUE in a lib/ .tsx file", () => {
    const messages = lintStdin(
      "export const w = window;\n",
      "src/lib/audio/probe.tsx"
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-globals" })
    );
  });

  it("bans a static upward import in a types/ .tsx file", () => {
    const messages = lintStdin(
      'import { x } from "@/hooks/y";\nexport const y = x;\n',
      "src/types/probe.tsx"
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-imports" })
    );
  });

  it("tsconfig.lib.json's include matches .ts and .tsx under lib/ and types/, per tsc", () => {
    // Asks tsc which files the real `include` globs select, rather than
    // comparing the strings (#838): a string check passes on a glob tsc
    // would not match. The config is copied verbatim into a probe root with
    // a fixture tree beside it, so no file is written under the real src/
    // (every probe here lives outside src/, so an interrupted run cannot
    // leave a stray file inside knip's src/** project). The copy is
    // self-contained: tsconfig.lib.json has no `extends`, and its relative
    // `baseUrl`/`include` resolve against the probe root the same way.
    const root = join(PROBE_DIR, "include-root");
    const inside = [
      "src/lib/probe.ts",
      "src/lib/nested/probe.tsx",
      "src/types/probe.ts",
      "src/types/nested/probe.tsx",
    ];
    const outside = ["src/hooks/probe.tsx", "src/components/probe.ts"];
    for (const rel of [...inside, ...outside]) {
      mkdirSync(join(root, posix.dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), "export const x = 1;\n");
    }
    writeFileSync(
      join(root, "tsconfig.lib.json"),
      readFileSync(join(REPO, "tsconfig.lib.json"), "utf8")
    );
    const listed = execFileSync(
      process.execPath,
      [TSC, "-p", join(root, "tsconfig.lib.json"), "--listFilesOnly"],
      { cwd: REPO, encoding: "utf8", stdio: "pipe" }
    )
      .split(/\r?\n/)
      .map((line) => line.replaceAll("\\", "/"));
    const probeRoot = root.replaceAll("\\", "/");
    const selected = (rel: string) => listed.includes(`${probeRoot}/${rel}`);
    // Non-emptiness floor: if the copy selected nothing, the not-selected
    // half below would pass vacuously.
    expect(inside.filter(selected)).toEqual(inside);
    expect(outside.filter(selected)).toEqual([]);
  });
});

describe("#159 L-6 — src/data/ is classified", () => {
  it.each(["types", "lib", "hooks", "components", "app"])(
    "src/%s's config denies or allows importing data/ as designed",
    (layer) => {
      const messages = lintStdin(
        'import catalog from "@/data/obs-catalog.json";\nexport const c = catalog;\n',
        `src/${layer}/probe.ts`
      );
      // lib/ is the one layer allowed to reach data/ directly
      // (lib/obs/catalog.ts is the canonical accessor); every other layer
      // must route through it.
      if (layer === "lib") {
        expect(messages).toEqual([]);
      } else {
        expect(messages).toContainEqual(
          expect.objectContaining({ ruleId: "no-restricted-imports" })
        );
      }
    }
  );

  // Frank round 1: the static deny above had no dynamic half, so
  // `await import("@/data/…")` passed from every non-lib layer. Both quote
  // styles, and the adapter file (use-nav-stack.ts has its own override).
  it.each(
    [
      "src/types/probe.ts",
      "src/lib/audio/probe.ts",
      "src/hooks/probe.ts",
      "src/hooks/use-nav-stack.ts",
      "src/components/probe.tsx",
      "src/app/probe.ts",
    ].flatMap((file) => [
      [file, '"@/data/obs-catalog.json"'],
      [file, "`@/data/obs-catalog.json`"],
    ])
  )(
    "%s: dynamic import(%s) of data/ is allowed only from lib/",
    (file, spec) => {
      const messages = lintStdin(
        `export async function f() { return (await import(${spec})).default; }\n`,
        file
      );
      const syntax = messages.filter(
        (m) => m.ruleId === "no-restricted-syntax"
      );
      expect(syntax).toHaveLength(file.startsWith("src/lib/") ? 0 : 1);
    }
  );
});

describe("#159 L-6 — substitution-free template-literal specifiers", () => {
  it.each([
    ["`@/hooks/y`", 1],
    ["`../../app/y`", 1],
    ["`@/lib/audio/format`", 0],
  ])("lib/ dynamic import(%s) → %i no-restricted-syntax hit(s)", (spec, n) => {
    const messages = lintStdin(
      `export async function f() { return (await import(${spec})).default; }\n`,
      "src/lib/audio/probe.ts"
    );
    const syntax = messages.filter((m) => m.ruleId === "no-restricted-syntax");
    expect(syntax).toHaveLength(n);
  });
});

/**
 * #838 (from #815's George r1) — the dynamic-import selectors above match a
 * specifier by its SPELLING, so a specifier the selector cannot read, or a
 * spelling it does not expect, reached an outer layer unflagged. The closure
 * is by construction rather than by resolution: a dynamic `import()` must
 * take a string literal or a substitution-free template (so the spelling is
 * always readable), the spelling match is by path SEGMENT anywhere in the
 * specifier (so `.././`, `a/../` and root-absolute spellings are read the
 * way the static `**` patterns read them), and `import.meta` is banned in
 * lib/ and types/ outright (so no `URL` construction can reach the bundler's
 * asset-URL form, however the base is spelled).
 */
describe("#838 — dynamic-import and import.meta bypass shapes", () => {
  const syntaxHits = (source: string, file: string) =>
    lintStdin(source, file).filter((m) => m.ruleId === "no-restricted-syntax");

  it.each([
    ['import("@/hooks/" + "y")', "src/lib/audio/probe.ts", "concatenated"],
    [
      "import(`@/hooks/${name}`)",
      "src/lib/audio/probe.ts",
      "substituted template",
    ],
    ["import(name)", "src/lib/audio/probe.ts", "variable"],
    ['import(".././hooks/y")', "src/lib/probe.ts", "dot segment after .."],
    ['import("./../hooks/y")', "src/lib/probe.ts", "./ before .."],
    [
      'import("../audio/../../hooks/y")',
      "src/lib/audio/probe.ts",
      ".. after a segment",
    ],
    [
      'import("@/lib/../hooks/y")',
      "src/lib/audio/probe.ts",
      "alias through ..",
    ],
    ['import("/src/hooks/y")', "src/lib/audio/probe.ts", "root-absolute"],
    ["import(name)", "src/types/probe.ts", "variable, from types/"],
    [
      'import("@/da" + "ta/obs-catalog.json")',
      "src/hooks/probe.ts",
      "concatenated data/, from hooks/",
    ],
    [
      "import(name)",
      "src/hooks/use-nav-stack.ts",
      "variable, from the history adapter",
    ],
    ["import(name)", "src/components/probe.tsx", "variable, from components/"],
    ["import(name)", "src/app/probe.ts", "variable, from app/"],
  ])("fires on %s in %s (%s)", (expr, file) => {
    const source = `const name = "y";\nexport async function f() { return (await ${expr}).default; }\nexport const n = name;\n`;
    expect(syntaxHits(source, file).length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    [
      'export const u = URL("../hooks/x.ts", import.meta.url);',
      "URL() without new",
    ],
    [
      'export const u = new URL("../hooks/x.ts", import.meta["url"]);',
      "computed import.meta['url']",
    ],
    [
      'const base = import.meta.url;\nexport const u = new URL("../hooks/x.ts", base);',
      "aliased base",
    ],
    [
      'const { url } = import.meta;\nexport const u = new URL("x", url);',
      "destructured url",
    ],
  ])("fires on import.meta in lib/ and types/: %s (%s)", (source) => {
    expect(
      syntaxHits(source, "src/lib/audio/probe.ts").length
    ).toBeGreaterThanOrEqual(1);
    expect(
      syntaxHits(source, "src/types/probe.ts").length
    ).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['export const u = new URL("https://example.org/a");', "new URL(href)"],
    [
      'export const u = new URL("a/b", "https://example.org/");',
      "new URL(href, base)",
    ],
    [
      "export function f(href: string, base: string) { return new URL(href, base); }",
      "new URL(variable href, variable base)",
    ],
    ['export const s = "@/hooks/y";', "an upward specifier as a plain string"],
    [
      'export async function f() { return (await import("./format")).default; }',
      "a relative lib/ sibling",
    ],
    [
      'export async function f() { return (await import("../storage/db")).default; }',
      "a relative lib/ cousin",
    ],
    [
      'export async function f() { return (await import("@/lib/audio/hooks-util")).default; }',
      "a lib/ file whose NAME starts with hooks",
    ],
  ])("stays silent in lib/ on %s (%s)", (source) => {
    expect(lintStdin(source, "src/lib/audio/probe.ts")).toEqual([]);
  });

  it("stays silent on app/main.tsx's literal dynamic import of the e2e harness", () => {
    // The one dynamic import outside lib/ in src/ today; a literal, so the
    // non-literal ban must not reach it.
    const messages = lintStdin(
      'export function f() { void import("./e2e-harness"); }\n',
      "src/app/main.tsx"
    );
    expect(messages).toEqual([]);
  });

  it("leaves import.meta legal outside lib/ and types/", () => {
    // hooks/ and app/ are where a Worker's own new URL(..., import.meta.url)
    // lives (hooks/mp3-codec.ts, app/e2e-harness.ts).
    const source =
      'export const u = new URL("./mp3.worker.ts", import.meta.url);\n';
    expect(syntaxHits(source, "src/hooks/probe.ts")).toEqual([]);
    expect(syntaxHits(source, "src/app/probe.ts")).toEqual([]);
  });
});
