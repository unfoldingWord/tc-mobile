import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HARNESS_ACTIONS } from "../scripts/ios-sim-core.mjs";

// The XCUITest driver for the iOS Simulator harness (#1840) lives in its own
// project, ios/Harness/, so the app's project and the TestFlight lane never
// see it. These are static checks on the files; whether the project builds is
// a Mac-only fact (`npm run ios-sim -- build --harness`) and is not claimed here.

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const PBX = read("ios/Harness/Harness.xcodeproj/project.pbxproj");
const SCHEME = read(
  "ios/Harness/Harness.xcodeproj/xcshareddata/xcschemes/Harness.xcscheme"
);
const DRIVE = read("ios/Harness/HarnessUITests/DriveTests.swift");

// The harness's own names, not the word "harness": the TestFlight workflow
// already says "e2e harness" in its leak guard, and that must not count.
const HARNESS_REF =
  /Harness\.xcodeproj|ios\/Harness|HarnessUITests|HarnessHost/;

describe("the harness stays out of the shipped app", () => {
  it("adds no target or reference to App.xcodeproj", () => {
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).not.toMatch(
      HARNESS_REF
    );
  });

  it("is not what the TestFlight lane builds", () => {
    const fastfile = read("fastlane/Fastfile");
    expect(fastfile).toContain('project: "ios/App/App.xcodeproj"');
    expect(fastfile).toContain('scheme: "App"');
    expect(fastfile).not.toMatch(HARNESS_REF);
    expect(read(".github/workflows/ios-testflight.yml")).not.toMatch(
      HARNESS_REF
    );
  });

  it("never signs: the Simulator build is unsigned and names no team", () => {
    expect(PBX).toContain("CODE_SIGNING_ALLOWED = NO;");
    expect(PBX).not.toContain("DEVELOPMENT_TEAM");
  });
});

describe("the harness project is internally consistent", () => {
  const ids = [...PBX.matchAll(/^\t\t([0-9A-Za-z]{24}) /gm)].map((m) => m[1]);

  it("defines its objects under 24-digit hex ids", () => {
    expect(ids.length).toBeGreaterThanOrEqual(20);
    for (const id of ids) expect(id).toMatch(/^[0-9A-F]{24}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every scheme buildable at a target the project defines", () => {
    const refs = [
      ...SCHEME.matchAll(
        /BlueprintIdentifier = "([^"]+)"\s+BuildableName = "[^"]+"\s+BlueprintName = "([^"]+)"/g
      ),
    ];
    expect(refs.length).toBe(2);
    for (const [, id, name] of refs) {
      expect(ids).toContain(id);
      expect(PBX).toMatch(
        new RegExp(`${id} /\\* ${name} \\*/ = \\{\\s+isa = PBXNativeTarget;`)
      );
    }
  });

  it("hosts the UI tests on the project's own do-nothing app", () => {
    expect(PBX).toContain("TEST_TARGET_NAME = HarnessHost;");
    expect(PBX).toContain('"com.apple.product-type.bundle.ui-testing"');
  });
});

describe("DriveTests and the CLI agree on the actions", () => {
  it("handles exactly the actions the CLI can send", () => {
    const cases = [...DRIVE.matchAll(/^\s+case "([a-z]+)":/gm)].map(
      (m) => m[1]
    );
    expect(cases.sort()).toEqual([...HARNESS_ACTIONS].sort());
  });

  it("fails an unknown action rather than passing with nothing done", () => {
    expect(DRIVE).toMatch(/default:\s+XCTFail\(/);
  });
});
