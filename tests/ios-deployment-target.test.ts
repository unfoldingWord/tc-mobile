import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #1052/#1017: the DRI raised the iOS floor to 15.4 so a phone below that
 * version can no longer install a build whose O4 CSS relies on `:has()`
 * (Safari shipped `:has()` in 15.4, not 15.0 — see #1051, which pins the WEB
 * build's `esbuild.target` at `ios15.4`). This suite pins the NATIVE app's
 * own floor to the same version everywhere it is declared, so the two halves
 * cannot drift apart again: a phone on 15.0-15.3 must be turned away by the
 * App Store / TestFlight install gate itself, not merely served CSS its
 * WebView already can't run.
 *
 * Every assertion below is red against the tree before this change (every
 * site read `15.0`, and `Package.swift` read `.v15`); see the PR body's
 * mutation table for the reproduction, not this comment (AGENTS.md: a run's
 * output belongs in the PR, never a docblock).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const FLOOR = "15.4";

describe("Xcode project deployment target", () => {
  const pbxproj = readFileSync(
    path.join(REPO_ROOT, "ios/App/App.xcodeproj/project.pbxproj"),
    "utf8"
  );
  const matches = [
    ...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g),
  ].map((m) => m[1]);

  // Sanity floor: a vacuous "every match is 15.4" over zero matches would
  // pass even if the setting were renamed or deleted entirely.
  it("found every known build-configuration occurrence", () => {
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("pins every occurrence to the raised floor", () => {
    for (const value of matches) {
      expect(value).toBe(FLOOR);
    }
  });
});

describe("SwiftPM package platform floor", () => {
  const pkg = readFileSync(
    path.join(REPO_ROOT, "ios/App/CapApp-SPM/Package.swift"),
    "utf8"
  );

  it("declares the raised iOS floor", () => {
    // SwiftPM's IOSVersion has no static case finer than a whole major
    // version, so a 15.4 floor can only be spelled with the string-literal
    // initializer AppleOSVersion provides. Pinning the literal text (not
    // just "contains 15.4" somewhere) catches a regression back to the
    // coarser `.v15` (== 15.0) static case, which would also contain the
    // substring "15" without ever meeting the 15.4 floor.
    expect(pkg).toContain('platforms: [.iOS("15.4")]');
    expect(pkg).not.toMatch(/\.iOS\(\.v1[0-4]\)/);
    expect(pkg).not.toContain(".iOS(.v15)");
  });
});

describe("native docs state the same floor", () => {
  const readme = readFileSync(
    path.join(REPO_ROOT, "docs/native/README.md"),
    "utf8"
  );
  const credentials = readFileSync(
    path.join(REPO_ROOT, "docs/native/ios-credentials.md"),
    "utf8"
  );

  it("README's platform table", () => {
    expect(readme).toContain("deployment target `15.4`");
    expect(readme).not.toContain("deployment target `15.0`");
  });

  it("TestFlight tester requirement", () => {
    expect(credentials).toContain("iOS 15.4 or later");
    expect(credentials).not.toContain("iOS 15 or later");
  });
});
