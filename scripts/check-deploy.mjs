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
 * `origin` (positional, or `--origin=`) defaults to the staging Worker, and
 * may be given exactly once — a second origin, by either spelling, is a
 * parse error rather than a silent last-one-wins, as is any unrecognized
 * `--` flag (round-5 Frank F-P2: a typo'd `--verison=` was dropped on the
 * floor and the gate carried on unconstrained).
 *
 * Neither half of the expectation defaults to the promoter's working tree.
 * `--sha` and `--version`, when not given explicitly, are resolved by
 * `resolveExpectedSha()` and `resolveExpectedVersion()` from the *same*
 * source: for the two known default origins (staging, production) that is the
 * *promoted branch's remote-tracking ref* (`origin/staging` / `origin/main`),
 * not local `HEAD` — Cloudflare Workers Builds deploys that branch's tip,
 * which for this repo's merge-PR promotion flow is a merge commit, not
 * whatever commit the promoter's local checkout happens to have `HEAD` on
 * (round-3 George #1; round-5 George G-F1 for the version half, which was
 * left behind and made a correct `v0.2.0` production promotion FAIL against a
 * checkout still on `0.1.12`). The check fetches that remote-tracking ref
 * itself — scoped to the one branch, with an explicit destination refspec so
 * it updates even on a `--single-branch` clone (`ensureRemoteRefFresh`,
 * below) — and **fails closed** for a known origin: if the local `origin`
 * remote isn't actually this repo (a fork, an unrepointed pre-transfer
 * clone), if the fetch fails, if the ref still can't be resolved afterward,
 * or if the ref's `package.json` can't be read, the check refuses to run
 * rather than falling back to the local checkout (this PR's takeover-round
 * Frank P1, hardened further across the round-1/round-2 George/Frank
 * re-reviews). Falling back to the local checkout only ever happens for an
 * origin with no known remote-tracking ref (a hand-typed preview-Worker
 * URL) — there is no promoted branch to be stale there. The SHA is the
 * primary signal (it identifies the exact commit); version is checked too
 * since a stale build can share a SHA with nothing meaningful if HEAD has
 * moved.
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

// Exported (round-2 George P3-4): `package.json`'s `check:deploy:prod` script
// and this file's `remoteRefForOrigin` used to be two unshared strings — a
// later edit to the npm script's URL would silently stop matching the exact
// equality in `remoteRefForOrigin`, dropping expected-sha/version resolution
// to local HEAD/package.json with no error (the same defect class as
// round-1 George G2, one layer down). `tests/check-deploy.test.ts` now reads
// `package.json` and asserts its `check:deploy:prod` script contains this
// exact exported value.
export const DEFAULT_ORIGIN =
  "https://tc-mobile-staging.unfoldingword.workers.dev";
export const PROD_ORIGIN = "https://tc-mobile.unfoldingword.workers.dev";

// Round-2 George P2: `ensureRemoteRefFresh` fetches from the local `origin`
// remote and treats `origin/staging`/`origin/main` as the promoted tip
// Cloudflare deploys — true only when `origin` actually points at this repo.
// AGENTS.md's own transfer section tells contributors who cloned before the
// 2026-09-13 org move to repoint `origin`, and a GitHub fork copies
// `staging`/`main` at fork time. On a fork or an unrepointed clone, the
// fetch above SUCCEEDS against that stale branch, updates local
// `origin/staging` to the stale tip, and if the *also*-stale deployed
// Worker happens to match it, the gate prints PASS on a promotion that
// never deployed — the exact #143 false PASS this whole check exists to
// close. (If the fork lacks the branch, the fetch fails closed already;
// the dangerous case is the one a fork actually starts with: the branch
// exists, and is stale.) `CANONICAL_REPO` and `isCanonicalOrigin()`, below,
// close that gap by refusing to trust any `origin` that isn't this repo.
const CANONICAL_REPO = "unfoldingWord/tc-mobile";

// Short SHAs must be a fixed length on both the producer (vite.config.ts's
// `buildSha`, which this script's own `resolveExpectedSha()` mirrors) and
// the consumer (`compareDeployed`, below) — `git rev-parse --short HEAD`
// alone varies with a repo's `core.abbrev`, so two correct call sites can
// still disagree on length for the same commit (round-1 George G3).
// Exported (round-2 George P3-5) so a test can assert `vite.config.ts`'s
// `--short=<N>` still matches this exact value — `git rev-parse --short=N`
// is a *minimum*, not exact: it can emit more than `N` characters when that
// prefix is ambiguous, and nothing previously tied the two literals together
// once `SHA_LENGTH` was introduced.
export const SHA_LENGTH = 7;

// This PR's own takeover-round Frank re-review, P2: `ensureRemoteRefFresh`'s
// `git fetch` is a network call made through plain synchronous `execSync`,
// which has no default timeout — a stalled DNS lookup, SSH prompt, credential
// helper, or blackholed connection would hang the whole check indefinitely,
// never reaching the bounded 15s HTTP timeout `fetchVersionJson` already has
// (`DEFAULT_TIMEOUT_MS`, below). Every git invocation in this file now shares
// the same bound, so a hang becomes the existing fail-closed error path
// (`execSync` throws `ETIMEDOUT` on the child process, which the calling
// try/catch already turns into a FAIL line) instead of hanging forever.
const GIT_TIMEOUT_MS = 15_000;

function currentVersion() {
  const pkgPath = path.resolve(import.meta.dirname, "../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function runGitSync(cmd) {
  return execSync(cmd, {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
  })
    .toString()
    .trim();
}

/**
 * Maps a known default origin to the remote-tracking ref whose tip Cloudflare
 * Workers Builds actually deploys for that origin's promotion —
 * `origin/staging` for the staging default, `origin/main` for the production
 * Worker. For this repo's merge-PR promotion flow that tip is a merge
 * commit, not a promoter's local branch tip: `docs/progress_tracker.md:102,118`
 * recorded the v0.1.12 `develop -> staging` promotion (#202) as merge commit
 * `afdfa6e`, the staging tip, not develop's pre-merge `7152289` (round-3
 * George #1). Returns `undefined` for any other origin (a per-PR preview
 * Worker, a hand-typed URL) — there is no known branch to resolve there, so
 * the caller falls back to local `HEAD`. Pure and exported for tests.
 */
export function remoteRefForOrigin(origin) {
  if (origin === DEFAULT_ORIGIN) return "origin/staging";
  if (origin === PROD_ORIGIN) return "origin/main";
  return undefined;
}

/**
 * True only when `remoteUrl` is a GitHub URL (https or ssh, any of git's
 * accepted forms, with or without a trailing `.git`) that names
 * `CANONICAL_REPO`, case-insensitively. Accepts:
 *   https://github.com/unfoldingWord/tc-mobile[.git]
 *   https://<user>@github.com/unfoldingWord/tc-mobile[.git]  (https w/ userinfo)
 *   git@github.com:unfoldingWord/tc-mobile[.git]             (scp-like ssh)
 *   git@ssh.github.com:unfoldingWord/tc-mobile[.git]         (SSH-over-443 alias host)
 *   ssh://git@github.com/unfoldingWord/tc-mobile[.git]       (explicit ssh:// URL)
 * The first release of this function missed the last three — a checkout
 * cloned or repointed with any of them failed closed on a correct canonical
 * origin, a false FAIL on the gate whenever it runs with no positional
 * origin but `--sha=`/`--version=` given (which skips the fetch but not this
 * check) (round-3 George P3-2). Anything else — a fork's URL, an
 * unrepointed pre-transfer remote, `http://`, a non-GitHub host, a malformed
 * string, `undefined` — returns `false`. Pure and exported for tests.
 */
export function isCanonicalOrigin(remoteUrl) {
  if (typeof remoteUrl !== "string") return false;
  const trimmed = remoteUrl.trim().replace(/\.git$/i, "");
  const httpsMatch = /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+)$/.exec(
    trimmed
  );
  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/.exec(trimmed);
  const scpMatch = /^git@(?:ssh\.)?github\.com:([^/]+\/[^/]+)$/.exec(trimmed);
  const repo = httpsMatch?.[1] ?? sshUrlMatch?.[1] ?? scpMatch?.[1];
  return repo?.toLowerCase() === CANONICAL_REPO.toLowerCase();
}

/**
 * Freshens the remote-tracking ref `resolveExpectedSha`/`resolveExpectedVersion`
 * are about to read, by running `git fetch origin <branch>` for it. Without
 * this, the "run `git fetch origin` first" instruction in AGENTS.md is a
 * documented prerequisite the gate itself does nothing to enforce — a
 * promoter who merges a promotion on GitHub but never fetches locally, on a
 * checkout where Cloudflare *also* failed to deploy (the exact #143 failure
 * mode this whole check exists to catch), gets a **false PASS**: the stale
 * local `origin/staging`/`origin/main` still points at the previous commit,
 * the also-stale deployed `version.json` matches it, and nothing detects
 * that neither reflects the new promotion (Frank, this PR's takeover round).
 *
 * The fetch uses an **explicit destination refspec**
 * (`+refs/heads/<branch>:refs/remotes/origin/<branch>`), not a bare
 * `git fetch origin <branch>`. A bare form only updates `FETCH_HEAD` unless
 * the branch is already covered by `remote.origin.fetch` — on a
 * `--single-branch` clone (fetchspec limited to e.g. `develop`), it exits 0
 * having fetched the objects but leaves `origin/staging`/`origin/main`
 * exactly as stale as before, which is precisely the condition this
 * function exists to close (George, round 1: a false FAIL on a correct
 * staging deploy, or a false PASS in the #143 shape, on that clone type).
 * The explicit refspec updates the named remote-tracking branch regardless
 * of the configured fetch mapping.
 *
 * Fails **closed**, not open, in two ways: if the fetch itself fails (no
 * network, no remote configured, wrong permissions), or if — even after a
 * successful fetch — `origin/<branch>` still cannot be resolved (the branch
 * was deleted/renamed on the remote, or some other edge case), this throws
 * rather than silently falling back to whatever the local ref or working
 * tree has. A check that cannot confirm freshness must refuse to compare,
 * never guess and never fall back to `HEAD` for a *known* staging/prod
 * origin. An explicit `--sha=`/`--version=` bypasses this entirely (see
 * `resolveExpected`), since there is then nothing to freshen.
 *
 * No-ops for any origin without a known remote-tracking ref (a hand-typed
 * preview-Worker URL) — there is nothing to fetch there; the resolvers fall
 * back to local `HEAD` for that case regardless, which is legitimate (no
 * known branch exists to be stale).
 *
 * Before fetching, also fails closed unless the local `origin` remote
 * resolves to `unfoldingWord/tc-mobile` (`isCanonicalOrigin`, above) —
 * round-2 George P2. Without this, a fork's `origin` (which GitHub copies
 * `staging`/`main` into at fork time) or an unrepointed pre-transfer clone
 * would let the fetch **succeed** against that stale branch, update local
 * `origin/staging` to the stale tip, and match an also-stale deployed
 * `version.json` — the exact #143 false PASS the fetch itself exists to
 * close, just moved one level up the trust chain. `runGit`/`warn` are
 * injected exactly as in `resolveExpectedSha`, so a test can fake git
 * without a real repository or network. Exported for tests.
 */
export function ensureRemoteRefFresh(
  origin,
  { runGit = runGitSync, warn = () => {} } = {}
) {
  const ref = remoteRefForOrigin(origin);
  if (!ref) return;
  const branch = ref.slice("origin/".length);
  let remoteUrl;
  try {
    remoteUrl = runGit("git remote get-url origin");
  } catch (err) {
    throw new Error(
      `could not read the "origin" remote's URL (${err.message}) — refusing to trust an unnamed remote as the promoted branch. ` +
        'Confirm this checkout has an "origin" remote, or pass --sha=/--version= explicitly to bypass ref resolution.'
    );
  }
  if (!isCanonicalOrigin(remoteUrl)) {
    throw new Error(
      `"origin" is "${remoteUrl}", not ${CANONICAL_REPO} — refusing to treat it as the promoted branch. ` +
        "A fork or an unrepointed pre-transfer clone can have a stale " +
        `${branch} that happens to match a stale deploy, the exact #143 ` +
        'false-PASS shape this check exists to close. Repoint "origin" to ' +
        `https://github.com/${CANONICAL_REPO}.git (see AGENTS.md), or pass ` +
        "--sha=/--version= explicitly to bypass ref resolution."
    );
  }
  try {
    runGit(
      `git fetch origin +refs/heads/${branch}:refs/remotes/origin/${branch} --quiet`
    );
  } catch (err) {
    throw new Error(
      `could not fetch origin/${branch} (${err.message}) — refusing to compare against a possibly-stale local ref. ` +
        "Check network access and the git remote, or pass --sha=/--version= explicitly to bypass ref resolution."
    );
  }
  try {
    runGit(`git rev-parse --verify --quiet ${ref}`);
  } catch (err) {
    throw new Error(
      `fetched origin, but ${ref} still could not be resolved (${err.message}) — refusing to fall back to local HEAD/package.json for a known staging/prod origin. ` +
        "Confirm the branch still exists on the remote, or pass --sha=/--version= explicitly to bypass ref resolution."
    );
  }
  warn(
    `fetched origin/${branch} (explicit refspec) so the expected sha/version reflect the current promoted tip, not a stale local ref`
  );
}

/**
 * Resolves the sha to expect for a promotion check. For a known
 * staging/prod default origin this reads the *promoted branch's*
 * remote-tracking ref (see `remoteRefForOrigin`) rather than local `HEAD`,
 * since Cloudflare deploys that branch's tip — usually a merge commit a
 * promoter's checkout is not sitting on. Falls back to local `HEAD` (naming
 * the reason) when the origin has no known ref, or when the ref can't be
 * resolved at all (e.g. `git fetch origin` was never run, so
 * `origin/staging`/`origin/main` don't exist locally).
 *
 * `runGit` is injected (default: real `git` via `execSync`) so a test can
 * fake git without a real repository or network; `warn` is injected so a
 * test can capture which ref/fallback was used instead of asserting on
 * stdout.
 *
 * For a *known* origin, this never falls back to `HEAD` on failure —
 * `ensureRemoteRefFresh` has already fetched and `git rev-parse --verify`d
 * this exact ref before this function is ever called via `resolveExpected`,
 * so a failure here means something unexpected (a race, a corrupted repo)
 * and falling back would silently reintroduce the mixed-source G-F1 shape
 * (round-2 George P3-2, applied symmetrically to both halves — the finding
 * was raised against `resolveExpectedVersion`, but the identical risk
 * exists here). Falling back to `HEAD` remains legitimate only for an
 * origin with **no** known ref — there is no promoted branch to be stale.
 * Exported for tests.
 */
export function resolveExpectedSha(
  origin,
  { runGit = runGitSync, warn = () => {} } = {}
) {
  const ref = remoteRefForOrigin(origin);
  if (!ref) {
    warn(
      `${origin} is not a known staging/prod default — using local HEAD as the expected sha`
    );
    return runGit(`git rev-parse --short=${SHA_LENGTH} HEAD`);
  }
  let sha;
  try {
    sha = runGit(`git rev-parse --short=${SHA_LENGTH} ${ref}`);
  } catch (err) {
    throw new Error(
      `could not resolve ${ref} (${err.message}) — refusing to fall back to local HEAD for a known staging/prod origin (ensureRemoteRefFresh already verified ${ref} resolves). ` +
        "Pass --sha= explicitly to bypass ref resolution."
    );
  }
  warn(
    `expected sha resolved from ${ref} (the promoted branch tip Cloudflare deploys), not local HEAD`
  );
  return sha;
}

/**
 * Resolves the version to expect for a promotion check — the exact mirror of
 * `resolveExpectedSha` above, and for the same reason. Round 3 moved the
 * expected *sha* onto the promoted branch's remote-tracking ref but left the
 * expected *version* reading the promoter's working tree, which made the gate
 * fail on the promotion it exists to confirm: a promoter sitting on develop at
 * `0.1.12` runs `check:deploy:prod` after a real `v0.2.0` `staging -> main`
 * promotion, the sha matches (ref-resolved), and the version compares local
 * `0.1.12` against deployed `0.2.0` — a false FAIL on a correct production
 * deploy (round-5 George G-F1). Both halves of the expectation must come from
 * the same commit.
 *
 * Reads `package.json`'s `version` out of the ref with `git show`. Falls back
 * to this checkout's `package.json` (`currentVersion()`, naming the reason)
 * only when the origin has **no known ref** — there is no promoted branch to
 * be stale there. For a *known* origin, this never falls back: round-2
 * George P3-2 found that the old fallback-on-`git show`-failure path could
 * still fire *after* `ensureRemoteRefFresh` had already fetched and verified
 * the ref — e.g. a sparse/partial clone that never lazy-fetched that blob —
 * silently reintroducing the exact mixed-source shape (verified sha from the
 * ref, version from the working tree) round-5 George G-F1 fixed. A promoter
 * on `develop` at `0.2.3` confirming a real `v0.2.4` deploy would get a
 * false FAIL: sha matches (ref-resolved and verified), but version compares
 * local `0.2.3` against deployed `0.2.4`. Throws instead, for both an
 * unreadable ref and one with no usable `version` field.
 *
 * `runGit` and `warn` are injected exactly as in `resolveExpectedSha`, so a
 * test can fake git without a real repository or network. Exported for tests.
 */
export function resolveExpectedVersion(
  origin,
  { runGit = runGitSync, warn = () => {} } = {}
) {
  const ref = remoteRefForOrigin(origin);
  if (!ref) {
    warn(
      `${origin} is not a known staging/prod default — using this checkout's package.json as the expected version`
    );
    return currentVersion();
  }
  let version;
  try {
    version = JSON.parse(runGit(`git show ${ref}:package.json`)).version;
  } catch (err) {
    throw new Error(
      `could not read ${ref}:package.json (${err.message}) — refusing to fall back to this checkout's package.json for a known staging/prod origin (ensureRemoteRefFresh already verified ${ref} resolves). ` +
        "Pass --version= explicitly to bypass ref resolution."
    );
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `${ref}:package.json has no usable "version" field — refusing to fall back to this checkout's package.json for a known staging/prod origin. ` +
        "Pass --version= explicitly to bypass ref resolution."
    );
  }
  warn(
    `expected version resolved from ${ref}:package.json (the promoted branch tip Cloudflare deploys), not this checkout`
  );
  return version;
}

/**
 * What to compare the deployed `version.json` against: the explicit `--version`
 * / `--sha` when given, otherwise each half resolved from the promoted
 * branch's ref. Both halves must come from the *same* place — resolving one
 * from the ref and the other from the working tree is the G-F1 false FAIL —
 * and this is the single seam where that pairing lives, so a test can pin it
 * without `main()`'s network call.
 *
 * When either half needs ref resolution (i.e. wasn't given explicitly),
 * freshens that ref first via `ensureRemoteRefFresh` — otherwise a promoter
 * who forgot `git fetch origin` gets whatever the local ref happened to
 * have, which can coincide with an also-stale deployed build and produce a
 * false PASS (this round's Frank P1). Skipped entirely when both `version`
 * and `sha` are given explicitly: there is then no ref to read, so nothing
 * to freshen. Exported for tests.
 */
export function resolveExpected(origin, { version, sha } = {}, deps = {}) {
  if (version === undefined || sha === undefined) {
    ensureRemoteRefFresh(origin, deps);
  }
  return {
    version: version ?? resolveExpectedVersion(origin, deps),
    sha: sha ?? resolveExpectedSha(origin, deps),
  };
}

/**
 * True when two short shas name the same commit. `git rev-parse --short=<N>`
 * pins `<N>` as a *minimum*, not an exact length — git emits more characters
 * whenever that prefix is ambiguous against another object in the repo. The
 * previous approach here truncated both sides to `SHA_LENGTH` and compared
 * for equality, which throws away exactly the disambiguating suffix git
 * added: two different, colliding commits `abc1234f` (served) and `abc1234e`
 * (expected) both truncate to `abc1234` and compare equal — a false PASS on
 * a promotion that changed the commit but not the version (round-3 George
 * P3-1). Comparing by prefix instead — the shorter of the two strings must
 * be at least `SHA_LENGTH` long, and the longer string must start with it —
 * still matches a legitimate same-commit pair of different lengths
 * (`abc1234` vs `abc1234ff`, e.g. a hand-typed `--sha=` against a longer
 * deployed value) while correctly rejecting two disambiguated shas that
 * merely share the `SHA_LENGTH`-long prefix (`abc1234ff` vs `abc1234aa`).
 * Non-string input compares by identity, matching the previous behavior for
 * `undefined`/missing fields. Exported for tests.
 */
export function shasMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return a === b;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= SHA_LENGTH && longer.startsWith(shorter);
}

/**
 * Pure comparison: the deployed version.json against what was expected.
 * Exported so a test can cover the pass/fail/mismatch logic without a
 * network call.
 */
export function compareDeployed(deployed, expected) {
  const shaMatches = shasMatch(deployed.sha, expected.sha);
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
  // `res.json()` succeeds on any valid JSON document — `null`, `42`, `"x"`,
  // an array — not just an object shaped like version.json. Without this,
  // `main()` passes an unusable body straight to `compareDeployed` and to
  // its own `fetched.body.version`/`fetched.body.sha` log line, so a `200
  // application/json` response of `null` (or `{}`, or `{"version":1}`) threw
  // an uncaught TypeError stack instead of a `FAIL:` line (round-3 George
  // P3-4). Validate the shape here, in the same place every other malformed
  // response is turned into a `SpaFallbackError`.
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.version !== "string" ||
    typeof body.sha !== "string"
  ) {
    throw new SpaFallbackError(
      `origin served ${url} as JSON, but it is not a usable version.json ` +
        `(got ${JSON.stringify(body)}) — expected an object with string ` +
        '"version" and "sha" fields. Likely a stale build, a different ' +
        "JSON payload served from this path, or a version.json shape that " +
        "changed without updating this check."
    );
  }
  return { url, body };
}

const USAGE =
  "usage: node scripts/check-deploy.mjs [origin] [--origin=<url>] " +
  "[--version=X.Y.Z] [--sha=<short-sha>] [--require-origin]";

/**
 * Argument parsing, pulled out so `--require-origin` can be unit tested
 * without a process exit. Throws (rather than calling `process.exit`) on a
 * bad combination — `main()` turns that into a FAIL line.
 *
 * Every rejection here exists because the alternative is failing *open*.
 * An unrecognized `--` flag used to be dropped silently, so a typo'd
 * `--verison=0.1.13` constrained nothing and the run happily checked whatever
 * the default resolution produced; and a second origin used to overwrite the
 * first, so the highest-stakes gate in the repo could check an origin the
 * promoter had not meant (round-5 Frank F-P2, the same defect class as
 * round-1 George G2). This takeover round's Frank P2 found the same gap for
 * `--sha`/`--version`: a duplicate silently kept the last value, so
 * `--sha=<new> --sha=<old>` (an easy mistake when editing or copying a
 * command) checked the promoter's *first* value against nothing — the run
 * proceeded against `<old>` with no indication `<new>` was ever discarded.
 */
export function parseArgs(argv) {
  let origin;
  let originGiven = false;
  let version;
  let versionGiven = false;
  let sha;
  let shaGiven = false;
  let requireOrigin = false;
  const setOrigin = (value) => {
    if (originGiven) {
      throw new Error(
        `origin was given more than once ("${origin}" then "${value}") — ` +
          `pass exactly one of a positional origin or --origin=<url>. ${USAGE}`
      );
    }
    origin = value;
    originGiven = true;
  };
  const setVersion = (value) => {
    if (versionGiven) {
      throw new Error(
        `--version was given more than once ("${version}" then "${value}") — ` +
          `pass it exactly once. ${USAGE}`
      );
    }
    version = value;
    versionGiven = true;
  };
  const setSha = (value) => {
    if (shaGiven) {
      throw new Error(
        `--sha was given more than once ("${sha}" then "${value}") — ` +
          `pass it exactly once. ${USAGE}`
      );
    }
    sha = value;
    shaGiven = true;
  };
  for (const arg of argv) {
    if (arg.startsWith("--version=")) {
      setVersion(arg.slice("--version=".length));
    } else if (arg.startsWith("--sha=")) {
      setSha(arg.slice("--sha=".length));
    } else if (arg.startsWith("--origin=")) {
      setOrigin(arg.slice("--origin=".length));
    } else if (arg === "--require-origin") {
      requireOrigin = true;
    } else if (arg.startsWith("--")) {
      throw new Error(
        `unrecognized argument "${arg}" — refusing to run a deploy check with an ` +
          `argument it silently ignores (a typo'd flag would constrain nothing). ${USAGE}`
      );
    } else {
      setOrigin(arg);
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
  let expected;
  try {
    expected = resolveExpected(
      origin,
      { version, sha },
      { warn: (msg) => console.log(`  ${msg}`) }
    );
  } catch (err) {
    // `ensureRemoteRefFresh` throws when it cannot confirm the local
    // remote-tracking ref is current (no network, no remote) — a check that
    // cannot establish freshness must refuse to compare, not fall back to a
    // possibly-stale ref (this round's Frank P1).
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
    return;
  }

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
