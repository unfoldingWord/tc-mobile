import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The About screen's source offer ships a durable link to the app's own
 * Corresponding Source in the BUILT bundle (LGPL §4(d)(0), the DRI's 2026-09-24
 * decision on #144).
 *
 * `tests/licenses.test.ts` pins the SOURCE wiring; this pins the emitted
 * artifact, the way `dist-locale` does for the locale attributes. A source-only
 * check would pass on a build that stripped or dead-code-eliminated the link —
 * the half-gate AGENTS.md warns about — and the whole point of the DRI decision
 * is that the link actually SHIPS on the phone. The offer is a GitHub
 * `/tree/<sha>` URL built from `__BUILD_SHA__`; the base `github.com/
 * unfoldingWord/tc-mobile` is the durable, sha-independent part to assert.
 *
 * Runs under `npm run test:dist` after a build; a bare `npm test` skips it.
 * See `tests/dist-gate.ts` for why presence of `dist/` decides nothing.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "dist", "assets");

function builtJs(): string {
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(ASSETS, f), "utf8"))
    .join("\n");
}

const gate = resolveDistGate(existsSync(ASSETS), "dist/assets");

describe.skipIf(gate === "skip")(
  "the built About surface ships the source offer",
  () => {
    it("carries the public Corresponding Source link in the bundle", () => {
      // Present it as the URL that resolves to the source, not a bare mention,
      // so a build that keeps the string but drops the `https://github.com/`
      // prefix (no longer a usable link) still fails.
      expect(builtJs()).toContain(
        "https://github.com/unfoldingWord/tc-mobile/tree/"
      );
    });
  }
);
