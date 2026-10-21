#!/usr/bin/env node
/**
 * Refuse a PR body that leaves unanswered a field the shared template
 * (`.github/pull_request_template.md`) requires, and a PR over the
 * production-line cap (#1442). The fields are listed in AGENTS.md, "Issue
 * pipeline"; a bare `N/A`, `TBD`, `later` or an unfilled `<…>` is not an
 * answer, and text in HTML comments or code fences does not count.
 *
 * The cap is `PROD_LINE_CAP` below and nowhere else; docs cite this file.
 * Over it, the body needs `size-exception: <reason>`. A `release/*` head is
 * exempt from the cap. Dependabot, a promotion (base `staging` or `main`) and
 * a `chore(release): vX.Y.Z` title into `develop` are exempt from everything, by PR
 * metadata and never by the body. A hygiene gate, not a security control.
 *
 * Sources (exactly one): `--event <path>` (CI; size from `origin/<base>...<head
 * sha>`, fails closed if uncountable), `--pr <number>` (gh; size not
 * checked), `--body-file <path>` (a draft, a plain human PR into develop
 * unless --title/--author/--base/--head say otherwise; size from
 * `origin/develop...HEAD`, a warning if uncountable). `--range <a...b>`
 * overrides the range; `--range none` skips the size check.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { isMainEntry } from "./check-commit-messages.mjs";

const REPO = "unfoldingWord/tc-mobile";

/** The one place the cap's number lives. */
export const PROD_LINE_CAP = 500;

export const REQUIRED_SECTIONS = [
  "Summary",
  "Risk",
  "Changes",
  "Testing",
  "Done when",
  "Collateral",
  "Taste",
  "Definition of done",
  "Review evidence",
  "Device checks",
];

export const COLLATERAL_SURFACES = [
  "release-notes",
  "legal-content",
  "help-articles",
  "feature-doc",
  "schema-doc",
  "service-catalog",
  "mobile-parity",
];

/** Field lines the gate reads; the template must carry each. */
export const FIELD_LABELS = [
  "Tier:",
  "Test-first:",
  "Taste impact:",
  "Reuse:",
  "Production lines:",
  "File size:",
];

const PLACEHOLDER_WORD = /^(?:tbd|later|todo|pending|wip|n\/?a)\.?$/i;

/**
 * Comments and code fences removed, LF line endings. A comment opener inside
 * a fence is fenced text, so comments are stripped only outside fences.
 */
export function sanitize(raw) {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  const out = [];
  let fence = null; // the opening run (``` or ~~~, 3+); closed by the same kind, at least as long
  let inComment = false;
  for (const original of text.split("\n")) {
    if (fence !== null) {
      const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(original);
      const closes =
        f !== null &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        f[2].trim() === "";
      if (closes) fence = null;
      continue;
    }
    let rest = original;
    let line = "";
    for (;;) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end < 0) break;
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = rest.indexOf("<!--");
        if (start < 0) {
          line += rest;
          break;
        }
        line += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
      }
    }
    const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (f !== null && !(f[1][0] === "`" && f[2].includes("`"))) fence = f[1];
    else out.push(line);
  }
  return out.join("\n");
}

const HTML_TAG =
  /<\/?(?:a|b|br|code|details|em|i|img|kbd|p|pre|strong|sub|summary|sup)\b[^>]*>/gi;

/** A code span: a backtick run of any length, closed by a run of the same length. */
const CODE_SPAN = /(`+)(?:(?!\1)[\s\S])*\1/g;
const AUTOLINK = /<(?:https?:\/\/|mailto:|[^\s<>@]+@)[^\s<>]+>/gi;

/** Replace each code span by `mapInner(its text without the backticks)`. */
function mapSpans(v, mapInner) {
  return v.replace(CODE_SPAN, (span) => {
    const ticks = /^`+/.exec(span)[0].length;
    return mapInner(span.slice(ticks, -ticks));
  });
}

/** The words a reader sees: span text kept, tags and markdown delimiters dropped. */
function words(v) {
  return mapSpans(v, (inner) => inner)
    .replace(AUTOLINK, " ")
    .replace(HTML_TAG, "")
    .replace(/[*_~]+/g, "")
    .trim();
}

/** True when `v` holds an unfilled `<…>`; code spans, autolinks and HTML tags are not. */
function hasPlaceholder(v) {
  return /<[^>]*>/.test(
    mapSpans(v, () => " ")
      .replace(AUTOLINK, " ")
      .replace(HTML_TAG, "")
  );
}

/** Level-2 sections of a sanitized body: lowercase heading -> trimmed text. */
export function parseSections(text) {
  const sections = new Map();
  let key = null;
  let buf = [];
  const flush = () => key !== null && sections.set(key, buf.join("\n").trim());
  for (const line of text.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      key = h[1].replace(/:\s*$/, "").trim().toLowerCase();
      buf = [];
    } else if (key !== null) buf.push(line);
  }
  flush();
  return sections;
}

/** True when `value` is a real answer, not blank, a placeholder or a bare N/A. */
export function isAnswer(value) {
  const raw = (value ?? "").trim();
  const v = words(raw);
  if (!/[A-Za-z0-9]/.test(v) || hasPlaceholder(raw)) return false;
  const na = /^n\/?a\b[\s.:—–-]*/i.exec(v);
  // Punctuation around the words is not content: `(TBD)`, `"TBD"`, `TBD...`.
  // A slot kept inside a code span is still a slot: judge what is left of the
  // text once every `<…>` is gone, so `<reason>` alone is nothing.
  const text = (na ? v.slice(na[0].length) : v)
    .replace(/<[^>]*>/g, "")
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
    .trim();
  return text !== "" && !PLACEHOLDER_WORD.test(text);
}

/**
 * The value of a `label` line (optionally a list item): the rest of that
 * line plus any indented lines directly below it. Null if the label has no
 * line.
 */
function fieldValue(text, label) {
  const lines = text.split("\n");
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?${label}[ \\t]*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const parts = [m[1]];
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^\s+\S/.test(lines[j])) break;
      parts.push(lines[j].trim());
    }
    return parts.join("\n").trim();
  }
  return null;
}

const CLOSES = /^\s*closes\s+#\d+(?:\s*(?:,|and|&)\s*#\d+)*\s*\.?\s*$/im;
const PART_OF_LINE =
  /^\s*part-of\s+#\d+\s+[—–-]\s+(\S.*?)\s*\/\s*remaining:\s*(.*?)\s*$/i;
const NEGATED =
  /\b(?:not|never|n['’]t|without)\s+(?:\w+\s+){0,2}?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#\d+/i;

/** Done-when items: each `- [ ]`/`- [x]` line with its indented continuation lines. */
function doneWhenItems(section) {
  const items = [];
  let open = false;
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s+\[[ xX]\]\s*(.*)$/.exec(line);
    if (m) {
      items.push(m[1]);
      open = true;
    } else if (open && /^\s+\S/.test(line))
      items[items.length - 1] += ` ${line.trim()}`;
    else open = false;
  }
  return items;
}

const TASTE =
  /^(?:none|follows pattern\s*\(([^)]*)\)|changes taste\s*\(([^)]*)\))\s*\.?$/i;

/** The Taste value's free text: `none`, its citation, or "" when it has no valid shape. */
function tasteCitation(value) {
  const m = TASTE.exec((value ?? "").trim());
  return m === null ? "" : (m[1] ?? m[2] ?? "none");
}

const NON_EMPTY = ["Changes", "Review evidence", "Device checks"];

const CLOSER_HELP =
  "write Closes #N, Part-of #N — <delivers> / remaining: <…>, or no-issue: <reason>";

/**
 * THE FREE-TEXT SLOTS. Every value the gate reads as free text is declared
 * here and judged by one rule, `isAnswer`, in `checkBody`; a slot that is not
 * in this table is not judged, and `tests/check-pr-body.test.ts` pins this
 * table against a poison case per slot. Each `read(ctx)` returns instances:
 * `{ msg, alts }`, where the instance holds when ANY alternative has ALL of
 * its values as answers. A missing field is the alternative `[""]`.
 */
export const FREE_TEXT_SLOTS = [
  {
    id: "closer",
    read: ({ text }) => {
      const alts = [];
      if (CLOSES.test(text)) alts.push(["Closes"]);
      // Indented lines continue the line above, as in `fieldValue`.
      const logical = [];
      for (const line of text.split("\n")) {
        if (/^\s+\S/.test(line) && logical.length > 0)
          logical[logical.length - 1] += ` ${line.trim()}`;
        else logical.push(line);
      }
      for (const line of logical) {
        const m = PART_OF_LINE.exec(line);
        if (m !== null) alts.push([m[1], m[2]]);
      }
      alts.push([fieldValue(text, "no-issue:") ?? ""]);
      return [
        {
          msg: NEGATED.test(text)
            ? `Closer: a negated closer ("does not close #N") does not count; ${CLOSER_HELP}`
            : `Closer: needs Closes #N, Part-of #N — <delivers> / remaining: <…>, or no-issue: <reason>`,
          alts,
        },
      ];
    },
  },
  {
    id: "test-first",
    read: ({ own }) => [
      {
        msg: "Test-first: needs the red proof, or N/A — <reason> (a bare N/A is not an answer)",
        alts: [[fieldValue(own("testing"), "Test-first:") ?? ""]],
      },
    ],
  },
  {
    id: "done-when-stem",
    read: ({ items }) =>
      items.map((item, i) => ({
        msg: `Done when: item ${i + 1} is empty or an unfilled placeholder`,
        alts: [[item.replace(/\bCheck:.*$/, "")]],
      })),
  },
  {
    id: "done-when-check",
    read: ({ items }) =>
      items.map((item, i) => ({
        msg: `Done when: item ${i + 1} has no Check:, or its Check is only a placeholder`,
        alts: [[/\bCheck:(.*)$/.exec(item)?.[1] ?? ""]],
        after: "done-when-stem", // reported only when the stem itself is fine
      })),
  },
  {
    id: "collateral",
    read: ({ own }) =>
      COLLATERAL_SURFACES.map((surface) => ({
        msg: `Collateral: ${surface} needs what changed, or N/A — <reason>`,
        alts: [[fieldValue(own("collateral"), `${surface}:`) ?? ""]],
      })),
  },
  {
    id: "taste",
    read: ({ own }) => [
      {
        msg: "Taste: `Taste impact:` needs none, follows pattern (citation) or changes taste (link)",
        alts: [[tasteCitation(fieldValue(own("taste"), "Taste impact:"))]],
      },
    ],
  },
  {
    id: "definition-of-done",
    read: ({ own }) =>
      ["Reuse", "Production lines", "File size"].map((label) => ({
        msg: `Definition of done: ${label}: needs an answer`,
        alts: [[fieldValue(own("definition of done"), `${label}:`) ?? ""]],
      })),
  },
  {
    id: "prose-section",
    read: ({ sections }) =>
      NON_EMPTY.map((title) => ({
        msg: `${title}: the section is empty, or only a placeholder`,
        alts: [[sections.get(title.toLowerCase()) ?? ""]],
        skipMissing: true, // a missing section is reported once, as missing
        title,
      })),
  },
  {
    id: "size-exception",
    applies: (ctx) => ctx.overCap === true,
    read: ({ text }) => [
      {
        msg: "Size: over the cap; split the PR, or add `size-exception: <reason>`",
        alts: [[fieldValue(text, "size-exception:") ?? ""]],
      },
    ],
  },
];

function context(raw) {
  const text = sanitize(raw);
  const sections = parseSections(text);
  const done = sections.get("done when");
  return {
    text,
    sections,
    items: done === undefined ? [] : doneWhenItems(done),
    // A label is read inside the section that owns it, never from another one.
    own: (section) => sections.get(section) ?? "",
  };
}

/** Every instance of every applicable slot in a body, tagged with its slot id. */
export function readSlots(raw, ctx = {}) {
  const c = context(raw);
  return FREE_TEXT_SLOTS.filter(
    (slot) => !slot.applies || slot.applies(ctx)
  ).flatMap((slot) => slot.read(c).map((i) => ({ id: slot.id, ...i })));
}

/** The list of problems with a body; empty when it is complete. */
export function checkBody(raw, ctx = {}) {
  const c = context(raw);
  const { sections, items } = c;
  const missing = [];
  const need = (bad, msg) => bad && missing.push(msg);

  for (const title of REQUIRED_SECTIONS) {
    need(
      sections.get(title.toLowerCase()) === undefined,
      `${title}: the section is missing`
    );
  }
  need(
    !/^\s*Tier:[ \t]*T[123][ \t]*$/m.test(c.own("risk")),
    "Tier: needs one token, T1, T2 or T3, alone on the line"
  );
  need(
    sections.has("done when") && items.length === 0,
    "Done when: needs at least one `- [ ]` / `- [x]` item"
  );

  // The one judge: every free-text value goes through isAnswer.
  const stemBad = new Set();
  for (const slot of FREE_TEXT_SLOTS) {
    if (slot.applies && !slot.applies(ctx)) continue;
    slot.read(c).forEach((inst, i) => {
      if (inst.skipMissing && !sections.has(inst.title.toLowerCase())) return;
      if (inst.after && stemBad.has(i)) return;
      if (!inst.alts.some((alt) => alt.every((v) => isAnswer(v)))) {
        missing.push(inst.msg);
        if (slot.id === "done-when-stem") stemBad.add(i);
      }
    });
  }
  return missing;
}

/** Paths whose lines do not count toward the cap. */
export function isExcludedFromSize(p) {
  return (
    /^(?:tests|e2e|docs)\//.test(p) ||
    /(?:^|\/)[^/]*\.test\.[^/]+$/.test(p) ||
    /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.lock)$/.test(
      p
    )
  );
}

/** Parse `git diff --numstat -z -M`: renames carry two extra paths. */
export function parseNumstat(out) {
  const tokens = out.split("\0");
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i]);
    if (!m) continue;
    const entry = { added: Number(m[1]) || 0, deleted: Number(m[2]) || 0 };
    if (m[3] === "") {
      entry.path = tokens[i + 2] ?? "";
      entry.oldPath = tokens[i + 1] ?? "";
      i += 2;
    } else entry.path = m[3];
    entries.push(entry);
  }
  return entries;
}

/**
 * True for a rename whose two paths fall on opposite sides of the size rule:
 * its unchanged lines move into, or out of, the count, so its numstat delta
 * alone says nothing about the production lines it adds or removes.
 */
export function crossesSizeBoundary(e) {
  return (
    e.oldPath !== undefined &&
    isExcludedFromSize(e.oldPath) !== isExcludedFromSize(e.path)
  );
}

export function countProdLines(entries) {
  return entries
    .filter((e) => !isExcludedFromSize(e.path))
    .reduce((n, e) => n + e.added + e.deleted, 0);
}

/** Production lines in a `a...b` range, via git. */
function prodLinesInRange(range) {
  // `--` cannot guard this: after it git reads the range as a path. A range is
  // never an option, so one that starts with `-` is refused.
  if (range.startsWith("-")) throw new Error(`not a revision range: ${range}`);
  const numstat = (flags, paths = []) =>
    parseNumstat(
      execFileSync(
        "git",
        [
          "--literal-pathspecs",
          "diff",
          "--numstat",
          "-z",
          ...flags,
          range,
          ...(paths.length > 0 ? ["--", ...paths] : []),
        ],
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        }
      )
    );
  const entries = numstat(["-M"]);
  // A same-class rename stays free. One that crosses the boundary is re-read
  // without rename detection, as a delete plus an add, so the production
  // side counts in full and the excluded side is dropped by its own path.
  const crossing = entries.filter(crossesSizeBoundary);
  const counted = entries.filter((e) => !crossesSizeBoundary(e));
  if (crossing.length > 0) {
    const paths = crossing.flatMap((e) => [e.oldPath, e.path]);
    counted.push(...numstat(["--no-renames"], paths));
  }
  return countProdLines(counted);
}

/** The reason a PR is exempt from the gate, or null. PR metadata only. */
export function exemption({ author, baseRef, title }) {
  // `gh pr view` reports the bot as `app/dependabot`, the event payload as `dependabot[bot]`.
  if (author === "dependabot[bot]" || author === "app/dependabot") {
    return "Dependabot PR";
  }
  if (baseRef === "staging" || baseRef === "main") {
    return `promotion PR (base ${baseRef})`;
  }
  // AGENTS.md "Versions and milestones": the bump PR is `chore(release): vX.Y.Z`.
  if (
    baseRef === "develop" &&
    /^chore\(release\): v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\s|$)/.test(
      title ?? ""
    )
  ) {
    return "release version-bump PR (chore(release): into develop)";
  }
  return null;
}

/** Exemption, then the body, then the size when a count is given. */
export function evaluate(pr, { prodLines = null } = {}) {
  const exempt = exemption(pr);
  if (exempt) return { ok: true, exempt, missing: [] };
  const overCap =
    prodLines !== null &&
    prodLines > PROD_LINE_CAP &&
    !(pr.headRef ?? "").startsWith("release/");
  const missing = checkBody(pr.body, { overCap });
  if (overCap) {
    // The slot table words the reason; here it names the count.
    const i = missing.findIndex((m) => m.startsWith("Size: over the cap"));
    if (i >= 0) {
      missing[i] =
        `Size: ${prodLines} production lines is over the cap of ${PROD_LINE_CAP}; split the PR, or add "size-exception: <reason>"`;
    }
  }
  return { ok: missing.length === 0, exempt: null, missing };
}

/** The fields the gate reads, from a `pull_request` event payload. */
export function prFromEvent(payload) {
  const pr = payload?.pull_request;
  if (!pr) {
    throw new Error(
      "the event payload has no pull_request (this check runs on pull_request events only)"
    );
  }
  return {
    body: pr.body ?? "",
    title: pr.title ?? "",
    author: pr.user?.login ?? "",
    baseRef: pr.base?.ref ?? "",
    headRef: pr.head?.ref ?? "",
    headSha: pr.head?.sha ?? "",
  };
}

/** `gh pr view`, with `runGh` injectable so tests never shell out. */
export function fetchPr(number, runGh = defaultRunGh) {
  const j = JSON.parse(
    runGh([
      "pr",
      "view",
      String(number),
      "--repo",
      REPO,
      "--json",
      "body,title,author,baseRefName,headRefName",
    ])
  );
  return {
    body: j.body ?? "",
    title: j.title ?? "",
    author: j.author?.login ?? "",
    baseRef: j.baseRefName ?? "",
    headRef: j.headRefName ?? "",
  };
}

function defaultRunGh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

const USAGE =
  "usage: check-pr-body.mjs --event <path> | --pr <number> | --body-file <path> [--range <a...b>|none] [--title T] [--author A] [--base B] [--head H]";

const VALUE_FLAGS = [
  "--event",
  "--pr",
  "--body-file",
  "--range",
  "--title",
  "--author",
  "--base",
  "--head",
];

export function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!VALUE_FLAGS.includes(argv[i])) throw new Error(USAGE);
    if (argv[i + 1] === undefined)
      throw new Error(`${argv[i]} requires a value`);
    values[argv[i]] = argv[i + 1];
  }
  const sources = ["--event", "--pr", "--body-file"].filter((f) => f in values);
  if (sources.length === 0) throw new Error(USAGE);
  if (sources.length > 1) {
    throw new Error(`give exactly one of --event, --pr, --body-file\n${USAGE}`);
  }
  const flag = sources[0];
  if (flag === "--pr" && !/^\d+$/.test(values[flag])) {
    throw new Error("--pr needs a PR number");
  }
  return {
    source: flag.slice(2),
    value: values[flag],
    range: values["--range"] ?? null,
    meta: {
      title: values["--title"] ?? "",
      author: values["--author"] ?? "",
      baseRef: values["--base"] ?? "develop",
      headRef: values["--head"] ?? "",
    },
  };
}

function main() {
  let result;
  try {
    const args = parseArgs(process.argv.slice(2));
    const pr =
      args.source === "event"
        ? prFromEvent(JSON.parse(readFileSync(args.value, "utf8")))
        : args.source === "pr"
          ? fetchPr(args.value)
          : { ...args.meta, body: readFileSync(args.value, "utf8") };
    let prodLines = null;
    if (!exemption(pr) && args.range !== "none" && args.source !== "pr") {
      const range =
        args.range ??
        (args.source === "event"
          ? `origin/${pr.baseRef}...${pr.headSha}`
          : "origin/develop...HEAD");
      try {
        prodLines = prodLinesInRange(range);
      } catch (err) {
        const why = `size not checked: could not diff ${range} (${String(err.stderr || err.message).trim()})`;
        if (args.source === "event") throw new Error(why);
        console.error(`WARN: ${why}`);
      }
    }
    result = evaluate(pr, { prodLines });
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.exempt) {
    console.log(`PASS: exempt from the PR body gate (${result.exempt}).`);
  } else if (result.ok) {
    console.log("PASS: every required PR body field is answered.");
  } else {
    console.error(
      `FAIL: ${result.missing.length} problem(s) with the PR body:\n`
    );
    for (const m of result.missing) console.error(`  - ${m}`);
    console.error(
      '\nThe template is .github/pull_request_template.md; AGENTS.md, "Issue pipeline (dev1–dev7)", explains each field.'
    );
    process.exitCode = 1;
  }
}

if (isMainEntry(import.meta.url, process.argv[1])) {
  main();
}
