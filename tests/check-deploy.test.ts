import { describe, expect, it } from "vitest";

import { compareDeployed } from "../scripts/check-deploy.mjs";

describe("compareDeployed", () => {
  it("passes when sha and version both match", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "abc1234" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result).toEqual({
      ok: true,
      shaMatches: true,
      versionMatches: true,
    });
  });

  it("fails on a sha mismatch even if the version matches", () => {
    const result = compareDeployed(
      { version: "0.1.12", sha: "old0000" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.ok).toBe(false);
    expect(result.shaMatches).toBe(false);
    expect(result.versionMatches).toBe(true);
  });

  it("fails on a version mismatch even if the sha matches", () => {
    const result = compareDeployed(
      { version: "0.1.11", sha: "abc1234" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result.ok).toBe(false);
    expect(result.shaMatches).toBe(true);
    expect(result.versionMatches).toBe(false);
  });

  it("fails when both mismatch", () => {
    const result = compareDeployed(
      { version: "0.1.11", sha: "old0000" },
      { version: "0.1.12", sha: "abc1234" }
    );
    expect(result).toEqual({
      ok: false,
      shaMatches: false,
      versionMatches: false,
    });
  });
});
