#!/usr/bin/env node
/**
 * Pre-push check for the review bench's recurring findings (AGENTS.md,
 * "Engineering bar"). Run as `npm run check:prepush`, first in
 * `.husky/pre-push`.
 *
 * Scope is this branch's own change: commits and added lines in
 * `$(git merge-base origin/develop HEAD)..HEAD`. When that range cannot be
 * computed (no git, no `origin/develop`, no merge base in a shallow clone),
 * the script prints why and exits 0. It never fails a push on missing
 * context.
 *
 * FAIL (exit 1):
 *   (a) a commit message in range that puts a GitHub closing keyword and
 *       `#N` inside a negation ("does not close #N"). GitHub ignores the
 *       negation and closes the issue on merge (#470).
 *   (b) a direct dependency whose installed `engines.node` does not admit
 *       the minimum of this repo's own `engines.node` (#989/#990). Checks
 *       only the direct dependencies the range added, re-specified or
 *       re-resolved in the lockfile (all of them when the floor itself
 *       changed), so a branch is never blocked by a dependency it did not
 *       change. It reads what is installed in `node_modules`, so run
 *       `npm ci` first; an installed version that differs from the one
 *       package-lock.json resolves at HEAD fails rather than passing on
 *       the wrong manifest.
 *
 * WARN (exit 0), on added lines only:
 *   (c) wording that claims verification (AGENTS.md, "Never claim
 *       verification you did not perform");
 *   (d) `not.toBe(` / `not.toEqual(` in a test, where the exact value is
 *       usually computable;
 *   (e) `indexOf(` or a regex in a test file that reads CSS or config text
 *       (the comment-slicing trap in AGENTS.md). File-level heuristic.
 *
 * No dependencies: the engines comparison below is a minimal semver range
 * reader, enough for the forms `engines.node` uses in practice. A range it
 * cannot read is reported and skipped, never failed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// (a) negated closing keywords

const HARD_NEGATION = String.raw`(?:never|cannot|without|no\s+longer)`;
const IDIOM_NEGATION = String.raw`(?:not|[a-z]+n['’]t)`;
const KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;
const ISSUE_REF = String.raw`(?:[\w.-]+\/[\w.-]+)?#(\d+)`;
const NEGATED_CLOSE = new RegExp(
  String.raw`\b(?:${HARD_NEGATION}|${IDIOM_NEGATION})\s+(?:[a-z]+\s+){0,2}?${KEYWORD}\b:?\s*${ISSUE_REF}`,
  "gi"
);
// "not only fixes #N but also ..." affirms the closure. The exemption needs
// both halves: not / n't + only|just|merely|simply before the keyword, and
// "also" or "as well" after the issue ref in the same sentence. Bare, "does
// not simply close #N." still negates, and "cannot simply close #N" always
// does.
const IDIOM_ADVERB = new RegExp(
  String.raw`^${IDIOM_NEGATION}\s+(?:only|just|merely|simply)\b`,
  "i"
);
const AFFIRMED_AFTER = /^[^.!?\n]*\b(?:also|as\s+well)\b/i;

/**
 * Every negated closing phrase in a commit message, as
 * `{ text, issue }`. "Closes #12" and "Part of #12" return nothing.
 */
export function findNegatedClosures(message) {
  const hits = [];
  for (const match of message.matchAll(NEGATED_CLOSE)) {
    const after = message.slice(match.index + match[0].length);
    if (IDIOM_ADVERB.test(match[0]) && AFFIRMED_AFTER.test(after)) continue;
    hits.push({ text: match[0].replace(/\s+/g, " "), issue: match[1] });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// (b) minimal semver range reading

const PART = String.raw`(\d+|[xX*])`;
// A prerelease tag is captured so it can be refused: this reader keeps no
// prerelease ordering, so such a range is unreadable and takes the NOTE path.
const COMPARATOR = new RegExp(
  String.raw`^(<=|>=|<|>|=|\^|~>?)?v?${PART}(?:\.${PART})?(?:\.${PART})?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`
);

function isWild(part) {
  return part === undefined || /^[xX*]$/.test(part);
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Parse one version with possibly-wild parts into its fixed prefix, e.g.
 * `22.x` -> `[22]`. Returns null when it is not a version.
 */
function parsePartial(token) {
  const m = COMPARATOR.exec(token);
  if (!m || m[5] !== undefined) return null;
  const parts = [m[2], m[3], m[4]];
  const fixed = [];
  for (const part of parts) {
    if (isWild(part)) break;
    fixed.push(Number(part));
  }
  return { op: m[1] ?? "", fixed };
}

function fill(fixed) {
  return [fixed[0] ?? 0, fixed[1] ?? 0, fixed[2] ?? 0];
}

/** The first version above every version matching a partial, e.g. `1.2` -> `1.3.0`. */
function bumpPartial(fixed) {
  if (fixed.length === 0) return null;
  if (fixed.length === 1) return [fixed[0] + 1, 0, 0];
  if (fixed.length === 2) return [fixed[0], fixed[1] + 1, 0];
  return null;
}

/** One comparator token as a list of `{ op, v }` bounds, or null if unreadable. */
function comparatorBounds(token) {
  const parsed = parsePartial(token);
  if (!parsed) return null;
  const { op, fixed } = parsed;
  const low = fill(fixed);
  if (fixed.length === 0) {
    // `*`, `x`, `>=x`: anything. `<x` / `>x` match nothing.
    return op === "<" || op === ">" ? [{ op: "<", v: [0, 0, 0] }] : [];
  }
  const partialUpper = bumpPartial(fixed);
  switch (op) {
    case "":
    case "=":
      return partialUpper
        ? [
            { op: ">=", v: low },
            { op: "<", v: partialUpper },
          ]
        : [{ op: "=", v: low }];
    case ">=":
      return [{ op: ">=", v: low }];
    case ">":
      return partialUpper
        ? [{ op: ">=", v: partialUpper }]
        : [{ op: ">", v: low }];
    case "<":
      return [{ op: "<", v: low }];
    case "<=":
      return partialUpper
        ? [{ op: "<", v: partialUpper }]
        : [{ op: "<=", v: low }];
    case "~":
    case "~>": {
      const upper =
        fixed.length === 1 ? [low[0] + 1, 0, 0] : [low[0], low[1] + 1, 0];
      return [
        { op: ">=", v: low },
        { op: "<", v: upper },
      ];
    }
    case "^": {
      let upper;
      if (low[0] > 0 || fixed.length === 1) upper = [low[0] + 1, 0, 0];
      else if (low[1] > 0 || fixed.length === 2) upper = [0, low[1] + 1, 0];
      else upper = [0, 0, low[2] + 1];
      return [
        { op: ">=", v: low },
        { op: "<", v: upper },
      ];
    }
    default:
      return null;
  }
}

/**
 * One `||` alternative as bounds, or null if any part is unreadable. An
 * empty alternative (`"^22.13.0 ||"`) is unreadable, not `*`.
 */
function alternativeBounds(alt) {
  const trimmed = alt.trim();
  if (trimmed === "") return null;
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen) {
    const from = parsePartial(hyphen[1]);
    const to = parsePartial(hyphen[2]);
    if (!from || !to || from.op || to.op) return null;
    const bounds = [{ op: ">=", v: fill(from.fixed) }];
    if (to.fixed.length > 0) {
      const upper = bumpPartial(to.fixed);
      bounds.push(
        upper ? { op: "<", v: upper } : { op: "<=", v: fill(to.fixed) }
      );
    }
    return bounds;
  }
  // `>= 22.12.0` is written with a space often enough to join it back.
  const tokens = trimmed.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, "$1").split(/\s+/);
  const bounds = [];
  for (const token of tokens) {
    const b = comparatorBounds(token);
    if (!b) return null;
    bounds.push(...b);
  }
  return bounds;
}

function parseRange(range) {
  if (typeof range !== "string") return null;
  const alts = range.split("||").map(alternativeBounds);
  return alts.some((a) => a === null) ? null : alts;
}

function meets(version, { op, v }) {
  const c = cmp(version, v);
  switch (op) {
    case ">=":
      return c >= 0;
    case ">":
      return c > 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    default:
      return c === 0;
  }
}

/**
 * Whether `version` (`"22.12.0"`) is admitted by `range`. Returns null when
 * the range cannot be read, so a caller can skip instead of guessing.
 */
export function satisfies(version, range) {
  const alts = parseRange(range);
  const v = parsePartial(version);
  if (!alts || !v || v.op || v.fixed.length !== 3) return null;
  return alts.some((bounds) => bounds.every((b) => meets(v.fixed, b)));
}

/**
 * The lowest version a range admits, as `"x.y.z"` — `^22.12.0 || >=24.0.0`
 * gives `22.12.0`, and a strict `>22.12.0` gives `22.12.1`. Null when
 * unreadable or when any satisfiable alternative has no lower bound
 * (`<20 || >=24`), rather than reporting the other alternative's minimum.
 */
export function rangeMinimum(range) {
  const alts = parseRange(range);
  if (!alts) return null;
  let best = null;
  for (const bounds of alts) {
    const lows = bounds.flatMap((b) => {
      if (b.op === ">=" || b.op === "=") return [b.v];
      // Releases only: the first version above x.y.z is x.y.(z+1).
      if (b.op === ">") return [[b.v[0], b.v[1], b.v[2] + 1]];
      return [];
    });
    const low =
      lows.length === 0
        ? [0, 0, 0]
        : lows.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
    if (!bounds.every((b) => meets(low, b))) continue;
    if (lows.length === 0) return null;
    if (!best || cmp(low, best) < 0) best = low;
  }
  return best ? best.join(".") : null;
}

/**
 * Check each direct dependency against the floor. `readManifest(name)`
 * returns the installed package.json object, or null when not installed.
 * `lockedVersion(name)`, when given, returns the version package-lock.json
 * at HEAD resolves; an installed manifest at a different version is a
 * failure with `locked` set, because its `engines.node` is not the one the
 * branch ships. Returns `{ failures, notes }`; notes are skips, never
 * failures.
 */
export function checkEngines(floor, names, readManifest, lockedVersion) {
  const failures = [];
  const notes = [];
  for (const name of names) {
    const manifest = readManifest(name);
    if (!manifest) {
      notes.push(`${name}: not installed, skipped (run npm ci)`);
      continue;
    }
    const locked = lockedVersion?.(name);
    if (locked !== undefined && manifest.version !== locked) {
      failures.push({ name, version: manifest.version, locked });
      continue;
    }
    const range = manifest.engines?.node;
    if (range === undefined) continue;
    const ok = satisfies(floor, range);
    if (ok === null) {
      notes.push(
        `${name}@${manifest.version}: engines.node "${range}" not readable, skipped`
      );
    } else if (!ok) {
      failures.push({ name, version: manifest.version, range });
    }
  }
  return { failures, notes };
}

function directDependencies(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

function lockVersion(lock, name) {
  return lock?.packages?.[`node_modules/${name}`]?.version;
}

/**
 * The direct dependencies this range changed: added, re-specified in
 * package.json, or resolved to a different version in package-lock.json.
 * Every direct dependency when the `engines.node` floor itself changed, or
 * when there is no base package.json to compare with. Any argument may be
 * null (file absent at that revision).
 */
export function changedDependencies(basePkg, headPkg, baseLock, headLock) {
  const head = directDependencies(headPkg);
  const names = Object.keys(head);
  if (!basePkg || basePkg.engines?.node !== headPkg?.engines?.node) {
    return names;
  }
  const base = directDependencies(basePkg);
  return names.filter(
    (name) =>
      base[name] !== head[name] ||
      lockVersion(baseLock, name) !== lockVersion(headLock, name)
  );
}

// ---------------------------------------------------------------------------
// (c)-(e) added-line warnings

/**
 * Added lines from `git diff --unified=0` output, as `{ file, line, text }`.
 * `---`/`+++` are file headers only between `diff --git` and the first
 * hunk, so an added line whose own text starts with `++ ` stays an addition.
 */
export function parseAddedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  let inHeader = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHeader = true;
      file = null;
      continue;
    }
    if (inHeader && raw.startsWith("+++ ")) {
      const target = raw.slice(4).replace(/^"(.*)"$/, "$1");
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      inHeader = false;
      line = Number(hunk[1]);
      continue;
    }
    if (!inHeader && file && raw.startsWith("+")) {
      added.push({ file, line, text: raw.slice(1) });
      line++;
    }
  }
  return added;
}

export function isTestFile(file) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/** Files where rule (c) applies: code, styles and config, plus prose outside the run record. */
function claimScanned(file) {
  if (file === "docs/progress_tracker.md") return false;
  return /\.(?:[cm]?[jt]sx?|css|ya?ml|json|sh|md)$/.test(file);
}

// A negated claim ("not verified on a device") is the honest form, so it
// does not warn.
const CLAIM =
  /(?<!(?:\bnot|\bnever|n't)\s+)\b(?:verified|tested on|confirmed on)\b|obligations met|no renderer/i;
const LOOSE_NEGATIVE = /\bnot\.(?:toBe|toEqual)\(/;
const INDEX_OR_REGEX =
  /\bindexOf\(|\.(?:match|matchAll|search|exec|test)\(|toMatch\(\s*\/|\/[^/\s]+\/[dgimsuy]*\.test\(/;
const READS_CSS_OR_CONFIG =
  /readFile(?:Sync)?\([\s\S]*?\.(?:css|ya?ml|json|toml)\b|\.(?:css|ya?ml)["'`]|(?:vite|vitest|eslint|knip|wrangler|capacitor|playwright)\.config|tsconfig[\w.]*\.json|\.husky\//;

/**
 * Warnings for rules (c)-(e). `readFile(file)` returns a test file's full
 * text as it is in the working tree (for rule (e)'s file-level check), or
 * null.
 */
export function scanAddedLines(added, readFile) {
  const warnings = [];
  const readsCssOrConfig = new Map();
  for (const { file, line, text } of added) {
    const where = `${file}:${line}`;
    const snippet = text.trim().slice(0, 120);
    if (claimScanned(file) && CLAIM.test(text)) {
      warnings.push({ rule: "c", where, snippet });
    }
    if (!isTestFile(file)) continue;
    if (LOOSE_NEGATIVE.test(text)) {
      warnings.push({ rule: "d", where, snippet });
    }
    if (INDEX_OR_REGEX.test(text)) {
      if (!readsCssOrConfig.has(file)) {
        const content = readFile(file);
        readsCssOrConfig.set(
          file,
          content !== null && READS_CSS_OR_CONFIG.test(content)
        );
      }
      if (readsCssOrConfig.get(file)) {
        warnings.push({ rule: "e", where, snippet });
      }
    }
  }
  return warnings;
}

const WARN_LABEL = {
  c: "verification claim (AGENTS.md: never claim verification you did not perform)",
  d: "loose negative assertion; prefer toBe/toEqual with the exact value",
  e: "indexOf/regex over CSS or config text; can a comment or string fool it?",
};

// ---------------------------------------------------------------------------
// entry path

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

function defaultGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Run every rule. `git` is injectable; `log`/`error` collect output.
 * Returns the exit code.
 */
export function run({ git = defaultGit, log = console.log } = {}) {
  let root;
  let base;
  try {
    root = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    log("SKIP: not inside a git work tree; nothing to check.");
    return 0;
  }
  try {
    git(["rev-parse", "--verify", "--quiet", "origin/develop^{commit}"]);
  } catch {
    log(
      "SKIP: origin/develop is not available here (run `git fetch origin develop`); prepush check not run."
    );
    return 0;
  }
  try {
    base = git(["merge-base", "origin/develop", "HEAD"]).trim();
  } catch {
    log(
      "SKIP: no merge base between origin/develop and HEAD (shallow clone?); prepush check not run."
    );
    return 0;
  }
  const range = `${base}..HEAD`;
  const failures = [];

  // (a)
  const logOut = git(["log", `--format=%H${FIELD_SEP}%B${RECORD_SEP}`, range]);
  for (const record of logOut.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n/, "");
    if (!trimmed) continue;
    const sep = trimmed.indexOf(FIELD_SEP);
    const sha = trimmed.slice(0, sep).slice(0, 7);
    for (const hit of findNegatedClosures(trimmed.slice(sep + 1))) {
      failures.push(
        `FAIL (a) ${sha}: "${hit.text}" closes #${hit.issue} on merge; GitHub ignores the negation. Write "Part of #${hit.issue}".`
      );
    }
  }

  // (b)
  const changed = git(["diff", "--name-only", range]).split("\n");
  if (
    changed.includes("package.json") ||
    changed.includes("package-lock.json")
  ) {
    const showJson = (rev, file) => {
      try {
        return JSON.parse(git(["show", `${rev}:${file}`]));
      } catch {
        return null;
      }
    };
    const pkg = showJson("HEAD", "package.json");
    const headLock = showJson("HEAD", "package-lock.json");
    const floor = pkg ? rangeMinimum(pkg.engines?.node) : null;
    const names = pkg
      ? changedDependencies(
          showJson(base, "package.json"),
          pkg,
          showJson(base, "package-lock.json"),
          headLock
        )
      : [];
    if (!floor) {
      log("NOTE (b): no readable engines.node floor in package.json; skipped.");
    } else if (names.length === 0) {
      log(
        "NOTE (b): no direct dependency or engines floor changed in range; skipped."
      );
    } else {
      const { failures: engineFailures, notes } = checkEngines(
        floor,
        names,
        (name) => {
          const p = path.join(root, "node_modules", name, "package.json");
          return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
        },
        (name) => lockVersion(headLock, name)
      );
      for (const note of notes) log(`NOTE (b): ${note}`);
      for (const f of engineFailures) {
        failures.push(
          f.locked !== undefined
            ? `FAIL (b) ${f.name}@${f.version}: installed, but package-lock.json at HEAD resolves ${f.locked}; its engines.node was not read. Run npm ci and rerun.`
            : `FAIL (b) ${f.name}@${f.version}: engines.node "${f.range}" does not admit ${floor}, the floor of package.json engines.node "${pkg.engines.node}".`
        );
      }
    }
  }

  // (c)-(e)
  const diff = git([
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    range,
  ]);
  const warnings = scanAddedLines(parseAddedLines(diff), (file) => {
    const p = path.join(root, file);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  });
  for (const w of warnings) {
    log(`WARN (${w.rule}) ${w.where}: ${WARN_LABEL[w.rule]}: ${w.snippet}`);
  }
  for (const f of failures) log(f);

  const summary = `${failures.length} failure(s), ${warnings.length} warning(s) in ${base.slice(0, 7)}..HEAD`;
  if (failures.length > 0) {
    log(`prepush-check: FAIL, ${summary}.`);
    return 1;
  }
  log(`prepush-check: PASS, ${summary}.`);
  return 0;
}

function canonicalFileUrl(fsPath) {
  let resolved = fsPath;
  try {
    resolved = realpathSync(fsPath);
  } catch {
    // A path that does not exist cannot be the running module; comparing it
    // as given keeps the answer "not the entry point" instead of throwing.
  }
  return pathToFileURL(resolved).href;
}

/** Only run when executed directly, never when a test imports the exports. */
export function isMainEntry(moduleUrl, argvPath) {
  if (!argvPath) return false;
  return (
    canonicalFileUrl(fileURLToPath(moduleUrl)) === canonicalFileUrl(argvPath)
  );
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  process.exitCode = run();
}
