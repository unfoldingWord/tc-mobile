import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { blankGradleSwiftComments } from "./support";

/**
 * #1421 (row 1423b): `MARKETING_VERSION` is the user-facing iOS version, and
 * the Xcode project declares it once per build configuration. A bump that
 * edits one configuration and misses the other would ship TestFlight builds
 * (Release) that disagree with a local Debug run, and nothing else reads it.
 * This pins the one property that is a rule rather than a value: every
 * configuration that sets it, Debug and Release both, carries the same value,
 * and that value is a dotted number. The value itself is deliberately NOT
 * pinned to `package.json` — `docs/native/README.md` §6 documents the iOS
 * marketing version as independent of the PWA's version.
 *
 * The project is read with its comments removed (#822), because the pins are
 * positive matches and a commented-out `MARKETING_VERSION` could otherwise
 * stand in for a live one. The checker is a pure function over the text so the
 * gate is exercised in both states on fixtures (a mismatch, and the
 * documented next bump), not only on the one tree that happens to be checked
 * in.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

type Setting = { configuration: string; value: string };

/** Every `MARKETING_VERSION` in a build configuration block, with the block's
 *  `name`. Blocks run from `isa = XCBuildConfiguration;` to the next one or the
 *  end of the file; `name = …;` is the block's last key. */
function marketingVersions(pbxproj: string): Setting[] {
  const settings: Setting[] = [];
  const blocks = pbxproj.split(/isa = XCBuildConfiguration;/).slice(1);
  for (const block of blocks) {
    const value = /\bMARKETING_VERSION = ([^;\s]+);/.exec(block)?.[1];
    if (value === undefined) continue;
    const name = /\bname = (\w+);/.exec(block)?.[1];
    if (name === undefined) {
      throw new Error(
        "a build configuration sets MARKETING_VERSION but has no name"
      );
    }
    settings.push({ configuration: name, value });
  }
  return settings;
}

/** The gate: returns the problems, empty when the project is consistent. */
function marketingVersionProblems(pbxproj: string): string[] {
  const settings = marketingVersions(pbxproj);
  const problems: string[] = [];
  for (const configuration of ["Debug", "Release"]) {
    if (!settings.some((s) => s.configuration === configuration)) {
      problems.push(`no ${configuration} configuration sets MARKETING_VERSION`);
    }
  }
  for (const { configuration, value } of settings) {
    if (!/^\d+\.\d+(\.\d+)?$/.test(value)) {
      problems.push(
        `${configuration} MARKETING_VERSION "${value}" is not a dotted number`
      );
    }
  }
  const distinct = new Set(settings.map((s) => s.value));
  if (distinct.size > 1) {
    problems.push(
      `MARKETING_VERSION differs between configurations: ${settings
        .map((s) => `${s.configuration}=${s.value}`)
        .join(", ")}`
    );
  }
  return problems;
}

function project(debug: string, release: string): string {
  const block = (name: string, version: string) => `
		ABC /* ${name} */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				MARKETING_VERSION = ${version};
			};
			name = ${name};
		};`;
  return block("Debug", debug) + block("Release", release);
}

describe("iOS MARKETING_VERSION in the Xcode project", () => {
  const pbxproj = blankGradleSwiftComments(
    readFileSync(
      path.join(REPO_ROOT, "ios/App/App.xcodeproj/project.pbxproj"),
      "utf8"
    )
  );

  it("is set by both Debug and Release in the checked-in project, to one value", () => {
    const settings = marketingVersions(pbxproj);
    // Non-emptiness floor: a rename of the setting must not pass vacuously.
    expect(settings.map((s) => s.configuration).sort()).toEqual([
      "Debug",
      "Release",
    ]);
    expect(marketingVersionProblems(pbxproj)).toEqual([]);
  });

  describe("the gate, on fixtures", () => {
    it("stays green on a consistent value and on the documented next bump", () => {
      expect(marketingVersionProblems(project("1.1", "1.1"))).toEqual([]);
      expect(marketingVersionProblems(project("1.2", "1.2"))).toEqual([]);
    });

    it("goes red when one configuration is missed in a bump", () => {
      expect(marketingVersionProblems(project("1.2", "1.1"))).toEqual([
        "MARKETING_VERSION differs between configurations: Debug=1.2, Release=1.1",
      ]);
      expect(marketingVersionProblems(project("1.1", "1.2"))).toHaveLength(1);
    });

    it("goes red when a configuration drops the setting or the value is not a number", () => {
      const releaseOnly = project("1.1", "1.1").replace(
        /\s*MARKETING_VERSION = 1\.1;(?=[^]*name = Release;)/,
        ""
      );
      expect(marketingVersionProblems(releaseOnly)).toEqual([
        "no Debug configuration sets MARKETING_VERSION",
      ]);
      expect(marketingVersionProblems(project("$(X)", "$(X)"))).toHaveLength(2);
      expect(marketingVersionProblems("")).toHaveLength(2);
    });

    it("is not satisfied by a comment", () => {
      const decoy = blankGradleSwiftComments(
        project("1.1", "1.1").replace(
          "MARKETING_VERSION = 1.1;\n\t\t\t};\n\t\t\tname = Release;",
          "// MARKETING_VERSION = 1.1;\n\t\t\t};\n\t\t\tname = Release;"
        )
      );
      expect(marketingVersionProblems(decoy)).toEqual([
        "no Release configuration sets MARKETING_VERSION",
      ]);
    });
  });
});
