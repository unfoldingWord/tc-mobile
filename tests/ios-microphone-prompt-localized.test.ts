import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PENDING } from "../src/lib/i18n/pending";

import { blankGradleSwiftComments, stripHtmlComments } from "./support";

/**
 * The iOS microphone permission prompt speaks the phone's language (#1458).
 *
 * `NSMicrophoneUsageDescription` is the first sentence a person who may not
 * read sees on an iPhone, and iOS shows the `InfoPlist.strings` of the
 * `.lproj` that matches the phone's language, falling back to the English
 * string in `Info.plist`. So a language that ships in the app needs three
 * things the app's own string table does not carry: an `InfoPlist.strings`
 * in its `<tag>.lproj`, the tag in the project's `knownRegions` (and a
 * variant-group child, or Xcode never copies the file), and the tag in
 * `CFBundleLocalizations`.
 *
 * The languages checked are derived, not listed: English is the Info.plist
 * default, and every other language whose pending list in `pending.ts` is
 * empty is complete and must have a prompt. Arabic is `"all"` there until its
 * right-to-left device pass, so it is outside the set today and joins it, and
 * this test, the moment it is complete (DRI rule, 2026-10-21).
 *
 * This reads files only. It cannot show the text on an iPhone, and the prompts
 * are drafts that no reader of the language has checked.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const rel = (p: string) => path.join(REPO_ROOT, p);
const read = (p: string) => readFileSync(rel(p), "utf8");

const plist = stripHtmlComments(read("ios/App/App/Info.plist"));
const pbxproj = blankGradleSwiftComments(
  read("ios/App/App.xcodeproj/project.pbxproj")
);

const completeLocales = Object.entries(PENDING)
  .filter(([, pending]) => Array.isArray(pending) && pending.length === 0)
  .map(([tag]) => tag);

const stringsPath = (tag: string) =>
  `ios/App/App/${tag}.lproj/InfoPlist.strings`;

/** The value of `"NSMicrophoneUsageDescription" = "...";` in a strings file. */
function promptOf(tag: string): string {
  const file = stringsPath(tag);
  if (!existsSync(rel(file))) return "";
  const m =
    /^\s*"NSMicrophoneUsageDescription"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/m.exec(
      read(file)
    );
  return m ? m[1]! : "";
}

const english =
  /<key>NSMicrophoneUsageDescription<\/key>\s*<string>([^<]*)<\/string>/.exec(
    plist
  )?.[1];

describe("iOS microphone prompt, one per complete app language", () => {
  it("has the English default in Info.plist", () => {
    expect(english).toBeTruthy();
  });

  it("finds the complete languages, and Arabic is not yet one of them", () => {
    // Floor: a derivation that quietly matched nothing would pass every loop
    // below. Eight languages were complete when this was written.
    expect(completeLocales.length).toBeGreaterThanOrEqual(8);
    expect(completeLocales).not.toContain("ar");
  });

  it.each(completeLocales)(
    "%s: a non-empty prompt in its own .lproj",
    (tag) => {
      expect(promptOf(tag).trim().length).toBeGreaterThan(0);
    }
  );

  it.each(completeLocales)("%s: the prompt is not the English line", (tag) => {
    // A copied English sentence is a defect, not a draft.
    expect(promptOf(tag)).not.toBe(english);
  });

  it.each(completeLocales)("%s: declared in CFBundleLocalizations", (tag) => {
    const block =
      /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(
        plist
      )?.[1];
    expect(block, "CFBundleLocalizations missing").toBeTruthy();
    expect(block).toContain(`<string>${tag}</string>`);
  });

  it.each(completeLocales)("%s: a knownRegion in the Xcode project", (tag) => {
    const regions = /knownRegions = \(([\s\S]*?)\);/.exec(pbxproj)?.[1] ?? "";
    expect(regions).toMatch(new RegExp(`^\\s*"?${tag}"?,$`, "m"));
  });

  // The pbxproj is read with its `/* name */` annotations blanked (comments are
  // not evidence), so the chain is followed by object id: file reference ->
  // variant group -> build file -> the app's Resources phase.
  const variantGroup =
    /(\w{24})\s*=\s*\{\s*isa = PBXVariantGroup;\s*children = \(([\s\S]*?)\);[^}]*?name = InfoPlist\.strings;/.exec(
      pbxproj
    );

  it("has an InfoPlist.strings variant group", () => {
    expect(variantGroup).toBeTruthy();
  });

  it.each(completeLocales)(
    "%s: the strings file is a child of the InfoPlist.strings variant group",
    (tag) => {
      const ref = new RegExp(
        `(\\w{24})\\s*=\\s*\\{isa = PBXFileReference;[^}]*name = "?${tag}"?;[^}]*path = "?${tag}\\.lproj/InfoPlist\\.strings"?;`
      ).exec(pbxproj);
      expect(ref, "no PBXFileReference").toBeTruthy();
      expect(variantGroup?.[2]).toContain(ref![1]!);
    }
  );

  it("builds the InfoPlist.strings variant group into Resources", () => {
    const build = new RegExp(
      `(\\w{24})\\s*=\\s*\\{isa = PBXBuildFile; fileRef = ${variantGroup?.[1] ?? "MISSING"}`
    ).exec(pbxproj);
    expect(build, "no PBXBuildFile for the group").toBeTruthy();
    const resources =
      /isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/.exec(
        pbxproj
      )?.[1];
    expect(resources).toContain(build![1]!);
  });

  it("keeps the Info.plist default and the app name in English", () => {
    expect(english).toBe(
      "tC Mobile uses the microphone to record spoken translations."
    );
    expect(plist).toMatch(
      /<key>CFBundleDisplayName<\/key>\s*<string>tC Mobile<\/string>/
    );
  });
});
