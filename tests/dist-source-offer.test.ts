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
const VERSION = path.join(ROOT, "dist", "version.json");

function builtJs(): string {
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(ASSETS, f), "utf8"))
    .join("\n");
}

const gate = resolveDistGate(
  existsSync(ASSETS) && existsSync(VERSION),
  "dist/assets or dist/version.json"
);

describe.skipIf(gate === "skip")(
  "the built About surface ships the source offer",
  () => {
    it("links the corresponding source at THIS build's exact commit", () => {
      // Pin the actual build sha, not just the `/tree/` prefix: a link to
      // `/tree/dev`, a bare `/tree/`, or an unrelated revision is NOT the
      // corresponding source for this build (Frank round 4, #144). `SourceOfferLink`
      // and `version.json` both read the same `buildSha`, so the emitted URL must
      // carry exactly it — this fails if the two ever diverge.
      const { sha } = JSON.parse(readFileSync(VERSION, "utf8")) as {
        sha: string;
      };
      expect(sha, "no sha in dist/version.json").toBeTruthy();
      expect(builtJs()).toContain(
        `https://github.com/unfoldingWord/tc-mobile/tree/${sha}`
      );
    });
  }
);
