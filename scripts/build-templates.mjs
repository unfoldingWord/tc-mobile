#!/usr/bin/env node
/**
 * `npm run build:templates`: the build into `dist-templates/` that bakes the
 * provisional template packages (e2e only, #1450).
 *
 * The two variables used to be a `VAR=value vite build` prefix in
 * `package.json`, which only a POSIX shell understands (#1804, from #1800's
 * review). This sets them on the child's environment instead, so it runs the
 * same under cmd and PowerShell. Vite is started through `process.execPath`
 * rather than a `.bin` shim, because a shim is a `.cmd` file on Windows that
 * `spawn` cannot run without a shell.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/** What the templates build sets and where it writes. Exported for tests. */
export const TEMPLATES_BUILD = {
  env: {
    TC_BAKE_PROVISIONAL_TEMPLATES: "1",
    TC_BAKE_BRANCH: "e2e-templates",
  },
  args: ["build", "--outDir", "dist-templates"],
};

function main() {
  const require = createRequire(import.meta.url);
  const viteBin = path.join(
    path.dirname(require.resolve("vite/package.json")),
    "bin",
    "vite.js"
  );
  const result = spawnSync(
    process.execPath,
    [viteBin, ...TEMPLATES_BUILD.args],
    { stdio: "inherit", env: { ...process.env, ...TEMPLATES_BUILD.env } }
  );
  if (result.error) {
    console.error(`FAIL: could not start vite — ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
