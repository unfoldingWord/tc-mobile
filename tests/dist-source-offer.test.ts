import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { thirdPartyLicenses } from "@/components/licenses";

import { resolveDistGate } from "./dist-gate";

/**
 * The About screen's source offer ships in the BUILT bundle: a link to the
 * app's own source and a link to the lamejs source kept in this repository,
 * both at this build's full commit id (LGPL §4(d)(0); the DRI's 2026-09-24
 * decision on #144 for the app link, the 2026-09-26 ruling on Frank round 6
 * for the library link and the full id).
 *
 * `tests/licenses.test.ts` and `tests/vendored-lamejs.test.ts` pin the SOURCE
 * wiring; this pins the emitted artifact, the way `dist-locale` does for the
 * locale attributes. A source-only check would pass on a build that stripped
 * or dead-code-eliminated a link, or that fed it the 7-character footer sha.
 *
 * Runs under `npm run test:dist` after a build; a bare `npm test` skips it.
 * See `tests/dist-gate.ts` for why presence of `dist/` decides nothing.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const ASSETS = path.join(DIST, "assets");
const VERSION = path.join(DIST, "version.json");
const REPO = "https://github.com/unfoldingWord/tc-mobile";

function builtJs(): string {
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(ASSETS, f), "utf8"))
    .join("\n");
}

function fullSha(): string {
  const { shaFull } = JSON.parse(readFileSync(VERSION, "utf8")) as {
    shaFull?: string;
  };
  // A link that must name one commit carries all 40 hex characters (Frank
  // round 6, #144); "dev" or a short sha here means the build had no commit.
  expect(shaFull, "dist/version.json has no 40-hex shaFull").toMatch(
    /^[0-9a-f]{40}$/
  );
  return shaFull!;
}

function distFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? distFiles(path.join(dir, e.name))
      : [path.relative(DIST, path.join(dir, e.name))]
  );
}

const gate = resolveDistGate(
  existsSync(ASSETS) && existsSync(VERSION),
  "dist/assets or dist/version.json"
);

describe.skipIf(gate === "skip")(
  "the built About surface ships the source offer",
  () => {
    it("links the app's source at THIS build's full commit", () => {
      // Pin the build's own commit, not just the `/tree/` prefix: `/tree/dev`,
      // a bare `/tree/`, or another revision is NOT this build's source (Frank
      // round 4, #144). The closing quote or backtick ends the match, so the
      // longer lamejs URL below cannot satisfy this one.
      expect(builtJs()).toMatch(
        new RegExp(`["'\`]${REPO}/tree/${fullSha()}["'\`]`)
      );
    });

    it("links the vendored lamejs source at THIS build's full commit", () => {
      const lamejs = thirdPartyLicenses.find(
        (l) => l.name === "@breezystack/lamejs"
      );
      expect(lamejs?.source?.path, "lamejs has no source path").toBeTruthy();
      expect(builtJs()).toContain(
        `${REPO}/tree/${fullSha()}/${lamejs!.source!.path}`
      );
    });

    it("discloses Vite whenever the build carries its module-preload polyfill", () => {
      // Vite writes this polyfill into the entry chunk itself, from a dev
      // dependency the runtime-closure walk in tests/licenses.test.ts never
      // visits (Frank P2, bench round 1 on #1019). If a config change drops the
      // polyfill this passes without Vite; while it ships, Vite is disclosed.
      if (/\.supports\(["'`]modulepreload["'`]\)/.test(builtJs())) {
        expect(thirdPartyLicenses.map((l) => l.name)).toContain("vite");
      }
    });

    it("does not ship the vendored folder itself", () => {
      expect(distFiles(DIST).filter((f) => f.includes("third_party"))).toEqual(
        []
      );
    });
  }
);
