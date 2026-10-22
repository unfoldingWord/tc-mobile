import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { region, stripHtmlComments, uniqueIndexOf } from "./support";

// #1636: whether a native lane built a commit, and whether it may be
// dispatched again, is decided by scripts/check-redispatch.mjs and nowhere
// else. #1613 tried to keep that rule as prose in two places and every review
// round found the copies and the commands disagreeing. These pins keep the
// tc-release skill and the runbook's §3a step 7 as pointers: each names the
// script once and carries none of the old rule's working parts.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) =>
  stripHtmlComments(readFileSync(path.join(ROOT, p), "utf8"));

/** The building blocks of the prose rule #1613 carried. */
const RULE_PARTS = [
  "gh run list",
  "gh run view",
  "/actions/runs/",
  "android-apk-",
  "--limit",
  "conclusion",
  "skipped",
  "two reads",
  "Already built",
];

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("the tc-release skill points at the script and holds no second rule", () => {
  const skill = read(".claude/skills/tc-release/SKILL.md");

  it("names the script exactly once", () => {
    expect(count(skill, "npm run check:redispatch")).toBe(1);
  });

  it.each(RULE_PARTS)("carries no %s", (part) => {
    expect(skill).not.toContain(part);
  });

  it("keeps the dispatch human-only", () => {
    const at = uniqueIndexOf(skill, "- [ ] Human-only: a dispatch");
    const bullet = region(skill, {
      from: at,
      to: skill.indexOf("\n- [ ]", at + 1),
    });
    expect(bullet).toContain("OK to dispatch <lane>");
  });

  // George r1 and r2 on #1641: the final-release bullet sent a `main`
  // rebuild "as step 5 says", and step 5 leads only to `--ref staging`.
  it("sends a main rebuild to runbook §4's --ref main command, not through step 5", () => {
    const at = uniqueIndexOf(
      skill,
      "- [ ] Agent-allowed: the native lanes (`android-apk.yml`,"
    );
    // The last bullet of the file; the paragraph after it ends the slice.
    const bullet = region(skill, {
      from: at,
      to: uniqueIndexOf(skill, "The shape, from v1.0.0"),
    });
    expect(bullet).toContain(
      "with runbook §4's command:\n      that lane's §3a step 7 command with `--ref main` in place of\n      `--ref staging`."
    );
    expect(bullet).not.toContain("as step 5 says");
    // George r3 on #1641: Play also pushes on `main`; every lane is named.
    expect(bullet).toContain("All three runs'");
    expect(bullet).not.toContain("Both runs'");
  });
});

describe("runbook §3a step 7 points at the script and holds no second rule", () => {
  const runbook = read("docs/release/promotion-v1.0.0.md");
  const step7 = region(runbook, {
    from: uniqueIndexOf(runbook, "7. **Native builds from one commit.**"),
    to: uniqueIndexOf(runbook, "8. **Check the APK before publishing.**"),
  });

  it("names the script exactly once", () => {
    expect(count(step7, "npm run check:redispatch")).toBe(1);
  });

  it.each(RULE_PARTS)("carries no %s", (part) => {
    expect(step7).not.toContain(part);
  });

  it("keeps the dispatch the DRI's, human-only", () => {
    expect(step7).toContain(
      "The DRI\n   dispatches a lane (human-only) only after"
    );
  });

  // Frank and George round 1 on #1641: `<lane>.yml` resolved to `apk.yml`,
  // a workflow that does not exist. Each lane token names its real file.
  it.each([
    ["apk", "android-apk.yml"],
    ["play", "android-play.yml"],
    ["testflight", "ios-testflight.yml"],
  ])("gives %s's dispatch command with %s", (lane, file) => {
    expect(step7).toContain(
      `\`${lane}\` is\n   \`gh workflow run ${file} --repo unfoldingWord/tc-mobile --ref staging\``
    );
    expect(existsSync(path.join(ROOT, ".github", "workflows", file))).toBe(
      true
    );
  });

  // George r3 on #1641: an OK line with no prior runs lists no ids, and the
  // step gave no follow-up for it, so the pre-dispatch form was the only one
  // to rerun.
  it("gives the follow-up for an OK line that lists no ids", () => {
    expect(step7).toContain("`--known=<the ids the OK line lists>`");
    expect(step7).toContain(
      "lists no ids: the rerun is then `--known=`, with nothing after the `=`."
    );
  });

  it("builds no workflow file name from the lane token", () => {
    expect(step7).not.toContain("<lane>.yml");
  });
});

describe("the script is reachable by its documented command", () => {
  it("package.json runs scripts/check-redispatch.mjs", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts["check:redispatch"]).toBe(
      "node scripts/check-redispatch.mjs"
    );
  });

  it("AGENTS.md Commands names it", () => {
    const agents = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
    const commands = region(agents, {
      from: uniqueIndexOf(agents, "## Commands"),
      to: uniqueIndexOf(agents, "## Architecture"),
    });
    expect(commands).toContain("npm run check:redispatch -- --lane");
  });
});
