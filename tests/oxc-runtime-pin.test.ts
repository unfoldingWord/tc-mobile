import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `@oxc-project/runtime` is an exact dev pin that must equal the version in
 * the helper ids Rolldown injects (`\0@oxc-project+runtime@<ver>/helpers/…`),
 * or `virtualModuleOwner` fails closed and `tests/dist-source-offer.test.ts`
 * reports "has no owning package" after a full build (#1820).
 *
 * Rolldown does not depend on `@oxc-project/runtime` in its metadata. It
 * depends on `@oxc-project/types` at an exact `=<ver>`, and the oxc packages
 * are released in lockstep, so that exact version is the runtime version it
 * embeds. This reads the requirement from the installed Rolldown's
 * package.json; a range or a missing entry is an error, not a match.
 */

const PKG = "@oxc-project/runtime";
const ANCHOR = "@oxc-project/types";

const root = path.join(import.meta.dirname, "..");
const readJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(path.join(root, ...parts), "utf8")) as T;

interface Manifest {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The runtime version Rolldown requires, or why it cannot be read. */
function requiredRuntime(rolldown: Manifest): string {
  const spec = rolldown.dependencies?.[ANCHOR];
  if (spec === undefined) {
    throw new Error(
      `rolldown@${rolldown.version} declares no ${ANCHOR} dependency, so the ${PKG} version it requires cannot be read from its metadata`
    );
  }
  const exact = /^=?(\d+\.\d+\.\d+)$/.exec(spec);
  if (!exact) {
    throw new Error(
      `rolldown@${rolldown.version} declares ${ANCHOR} as ${JSON.stringify(spec)}, which is not a plain exact x.y.z version (a range, prerelease or build tag), so the ${PKG} version it requires cannot be read from its metadata`
    );
  }
  return exact[1] as string;
}

/** A message naming the package, the pin and the required version, or null. */
function pinProblem(pin: string | undefined, required: string): string | null {
  if (pin === required) return null;
  return `${PKG} is pinned at ${pin ?? "(not pinned)"} in package.json, but the installed Rolldown requires ${required}. Set "${PKG}": "${required}" (exact) in devDependencies and refresh package-lock.json.`;
}

/** A message naming the installed copy and the pin, or null when they agree. */
function skewProblem(
  installed: string | undefined,
  pin: string | undefined
): string | null {
  if (installed === pin) return null;
  return `The installed ${PKG} is ${installed ?? "(unreadable)"}, but package.json pins ${pin ?? "(not pinned)"}. node_modules and package-lock.json disagree with the pin: refresh the lockfile (npm install) so the installed copy matches.`;
}

describe("the @oxc-project/runtime pin", () => {
  it("equals the runtime version the installed Rolldown requires", () => {
    const rolldown = readJson<Manifest>(
      "node_modules",
      "rolldown",
      "package.json"
    );
    const pkg = readJson<Manifest>("package.json");
    // "ok" on both sides so a failure prints the whole message, not a stub.
    expect(
      pinProblem(pkg.devDependencies?.[PKG], requiredRuntime(rolldown)) ?? "ok"
    ).toBe("ok");
  });

  it("is the version the installed package itself reports", () => {
    const pkg = readJson<Manifest>("package.json");
    const installed = readJson<Manifest>(
      "node_modules",
      "@oxc-project",
      "runtime",
      "package.json"
    );
    // "ok" on both sides so a failure prints the whole message, not a stub.
    expect(
      skewProblem(installed.version, pkg.devDependencies?.[PKG]) ?? "ok"
    ).toBe("ok");
  });

  it("names the package, the pin and the required version on a mismatch", () => {
    const message = pinProblem("0.153.0", "0.156.0");
    expect(message).toContain(PKG);
    // The roles, not just the numbers: the pin is the one in package.json, the
    // requirement is Rolldown's, and the fix sentence must name the latter.
    expect(message).toMatch(/pinned at 0\.153\.0\b[\s\S]*requires 0\.156\.0\b/);
    expect(message).toContain(`"${PKG}": "0.156.0"`);
    expect(pinProblem(undefined, "0.156.0")).toContain("(not pinned)");
  });

  it("is silent when the pin equals the requirement", () => {
    expect(pinProblem("0.156.0", "0.156.0")).toBeNull();
  });

  it("names the package and the lockfile when the installed copy skews", () => {
    const message = skewProblem("0.153.0", "0.156.0");
    expect(message).toContain(PKG);
    expect(message).toMatch(/installed[\s\S]*0\.153\.0[\s\S]*pins 0\.156\.0/);
    expect(message).toContain("refresh the lockfile");
    expect(skewProblem("0.156.0", "0.156.0")).toBeNull();
  });

  it("reads an exact requirement", () => {
    expect(requiredRuntime({ dependencies: { [ANCHOR]: "=0.156.0" } })).toBe(
      "0.156.0"
    );
  });

  it("refuses a range, a prerelease and a build tag as not a plain x.y.z", () => {
    for (const spec of ["^0.156.0", "=0.156.0-rc.1", "=0.156.0+b1"]) {
      expect(() =>
        requiredRuntime({ version: "9.9.9", dependencies: { [ANCHOR]: spec } })
      ).toThrow(/not a plain exact x\.y\.z/);
    }
  });

  it("says the entry is missing, not that it is the wrong shape", () => {
    expect(() => requiredRuntime({ dependencies: {} })).toThrow(
      /declares no @oxc-project\/types dependency/
    );
    expect(() => requiredRuntime({ dependencies: {} })).not.toThrow(
      /not a plain/
    );
  });
});
