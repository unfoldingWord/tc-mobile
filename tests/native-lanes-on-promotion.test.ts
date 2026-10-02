import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripYamlComments } from "./support";

/**
 * #1281: the APK and TestFlight lanes start on a promotion merge to `staging`
 * or `main` and otherwise only on a manual dispatch from one of those two
 * branches. The preflight job is what decides, so the gate is run here in
 * both states (AGENTS.md, "A gate is tested in both states"): it builds on a
 * promotion merge and on a staging/main dispatch, it builds nothing on any
 * other push to those branches, and it refuses any other ref outright. The
 * former `allow_any_ref` override is gone (DRI pick, 2026-09-30), so there
 * is no input that reopens a feature branch to the signing job; the
 * `release-signing` environment's deployment-branch policy is the actor
 * guard on the secrets and is a repository setting, not something this file
 * can read.
 *
 * Read through the shared YAML comment strip (#822): the trigger and
 * environment pins below are positive `toContain`s, and a `#` comment holding
 * the old line would satisfy them while the live line said otherwise.
 */

const LANES = {
  "android-apk.yml": "build",
  "ios-testflight.yml": "testflight",
} as const;

type Lane = keyof typeof LANES;

const GATE_STEP = "Build a promotion merge, or a dispatch from staging/main";

function workflow(lane: Lane): string {
  return stripYamlComments(
    readFileSync(
      new URL(`../.github/workflows/${lane}`, import.meta.url),
      "utf8"
    )
  );
}

function gateScript(lane: Lane): string {
  const text = workflow(lane);
  const start = text.indexOf(`      - name: ${GATE_STEP}\n`);
  if (start < 0) throw new Error(`Missing gate step in ${lane}`);
  const block = text.slice(start);
  const run = /^        run: \|\n/m.exec(block);
  if (!run) throw new Error(`Missing run block in ${lane}`);
  const lines = block.slice(run.index + run[0].length).split("\n");
  const script: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

function runGate(lane: Lane, env: Record<string, string>) {
  const result = spawnSync(
    "bash",
    ["-c", `${gateScript(lane)}\ncat "$GITHUB_OUTPUT"`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        GITHUB_OUTPUT: `/tmp/native-gate-${process.pid}-${Math.random()}`,
        REF_TYPE: "branch",
        HEAD_MESSAGE: "",
        ...env,
      },
    }
  );
  return result;
}

const PROMOTION_TO_STAGING =
  "Merge pull request #1291 from unfoldingWord/release/v1.0.1\n\nchore(release): v1.0.1";
const PROMOTION_TO_MAIN =
  "Merge pull request #1292 from unfoldingWord/staging\n\nv1.0.1 to production";

describe.each(Object.keys(LANES) as Lane[])("%s triggers (#1281)", (lane) => {
  const text = workflow(lane);

  it("fires on pushes to staging and main, and on a manual dispatch", () => {
    expect(text).toMatch(
      /^on:\n {2}push:\n {4}branches: \["staging", "main"\]\n/m
    );
    expect(text).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("has no allow_any_ref input or override left", () => {
    expect(text).not.toContain("allow_any_ref");
    expect(text).not.toContain("ALLOW_ANY");
  });

  it("runs the signing job only when preflight says so, in release-signing", () => {
    const job = LANES[lane];
    const block = text.slice(text.indexOf(`  ${job}:\n`));
    expect(block).toMatch(
      /^ {4}if: needs\.preflight\.outputs\.build == 'true'$/m
    );
    expect(block).toMatch(/^ {4}environment: release-signing$/m);
    expect(block).toMatch(/^ {4}needs: preflight$/m);
    // Preflight stays secret-free and environment-free: it is the mistake
    // guard, not the actor guard, and must not be the job the policy gates.
    const preflight = text.slice(
      text.indexOf("  preflight:\n"),
      text.indexOf(`  ${job}:\n`)
    );
    expect(preflight).not.toContain("secrets.");
    expect(preflight).not.toContain("environment:");
    expect(preflight).toMatch(/^ {4}outputs:\n {6}build: /m);
  });
});

describe.each(Object.keys(LANES) as Lane[])(
  "%s preflight gate, both states (#1281)",
  (lane) => {
    it.each([
      ["staging", PROMOTION_TO_STAGING],
      ["main", PROMOTION_TO_MAIN],
      // A release ref promoted straight to main is still an admin merge of a
      // pinned release ref; the gate accepts it on either branch.
      ["main", "Merge pull request #2000 from unfoldingWord/release/v1.0.2"],
    ])("builds a promotion merge pushed to %s", (REF, HEAD_MESSAGE) => {
      const result = runGate(lane, { EVENT: "push", REF, HEAD_MESSAGE });
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("build=true");
      expect(result.stdout).not.toContain("::notice::");
    });

    it.each([
      ["a direct commit", "docs: fix a typo on staging"],
      [
        "a merge of a feature branch",
        "Merge pull request #7 from unfoldingWord/fix/hotfix",
      ],
      [
        "a merge of a fork's release branch",
        "Merge pull request #8 from someone-else/release/v9",
      ],
      ["an empty message", ""],
      [
        "a promotion phrase on the second line only",
        "chore: something\nMerge pull request #1 from unfoldingWord/release/v1",
      ],
    ])("builds nothing on %s pushed to staging", (_name, HEAD_MESSAGE) => {
      const result = runGate(lane, {
        EVENT: "push",
        REF: "staging",
        HEAD_MESSAGE,
      });
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("build=false");
      expect(result.stdout).not.toContain("build=true");
      expect(result.stdout).toContain("::notice::Not a promotion merge");
    });

    it.each(["staging", "main"])(
      "builds a manual dispatch from %s without a message",
      (REF) => {
        const result = runGate(lane, { EVENT: "workflow_dispatch", REF });
        expect(result.status, result.stderr + result.stdout).toBe(0);
        expect(result.stdout).toContain("build=true");
      }
    );

    it.each([
      ["develop", "branch", "workflow_dispatch", ""],
      ["feature/experiment", "branch", "workflow_dispatch", ""],
      ["staging", "tag", "workflow_dispatch", ""],
      ["main", "tag", "workflow_dispatch", ""],
      ["v1.0.0", "tag", "workflow_dispatch", ""],
      // The push filter never delivers these, but the script must not rely
      // on the filter: a copied trigger block is a one-line edit away.
      ["develop", "branch", "push", PROMOTION_TO_STAGING],
      ["staging", "tag", "push", PROMOTION_TO_STAGING],
    ])(
      "refuses %s (%s) on %s outright, with no build output",
      (REF, REF_TYPE, EVENT, HEAD_MESSAGE) => {
        const result = runGate(lane, { EVENT, REF, REF_TYPE, HEAD_MESSAGE });
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("::error::Refusing to build");
        expect(result.stdout).not.toContain("build=");
      }
    );

    it("fails closed on an event this lane does not know", () => {
      const result = runGate(lane, { EVENT: "schedule", REF: "staging" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error::Unexpected event");
      expect(result.stdout).not.toContain("build=");
    });

    it("never echoes the commit subject at the start of a line, so a message cannot issue a workflow command", () => {
      const result = runGate(lane, {
        EVENT: "push",
        REF: "staging",
        HEAD_MESSAGE: "::error::injected\nsecond line",
      });
      expect(result.status).toBe(0);
      for (const line of result.stdout.split("\n")) {
        if (line.startsWith("::")) {
          expect(line).toMatch(/^::notice::Not a promotion merge/);
        }
      }
    });
  }
);
