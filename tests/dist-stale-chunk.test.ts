import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * Every dynamic `import()` in the shipped bundle reaches the stale-chunk
 * reload (#1421 O1).
 *
 * `hooks/stale-chunk-reload.ts` listens for `vite:preloadError` and nothing
 * else, so it covers a lazy chunk only when that chunk's `import()` is wrapped
 * by Vite's preload helper AND the helper dispatches the event for a rejection
 * of the import itself, not only for a missing stylesheet. Both are facts about
 * the build, not the source, so they are read from `dist/assets/*.js`.
 *
 * Needs a build: it runs under `npm run test:dist` and skips elsewhere (see
 * `./dist-gate`). A green result is a statement about the last build.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "dist", "assets");

const scripts = existsSync(ASSETS_DIR)
  ? readdirSync(ASSETS_DIR)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({
        name,
        text: readFileSync(path.join(ASSETS_DIR, name), "utf8"),
      }))
  : [];

const GATE = resolveDistGate(scripts.length > 0, "dist/assets/*.js");

// Where the helper creates the event, and where the app listens for it.
const DISPATCH = /new Event\(\s*[`'"]vite:preloadError[`'"]/g;
const LISTEN = /addEventListener\(\s*[`'"]vite:preloadError[`'"]/g;
// A dynamic import of a relative path. Only paths that name a file in
// `dist/assets` count: React's own error text quotes `import('./MyComponent')`.
const DYNAMIC_IMPORT = /\bimport\(\s*[`'"](\.\/[^`'"]+)[`'"]\s*\)/g;

const count = (pattern: RegExp): number =>
  scripts.reduce((n, s) => n + [...s.text.matchAll(pattern)].length, 0);

/** The preload helper's name and source, from the one place that dispatches. */
function preloadHelper(): { name: string; body: string; file: string } {
  expect(count(DISPATCH)).toBe(1);
  const defining = scripts.filter((s) => s.text.search(DISPATCH) !== -1);
  const [{ name: file, text }] = defining as [(typeof scripts)[number]];
  const at = text.search(DISPATCH);
  // The helper is `<name>=function(…){…}` with its inner functions declared
  // as `function x(…)`, so the last `<name>=function(` before the event is it.
  const starts = [...text.slice(0, at).matchAll(/([\w$]+)=function\(/g)];
  const last = starts.at(-1);
  if (last?.[1] === undefined) throw new Error("no preload helper found");
  return { name: last[1], body: text.slice(last.index, at + 400), file };
}

describe.skipIf(GATE === "skip")(
  "dynamic imports in the build (dist/assets/*.js, requires `npm run build`)",
  () => {
    it("the app listens for the event", () => {
      expect(count(LISTEN)).toBe(1);
    });

    it("the helper dispatches the event for a rejected import, not only a stylesheet", () => {
      const { body } = preloadHelper();
      // `return e().catch(i)`: the importer's own rejection goes to the
      // dispatching function.
      expect(body).toMatch(/[\w$]+\(\)\.catch\([\w$]+\)/);
    });

    it("every dynamic import is wrapped by the helper", () => {
      const { name } = preloadHelper();
      const unwrapped: string[] = [];
      let total = 0;
      for (const { name: file, text } of scripts) {
        for (const match of text.matchAll(DYNAMIC_IMPORT)) {
          const target = match[1] ?? "";
          if (!existsSync(path.join(ASSETS_DIR, target))) continue;
          total += 1;
          // The call this import sits in: `<helper>(()=>import(` or
          // `<helper>(async()=>{let{…}=await import(`, with no statement
          // boundary between the helper call and the import.
          const before = text.slice(
            Math.max(0, match.index - 120),
            match.index
          );
          const call = before.lastIndexOf(`${name}(`);
          if (call === -1 || before.slice(call).includes(";")) {
            unwrapped.push(`${file}: …${before.slice(-60)}`);
          }
        }
      }
      // A floor, so a pattern that silently matches nothing cannot pass.
      expect(total).toBeGreaterThan(0);
      expect(unwrapped).toEqual([]);
    });
  }
);
