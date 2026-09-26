import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * #1017 open question 1: does Vite's `build.target` (and the CSS target it
 * derives, `build.cssTarget`) produce output that runs on the stated iOS
 * floor (`ios/App/App.xcodeproj/project.pbxproj`,
 * `IPHONEOS_DEPLOYMENT_TARGET`)?
 *
 * **The floor is 15.4, not 15.0** — raised there by the #1052 DRI decision
 * (2026-09-26, "Raise floor to 15.4 (Recommended)"), because the O4 CSS
 * (`src/app/styles/o4/{menus,sheets,motion}.css`) uses the `:has()` selector,
 * which needs Safari/iOS 15.4 (caniuse-lite's `data/features/css-has.js`) and
 * has no fallback `build.target`/`build.cssTarget` can provide (verified
 * directly: LightningCSS passes `:has()` through unchanged and warning-free
 * at any target — there is no downlevel transform for a CSS selector the way
 * there is for JS syntax). See `docs/native/system-requirements.md` for the
 * full resolution; this file only pins the resulting `build.target` value.
 *
 * Vite 8's own default, when `build.target` is unset, is the string
 * `"baseline-widely-available"` — a rolling snapshot bumped on every Vite
 * major release (`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` in
 * `node_modules/vite/dist/node/chunks/node.js`) that, at the vite@8.3.0
 * pinned here, resolves to `["chrome111","edge111","firefox114","safari16.4",
 * "ios16.4"]` — still above 15.4. Nothing in `vite.config.ts` overrode it
 * before PR #1051.
 *
 * This file has two independent halves:
 *
 *   1. An always-on config check (below) that the explicit `target` array is
 *      present and pinned to what the floor actually needs. This is the half
 *      that catches drift: a future Vite bump moving the default further
 *      forward cannot regress this app, because nothing here depends on the
 *      default any more.
 *   2. A build-artifact check, gated the same way `tests/dist-css.test.ts`
 *      is, that the actually-shipped `dist/` JS contains no class static
 *      initialization block — the one concrete syntax feature this repo's
 *      research (see the #1017 comment and `docs/native/system-requirements.md`)
 *      found needs newer than 15.4: `@babel/compat-data`'s
 *      `data/plugins.json` (`transform-class-static-block`) puts it at
 *      `ios: "16.4"`. It is not used anywhere in `src/` today (checked by
 *      grep), so this is a regression guard against a future dependency or
 *      change introducing one silently, not a fix for something broken now.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = path.join(ROOT, "vite.config.ts");

/** The pinned floor: Vite's own current baseline for chrome/edge/firefox
 *  (no evidence found that those need lowering — the stated Android floor,
 *  `android/variables.gradle`'s `minSdkVersion = 24`, is conditioned
 *  everywhere on Android System WebView being kept up to date), with the
 *  Safari-family entries at the app's actual iOS floor — **15.4, not 15.0**,
 *  since #1052's DRI decision (2026-09-26, "Raise floor to 15.4
 *  (Recommended)"): the O4 CSS's `:has()` usage needs Safari/iOS 15.4, and
 *  the floor moved up to match it rather than the 13 `:has()` rules being
 *  rewritten. See `docs/native/system-requirements.md` for the resolution. */
const EXPECTED_TARGET = [
  "chrome111",
  "edge111",
  "firefox114",
  "safari15.4",
  "ios15.4",
];

function propName(node: ts.PropertyAssignment): string | undefined {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
    ? node.name.text
    : undefined;
}

/** Every `target: [...]` array literal that sits directly on a `build: {}`
 *  object literal in `source`, read from the TypeScript syntax tree — so a
 *  commented-out `target` (Frank R1 on #1051) is not a match, and an unrelated
 *  earlier `target: [` elsewhere in the file cannot be mistaken for it. */
function buildTargetsIn(source: string): string[][] {
  const sourceFile = ts.createSourceFile(
    "vite.config.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[][] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      propName(node) === "build" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          propName(prop) === "target" &&
          ts.isArrayLiteralExpression(prop.initializer)
        )
          found.push(
            prop.initializer.elements.map((e) =>
              ts.isStringLiteral(e) ? e.text : `<non-literal ${e.getText()}>`
            )
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function configuredBuildTarget(): string[] {
  const found = buildTargetsIn(readFileSync(CONFIG, "utf8"));
  const [only] = found;
  if (found.length !== 1 || only === undefined)
    throw new Error(
      `expected exactly one build.target array literal in vite.config.ts, found ${found.length}`
    );
  return only;
}

describe("buildTargetsIn (AST, not raw text)", () => {
  it("finds a live build.target array", () => {
    const source = 'export default { build: { target: ["safari15"] } };';
    expect(buildTargetsIn(source)).toEqual([["safari15"]]);
  });

  it("does not count a commented-out build.target as one", () => {
    const source =
      'export default { build: {\n  // target: ["safari15"],\n  minify: true } };';
    expect(buildTargetsIn(source)).toEqual([]);
  });

  it("does not count a target array outside build as one", () => {
    const source =
      'export default { esbuild: { target: ["safari15"] }, build: {} };';
    expect(buildTargetsIn(source)).toEqual([]);
  });
});

describe("vite.config.ts pins build.target to the stated device floor (#1017 Q1)", () => {
  it("sets an explicit target, not Vite's rolling baseline-widely-available default", () => {
    // Non-throwing is itself part of the assertion: before this change,
    // vite.config.ts had no `target:` key in `build` at all, so
    // `configuredBuildTarget()` throws and this test is red.
    expect(configuredBuildTarget()).toEqual(EXPECTED_TARGET);
  });

  it("does not regress to a Safari/iOS entry newer than 15.4 (the iOS floor, #1052)", () => {
    const target = configuredBuildTarget();
    const safariEntry = target.find((t) => /^safari/.test(t));
    const iosEntry = target.find((t) => /^ios/.test(t));
    expect(safariEntry, "no safari* entry in build.target").toBeDefined();
    expect(iosEntry, "no ios* entry in build.target").toBeDefined();
    const safariVersion = parseFloat((safariEntry ?? "safari0").slice(6));
    const iosVersion = parseFloat((iosEntry ?? "ios0").slice(3));
    expect(safariVersion).toBeLessThanOrEqual(15.4);
    expect(iosVersion).toBeLessThanOrEqual(15.4);
  });
});

/** Whether `source` contains a class static initialization block
 *  (`class C { static { ... } }`) anywhere in its syntax tree — the one
 *  syntax feature this repo's #1017 research confirmed needs newer than
 *  the 15.4 floor (`ios: "16.4"` in `@babel/compat-data`'s
 *  `data/plugins.json`). Parsed with the real TypeScript grammar
 *  (`ts.createSourceFile`), the same tool `tests/precache-manifest.test.ts`
 *  already uses for this class of check — not a text/regex scan, so a
 *  string or comment that merely mentions "static {" cannot false-hit and a
 *  reformatted (but semantically identical) block cannot be missed. */
function hasClassStaticBlock(source: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false
  );

  function visit(node: ts.Node): boolean {
    if (ts.isClassStaticBlockDeclaration(node)) return true;
    return ts.forEachChild(node, visit) ?? false;
  }

  return visit(sourceFile);
}

describe("hasClassStaticBlock (AST, not raw text)", () => {
  it("does not count a comment mentioning a static block as one", () => {
    const source =
      "// some classes use a static { ... } block for setup\nexport const x = 1;";
    expect(hasClassStaticBlock(source, "probe.ts")).toBe(false);
  });

  it("does not count a string literal naming the syntax as one", () => {
    const source = 'export const msg = "class C { static { x = 1 } }";';
    expect(hasClassStaticBlock(source, "probe.ts")).toBe(false);
  });

  it("does not count an ordinary static method or field as one", () => {
    const source =
      "class C { static x = 1; static m() { return 1; } }\nexport { C };";
    expect(hasClassStaticBlock(source, "probe.ts")).toBe(false);
  });

  it("counts a real class static initialization block as one", () => {
    const source = "class C { static { globalThis.x = 1; } }\nexport { C };";
    expect(hasClassStaticBlock(source, "probe.ts")).toBe(true);
  });

  it("counts one nested inside a minified, single-line bundle shape", () => {
    const source =
      "var e;class t{}((e=t).x=1);class n{static{n.y=2}}export{n};";
    expect(hasClassStaticBlock(source, "probe.ts")).toBe(true);
  });
});

function distJsFiles(): string[] {
  const assetsDir = path.join(ROOT, "dist", "assets");
  const out: string[] = [];
  if (existsSync(assetsDir)) {
    for (const name of readdirSync(assetsDir)) {
      if (name.endsWith(".js")) out.push(path.join(assetsDir, name));
    }
  }
  for (const name of ["registerSW.js", "sw.js"]) {
    const full = path.join(ROOT, "dist", name);
    if (existsSync(full)) out.push(full);
  }
  const distDir = path.join(ROOT, "dist");
  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      if (name.startsWith("workbox-") && name.endsWith(".js"))
        out.push(path.join(distDir, name));
    }
  }
  return out;
}

const files = distJsFiles();
const GATE = resolveDistGate(files.length > 0, "dist/assets/*.js");

describe.skipIf(GATE === "skip")(
  "the built JS (dist/, requires a prior `npm run build`) ships no syntax above the iOS 15.4 floor",
  () => {
    // Non-empty, or an empty listing would vacuously pass every case below —
    // the same trap `tests/precache-manifest.test.ts` names for its own
    // build-artifact half.
    it("found at least one dist JS file to scan", () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files.map((f) => [path.relative(ROOT, f), f] as const))(
      "%s has no class static initialization block",
      (_label, file) => {
        const source = readFileSync(file, "utf8");
        expect(hasClassStaticBlock(source, file)).toBe(false);
      }
    );
  }
);
