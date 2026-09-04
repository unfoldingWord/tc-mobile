#!/usr/bin/env node
/**
 * Confirm a promotion actually deployed.
 *
 * `AGENTS.md` ("Cloudflare Workers Builds owns deployment") says a merged
 * promotion PR is not a deployed build — Cloudflare deploys out-of-band, and
 * the transfer to the unfoldingWord org already broke that link once (#143)
 * without CI noticing. This fetches the deployed origin's `version.json`
 * (emitted at build time by the `version-json` Vite plugin in
 * `vite.config.ts`) and compares it against the commit being promoted.
 *
 * Run by the promoter, by hand, after a `develop -> staging` or
 * `staging -> main` merge — see AGENTS.md, "Confirming a deploy and rolling
 * one back".
 *
 *   node scripts/check-deploy.mjs [origin] [--version=X.Y.Z] [--sha=abcdef1]
 *
 * `origin` defaults to the staging Worker. `--version` defaults to this
 * checkout's package.json version; `--sha` defaults to `git rev-parse
 * --short HEAD`. The SHA is the primary signal (it identifies the exact
 * commit); version is checked too since a stale build can share a SHA with
 * nothing meaningful if HEAD has moved.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_ORIGIN = "https://tc-mobile-staging.unfoldingword.workers.dev";

function currentVersion() {
  const pkgPath = path.resolve(import.meta.dirname, "../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function currentSha() {
  return execSync("git rev-parse --short HEAD", {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

function parseArgs(argv) {
  let origin = DEFAULT_ORIGIN;
  let version;
  let sha;
  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
    } else if (arg.startsWith("--sha=")) {
      sha = arg.slice("--sha=".length);
    } else if (!arg.startsWith("--")) {
      origin = arg;
    }
  }
  return { origin: origin.replace(/\/+$/, ""), version, sha };
}

/**
 * Pure comparison: the deployed version.json against what was expected.
 * Exported so a test can cover the pass/fail/mismatch logic without a
 * network call.
 */
export function compareDeployed(deployed, expected) {
  const shaMatches = deployed.sha === expected.sha;
  const versionMatches = deployed.version === expected.version;
  return {
    ok: shaMatches && versionMatches,
    shaMatches,
    versionMatches,
  };
}

async function fetchVersionJson(origin) {
  const url = `${origin}/version.json?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return { url, body: await res.json() };
}

async function main() {
  const { origin, version, sha } = parseArgs(process.argv.slice(2));
  const expected = {
    version: version ?? currentVersion(),
    sha: sha ?? currentSha(),
  };

  console.log(
    `Checking ${origin} against version=${expected.version} sha=${expected.sha}`
  );

  let fetched;
  try {
    fetched = await fetchVersionJson(origin);
  } catch (err) {
    console.error(`FAIL: could not fetch version.json — ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const result = compareDeployed(fetched.body, expected);
  console.log(
    `Deployed: version=${fetched.body.version} sha=${fetched.body.sha} builtAt=${fetched.body.builtAt}`
  );

  if (result.ok) {
    console.log(`PASS: ${origin} is serving the expected build.`);
    return;
  }

  console.error(`FAIL: ${origin} is not serving the expected build.`);
  if (!result.shaMatches) {
    console.error(
      `  sha mismatch: expected ${expected.sha}, got ${fetched.body.sha}`
    );
  }
  if (!result.versionMatches) {
    console.error(
      `  version mismatch: expected ${expected.version}, got ${fetched.body.version}`
    );
  }
  process.exitCode = 1;
}

// Only run when executed directly (`node scripts/check-deploy.mjs`), not
// when tests/check-deploy.test.ts imports `compareDeployed` — importing this
// module must never make a network call.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
