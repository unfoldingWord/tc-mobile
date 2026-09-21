import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

// Whether a CSS fallback survives the production build cannot be asserted
// from source alone (George R5 on #414/#420): Vite's default CSS minifier
// (esbuild) collapses two declarations of the SAME property within one rule
// down to the last one, which is exactly what happened to the round-4/5
// `.recorder-stage { justify-content: center; justify-content: safe center; }`
// fix — the shipped `dist/assets/*.css` kept `safe center` alone, with no
// fallback left for an engine that rejects it. Round 6's fix moves the
// enhancement into its own `@supports` block instead, which esbuild cannot
// collapse across rule boundaries — this test reads the ACTUAL built file to
// prove that, rather than trusting the source shape.
//
// TWO limitations, stated rather than glossed (mirrors
// `precache-manifest.test.ts`'s own honesty about this class of test):
//
//   1. It needs a build, so it runs only where one is guaranteed to precede
//      it — `npm run test:dist`, which `npm run verify` invokes after `npm
//      run build`. Everywhere else it skips, and it skips whether or not a
//      `dist/` happens to be lying around. See `./dist-gate` for why the
//      artifact's presence decides nothing (#568).
//   2. What it reads is the last build's output. A green result is a
//      statement about that build, not an unconditional proof about source
//      that was never rebuilt.
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "dist", "assets");

function builtCssPath(): string | null {
  if (!existsSync(ASSETS_DIR)) return null;
  const cssFile = readdirSync(ASSETS_DIR).find((name) => name.endsWith(".css"));
  return cssFile ? path.join(ASSETS_DIR, cssFile) : null;
}

const CSS_PATH = builtCssPath();
const GATE = resolveDistGate(CSS_PATH !== null, "dist/assets/*.css");

describe.skipIf(GATE === "skip")(
  "the built recorder-stage CSS (dist/assets/*.css, requires a prior `npm run build`)",
  () => {
    // Guarded even though the gate already means this factory's child `it`s
    // never RUN unless the gate says "run" — vitest still INVOKES this
    // factory (to collect and report those its as "skipped" rather than
    // absent), so an unconditional `readFileSync(null, ...)` here crashes
    // instead of skipping cleanly. `css` is unused when skipped; only its
    // presence as a real string matters when the suite actually runs.
    const css = CSS_PATH !== null ? readFileSync(CSS_PATH, "utf8") : "";

    // The FIRST `.recorder-stage{...}` occurrence in the file is the base,
    // unconditional rule — the `@supports`-wrapped one is a second, later
    // occurrence of the same selector (round 6's fix). Slicing from that
    // first index and matching from the start of the slice isolates the
    // base rule specifically, without needing to locate `@supports`
    // anywhere: Tailwind's own Preflight/utility layers already emit
    // unrelated `@supports` blocks earlier in this same file (feature
    // queries for other properties), so splitting on the bare string
    // "@supports" would cut the file off long before reaching
    // `.recorder-stage` at all — confirmed by running this against the
    // build while writing this test.
    const fromFirstRecorderStage = css.slice(css.indexOf(".recorder-stage{"));
    const baseRuleMatch = fromFirstRecorderStage.match(
      /^\.recorder-stage\{[^}]*\}/
    );

    it("declares the base rule with a plain justify-content:center — the fallback for an engine that rejects safe centering", () => {
      // Non-null, or a missing/renamed selector would vacuously pass every
      // assertion below it.
      expect(baseRuleMatch).not.toBeNull();
      const rule = baseRuleMatch?.[0] ?? "";
      expect(rule).toContain("justify-content:center");
      // The exact regression this test exists to catch: the round-4/5
      // shape declared `safe center` in the SAME rule, which esbuild
      // collapsed the plain `center` out of entirely.
      expect(rule).not.toContain("safe center");
    });

    it("carries safe centering only inside an @supports block esbuild cannot collapse into the base rule", () => {
      const supportsMatch = css.match(
        /@supports \(justify-content:\s*safe center\)\{\.recorder-stage\{[^}]*\}\}/
      );
      expect(supportsMatch).not.toBeNull();
      expect(supportsMatch?.[0]).toContain("justify-content:safe center");
    });

    // George R7 P2-1, round 8: `.recorder-canvas`'s `overflow-hidden` utility
    // gives it CSS Flexbox §4.5's automatic minimum size of 0, so on a short
    // `.recorder-stage` ordinary flex-shrink absorbed the ENTIRE deficit into
    // the canvas alone (measured: a 151px stage shrank it to 55px, silently,
    // with the amplitude midline 20px below the visible box) — the group
    // never actually overflowed its container, so `justify-content: safe
    // center` (the fix above) never activated at all; see the round-7/8
    // triage on #420 for the Playwright measurements. `flex-shrink: 0` on
    // all three stage children makes the group genuinely unshrinkable, so a
    // short stage overflows for real and `safe center` clips Cut as the
    // comments above it have claimed since round 3.
    it.each([".recorder-paste", ".recorder-canvas", ".recorder-cut"])(
      "makes %s unshrinkable (flex-shrink:0) so a short stage overflows instead of silently shrinking the canvas",
      (selector) => {
        const escaped = selector.replace(".", "\\.");
        const ruleMatch = css.match(new RegExp(`${escaped}\\{[^}]*\\}`));
        // Non-null, or a missing/renamed selector would vacuously pass the
        // assertion below it.
        expect(ruleMatch).not.toBeNull();
        expect(ruleMatch?.[0]).toContain("flex-shrink:0");
      }
    );
  }
);

// The skip above is a convenience for anyone running the suite without a
// build: vitest reports a skip, not a failure, so a plain `npm test` still
// exits 0. A skip is also indistinguishable from a pass, which is why the
// gate makes the OTHER half loud — `npm run test:dist` promises a build, and
// the shared resolver turns that promise into a module-scope throw rather
// than one more case in this file that could be deleted. `REQUIRE_DIST_BUILD`
// is a purpose-built flag, not the ambient `CI` variable: `CI` is true
// wherever tests run, including the passes that legitimately have no build
// yet. See `./dist-gate` for why the loud half does not live here.
