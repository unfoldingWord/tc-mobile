/**
 * The build step that bakes published template packages into the app (#1450
 * plan tasks 5–6; a child of #1451). `templates/manifest.json` pins each
 * package: its dataset repo, a release tag or a commit, the path in that repo,
 * the vendored copy under `templates/`, and the SHA-256 of those bytes. The
 * build reads only the vendored copy, so it needs no network and the same
 * commit always bakes the same bytes.
 *
 * `vite.config.ts` calls `bakeTemplatePackages` at the start of every build
 * and hands the result to the app as a lazy chunk; run from the command line,
 * the script does the same checks and prints what a build would bake:
 *
 *   node scripts/bake-template-packages.mjs [--manifest <path>]
 *
 * It refuses (exit 1, naming the entry and the field) when:
 * - a file's bytes do not match the pinned SHA-256;
 * - a package fails the v0 contract, or its id is not the entry's;
 * - a title table fails `parseTemplateTitleTable` against its package;
 * - an id is listed twice;
 * - a non-provisional entry is not pinned to a tag `vX.Y.Z`, or its package's
 *   `source.revision` is not that tag, or its `version` is not the tag
 *   without its `v`.
 *
 * Every `file` in the manifest, a package's or a title table's, must be a
 * relative path that stays inside the manifest's directory (#1797).
 *
 * A provisional entry is test data: it may pin a commit, and its package may
 * say `source.revision: "unreleased"` and `version: "0.0.0"`. It is baked only
 * when the build opts in with TC_BAKE_PROVISIONAL_TEMPLATES=1 AND the build
 * positively names a branch other than `main` (`branchPolicy` below). Anything
 * it cannot identify fails closed: no branch variable, an empty one, a tag
 * build, or `main` in any branch variable leaves the package out with a log
 * line saying why, and the build goes on, so a preview build of `main` on the
 * staging Worker (which sets the flag) does not fail. The DRI's pick on #1450
 * (2026-10-29), verbatim: "Test build now, titles later (Recommended)"; the
 * fail-closed rule is #1797's first follow-up from #1798's review.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainEntry } from "./check-commit-messages.mjs";
import {
  parseTemplatePackage,
  parseTemplateTitleTable,
} from "../src/lib/templates/validate.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_MANIFEST = path.join(ROOT, "templates", "manifest.json");

/** The opt-in. Only "1" turns it on; any other non-empty value is refused. */
export const PROVISIONAL_FLAG = "TC_BAKE_PROVISIONAL_TEMPLATES";

/**
 * The branch variables a CI build can read. Cloudflare Workers Builds
 * documents WORKERS_CI_BRANCH ("branch-name-from-push-event"), and GitHub
 * Actions (the native lanes) documents GITHUB_REF_NAME, the short name of the
 * branch or tag. Any one of them naming `main` makes the build a production
 * one, even when another names something else.
 */
const BRANCH_VARS = ["WORKERS_CI_BRANCH", "GITHUB_REF_NAME"];

/**
 * The local override: a developer's own build names its branch here, so a
 * local build or a test can bake provisional packages without faking a CI
 * variable. It is ignored in CI (any of CI_VARS set), so it can never stand in
 * for a branch variable a CI build failed to provide.
 */
export const LOCAL_BRANCH_VAR = "TC_BAKE_BRANCH";

/** Set by Workers Builds (CI=true, WORKERS_CI=1) or GitHub Actions. */
const CI_VARS = ["CI", "WORKERS_CI", "GITHUB_ACTIONS"];

const PRODUCTION_BRANCH = "main";

const TAG = /^v(\d+\.\d+\.\d+)$/;

/** A refusal: the build must stop. Its message names the entry and field. */
export class BakeRefusal extends Error {}

function refuse(where, why) {
  throw new BakeRefusal(`${where}: ${why}`);
}

const reason = (cause) =>
  cause instanceof Error ? cause.message : String(cause);

function policyFrom(env) {
  const flag = env[PROVISIONAL_FLAG];
  if (flag !== undefined && flag !== "" && flag !== "1") {
    refuse(
      PROVISIONAL_FLAG,
      `must be "1" or unset, not ${JSON.stringify(flag)}`
    );
  }
  return { optedIn: flag === "1", blocked: branchPolicy(env) };
}

const present = (env, name) => (env[name] ?? "") !== "";

/**
 * Why this build may not bake a provisional package, or null when it may.
 * It may only when it positively names a branch other than `main` and is not
 * a tag build; everything else is a reason to leave the package out.
 */
function branchPolicy(env) {
  if (env.GITHUB_REF_TYPE === "tag") {
    return "GITHUB_REF_TYPE=tag is a tag build";
  }
  if ((env.GITHUB_REF ?? "").startsWith("refs/tags/")) {
    return `GITHUB_REF=${env.GITHUB_REF} is a tag build`;
  }
  const inCi = CI_VARS.some((v) => present(env, v));
  const names = [...BRANCH_VARS, ...(inCi ? [] : [LOCAL_BRANCH_VAR])].filter(
    (v) => present(env, v)
  );
  const onMain = names.find((v) => env[v] === PRODUCTION_BRANCH);
  if (onMain) return `${onMain}=${PRODUCTION_BRANCH} is a production build`;
  if (names.length === 0) {
    return `no branch variable names a branch other than ${PRODUCTION_BRANCH} (${BRANCH_VARS.join(", ")}${inCi ? "" : `, or ${LOCAL_BRANCH_VAR} for a local build`})`;
  }
  return null;
}

/**
 * `file` resolved inside `dir`, refused when it is absolute or climbs out.
 * The manifest's directory is the only place a build reads pinned bytes from.
 */
function resolveInside(dir, file, where) {
  if (typeof file !== "string" || file === "" || path.isAbsolute(file)) {
    refuse(where, `file must be a relative path, not ${JSON.stringify(file)}`);
  }
  const root = path.resolve(dir);
  const target = path.resolve(root, file);
  const rel = path.relative(root, target);
  const climbs = rel === ".." || rel.startsWith(`..${path.sep}`);
  if (rel === "" || climbs || path.isAbsolute(rel)) {
    refuse(where, `${file} is outside the manifest's directory`);
  }
  return target;
}

/** JSON from `file`, refused unless its bytes hash to `sha256`. */
function readPinned(dir, file, sha256, where) {
  const target = resolveInside(dir, file, where);
  let bytes;
  try {
    bytes = readFileSync(target);
  } catch (cause) {
    refuse(where, `cannot read ${file}: ${reason(cause)}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    refuse(where, `${file}: sha256 is ${actual}, the manifest pins ${sha256}`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    refuse(where, `${file} is not JSON: ${reason(cause)}`);
  }
}

/** The release rule: a package says the tag it is pinned to. */
function checkRelease(entry, pkg, where) {
  const tag = TAG.exec(entry.revision);
  const { revision } = pkg.source;
  if (tag && revision === entry.revision && pkg.version === tag[1]) return;
  if (entry.provisional && revision === "unreleased" && pkg.version === "0.0.0")
    return;
  if (!tag) {
    refuse(
      where,
      entry.provisional
        ? `revision ${entry.revision} is a commit, so the package must say source.revision "unreleased" and version "0.0.0"`
        : `revision ${entry.revision} is not a release tag vX.Y.Z; only a provisional entry may pin a commit`
    );
  }
  if (revision !== entry.revision) {
    refuse(
      where,
      `source.revision is "${revision}", not the pinned tag ${entry.revision}`
    );
  }
  refuse(
    where,
    `version is "${pkg.version}", not ${tag[1]} (the pinned tag ${entry.revision} without its v)`
  );
}

/**
 * Check every entry in `manifest` and return what a build bakes. Provisional
 * entries are checked like any other, then left out unless `env` opts in.
 * Throws `BakeRefusal` on the first refusal.
 */
export function bakeTemplatePackages({
  manifest = DEFAULT_MANIFEST,
  env = process.env,
} = {}) {
  const policy = policyFrom(env);
  let list;
  try {
    list = JSON.parse(readFileSync(manifest, "utf8")).packages;
  } catch (cause) {
    refuse(manifest, `cannot read the manifest: ${reason(cause)}`);
  }
  if (!Array.isArray(list)) refuse(manifest, `has no "packages" list`);
  const dir = path.dirname(manifest);
  const baked = [];
  const leftOut = [];
  const ids = new Set();
  for (const entry of list) {
    const where = `${path.basename(manifest)} ${entry.id}`;
    if (typeof entry.provisional !== "boolean") {
      refuse(where, `"provisional" must be true or false`);
    }
    if (ids.has(entry.id)) refuse(where, "is listed twice");
    ids.add(entry.id);
    const raw = readPinned(dir, entry.file, entry.sha256, where);
    let pkg;
    try {
      pkg = parseTemplatePackage(raw);
    } catch (cause) {
      refuse(`${where} ${entry.file}`, reason(cause));
    }
    if (pkg.id !== entry.id) refuse(where, `the package's own id is ${pkg.id}`);
    checkRelease(entry, pkg, where);
    const titles = (entry.titles ?? []).map((t) => {
      const table = readPinned(dir, t.file, t.sha256, where);
      try {
        parseTemplateTitleTable(table, pkg);
      } catch (cause) {
        refuse(`${where} ${t.file}`, reason(cause));
      }
      return table;
    });
    if (entry.provisional && !policy.optedIn) {
      leftOut.push({
        id: entry.id,
        why: `provisional; set ${PROVISIONAL_FLAG}=1 to bake it`,
      });
      continue;
    }
    if (entry.provisional && policy.blocked) {
      leftOut.push({
        id: entry.id,
        why: `provisional, and ${policy.blocked}; only a named branch other than ${PRODUCTION_BRANCH} bakes a provisional package, even with ${PROVISIONAL_FLAG}=1`,
      });
      continue;
    }
    baked.push({
      id: pkg.id,
      version: pkg.version,
      provisional: entry.provisional,
      pkg: raw,
      titles,
    });
  }
  return { baked, leftOut };
}

/** One line per package, the way a build log shows it. */
export function describeBake({ baked, leftOut }) {
  const tables = (n) =>
    n === 0 ? "" : `, ${n} title table${n === 1 ? "" : "s"}`;
  return [
    ...baked.map(
      (b) =>
        `baked ${b.id} ${b.provisional ? "(provisional)" : b.version}${tables(b.titles.length)}`
    ),
    ...leftOut.map(({ id, why }) => `left out ${id} (${why})`),
  ];
}

function main(argv, env) {
  let manifest = DEFAULT_MANIFEST;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest" && argv[i + 1])
      manifest = path.resolve(argv[++i]);
    else {
      console.error(`bake-template-packages: unknown argument ${argv[i]}`);
      return 1;
    }
  }
  try {
    for (const line of describeBake(bakeTemplatePackages({ manifest, env }))) {
      console.log(line);
    }
    return 0;
  } catch (cause) {
    if (!(cause instanceof BakeRefusal)) throw cause;
    console.error(`bake-template-packages: refused: ${cause.message}`);
    return 1;
  }
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
