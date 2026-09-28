import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// #161 Q-20: package.json had no `repository` or `homepage` field, so an
// outside reader (npm's own registry page, a dependency-audit tool) had
// nothing pointing back at this repo. This pins the two fields to the
// canonical GitHub location so a future edit can't silently drop or
// mistype them.
const ROOT = path.join(import.meta.dirname, "..");

const packageJson: {
  repository?: { type?: string; url?: string };
  homepage?: string;
} = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

describe("package.json repository/homepage metadata (#161 Q-20)", () => {
  it("declares a git repository pointing at unfoldingWord/tc-mobile", () => {
    expect(packageJson.repository?.type).toBe("git");
    expect(packageJson.repository?.url).toBe(
      "git+https://github.com/unfoldingWord/tc-mobile.git"
    );
  });

  it("declares a homepage pointing at the repo's README", () => {
    expect(packageJson.homepage).toBe(
      "https://github.com/unfoldingWord/tc-mobile#readme"
    );
  });
});
