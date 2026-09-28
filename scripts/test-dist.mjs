/**
 * The sanctioned caller for the build-artifact suites.
 *
 * This exists to set one environment variable in a way that works on every
 * platform a contributor pushes from. `REQUIRE_DIST_BUILD=1 vitest run …` as
 * an npm script is a POSIX env prefix: npm's default script shell on Windows
 * is `cmd.exe`, which does not accept `NAME=value command`, and this repo has
 * no `cross-env` and no `script-shell` override. `verify`, `.husky/pre-push`
 * and ci.yml's build-artifact step all call this, so a POSIX-only spelling
 * would take the whole push gate down on a Windows checkout while Ubuntu CI
 * stayed green — the same asymmetry as #189 (George R1 P2 on #572).
 *
 * Setting the variable is the whole job. See `tests/dist-gate.ts` for what it
 * decides and why artifact presence decides nothing (#568).
 */
import { spawnSync } from "node:child_process";

process.env.REQUIRE_DIST_BUILD = "1";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/dist-css.test.ts",
    "tests/dist-locale.test.ts",
    "tests/dist-source-offer.test.ts",
    "tests/precache-manifest.test.ts",
    "tests/build-target-floor.test.ts",
  ],
  { stdio: "inherit", env: process.env }
);

if (result.error) console.error(result.error);

// A signal-killed child reports `status === null`; treat anything that is not
// a clean 0 as a failure rather than letting the gate exit 0 on it.
process.exit(result.status ?? 1);
