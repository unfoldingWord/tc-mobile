#!/usr/bin/env node
/**
 * Pre-fill the seven Collateral surfaces of a PR body from a diff (#1442).
 *
 *   node scripts/collateral.mjs [<base>...<head>]   (default origin/develop...HEAD)
 *
 * Prints one `- <surface>: <…>` line per surface, in the order and with the
 * names `scripts/check-pr-body.mjs` requires. A line says which changed paths
 * touched the surface, or that a heuristic suggests it may be owed, or that
 * no rule hit. It is a hint for the author, never a verdict, and every line
 * is deliberately an unfilled `<…>`: pasted into a PR body unedited it still
 * fails the body gate, so the author has to write what changed, or
 * `N/A — <reason>`. The surfaces' meanings are in `.github/pull_request_template.md`.
 */

import { execFileSync } from "node:child_process";

import { COLLATERAL_SURFACES } from "./check-pr-body.mjs";
import { isMainEntry } from "./check-commit-messages.mjs";

const isSrcCode = (p) => /^src\/.*\.(ts|tsx)$/.test(p) && !/\.test\./.test(p);
const isUi = (p) => /^src\/(?:components|app)\//.test(p);

/**
 * Per surface: `paths` touch it outright; `lines` touch it when a changed
 * file's added line matches; `hint(changes)` returns a reason it may be owed.
 */
export const RULES = [
  {
    key: "release-notes",
    paths: [/^RELEASE_NOTES_UNRELEASED\.md$/],
    lines: [],
    hint: (changes) =>
      changes.some((c) => isSrcCode(c.path))
        ? "src changed and no RELEASE_NOTES_UNRELEASED.md line was added"
        : null,
  },
  {
    key: "legal-content",
    paths: [
      /^PRIVACY\.md$/,
      /^LICENSE$/,
      /^public\/licenses\//,
      /^third_party\//,
      /^src\/components\/about-panel\.tsx$/,
      /^docs\/native\/play-store\.md$/,
    ],
    lines: [],
  },
  {
    key: "help-articles",
    paths: [/^docs\/training\//, /^docs\/tester-install\.md$/],
    lines: [],
  },
  {
    key: "feature-doc",
    paths: [
      /^AGENTS\.md$/,
      /^README\.md$/,
      /^CONTRIBUTING\.md$/,
      /^docs\/(?:decisions|design)\//,
    ],
    lines: [
      {
        path: /^src\/.*\.(?:ts|tsx|css)$/,
        line: /^\s*(?:\/\*\*?|\*|\/\/)/,
      },
    ],
  },
  {
    key: "schema-doc",
    paths: [/^src\/lib\/storage\//, /^docs\/release\/promotion-/],
    lines: [{ path: /^src\/.*\.(?:ts|tsx)$/, line: /\bDB_VERSION\b/ }],
  },
  {
    key: "service-catalog",
    paths: [
      /^wrangler\.jsonc$/,
      /^\.github\/workflows\//,
      /^capacitor\.config\.ts$/,
      /^fastlane\//,
    ],
    lines: [],
  },
  {
    key: "mobile-parity",
    paths: [
      /^android\//,
      /^ios\//,
      /^capacitor\.config\.ts$/,
      /^src\/hooks\/audio-io\.ts$/,
    ],
    lines: [],
    hint: (changes) =>
      changes.some((c) => isUi(c.path))
        ? "UI changed: say what the Android and iOS shells adopt"
        : null,
  },
];

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** Undo git's C-style quoting of a path (`"caf\303\251.md"`); a bare path is returned as is. */
function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  for (const m of s.slice(1, -1).matchAll(/\\([0-7]{3}|.)|([^\\]+)/gsu)) {
    if (m[2] !== undefined) bytes.push(...Buffer.from(m[2], "utf8"));
    else if (/^[0-7]{3}$/.test(m[1])) bytes.push(parseInt(m[1], 8));
    else if (m[1] in ESCAPES) bytes.push(ESCAPES[m[1]]);
    else if (m[1] === '"' || m[1] === "\\") bytes.push(m[1].charCodeAt(0));
    else throw new Error(`unrecognised escape in path ${s}`);
  }
  return Buffer.from(bytes).toString("utf8");
}

const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;

// The `b/` path of a `diff --git` header; an unreadable one throws, since a
// dropped file would print a confident "no rule hit". Renames override it.
function headerPath(line) {
  const rest = line.slice("diff --git ".length);
  const quoted = new RegExp(`^(?:a/.+|${QUOTED}) (${QUOTED})$`).exec(rest);
  if (quoted) {
    const p = unquote(quoted[1]);
    if (p.startsWith("b/")) return p.slice(2);
  }
  // Unquoted, unrenamed: `a/P b/P` with the same P, which may contain " b/".
  const n = (rest.length - 5) / 2;
  const p = rest.slice(2, 2 + n);
  if (Number.isInteger(n) && rest === `a/${p} b/${p}`) return p;
  const loose = /^(?:a\/.+|"a\/.*") b\/(.+)$/.exec(rest);
  if (loose) return loose[1];
  throw new Error(`unrecognised diff header: ${line}`);
}

/** Paths and added lines from `git diff -U0 -M --src-prefix=a/ --dst-prefix=b/`. */
export function parseDiff(text) {
  const changes = [];
  let current = null;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const moved = /^(rename|copy) (from|to) (.+)$/.exec(line);
    if (line.startsWith("diff --git ")) {
      current = { path: headerPath(line), added: [] };
      changes.push(current);
      inHunk = false;
    } else if (current && !inHunk && moved) {
      if (moved[2] === "from") current.oldPath = unquote(moved[3]);
      else current.path = unquote(moved[3]);
    } else if (current && !inHunk && line.startsWith("+++ ")) {
      const p = unquote(line.slice(4));
      if (p.startsWith("b/")) current.path = p.slice(2);
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && current && line.startsWith("+")) {
      current.added.push(line.slice(1));
    }
  }
  return changes;
}

/** One result per surface, in the gate's order. */
export function classify(changes) {
  return COLLATERAL_SURFACES.map((key) => {
    const rule = RULES.find((r) => r.key === key);
    // A path rule matches either side of a rename; line rules the new path.
    const paths = changes
      .filter(
        (c) =>
          rule.paths.some((re) =>
            [c.path, c.oldPath].some((n) => n !== undefined && re.test(n))
          ) ||
          rule.lines.some(
            (l) => l.path.test(c.path) && c.added.some((a) => l.line.test(a))
          )
      )
      .map((c) => (c.oldPath ? `${c.oldPath} → ${c.path}` : c.path));
    if (paths.length > 0) return { key, state: "touched", paths };
    const why = rule.hint?.(changes) ?? null;
    return why ? { key, state: "check", why } : { key, state: "none" };
  });
}

export function formatReport(results) {
  const lines = results.map((r) => {
    const hint =
      r.state === "touched"
        ? `touched: ${r.paths.join(", ")} — say what changed`
        : r.state === "check"
          ? `check: ${r.why}`
          : "no rule hit — say what changed";
    return `- ${r.key}: <${hint} | N/A — reason>`;
  });
  return [
    ...lines,
    "",
    "A hint, not a verdict. Replace each <…> with what changed, or N/A — <reason>.",
  ].join("\n");
}

// The prefixes are forced: parseDiff reads `a/` and `b/`, and a user's
// diff.noprefix or diff.mnemonicPrefix would otherwise change them.
const DIFF_ARGS = [
  ...["-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "diff"],
  ...["-U0", "--no-color", "--no-ext-diff", "-M"],
  ...["--src-prefix=a/", "--dst-prefix=b/"],
];

function main(argv) {
  if (argv.length > 1) {
    console.error("FAIL: usage: collateral.mjs [<base>...<head>]");
    return 1;
  }
  const range = argv[0] ?? "origin/develop...HEAD";
  if (range.startsWith("-")) {
    console.error(
      `FAIL: ${range} is not a range; git would read it as an option`
    );
    return 1;
  }
  try {
    const diff = execFileSync("git", [...DIFF_ARGS, range, "--"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`Collateral surfaces for ${range}:\n`);
    console.log(formatReport(classify(parseDiff(diff))));
    return 0;
  } catch (err) {
    console.error(
      `FAIL: could not diff ${range}: ${String(err.stderr || err.message).trim()}`
    );
    return 1;
  }
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
