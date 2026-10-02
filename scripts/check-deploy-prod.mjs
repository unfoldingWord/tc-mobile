#!/usr/bin/env node
/**
 * Confirm a `staging -> main` promotion on BOTH production origins.
 *
 * Production serves on two origins (`wrangler.jsonc`, #1295): the `tc-mobile`
 * Worker's own `workers.dev` URL and the `tcmobile.app` custom domain. The
 * first proves the Worker deployed; the second proves the custom-domain
 * route still reaches it. This runs `check-deploy.mjs` once per origin, in
 * that order, with `--require-origin` and the origin fixed, and **forwards
 * every argument the promoter passed to every run**.
 *
 *   npm run check:deploy:prod                              # both origins, from origin/main
 *   npm run check:deploy:prod -- --sha=abc1234 --version=1.0.0
 *
 * Why a script and not a shell `&&` chain in `package.json` (#1299 round-1
 * George P2): `npm run <script> -- <args>` appends `<args>` to the END of
 * the script text, so in `a && b` only `b` ever sees them. A promoter
 * confirming a rollback with `-- --sha=<previous> --version=<previous>`
 * (AGENTS.md: a rollback moves the Worker, not `main`, so `origin/main`
 * is the WRONG expectation there) would have had the workers.dev run
 * silently compare against `origin/main` and PASS on the build they had
 * just rolled away from, while only the custom-domain run honoured the
 * flags. One process that spawns both runs with the same argv closes that.
 *
 * Stops at the first failing origin and exits with its status — if the
 * Worker itself did not deploy, the route check is moot. A child killed by a
 * signal (no numeric status) is a failure, never a pass.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  isMainEntry,
  PROD_DOMAIN_ORIGIN,
  PROD_ORIGIN,
} from "./check-deploy.mjs";

/** The production origins, in the order they are checked. Exported for tests. */
export const PROD_ORIGINS = [PROD_ORIGIN, PROD_DOMAIN_ORIGIN];

const CHECK_DEPLOY = path.join(import.meta.dirname, "check-deploy.mjs");

/**
 * The argv (after `node`) for one origin's run: the checker, the production
 * guard, the fixed origin, then everything the promoter passed. The promoter's
 * arguments come last so `parseArgs` sees the fixed `--origin=` first and a
 * promoter who also passes an origin gets its "given more than once" error
 * rather than a silent override. Pure and exported for tests.
 */
export function prodCheckArgv(origin, extra) {
  return [CHECK_DEPLOY, "--require-origin", `--origin=${origin}`, ...extra];
}

function defaultSpawn(argv) {
  const result = spawnSync(process.execPath, argv, { stdio: "inherit" });
  if (result.error) {
    console.error(`FAIL: could not start ${argv[0]} — ${result.error.message}`);
    return 1;
  }
  return result.status;
}

/**
 * Runs the checker once per production origin with `extra` forwarded to each
 * run. Returns the exit status to use: `0` only when every run exited `0`;
 * otherwise the first run's non-zero status, or `1` when that run had no
 * numeric status (killed by a signal, or failed to start). Later origins are
 * not run after a failure. `spawn` and `log` are injected so a test can
 * assert what each run receives without spawning a process or touching the
 * network. Exported for tests.
 */
export function runProdChecks(
  extra,
  { spawn = defaultSpawn, log = console.log } = {}
) {
  for (const [index, origin] of PROD_ORIGINS.entries()) {
    log(
      `check:deploy:prod — production origin ${index + 1}/${PROD_ORIGINS.length}: ${origin}`
    );
    const status = spawn(prodCheckArgv(origin, extra));
    if (status !== 0) {
      return typeof status === "number" ? status : 1;
    }
  }
  return 0;
}

// Only run when executed directly, never when a test imports the exports —
// same guard, same reason as `check-deploy.mjs`.
if (isMainEntry(import.meta.url, process.argv[1])) {
  process.exitCode = runProdChecks(process.argv.slice(2));
}
