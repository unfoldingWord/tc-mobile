import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { distBuildRequired, distGateDecision } from "./dist-gate";

// #568: `npm run verify` runs `test` before `build`, so `dist/` is present or
// absent depending on what an earlier command left behind — and the two
// build-artifact suites used to gate on exactly that. One tree, two tallies,
// neither of them evidence. The gate below is the repair, and this file is
// the gate's own test: the decision must depend on the CALLER's intent and
// never on leftover state.

describe("the build-artifact gate", () => {
  it.each([true, false])(
    "skips with artifactPresent=%s when no caller required a build — leftover state cannot change the tally",
    (artifactPresent) => {
      expect(distGateDecision(false, artifactPresent)).toBe("skip");
    }
  );

  it("runs when a build was required and the artifact is there", () => {
    expect(distGateDecision(true, true)).toBe("run");
  });

  it("fails, rather than skips, when a build was required and the artifact is missing", () => {
    // The loud half. A caller that promised a build and did not produce one
    // is a broken build step, not a reason to quietly assert nothing.
    expect(distGateDecision(true, false)).toBe("fail");
  });
});

describe("distBuildRequired", () => {
  it("is false when the variable is unset", () => {
    expect(distBuildRequired({})).toBe(false);
  });

  it("is false when the variable is set to an empty value", () => {
    // Matches the shell's own notion of unset-ish, and the truthiness these
    // suites used before the flag was lifted into one place.
    expect(distBuildRequired({ REQUIRE_DIST_BUILD: "" })).toBe(false);
  });

  it("is true when the sanctioned caller sets it", () => {
    expect(distBuildRequired({ REQUIRE_DIST_BUILD: "1" })).toBe(true);
  });
});

// The helper above can be correct while a suite ignores it, so this pins the
// two consumers to it. It is a source check, with the trap AGENTS.md names:
// a COMMENT naming the thing being searched for captures the search. Hence
// the comment stripping below, the non-emptiness floor, and the rule that no
// prose in these two files may spell the skip call with its opening paren.
const GATED_FILES = ["dist-css.test.ts", "precache-manifest.test.ts"];

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `describe.skipIf(<arg>)(` argument in a source, comments removed. */
function skipConditions(source: string): string[] {
  return [
    ...withoutComments(source).matchAll(/describe\.skipIf\(([\s\S]*?)\)\(/g),
  ].map((m) => (m[1] ?? "").trim());
}

describe.each(GATED_FILES)("%s's skip condition", (file) => {
  const source = readFileSync(
    path.join(path.resolve(import.meta.dirname), file),
    "utf8"
  );
  const conditions = skipConditions(source);

  it("is found at all — an empty match set would satisfy every assertion below it vacuously", () => {
    expect(conditions.length).toBeGreaterThan(0);
  });

  it("reads the shared gate", () => {
    for (const condition of conditions) expect(condition).toContain("GATE");
  });

  it("never consults the filesystem, which is what made the tally move (#568)", () => {
    for (const condition of conditions) {
      expect(condition).not.toMatch(/existsSync|readdirSync|CSS_PATH/);
    }
  });
});
