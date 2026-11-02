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
  const exact = spec && /^=?(\d+\.\d+\.\d+)$/.exec(spec);
  if (!exact) {
    throw new Error(
      `rolldown@${rolldown.version} declares ${ANCHOR} as ${JSON.stringify(spec)}, not an exact version, so the ${PKG} version it requires cannot be read from its metadata`
    );
  }
  return exact[1] as string;
}

/** A message naming the package, the pin and the required version, or null. */
function pinProblem(pin: string | undefined, required: string): string | null {
  if (pin === required) return null;
  return `${PKG} is pinned at ${pin ?? "(not pinned)"} in package.json, but the installed Rolldown requires ${required}. Set "${PKG}": "${required}" (exact) in devDependencies and refresh package-lock.json.`;
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
    expect(installed.version).toBe(pkg.devDependencies?.[PKG]);
  });

  it("names the package, the pin and the required version on a mismatch", () => {
    const message = pinProblem("0.153.0", "0.156.0");
    expect(message).toContain(PKG);
    expect(message).toContain("0.153.0");
    expect(message).toContain("0.156.0");
    expect(pinProblem(undefined, "0.156.0")).toContain("(not pinned)");
  });

  it("reads an exact requirement and refuses a range", () => {
    expect(requiredRuntime({ dependencies: { [ANCHOR]: "=0.156.0" } })).toBe(
      "0.156.0"
    );
    expect(() =>
      requiredRuntime({
        version: "9.9.9",
        dependencies: { [ANCHOR]: "^0.156.0" },
      })
    ).toThrow(/not an exact version/);
    expect(() => requiredRuntime({ dependencies: {} })).toThrow(
      /not an exact version/
    );
  });
});
