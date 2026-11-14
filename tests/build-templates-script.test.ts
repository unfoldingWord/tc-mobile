import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TEMPLATES_BUILD } from "../scripts/build-templates.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const scripts = (
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

// A POSIX `VAR=value cmd` prefix at the start of a command, which cmd and
// PowerShell do not understand (#1804). Checked on every segment of every
// script, so a second occurrence elsewhere fails too.
const ENV_PREFIX = /(^|&&|\|\||;|\|)\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s/;

describe("package.json scripts are shell-portable (#1804)", () => {
  it("no script starts a command with a POSIX VAR=value prefix", () => {
    const offenders = Object.entries(scripts)
      .filter(([, command]) => ENV_PREFIX.test(command))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it("build:templates runs the wrapper, which sets the bake variables", () => {
    expect(scripts["build:templates"]).toBe("node scripts/build-templates.mjs");
    expect(TEMPLATES_BUILD.env).toEqual({
      TC_BAKE_PROVISIONAL_TEMPLATES: "1",
      TC_BAKE_BRANCH: "e2e-templates",
    });
    expect(TEMPLATES_BUILD.args).toEqual([
      "build",
      "--outDir",
      "dist-templates",
    ]);
  });
});
