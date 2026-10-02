import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { blankGradleSwiftComments, stripHtmlComments } from "./support";

/**
 * #1210 (go-live): the App Store build is iPhone-only, and its privacy
 * manifest states "no tracking, nothing collected" rather than leaving it
 * implied. DRI picks, 2026-10-01: "iPhone only for now (Recommended)" (D1)
 * and "1.0.1 adds it, then submit (Recommended)".
 *
 * iPhone-only matters before the first App Store release, not after: a
 * released app is understood not to be able to drop a device family in an
 * update (inference, recorded on #1210 D1), so the family is pinned here.
 *
 * Every file is read with its comments removed (#822), because the pins below
 * include positive matches a comment could otherwise satisfy. The `.pbxproj`
 * goes through the quote-aware Gradle/Swift strip, as in
 * `ios-deployment-target.test.ts`; the plists are XML, so their comments go
 * through the HTML strip.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Xcode project device family", () => {
  const pbxproj = blankGradleSwiftComments(
    read("ios/App/App.xcodeproj/project.pbxproj")
  );
  const families = [
    ...pbxproj.matchAll(/TARGETED_DEVICE_FAMILY = "?([\d,]+)"?;/g),
  ].map((m) => m[1]);

  // The app target has a Debug and a Release configuration. A vacuous "every
  // match is 1" over zero matches would pass with the setting deleted.
  it("found both build configurations' device family", () => {
    expect(families.length).toBeGreaterThanOrEqual(2);
  });

  it("targets iPhone only (family 1) in every configuration", () => {
    for (const family of families) expect(family).toBe("1");
  });
});

describe("Info.plist orientations", () => {
  const plist = stripHtmlComments(read("ios/App/App/Info.plist"));

  it("declares no iPad-only orientation set", () => {
    expect(plist).not.toContain("UISupportedInterfaceOrientations~ipad");
  });

  it("keeps the iPhone's portrait-only orientation", () => {
    expect(plist).toMatch(
      /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/
    );
  });
});

describe("PrivacyInfo.xcprivacy", () => {
  const manifest = stripHtmlComments(read("ios/App/App/PrivacyInfo.xcprivacy"));

  it("states that the app does not track", () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });

  it("lists no tracking domains", () => {
    expect(manifest).toMatch(
      /<key>NSPrivacyTrackingDomains<\/key>\s*(<array\/>|<array>\s*<\/array>)/
    );
  });

  it("lists no collected data types", () => {
    expect(manifest).toMatch(
      /<key>NSPrivacyCollectedDataTypes<\/key>\s*(<array\/>|<array>\s*<\/array>)/
    );
  });

  it("keeps the file-timestamp reason the filesystem plugin needs", () => {
    expect(manifest).toMatch(
      /<string>NSPrivacyAccessedAPICategoryFileTimestamp<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>C617\.1<\/string>/
    );
  });
});
