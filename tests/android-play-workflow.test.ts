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

const fastfile = readFileSync(
  new URL("../fastlane/Fastfile", import.meta.url),
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

// Extracts a single `- name: <name>` step's YAML block (up to but not
// including the next `- name:`/`- uses:` step at the same 6-space indent),
// so a test can inspect that one step's `if:` condition and run its script
// in isolation — the same "read the real step, don't restate it" approach
// preflightScript() above already uses for the preflight job.
function stepBlock(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Missing step: ${name}`);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/\n {6}(- name:|- uses:)/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function stepIf(block: string): string | null {
  const m = /^ {8}if: (.+)$/m.exec(block);
  return m?.[1] ? m[1].trim() : null;
}

function stepRunScript(block: string): string {
  const run = /^ {8}run: \|\n/m.exec(block);
  if (!run) throw new Error("Missing run block in step");
  const lines = block.slice(run.index + run[0].length).split("\n");
  const script: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

function runScript(script: string, env: Record<string, string>) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
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
  it("serializes every run for this Play app across both branches", () => {
    expect(workflow).toMatch(
      /^ {2}group: android-play\n {2}cancel-in-progress: false\n/m
    );
  });
  it("keeps the security shape the header relies on", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).toMatch(/^ {4}permissions:\n {6}contents: read$/m);
    expect(workflow).toMatch(
      /- name: Remove decoded credentials\n {8}if: always\(\)\n/
    );
  });
  it("installs fastlane before any Play secret reaches disk", () => {
    // gem install / bundle install run arbitrary code (install hooks), so
    // this must happen before the keystore is written to disk, not merely
    // before it is read.
    const npmCi = workflow.indexOf("- name: Install dependencies");
    const installFastlane = workflow.indexOf("- name: Install fastlane");
    const writeSecrets = workflow.indexOf("- name: Write the upload keystore");
    expect(npmCi).toBeGreaterThan(-1);
    expect(installFastlane).toBeGreaterThan(-1);
    expect(writeSecrets).toBeGreaterThan(-1);
    expect(installFastlane).toBeGreaterThan(npmCi);
    expect(installFastlane).toBeLessThan(writeSecrets);
  });
});

// #893: a build_only dispatch builds and signs the .aab but never uploads it,
// so it should need only the four signing secrets — not the Play
// service-account credential the upload alone consumes. inputs.build_only is
// empty on a push (pushes carry no `inputs` context at all), so `!inputs.
// build_only` is true there too: a push always takes the "requires the
// service account" branch, same as an explicit build_only:false dispatch.
describe("build_only needs only the signing secrets, not the service account (#893)", () => {
  it("requires the four signing secrets unconditionally, and nothing else", () => {
    const block = stepBlock("Require the signing secrets");
    expect(stepIf(block)).toBeNull();
    expect(block).not.toContain("PLAY_SERVICE_ACCOUNT_JSON");

    const script = stepRunScript(block);
    const complete = runScript(script, {
      PLAY_UPLOAD_KEYSTORE_BASE64: "a",
      PLAY_UPLOAD_STORE_PASSWORD: "b",
      PLAY_UPLOAD_KEY_ALIAS: "c",
      PLAY_UPLOAD_KEY_PASSWORD: "d",
    });
    expect(complete.status).toBe(0);

    const incomplete = runScript(script, {
      PLAY_UPLOAD_KEYSTORE_BASE64: "a",
      PLAY_UPLOAD_STORE_PASSWORD: "b",
      PLAY_UPLOAD_KEY_ALIAS: "c",
      // PLAY_UPLOAD_KEY_PASSWORD missing
    });
    expect(incomplete.status).not.toBe(0);
  });

  it("gates the Play service-account requirement on build_only", () => {
    const block = stepBlock("Require the Play service-account secret");
    expect(stepIf(block)).toBe("${{ !inputs.build_only }}");
  });

  it("still enforces the service-account secret whenever that step runs (the upload path)", () => {
    const block = stepBlock("Require the Play service-account secret");
    const script = stepRunScript(block);
    expect(runScript(script, {}).status).not.toBe(0);
    expect(
      runScript(script, { PLAY_SERVICE_ACCOUNT_JSON: '{"type":"x"}' }).status
    ).toBe(0);
  });

  it("decodes the upload keystore unconditionally", () => {
    const block = stepBlock("Write the upload keystore");
    expect(stepIf(block)).toBeNull();
  });

  it("gates decoding the Play service-account key on build_only", () => {
    const block = stepBlock("Write the Play service-account key");
    expect(stepIf(block)).toBe("${{ !inputs.build_only }}");
  });

  it("still cleans up both decoded credential paths regardless of which ran", () => {
    const block = stepBlock("Remove decoded credentials");
    expect(block).toContain("android/tc-mobile-upload.jks");
    expect(block).toContain("fastlane/play-service-account.json");
  });
});

describe("Fastlane Play lane", () => {
  // The five skip_upload_* flags are what keeps this lane from touching the
  // Play Console store listing (metadata, changelogs, images, screenshots)
  // or uploading a bare APK alongside the .aab. Pin each one so a later edit
  // that drops or flips one fails a test instead of silently widening what
  // fastlane is allowed to touch.
  function playLaneBlock(): string {
    const start = fastfile.indexOf("lane :play do");
    if (start < 0) throw new Error("Missing Play lane");
    const end = fastfile.indexOf("\nend", start);
    if (end < 0) throw new Error("Could not find end of Play lane");
    return fastfile.slice(start, end);
  }

  it.each([
    "skip_upload_apk",
    "skip_upload_metadata",
    "skip_upload_changelogs",
    "skip_upload_images",
    "skip_upload_screenshots",
  ])("pins %s: true in the Play lane", (flag) => {
    const block = playLaneBlock();
    expect(block).toMatch(new RegExp(`^\\s*${flag}: true,?\\s*$`, "m"));
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

  it.each(["production", "Production", "PRODUCTION"])(
    "refuses the %s track from either branch",
    (track) => {
      expect(runPreflight({ REF: "main", TRACK_MAIN: track }).status).not.toBe(
        0
      );
      expect(
        runPreflight({ REF: "staging", TRACK_STAGING: track }).status
      ).not.toBe(0);
    }
  );

  it.each(["alpha\nenabled=true", "closed beta", "a;b"])(
    "refuses a track that is not a single token (%j)",
    (track) => {
      expect(runPreflight({ REF: "main", TRACK_MAIN: track }).status).not.toBe(
        0
      );
    }
  );

  it.each(["beta", "internal", "tc-mobile.field_2"])(
    "passes the testing or custom track %s",
    (track) => {
      const r = runPreflight({ REF: "main", TRACK_MAIN: track });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`track=${track}\n`);
    }
  );

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
