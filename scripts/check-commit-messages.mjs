#!/usr/bin/env node
/**
 * Reject a commit whose message has a subject but no non-blank body.
 *
 * AGENTS.md ("Conventions") requires Conventional Commits with a subject
 * AND a body, neither blank — but nothing enforced that until now. #776 and
 * the review bench's fix-lane commits on #792 (`7a41ee29d`) and #793
 * (`21108948e`) landed on `develop` with a subject and no body (#840 R3).
 *
 * Two entry points share the same `checkMessage`:
 *
 *   node scripts/check-commit-messages.mjs <path-to-msg-file>
 *     The `commit-msg` git hook form (`.husky/commit-msg`): `<path-to-msg-file>`
 *     is the temp file git hands the hook, holding exactly one message.
 *
 *   node scripts/check-commit-messages.mjs --range <base>..<head>
 *     The CI form (`ci.yml`, `pull_request` only): walks every commit in the
 *     range with `git log --no-merges`, so a merge commit never needs its own
 *     exemption there. `<base>..<head>` is passed straight to `git log`.
 *
 * A commit whose first non-blank line (the subject) starts with `Merge ` is
 * always allowed, body or not — this is what lets the hook run without
 * `--no-verify` on a local `git merge`, and it is checked independently of
 * the CI form's `--no-merges` so the two entry points agree on the same rule
 * rather than trusting two different mechanisms to reach the same answer.
 *
 * Dependabot's commits are NOT given a code exemption. Its messages carry a
 * changelog body by default (see `.github/dependabot.yml` and, e.g., commit
 * `bb9318ccd0` — "Bumps lint-staged from 16.4.0 to 17.5.1" plus the
 * `updated-dependencies` / `Signed-off-by` trailer block) — a body PR #840
 * asked us to check for, found present, and so left this check unconditional
 * for author. If a future Dependabot template ever drops the body, this
 * check will correctly start failing those commits too, which is the
 * intended behaviour for a body-less commit, dependabot-authored or not.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Lines beginning with the default git comment char are never body content. */
function stripCommentLines(raw) {
  return raw
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

/**
 * Split a raw commit message into its subject (the first non-blank line)
 * and whether any non-blank line follows it. A message that is empty, or
 * whitespace/comments only, reports an empty subject and no body — callers
 * treat that as "not this gate's concern" (an empty message is a different,
 * pre-existing failure git itself already refuses).
 */
export function hasNonBlankBody(raw) {
  const lines = stripCommentLines(raw.replace(/\r\n/g, "\n")).split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return { subject: "", hasBody: false };
  const subject = lines[i];
  const rest = lines.slice(i + 1);
  const hasBody = rest.some((line) => line.trim() !== "");
  return { subject, hasBody };
}

export function isMergeSubject(subject) {
  return subject.startsWith("Merge ");
}

/**
 * The one rule both entry points enforce: `{ ok: false }` only for a commit
 * with a real (non-merge) subject and no non-blank body.
 */
export function checkMessage(raw) {
  const { subject, hasBody } = hasNonBlankBody(raw);
  if (!subject) {
    return {
      ok: true,
      subject,
      reason: "empty message; not this gate's concern",
    };
  }
  if (isMergeSubject(subject)) {
    return { ok: true, subject, reason: "merge commit" };
  }
  if (!hasBody) {
    return {
      ok: false,
      subject,
      reason:
        "commit message has a subject but no non-blank body (AGENTS.md: subject AND body, neither blank)",
    };
  }
  return { ok: true, subject };
}

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/** Parse one `git log --no-merges --format=%H<FS>%B<RS>` invocation's stdout. */
export function parseLogRecords(stdout) {
  return stdout
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const sepIndex = record.indexOf(FIELD_SEP);
      const sha = record.slice(0, sepIndex);
      const body = record.slice(sepIndex + FIELD_SEP.length);
      return { sha, body };
    });
}

/**
 * Check every non-merge commit in `range` (a `git log`-style `base..head`
 * revision range). `runGit` is injectable so tests can point this at a
 * scratch repository without shelling out from the module under test twice.
 */
export function checkRange(range, { runGit } = {}) {
  const git =
    runGit ??
    ((args) =>
      execFileSync("git", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }));
  const stdout = git([
    "log",
    "--no-merges",
    `--format=%H${FIELD_SEP}%B${RECORD_SEP}`,
    range,
  ]);
  const records = parseLogRecords(stdout);
  const results = records.map(({ sha, body }) => ({
    sha,
    ...checkMessage(body),
  }));
  return { results, failures: results.filter((r) => !r.ok) };
}

function printFailures(failures) {
  console.error(
    `FAIL: ${failures.length} commit${failures.length === 1 ? "" : "s"} with a blank body:\n`
  );
  for (const f of failures) {
    console.error(`  ${f.sha ? f.sha.slice(0, 7) + " " : ""}${f.subject}`);
    console.error(`    ${f.reason}\n`);
  }
  console.error(
    'Conventional Commits requires a subject AND a body, neither blank (AGENTS.md, "Conventions").'
  );
}

function runHookMode(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const result = checkMessage(raw);
  if (result.ok) {
    return 0;
  }
  printFailures([
    { sha: undefined, subject: result.subject, reason: result.reason },
  ]);
  return 1;
}

function runRangeMode(range) {
  const { results, failures } = checkRange(range);
  if (failures.length === 0) {
    console.log(
      `PASS: ${results.length} commit(s) in ${range} all have a non-blank body.`
    );
    return 0;
  }
  printFailures(failures);
  return 1;
}

export function parseArgs(argv) {
  const rangeIndex = argv.indexOf("--range");
  if (rangeIndex !== -1) {
    const range = argv[rangeIndex + 1];
    if (!range) {
      throw new Error("--range requires a <base>..<head> argument");
    }
    return { mode: "range", range };
  }
  const [filePath] = argv;
  if (!filePath) {
    throw new Error(
      "usage: check-commit-messages.mjs <msg-file> | check-commit-messages.mjs --range <base>..<head>"
    );
  }
  return { mode: "file", filePath };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode =
    parsed.mode === "range"
      ? runRangeMode(parsed.range)
      : runHookMode(parsed.filePath);
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

/** Only run when executed directly (`node scripts/check-commit-messages.mjs`), never when a test imports the pure exports. */
export function isMainEntry(moduleUrl, argvPath) {
  if (!argvPath) return false;
  return (
    canonicalFileUrl(fileURLToPath(moduleUrl)) === canonicalFileUrl(argvPath)
  );
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  main();
}
