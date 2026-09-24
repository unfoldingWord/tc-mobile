import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The Play lane (docs/native/play-store.md) fires on push, so its preflight is
// the only thing standing between a merge and a Play upload. Run the real
// preflight script from the yml against each branch/variable combination.
const workflow = readFileSync(
  new URL("../.github/workflows/android-play.yml", import.meta.url),
  "utf8"
);

function preflightScript(): string {
  const start = workflow.indexOf("      - name: Map branch to Play track\n");
  if (start < 0) throw new Error("Missing preflight step");
  const block = workflow.slice(start);
  const run = /^        run: \|\n/m.exec(block);
  if (!run) throw new Error("Missing run block");
  const lines = block.slice(run.index + run[0].length).split("\n");
  const script: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

function runPreflight(env: Record<string, string>) {
  const out = spawnSync(
    "bash",
    ["-c", `${preflightScript()}\ncat "$GITHUB_OUTPUT"`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        GITHUB_OUTPUT: `/tmp/play-preflight-${process.pid}-${Math.random()}`,
        TRACK_STAGING: "internal",
        TRACK_MAIN: "alpha",
        STATUS: "draft",
        ENABLED: "true",
        REF_TYPE: "branch",
        ...env,
      },
    }
  );
  return out;
}

describe("Play upload lane triggers", () => {
  it("fires only on pushes to staging and main", () => {
    expect(workflow).toContain('branches: ["staging", "main"]');
  });
  it("uses the branch-restricted play-upload environment, not release-signing", () => {
    expect(workflow).toContain("environment: play-upload");
    expect(workflow).not.toContain("environment: release-signing");
  });
  it("never builds a diagnostic bundle", () => {
    expect(workflow).toContain('TC_ANDROID_DIAGNOSTIC: "false"');
  });
});

describe("Play preflight branch → track mapping", () => {
  it.each([
    ["staging", "internal"],
    ["main", "alpha"],
  ])("%s → %s", (ref, track) => {
    const r = runPreflight({ REF: ref });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`track=${track}`);
    expect(r.stdout).toContain("enabled=true");
    expect(r.stdout).toContain("status=draft");
  });

  it("refuses any other branch", () => {
    expect(runPreflight({ REF: "develop" }).status).not.toBe(0);
  });

  it("refuses a tag named like a branch", () => {
    expect(runPreflight({ REF: "main", REF_TYPE: "tag" }).status).not.toBe(0);
  });

  it("rejects an unknown release status", () => {
    expect(runPreflight({ REF: "main", STATUS: "inProgress" }).status).not.toBe(
      0
    );
  });

  it("lets a build_only dispatch run while the lane is disabled", () => {
    const r = runPreflight({ REF: "main", ENABLED: "", BUILD_ONLY: "true" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("enabled=true");
  });

  it("reports disabled (without failing) until PLAY_UPLOAD_ENABLED is true", () => {
    const r = runPreflight({ REF: "staging", ENABLED: "" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("enabled=false");
  });
});
