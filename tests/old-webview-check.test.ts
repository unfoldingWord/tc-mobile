import { readFileSync } from "node:fs";
import path from "node:path";

import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { stripHtmlComments } from "./support";

/**
 * The old-engine check in `index.html` (#1944) stays tied to the build target.
 *
 * Why a test that compares, rather than a feature list DERIVED from the
 * target: the check must run on engines that cannot parse the app, so it
 * cannot import anything and has no build step of its own. A derived list
 * would need a generated file, and a build plugin to keep it in step. The
 * pin is cheaper and fails loudly: the check carries `BUILT_FOR_CHROME`, and
 * this file fails when it differs from the Chrome number in `vite.config.ts`'s
 * `build.target`, so whoever raises the target is brought here to review the
 * list.
 *
 * Not covered: that every built-in the bundle needs is listed. Only the two
 * known to be used are, and `e2e/old-webview-screen.spec.ts` drives the
 * behaviour.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
const HTML = readFileSync(path.join(ROOT, "index.html"), "utf8");

/** The inline check's source, found by its id rather than by position. */
function checkSource(): string {
  const m = /<script id="old-webview-check">([\s\S]*?)<\/script>/.exec(HTML);
  if (!m?.[1]) throw new Error("index.html has no #old-webview-check script");
  return m[1];
}

function targetChrome(): number {
  const m = /^\s*target:\s*\[([^\]]*)\]/m.exec(CONFIG);
  if (!m?.[1]) throw new Error("vite.config.ts has no build.target array");
  const chrome = /"chrome(\d+)"/.exec(m[1]);
  if (!chrome?.[1]) throw new Error("build.target has no chrome entry");
  return Number(chrome[1]);
}

function features(): { name: string; since: number }[] {
  const out: { name: string; since: number }[] = [];
  const re = /name:\s*"([^"]+)",\s*since:\s*(\d+)/g;
  for (const m of checkSource().matchAll(re)) {
    out.push({ name: m[1]!, since: Number(m[2]) });
  }
  return out;
}

describe("the old-engine check (#1944)", () => {
  it("parses as ES5, so a very old WebView can run it", () => {
    const messages = new Linter().verify(checkSource(), {
      languageOptions: { ecmaVersion: 5, sourceType: "script" },
    });
    // A parse error is the only message with `fatal` set; no rules are on.
    expect(messages.filter((m) => m.fatal)).toEqual([]);
  });

  it("is a classic script, not a module", () => {
    expect(HTML).toMatch(/<script id="old-webview-check">/);
    expect(HTML).not.toMatch(
      /<script[^>]*type="module"[^>]*id="old-webview-check"/
    );
  });

  it("is built for the Chrome number in vite.config.ts's build.target", () => {
    const m = /var BUILT_FOR_CHROME = (\d+);/.exec(checkSource());
    expect(m?.[1]).toBeDefined();
    expect(Number(m![1])).toBe(targetChrome());
  });

  it("lists features, none newer than the build target", () => {
    const list = features();
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const f of list) {
      expect(f.since, f.name).toBeLessThanOrEqual(targetChrome());
    }
  });

  it("runs before the module bundle, and the module tag is untouched", () => {
    const code = stripHtmlComments(HTML);
    const check = code.indexOf('<script id="old-webview-check">');
    const bundle = code.indexOf(
      '<script type="module" src="/src/app/main.tsx">'
    );
    expect(check).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(check);
  });
});
