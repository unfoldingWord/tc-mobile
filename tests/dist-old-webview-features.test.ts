import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The old-engine check lists every post-Chrome-85 built-in the bundle calls
 * (#1944).
 *
 * `tests/old-webview-check.test.ts` pins the check to the build target's
 * number; it cannot say the FEATURES list is complete. This scans the built
 * `dist/assets/*.js` for a fixed list of built-ins that Chrome 86 to 111
 * added, and fails when the bundle uses one that `index.html`'s FEATURES does
 * not name. Syntax is not in scope: the build target lowers syntax, and does
 * not polyfill built-ins, which is the whole gap.
 *
 * Limits, stated: the candidate list is fixed and hand-written, so a built-in
 * not on it is not covered, and a match is by text in minified code. A library
 * that touches a built-in through a computed name would not match. Each
 * candidate that is used must be listed, or exempted below with the reason.
 * A built-in iOS 15.4 lacks must not be listed in FEATURES (the check must
 * never block an iPhone); one found in the bundle would need an issue, not an
 * exemption here.
 *
 * Needs a build: it runs under `npm run test:dist` and skips elsewhere (see
 * `./dist-gate`). A green result is a statement about the last build.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "dist", "assets");
const HTML = readFileSync(path.join(ROOT, "index.html"), "utf8");

const scripts = existsSync(ASSETS_DIR)
  ? readdirSync(ASSETS_DIR)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({
        name,
        text: readFileSync(path.join(ASSETS_DIR, name), "utf8"),
      }))
  : [];

const GATE = resolveDistGate(scripts.length > 0, "dist/assets/*.js");

/** Built-ins added in Chrome 86 to 111, by the name FEATURES would use. */
const CANDIDATES: { name: string; pattern: RegExp }[] = [
  { name: "crypto.randomUUID", pattern: /\brandomUUID\b/ },
  { name: "Object.hasOwn", pattern: /\bObject\.hasOwn\b/ },
  { name: "Array.prototype.at", pattern: /\.at\(/ },
  { name: "Array.prototype.findLast", pattern: /\.findLast(Index)?\(/ },
  { name: "structuredClone", pattern: /\bstructuredClone\b/ },
  {
    name: "Array.prototype.toSorted",
    pattern: /\.to(Sorted|Reversed|Spliced)\(/,
  },
  { name: "Array.prototype.with", pattern: /\.with\(/ },
  { name: "AbortSignal.timeout", pattern: /\bAbortSignal\.timeout\b/ },
  { name: "Element.replaceChildren", pattern: /\.replaceChildren\(/ },
  { name: "Intl.supportedValuesOf", pattern: /\bIntl\.supportedValuesOf\b/ },
  { name: "Element.checkVisibility", pattern: /\.checkVisibility\(/ },
  { name: "scheduler.postTask", pattern: /\bscheduler\.postTask\b/ },
  { name: "HTMLInputElement.showPicker", pattern: /\.showPicker\(/ },
  { name: "String.prototype.isWellFormed", pattern: /\.isWellFormed\(/ },
  { name: "Atomics.waitAsync", pattern: /\bAtomics\.waitAsync\b/ },
  { name: "Intl.Segmenter", pattern: /\bIntl\.Segmenter\b/ },
];

/** A candidate the bundle uses and the check deliberately does not list. */
const EXEMPT: Record<string, { reason: string; guard: RegExp }> = {
  "Intl.Segmenter": {
    reason:
      "src/lib/utils.ts feature-detects it and falls back, so an engine without it keeps working",
    guard: /typeof Intl\.Segmenter==`function`/,
  },
};

function listed(): string[] {
  const m = /<script id="old-webview-check">([\s\S]*?)<\/script>/.exec(HTML);
  if (!m?.[1]) throw new Error("index.html has no #old-webview-check script");
  return [...m[1].matchAll(/name:\s*"([^"]+)",\s*since:/g)].map((x) => x[1]!);
}

describe.skipIf(GATE === "skip")(
  "old-engine check coverage of the build (dist/assets/*.js, requires `npm run build`)",
  () => {
    it("every post-Chrome-85 built-in the bundle uses is listed or exempt", () => {
      const names = listed();
      expect(names.length).toBeGreaterThanOrEqual(3);
      const used = CANDIDATES.filter((c) =>
        scripts.some((s) => c.pattern.test(s.text))
      ).map((c) => c.name);
      // A floor: the bundle does use these, so a scan that matched nothing
      // would not pass for the right reason.
      expect(used).toEqual(
        expect.arrayContaining(["Object.hasOwn", "crypto.randomUUID"])
      );
      const unlisted = used.filter((n) => !names.includes(n) && !(n in EXEMPT));
      expect(unlisted).toEqual([]);
    });

    it("an exemption still holds: the bundle guards that built-in", () => {
      for (const [name, { guard }] of Object.entries(EXEMPT)) {
        const used = scripts.filter((s) =>
          CANDIDATES.find((c) => c.name === name)!.pattern.test(s.text)
        );
        for (const s of used) {
          expect(guard.test(s.text), `${name} in ${s.name}`).toBe(true);
        }
      }
    });
  }
);
