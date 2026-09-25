import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The O4 stylesheet folder's position in the built cascade (#938, batch 0 of
 * epic #936's "One stylesheet per lane" rule) — `tests/dist-css.test.ts`'s
 * shape, applied to a different question.
 *
 * WHAT THIS PROVES AND WHY IT CANNOT BE A SOURCE-TEXT CHECK ALONE. Two files
 * — `src/app/styles/3-components.css` and `src/app/styles/o4/index.css` —
 * declare the SAME layer, `@layer components`, rather than the O4 file
 * opening a new, later layer. Under CSS Cascade Layers, a later-declared
 * layer beats an earlier one regardless of specificity; sharing one layer is
 * a weaker, narrower guarantee — equal-specificity rules inside it are
 * decided by ordinary source order, the same rule that decides two
 * unlayered rules. Whether "o4/index.css's content lands after
 * 3-components.css's content in that ONE shared layer" survives a real
 * production build (Tailwind's own bundling of the `@import` graph, then
 * Vite/esbuild's minification) is not something reading the `.css` SOURCE
 * files can answer — `tests/o4-cascade.test.ts` reads the shipped
 * `dist/assets/*.css` for exactly that reason `dist/css.test.ts` already
 * gives: a minifier is free to reorder or merge things a source read cannot
 * see.
 *
 * WHY A REAL DECLARATION, NOT A COMMENT. `o4/index.css`'s own header records
 * this: a build was run against a comment-only version of that file (a plain
 * `/**` block, and separately one prefixed `/*!`, the marker some minifiers
 * preserve for license banners and which Tailwind's own banner in this same
 * built file survives as) and neither comment appeared anywhere in
 * `dist/assets/*.css` afterward — an empty `@layer components {}` compiles
 * away to zero bytes in this project's build, indistinguishable from the file
 * not existing. Only a real declaration survives, which is why
 * `o4/index.css` carries the one inert `--o4-scope` custom property this test
 * locates. That is a narrower reading of this batch's "empty apart from a
 * header comment" done-when clause than the literal text — recorded as a
 * deliberate, evidence-based deviation, not an oversight, in this PR's body.
 *
 * WHAT THIS DOES NOT PROVE. It does not run a browser or compute an actual
 * cascade winner — like `tests/focus-offset-cascade.test.ts`, it reads
 * structural facts (here: byte position in the real build output) and leans
 * on the CSS Cascade Layers spec, cited above, for what those facts imply.
 * It also says nothing about a FUTURE O4 rule's own specificity relative to
 * whatever it overrides — only that ties inside the shared `components`
 * layer resolve toward O4, because this folder's contribution is always the
 * last thing written into that layer.
 *
 * Skip/fail semantics are `./dist-gate`'s: this suite runs only under
 * `npm run test:dist` (after `npm run build`), and quietly skips everywhere
 * else rather than reporting a false pass or a false fail against a build
 * that may not exist locally.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "dist", "assets");

function builtCssPath(): string | null {
  if (!existsSync(ASSETS_DIR)) return null;
  const cssFile = readdirSync(ASSETS_DIR).find((name) => name.endsWith(".css"));
  return cssFile ? path.join(ASSETS_DIR, cssFile) : null;
}

const CSS_PATH = builtCssPath();
const GATE = resolveDistGate(CSS_PATH !== null, "dist/assets/*.css");

// The exact minified shape observed in a real build: Lightning CSS/esbuild
// drops the quotes an attribute selector does not need (`[data-design=o4]`,
// not `[data-design="o4"]`) and collapses whitespace inside the declaration.
const O4_SCOPE_RULE = "[data-design=o4]{--o4-scope:1}";

describe.skipIf(GATE === "skip")(
  "the O4 stylesheet folder's position in the built components layer (dist/assets/*.css, requires a prior `npm run build`)",
  () => {
    const css = CSS_PATH !== null ? readFileSync(CSS_PATH, "utf8") : "";

    it("o4/index.css's declaration survives the production build", () => {
      // Vacuity guard: if this ever fails, nothing below is meaningful — see
      // this file's header for why a comment-only version does NOT survive.
      expect(css).toContain(O4_SCOPE_RULE);
    });

    it("sits inside the shared components layer, immediately before the utilities layer opens", () => {
      // Two closing braces separate the rule from `@layer utilities{`: one
      // for the rule itself, one for the `@layer components { ... }` block
      // that wraps every file's contribution to this layer (Tailwind's own
      // bundler merges 3-components.css's several `@layer components {}`
      // blocks and o4/index.css's one into a single run in the output — this
      // exact string would not match if that merge ever stopped happening).
      // That makes this file's declaration the LAST thing written into the
      // components layer, whatever 3-components.css contains by the time
      // this runs — a stronger, more future-proof anchor than pinning to one
      // named selector in that file, which lanes may still edit for
      // non-O4 reasons.
      expect(css).toContain(`${O4_SCOPE_RULE}}@layer utilities{`);
    });

    it("the components layer is not reopened after this file's contribution", () => {
      // If a later `@import` or plugin re-opened `@layer components` after
      // o4/index.css's position, something could land AFTER this file and
      // still tie into the same layer at a later source position — silently
      // reopening the very gap this switch depends on staying closed. There
      // is exactly one `@layer components{` per production build today.
      const opens = css.match(/@layer components\{/g) ?? [];
      expect(opens.length).toBe(1);
    });
  }
);

/**
 * The ten per-area O4 stylesheets, pre-created ahead of batch 1 so its five
 * parallel lanes (#941-#945, #946-#950) never collide on this one index —
 * two lanes editing `o4/index.css` in the same batch is the exact defect
 * this pre-creation exists to avoid.
 *
 * A SOURCE-text check, deliberately not gated behind `REQUIRE_DIST_BUILD`:
 * unlike the cascade position above, "does the file exist and is it
 * imported" needs no build to answer, and gating it the same way would mean
 * this only ever runs alongside a build nobody CI-side runs before merge —
 * `npm run test` alone should catch a lane deleting one of these on purpose
 * or by accident.
 */
const O4_DIR = path.join(ROOT, "src", "app", "styles", "o4");
const INDEX_SOURCE = readFileSync(path.join(O4_DIR, "index.css"), "utf8");

const AREA_FILES = [
  "books.css",
  "sheets.css",
  "segments.css",
  "recorder.css",
  "menus.css",
  "controls.css",
  "dialogs.css",
  "share.css",
  "errors.css",
  "motion.css",
];

describe("the ten pre-created O4 area stylesheets exist and are wired in", () => {
  it.each(AREA_FILES)("%s exists on disk", (name) => {
    expect(existsSync(path.join(O4_DIR, name)), name).toBe(true);
  });

  it.each(AREA_FILES)("%s is imported from o4/index.css", (name) => {
    expect(INDEX_SOURCE, name).toContain(`@import "./${name}";`);
  });
});
