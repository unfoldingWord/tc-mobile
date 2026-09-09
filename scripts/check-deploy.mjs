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
 *   node scripts/check-deploy.mjs [origin] [--origin=<url>] [--version=X.Y.Z] [--sha=abcdef1]
 *
 * `origin` (positional, or `--origin=`) defaults to the staging Worker.
 * `--version` defaults to this checkout's package.json version; `--sha`
 * defaults to `git rev-parse --short=7 HEAD`. The SHA is the primary signal
 * (it identifies the exact commit); version is checked too since a stale
 * build can share a SHA with nothing meaningful if HEAD has moved.
 *
 * `--require-origin` refuses to fall back to the staging default when no
 * origin was given — used by `check:deploy:prod` (round-1 George G2) so a
 * promoter checking a `staging -> main` promotion can never get a silent
 * PASS against staging by omission.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "https://tc-mobile-staging.unfoldingword.workers.dev";

// Short SHAs must be a fixed length on both the producer (vite.config.ts's
// `buildSha`, which this script's own `currentSha()` mirrors) and the
// consumer (`compareDeployed`, below) — `git rev-parse --short HEAD` alone
// varies with a repo's `core.abbrev`, so two correct call sites can still
// disagree on length for the same commit (round-1 George G3).
const SHA_LENGTH = 7;

function currentVersion() {
  const pkgPath = path.resolve(import.meta.dirname, "../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function currentSha() {
  return execSync(`git rev-parse --short=${SHA_LENGTH} HEAD`, {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

/**
 * Pin a sha to `SHA_LENGTH` before comparing. Belt-and-braces alongside the
 * `--short=7` pin on both git invocations above: a `--sha=` passed by hand,
 * or a `version.json` built before this fix shipped, can still carry a
 * different length, and a defensive normalize here is what keeps that from
 * reading as a false FAIL. Exported for tests.
 */
export function normalizeSha(sha) {
  return typeof sha === "string" ? sha.slice(0, SHA_LENGTH) : sha;
}

/**
 * Pure comparison: the deployed version.json against what was expected.
 * Exported so a test can cover the pass/fail/mismatch logic without a
 * network call.
 */
export function compareDeployed(deployed, expected) {
  const shaMatches = normalizeSha(deployed.sha) === normalizeSha(expected.sha);
  const versionMatches = deployed.version === expected.version;
  return {
    ok: shaMatches && versionMatches,
    shaMatches,
    versionMatches,
  };
}

/**
 * True only when this module was invoked directly as the CLI entry point
 * (`node scripts/check-deploy.mjs`), never when `tests/check-deploy.test.ts`
 * imports it. `import.meta.url` is a percent-encoded `file://` URL, but
 * `process.argv[1]` is a raw filesystem path — building the comparison URL
 * by hand (`` `file://${process.argv[1]}` ``) skips that encoding, so a
 * checkout path containing a space (or any other percent-encodable
 * character) never matches and `main()` silently never runs — a safety gate
 * that exits 0 having checked nothing (round-1 Frank F1). `pathToFileURL`
 * applies the same encoding Node used to produce `import.meta.url`, so the
 * two sides compare like for like. Exported for tests.
 */
export function isMainEntry(moduleUrl, argvPath) {
  if (!argvPath) return false;
  return moduleUrl === pathToFileURL(argvPath).href;
}

/**
 * Maps a `fetch` failure to a promoter-facing message. A timeout
 * (`AbortSignal.timeout`, below) is a *slow bounded failure* — worth telling
 * apart from a generic network error so a promoter staring at a hung
 * terminal for minutes isn't left guessing (round-1 Frank F2). Exported for
 * tests.
 */
export function describeFetchFailure(err, { timeoutMs, url } = {}) {
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `timed out after ${timeoutMs}ms waiting for ${url}`;
  }
  return `could not fetch ${url ?? "version.json"} — ${err.message}`;
}

/**
 * `Content-Type` says whether the origin actually served JSON. Necessary
 * because `wrangler.jsonc`'s `not_found_handling: "single-page-application"`
 * means a *missing* `version.json` doesn't 404 — it 200s with the SPA's
 * `index.html` fallback, which is `!res.ok`-passing and would otherwise only
 * be caught (confusingly, as a generic fetch error) when `res.json()` throws
 * on the HTML body (round-1 George G4). Exported for tests.
 */
export function isJsonContentType(contentType) {
  return (
    typeof contentType === "string" &&
    contentType.toLowerCase().includes("application/json")
  );
}

/** Thrown when the origin responded but did not actually serve version.json
 * — distinct from a network/timeout failure so `main()` can print a message
 * that points at the real cause (missing build artefact or stale/SPA
 * fallback) instead of a generic "could not fetch". */
export class SpaFallbackError extends Error {}

const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchVersionJson(
  origin,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  const url = `${origin}/version.json?t=${Date.now()}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw Object.assign(
      new Error(describeFetchFailure(err, { timeoutMs, url })),
      {
        cause: err,
      }
    );
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  const contentType = res.headers.get("content-type");
  if (!isJsonContentType(contentType)) {
    throw new SpaFallbackError(
      `origin served "${contentType ?? "no content-type"}" instead of JSON for ${url} — ` +
        "this looks like the SPA fallback (version.json missing from the build/deploy) " +
        "or a stale build, not a network failure"
    );
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new SpaFallbackError(
      `origin served a 200 response for ${url} that did not parse as JSON — ` +
        `likely a stale build or SPA fallback mislabelled as JSON: ${err.message}`
    );
  }
  return { url, body };
}

/**
 * Argument parsing, pulled out so `--require-origin` can be unit tested
 * without a process exit. Throws (rather than calling `process.exit`) on a
 * bad combination — `main()` turns that into a FAIL line.
 */
export function parseArgs(argv) {
  let origin;
  let originGiven = false;
  let version;
  let sha;
  let requireOrigin = false;
  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
    } else if (arg.startsWith("--sha=")) {
      sha = arg.slice("--sha=".length);
    } else if (arg.startsWith("--origin=")) {
      origin = arg.slice("--origin=".length);
      originGiven = true;
    } else if (arg === "--require-origin") {
      requireOrigin = true;
    } else if (!arg.startsWith("--")) {
      origin = arg;
      originGiven = true;
    }
  }
  if (requireOrigin && !originGiven) {
    // `check:deploy:prod` sets this. Without it, a promoter checking a
    // `staging -> main` promotion who forgets `--origin=` gets a silent PASS
    // against staging (round-1 George G2) — the highest-stakes gate in the
    // repo failing open.
    throw new Error(
      "--require-origin was set but no origin was given (positional or --origin=<url>) " +
        "— refusing to fall back to the staging default for a check that must target an explicit origin"
    );
  }
  return {
    origin: (origin ?? DEFAULT_ORIGIN).replace(/\/+$/, ""),
    version,
    sha,
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const { origin, version, sha } = parsed;
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
    // `fetchVersionJson` already produces a fully-formed message for every
    // failure mode (timeout, network error, or a `SpaFallbackError` for a
    // 200 that isn't actually version.json) — see `describeFetchFailure`
    // and `isJsonContentType` above.
    console.error(`FAIL: ${err.message}`);
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
// when tests/check-deploy.test.ts imports `compareDeployed` and friends —
// importing this module must never make a network call.
if (isMainEntry(import.meta.url, process.argv[1])) {
  await main();
}
