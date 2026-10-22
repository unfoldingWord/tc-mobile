import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COLLATERAL_SURFACES,
  FIELD_LABELS,
  PROD_LINE_CAP,
  REQUIRED_SECTIONS,
  checkBody,
  countProdLines,
  crossesSizeBoundary,
  evaluate,
  exemption,
  FREE_TEXT_SLOTS,
  bumpTitleVersion,
  checkBumpDiff,
  claimsBump,
  readSlots,
  fetchPr,
  isAnswer,
  isExcludedFromSize,
  parseArgs,
  parseNumstat,
  parseSections,
  prFromEvent,
  sanitize,
} from "../scripts/check-pr-body.mjs";

/**
 * #1442. The PR-body gate refuses a body with a missing or empty required
 * field and a PR over the production-line cap. AGENTS.md "A gate is tested in
 * both states": red once per field the gate exists to catch, green on a full
 * body and on every exempt PR kind (and red on each kind's look-alike), and
 * the real CLI as a subprocess, because the bottom-of-file entry call could
 * be deleted with every exported-function test still passing.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "check-pr-body.mjs");
const TEMPLATE = readFileSync(
  path.join(ROOT, ".github", "pull_request_template.md"),
  "utf8"
);

// Same guard as tests/check-commit-messages.test.ts: scratch-repo git calls
// must not leak into this worktree through inherited GIT_* variables.
const GIT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  return env;
}
const REAL_HEAD = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  cwd: ROOT,
}).trim();
afterEach(() => {
  const now = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    cwd: ROOT,
  }).trim();
  expect(now).toBe(REAL_HEAD);
});

type Fields = {
  closer?: string | null;
  tier?: string | null;
  testFirst?: string | null;
  doneWhen?: string | null;
  collateral?: Record<string, string | null>;
  taste?: string | null;
  reuse?: string | null;
  prodLines?: string | null;
  fileSize?: string | null;
  sections?: Record<string, string | null>;
  extra?: string;
};

/** A body with every field filled; named fields overridden or removed (null). */
function body(f: Fields = {}): string {
  const line = (label: string, v: string | null | undefined, d: string) =>
    v === null ? "" : `${label} ${v ?? d}\n`;
  const sec = (title: string, content: string) => {
    const o = f.sections?.[title];
    return o === null ? "" : `## ${title}\n\n${o ?? content}\n\n`;
  };
  const collateral = COLLATERAL_SURFACES.map((s) => {
    const v = f.collateral && s in f.collateral ? f.collateral[s] : undefined;
    return v === null
      ? ""
      : `- ${s}: ${v ?? "N/A — nothing here touches it"}\n`;
  }).join("");
  return (
    sec(
      "Summary",
      `Adds the gate.\n\n${f.closer === null ? "" : (f.closer ?? "Closes #1442")}`
    ) +
    sec("Risk", line("Tier:", f.tier, "T3").trimEnd()) +
    sec("Changes", "- the gate") +
    sec(
      "Testing",
      line("Test-first:", f.testFirst, "red run FAIL, then green").trimEnd()
    ) +
    sec(
      "Done when",
      f.doneWhen === null
        ? ""
        : (f.doneWhen ??
            '- [x] the gate refuses an empty body in `scripts/check-pr-body.mjs` — Check: test "red per field" in `tests/check-pr-body.test.ts`')
    ) +
    sec("Collateral", collateral.trimEnd()) +
    sec("Taste", line("Taste impact:", f.taste, "none").trimEnd()) +
    sec(
      "Definition of done",
      line("- Reuse:", f.reuse, "searched, found nothing") +
        line("- Production lines:", f.prodLines, "+120 / -0 / net +120") +
        line(
          "- File size:",
          f.fileSize,
          "no file over 800 lines grows"
        ).trimEnd()
    ) +
    sec("Review evidence", "not yet reviewed") +
    sec("Device checks", "Not needed; no src change.") +
    (f.extra ?? "")
  );
}

describe("sanitize / parseSections / isAnswer", () => {
  it("drops comments, code fences and CRLF", () => {
    expect(sanitize("a<!-- x -->b\r\n```\nCloses #1\n```\nc")).toBe("ab\nc");
  });

  // Bench round 1 (Frank 2): tilde fences, and a closer of the opener's kind.
  it("drops tilde fences and closes a fence only on its own kind and length", () => {
    expect(sanitize("a\n~~~markdown\nCloses #1\n~~~\nb")).toBe("a\nb");
    expect(sanitize("a\n````\n```\nCloses #1\n````\nb")).toBe("a\nb");
    expect(sanitize("a\n~~~\n```\nCloses #1\n~~~\nb")).toBe("a\nb");
  });

  // Round 5 (George 3): a comment opener inside a fence is fenced text, not a comment.
  it("strips comments only outside fences", () => {
    const out = sanitize(
      "a\n```\n<!-- example\n```\nTier: T1\n<!-- real -->\nb"
    );
    expect(out).toBe("a\nTier: T1\n\nb");
  });

  it("drops an unclosed fence to the end of the body", () => {
    expect(sanitize("a\n```\nCloses #1\nTier: T1")).toBe("a");
  });

  it("splits on level-2 headings and normalises case and a trailing colon", () => {
    const s = parseSections("## Test-first:\n\nred\n\n## Done When\n- [x] a\n");
    expect(s.get("test-first")).toBe("red");
    expect(s.get("done when")).toBe("- [x] a");
  });

  it.each([
    "x",
    "N/A — nothing to test here",
    "N/A: docs only",
    "n/a - none",
    "tests/foo.test.ts, red at abc123",
    // Bench round 1 (Frank 1): inline code, autolinks and HTML tags are not placeholders.
    "existing `Map<string, number>` helper",
    "results at <https://example.com/results>",
    "<details><summary>run</summary>5511 passed</details>",
    "``Map<string, number>`` helper",
    "N/A — <b>nothing</b> to test",
    "test `reads <T>` → pass",
    "**red** run, then green",
    "fixes the gate (see #12), then more.",
    // Round 6 (George 1): a slot with words around it is still an answer.
    "`reads <T>` → pass",
    "N/A — <b>nothing</b>",
    // Round 6 Low 2: a CommonMark email autolink is not a slot.
    "N/A — ask <someone@unfoldingword.org>",
  ])("accepts the answer %j", (v) => expect(isAnswer(v)).toBe(true));

  it.each([
    "",
    "   ",
    "N/A",
    "n/a.",
    "NA",
    "TBD",
    "later",
    "todo",
    "pending",
    "wip",
    "N/A — TBD",
    "N/A —",
    "<what changed | N/A — reason>",
    "see <link>",
    "-",
    // Bench round 2 (George 1): a placeholder wrapped in an allowed tag is still one.
    "<code>TBD</code>",
    "<b>N/A</b>",
    "<em>later</em>",
    "<p>pending</p>",
    "<br>",
    "<code>",
    "<details></details>",
    "N/A — <b>TBD</b>",
    "<b>N/A — </b>",
    // Bench round 3 (George 1): markdown-wrapped placeholders are still placeholders.
    "`TBD`",
    "`N/A`",
    "`later`",
    "``TBD``",
    "` `",
    "**TBD**",
    "*N/A*",
    "_later_",
    "N/A — `TBD`",
    "N/A — **TBD**",
    // Round 4 Low: a placeholder wrapped only in punctuation.
    "TBD,",
    "(TBD)",
    '"TBD"',
    "TBD...",
    "[later]",
    "N/A —",
    "— TBD —",
    "[TBD](https://example.com)",
    "N/A — [later](#x)",
    // Round 6 (George 1): a code span does not hide a template slot.
    "`<what changed>`",
    "`<red proof | N/A — reason>`",
    "N/A — `<reason>`",
  ])("rejects the non-answer %j", (v) => expect(isAnswer(v)).toBe(false));
});

describe("checkBody — a backticked template slot (round 6)", () => {
  it("fails a Test-first line that is only the backticked slot", () => {
    const missing = checkBody(
      body({ testFirst: "`<red proof | N/A — reason>`" })
    );
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("checkBody — an unclosed fence or comment", () => {
  it.each(["```\nCloses #1", "<!-- never closed"])(
    "says the tail was ignored, first, for %j",
    (tail) => {
      const missing = checkBody(`${body()}\n${tail}\n`);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatch(/^Unclosed/);
      const cut = checkBody(body().replace("## Taste", `${tail}\n## Taste`));
      expect(cut[0]).toMatch(/^Unclosed code fence \(or comment\)/);
      expect(cut.length).toBeGreaterThan(1);
    }
  );
});

describe("checkBody — green", () => {
  it("accepts a body with every field filled", () => {
    expect(checkBody(body())).toEqual([]);
  });

  it("accepts a CRLF body", () => {
    expect(checkBody(body().replace(/\n/g, "\r\n"))).toEqual([]);
  });

  it.each([
    "Closes #12",
    "closes #12.",
    "Closes #12, #13",
    "Part-of #12 — delivers the gate / remaining: the skills",
    "no-issue: a typo in a comment",
    // Round 6 Low 3: a wrapped Part-of line.
    "Part-of #12 — delivers the gate\n  / remaining: the skills",
  ])("accepts the closer %j", (closer) =>
    expect(checkBody(body({ closer }))).toEqual([])
  );

  it("accepts Test-first as N/A with a reason, and a multi-line red proof", () => {
    expect(checkBody(body({ testFirst: "N/A — docs only" }))).toEqual([]);
    expect(
      checkBody(
        body({ testFirst: "red at abc123\n  FAIL tests/x.test.ts\n  1 failed" })
      )
    ).toEqual([]);
  });

  it.each([
    "none",
    "follows pattern (src/lib/strings.ts)",
    "changes taste (https://x/y)",
  ])("accepts Taste impact: %s", (taste) =>
    expect(checkBody(body({ taste }))).toEqual([])
  );

  it("accepts an unticked Done-when item that carries a Check", () => {
    expect(
      checkBody(
        body({
          doneWhen:
            "- [ ] waits on a device run — Check: UI — Books: tap → sheet opens",
        })
      )
    ).toEqual([]);
  });

  it("accepts angle brackets inside inline code and autolinks (bench round 1, Frank 1)", () => {
    expect(
      checkBody(
        body({
          reuse: "existing `Map<string, number>` helper",
          testFirst: "red, results at <https://example.com/results>",
          doneWhen:
            "- [x] parses `Array<string>` in `scripts/x.mjs` — Check: test `reads <T>` → pass",
        })
      )
    ).toEqual([]);
  });

  it("does not count a body that is only a tilde-fenced example (bench round 1, Frank 2)", () => {
    expect(checkBody(`~~~markdown\n${body()}\n~~~\n`).length).toBeGreaterThan(
      10
    );
  });

  it("ignores template instructions and fenced examples", () => {
    const b =
      "<!--\n## Taste\nTier: T9\n-->\n" +
      body() +
      "\n```\nTier: nonsense\nDoes not close #5\n```\n";
    expect(checkBody(b)).toEqual([]);
  });
});

describe("checkBody — red, one case per field", () => {
  it.each([
    ["no closer at all", null],
    ["Closes with no number", "Closes #"],
    ["a negated closer", "Does not close #12"],
    ["a negated closer in other words", "This will never close #12"],
    ["Part-of with no remaining", "Part-of #12 — delivers the gate"],
    ["Part-of with no delivers text", "Part-of #12 / remaining: the rest"],
    ["no-issue with no reason", "no-issue:"],
    ["no-issue with TBD", "no-issue: TBD"],
    [
      "a closing keyword in the middle of a sentence",
      "This PR closes #12 once merged",
    ],
  ])("flags %s", (_label, closer) => {
    const missing = checkBody(body({ closer }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/closer/i);
  });

  it("names the negation when a negated closer is the only one", () => {
    expect(checkBody(body({ closer: "Does not close #12" }))[0]).toMatch(
      /negat/i
    );
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["a placeholder", "<T1 | T2 | T3>"],
    ["a sentence", "T2 because it touches hooks"],
    ["an unknown tier", "T4"],
    ["a tier from another scheme", "High"],
  ])("flags a Tier that is %s", (_l, tier) => {
    const missing = checkBody(body({ tier }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Tier/);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["a bare N/A", "N/A"],
    ["N/A with a placeholder reason", "N/A — TBD"],
    ["a placeholder", "<red proof | N/A — reason>"],
  ])("flags a Test-first that is %s", (_l, testFirst) => {
    const missing = checkBody(body({ testFirst }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Test-first/);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["prose with no item", "all of it"],
    ["an item with no Check", "- [x] gate exists"],
    ["an empty item", "- [ ] "],
    ["an unfilled placeholder item", "- [ ] <behaviour> — Check: <how>"],
  ])("flags Done when that is %s", (_l, doneWhen) => {
    const missing = checkBody(body({ doneWhen }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Done when/);
  });

  it("flags only the item that lacks a Check", () => {
    const missing = checkBody(
      body({ doneWhen: '- [x] a — Check: test "a"\n- [x] b' })
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/item 2/);
  });

  // Bench round 1 (George 1): every free-text answer goes through isAnswer.
  it.each([
    [
      "a placeholder delivers and remaining",
      "Part-of #12 — <x> / remaining: <…>",
    ],
    ["remaining: TBD", "Part-of #12 — delivers the gate / remaining: TBD"],
    ["remaining: N/A", "Part-of #12 — delivers the gate / remaining: N/A"],
    ["delivers TBD", "Part-of #12 — TBD / remaining: the skills"],
  ])("flags a Part-of with %s", (_l, closer) => {
    const missing = checkBody(body({ closer }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/closer/i);
  });

  it.each(["TBD", "N/A", "<how>"])(
    "flags a Done-when Check: value of %j",
    (v) => {
      const missing = checkBody(
        body({ doneWhen: `- [x] gate exists — Check: ${v}` })
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]).toMatch(/Done when/);
    }
  );

  it("does not read a column-0 line as a Done-when item's continuation", () => {
    const missing = checkBody(
      body({ doneWhen: '- [x] gate exists\nCheck: test "x"' })
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/item 1 has no Check/);
    expect(
      checkBody(body({ doneWhen: '- [x] gate exists\n  — Check: test "x"' }))
    ).toEqual([]);
  });

  describe.each([["Changes"], ["Review evidence"], ["Device checks"]])(
    "the %s section",
    (title) => {
      it.each(["TBD", "N/A", "<what was run>"])("is flagged when %j", (v) => {
        const missing = checkBody(body({ sections: { [title]: v } }));
        expect(missing).toHaveLength(1);
        expect(missing[0]).toContain(title);
      });
    }
  );

  describe.each(COLLATERAL_SURFACES.map((s) => [s]))("Collateral %s", (s) => {
    it.each([
      ["missing", null],
      ["empty", ""],
      ["a bare N/A", "N/A"],
      ["TBD", "TBD"],
      ["later", "later"],
      ["N/A with no reason", "N/A —"],
      ["an unfilled placeholder", "<what changed | N/A — reason>"],
    ])("is flagged when %s", (_l, v) => {
      const missing = checkBody(body({ collateral: { [s]: v } }));
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain(s);
    });

    it("accepts what changed, and N/A — none", () => {
      expect(
        checkBody(body({ collateral: { [s]: "updated AGENTS.md" } }))
      ).toEqual([]);
      expect(checkBody(body({ collateral: { [s]: "N/A — none" } }))).toEqual(
        []
      );
    });
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["a placeholder", "<none | follows pattern (x) | changes taste (y)>"],
    ["follows pattern with no citation", "follows pattern"],
    ["an unknown state", "mostly none"],
    ["a TBD citation", "follows pattern (TBD)"],
    ["an N/A citation", "follows pattern (N/A)"],
    ["a placeholder citation", "follows pattern (<file>)"],
    ["a later link", "changes taste (later)"],
    ["a placeholder link", "changes taste (<link>)"],
  ])("flags Taste impact that is %s", (_l, taste) => {
    const missing = checkBody(body({ taste }));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/Taste/);
  });

  it.each([
    ["Reuse", { reuse: "" }],
    ["Production lines", { prodLines: "TBD" }],
    ["File size", { fileSize: null }],
  ] as [string, Fields][])(
    "flags a Definition of done line: %s",
    (label, f) => {
      const missing = checkBody(body(f));
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain(label);
    }
  );

  it.each(REQUIRED_SECTIONS.map((s) => [s]))(
    "flags a missing %s section",
    (title) => {
      const missing = checkBody(body({ sections: { [title]: null } }));
      expect(missing.length).toBeGreaterThanOrEqual(1);
      expect(missing.join("\n")).toContain(title);
    }
  );

  it.each(["Changes", "Review evidence", "Device checks"])(
    "flags an empty %s section",
    (title) => {
      const missing = checkBody(body({ sections: { [title]: "-" } }));
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain(title);
    }
  );

  it("reports every missing field, not just the first", () => {
    expect(checkBody("").length).toBeGreaterThanOrEqual(15);
  });
});

describe("the shipped template and the gate agree (no drift)", () => {
  const clean = sanitize(TEMPLATE);

  it("has exactly the sections the gate requires, in any order", () => {
    const headings = [...parseSections(clean).keys()].sort();
    expect(headings).toEqual(
      REQUIRED_SECTIONS.map((s) => s.toLowerCase()).sort()
    );
  });

  it("carries every field line the gate reads", () => {
    for (const label of FIELD_LABELS) {
      expect(clean, label).toMatch(
        new RegExp(`^\\s*(?:[-*]\\s+)?${label}`, "m")
      );
    }
    for (const s of COLLATERAL_SURFACES) {
      expect(clean, s).toMatch(new RegExp(`^\\s*[-*]\\s+${s}:`, "m"));
    }
  });

  it("fails as shipped: an unfilled template is not a passing body", () => {
    expect(checkBody(TEMPLATE).length).toBeGreaterThanOrEqual(15);
  });

  it("passes when filled in the template's own shape", () => {
    let filled = clean
      .replace("Closes #", "Closes #1442")
      .replace(/^Tier:.*$/m, "Tier: T3")
      .replace("-\n", "- the gate\n")
      .replace(/^Test-first:.*$/m, "Test-first: N/A — template only")
      .replace(
        /^- \[ \] <.*$/m,
        "- [x] the gate runs — Check: run `npm test` → 0 failures"
      )
      .replace(/^Taste impact:.*$/m, "Taste impact: none")
      .replace(/^- Reuse:.*$/m, "- Reuse: searched, nothing to reuse")
      .replace(
        /^- Production lines:.*$/m,
        "- Production lines: +10 / -0 / net +10"
      )
      .replace(/^- File size:.*$/m, "- File size: no file over 800 lines grows")
      .replace(/(## Review evidence\n)/, "$1\nnot yet reviewed\n")
      .replace(/(## Device checks\n)/, "$1\nnot run yet\n");
    for (const s of COLLATERAL_SURFACES) {
      filled = filled.replace(
        new RegExp(`^- ${s}:.*$`, "m"),
        `- ${s}: N/A — none`
      );
    }
    expect(checkBody(filled)).toEqual([]);
  });
});

describe("size — the production-line cap", () => {
  it("excludes tests, e2e, docs and lockfiles; counts everything else", () => {
    for (const p of [
      "tests/a.test.ts",
      "tests/support.ts",
      "src/lib/x.test.ts",
      "e2e/a.spec.ts",
      "docs/design/x.md",
      "package-lock.json",
      "Gemfile.lock",
    ]) {
      expect(isExcludedFromSize(p), p).toBe(true);
    }
    for (const p of [
      "src/lib/x.ts",
      "scripts/check-pr-body.mjs",
      "AGENTS.md",
      ".github/workflows/ci.yml",
      "mydocs/x.ts",
      "latests/x.ts",
    ]) {
      expect(isExcludedFromSize(p), p).toBe(false);
    }
  });

  it("parses -z numstat: plain, rename, and binary entries", () => {
    const out =
      "3\t1\tsrc/a.ts\0" +
      "0\t0\t\0src/old.ts\0src/new.ts\0" +
      "-\t-\tpublic/x.png\0" +
      "10\t0\tdocs/x.md\0";
    expect(parseNumstat(out)).toEqual([
      { added: 3, deleted: 1, path: "src/a.ts" },
      { added: 0, deleted: 0, path: "src/new.ts", oldPath: "src/old.ts" },
      { added: 0, deleted: 0, path: "public/x.png" },
      { added: 10, deleted: 0, path: "docs/x.md" },
    ]);
  });

  it("flags a rename only when its two paths are on opposite sides of the cap", () => {
    const cases: Array<[{ path: string; oldPath?: string }, boolean]> = [
      [{ path: "src/a.ts" }, false],
      [{ path: "src/b.ts", oldPath: "src/a.ts" }, false],
      [{ path: "src/a.ts", oldPath: "tests/a.test.ts" }, true],
      [{ path: "docs/a.md", oldPath: "src/a.ts" }, true],
    ];
    for (const [e, want] of cases) {
      expect(crossesSizeBoundary(e), JSON.stringify(e)).toBe(want);
    }
  });

  it("counts additions plus deletions of production paths only", () => {
    expect(
      countProdLines([
        { added: 100, deleted: 20, path: "src/a.ts" },
        { added: 900, deleted: 0, path: "tests/a.test.ts" },
        { added: 900, deleted: 0, path: "docs/a.md" },
        { added: 5, deleted: 5, path: "package-lock.json" },
        { added: 0, deleted: 0, path: "src/renamed.ts" },
      ])
    ).toBe(120);
  });

  const empty = {
    body: body(),
    title: "feat: x",
    author: "sethstoll",
    baseRef: "develop",
    headRef: "feat/x",
  };

  it("passes at the cap and fails one line over it", () => {
    expect(evaluate(empty, { prodLines: PROD_LINE_CAP }).ok).toBe(true);
    const over = evaluate(empty, { prodLines: PROD_LINE_CAP + 1 });
    expect(over.ok).toBe(false);
    expect(over.missing.join("\n")).toMatch(/size-exception/);
  });

  it("passes over the cap with a real size-exception, fails on a non-answer", () => {
    const ok = body({
      extra: "size-exception: one generated table, no split reads\n",
    });
    expect(
      evaluate({ ...empty, body: ok }, { prodLines: PROD_LINE_CAP + 1 }).ok
    ).toBe(true);
    for (const bad of ["TBD", "later", "N/A", ""]) {
      const b = body({ extra: `size-exception: ${bad}\n` });
      expect(
        evaluate({ ...empty, body: b }, { prodLines: PROD_LINE_CAP + 1 }).ok,
        bad
      ).toBe(false);
    }
  });

  it("does not read a size-exception inside a comment or a fence", () => {
    const b = body({
      extra:
        "<!-- size-exception: because -->\n```\nsize-exception: because\n```\n",
    });
    expect(
      evaluate({ ...empty, body: b }, { prodLines: PROD_LINE_CAP + 1 }).ok
    ).toBe(false);
  });

  // #1582: a branch name is not a signal. Red on the old rule, which let a
  // `release/*` head skip the cap by name alone.
  it("does not exempt a release/* head from the cap", () => {
    const r = evaluate(
      { ...empty, headRef: "release/big-feature", body: body() },
      { prodLines: 9999 }
    );
    expect(r.ok).toBe(false);
    expect(r.missing.join("\n")).toContain("9999");
  });

  it("still lets a release/* head past the cap with a size-exception", () => {
    const b = body({ extra: "size-exception: one generated table\n" });
    expect(
      evaluate(
        { ...empty, headRef: "release/v1.2.0", body: b },
        { prodLines: 9999 }
      ).ok
    ).toBe(true);
  });

  it("does not check size when no count is given", () => {
    expect(evaluate(empty, { prodLines: null }).ok).toBe(true);
  });
});

describe("exemption — which PR kinds the gate lets through", () => {
  const human = { author: "sethstoll", baseRef: "develop", title: "feat: x" };

  it("exempts Dependabot by author login", () => {
    expect(exemption({ ...human, author: "dependabot[bot]" })).toMatch(
      /dependabot/i
    );
  });

  // Bench round 2 (Frank): `gh pr view` reports the bot as `app/dependabot`.
  it("exempts the login `gh pr view` reports for Dependabot, and not a lookalike", () => {
    expect(exemption({ ...human, author: "app/dependabot" })).toMatch(
      /dependabot/i
    );
    expect(exemption({ ...human, author: "app/dependabot-fan" })).toBeNull();
    expect(exemption({ ...human, author: "dependabot" })).toBeNull();
  });

  it.each([
    ["staging", "chore(release): promote v1.1.0 to staging"],
    ["staging", "Promote v1.0.2 to staging"],
    ["staging", "chore(promote): develop -> staging, 1.0.1"],
    ["staging", "Promote develop → staging: v0.2.14"],
    ["main", "chore(promote): staging -> main, v1.0.1"],
  ])("exempts a promotion into %s titled %j", (baseRef, title) => {
    expect(exemption({ ...human, baseRef, title })).toMatch(/promotion/i);
  });

  const bumpOk = { bump: { ok: true as const } };

  it("exempts a chore(release): bump into develop whose diff proved it", () => {
    expect(
      exemption({ ...human, title: "chore(release): v1.1.0" }, bumpOk)
    ).toMatch(/release/i);
  });

  // #1582: the title alone is a claim, not a proof.
  it("does not exempt a bump title on its own, unproved or disproved", () => {
    const pr = { ...human, title: "chore(release): v1.1.0" };
    expect(exemption(pr)).toBeNull();
    expect(exemption(pr, { bump: null })).toBeNull();
    expect(
      exemption(pr, {
        bump: { ok: false, reason: "src/x.ts is not a version file" },
      })
    ).toBeNull();
  });

  // Bench round 1 (George 2): AGENTS.md's release PR is `chore(release): vX.Y.Z`.
  it.each(["chore(release): v1.1.0-rc.2", "chore(release): v0.2.14 — promote"])(
    "exempts the release title %j once proved",
    (title) =>
      expect(exemption({ ...human, title }, bumpOk)).toMatch(/release/i)
  );

  it.each(["chore(release): wip", "chore(release): v9", "chore(release):"])(
    "does not exempt the release look-alike %j into develop, even with a proof",
    (title) => expect(exemption({ ...human, title }, bumpOk)).toBeNull()
  );

  it("reads the version out of the title, or null", () => {
    expect(bumpTitleVersion("chore(release): v1.1.0")).toBe("1.1.0");
    expect(bumpTitleVersion("chore(release): v1.1.0-rc.2 — x")).toBe(
      "1.1.0-rc.2"
    );
    expect(bumpTitleVersion("chore(release): v9.9.9-not-a-bump")).toBeNull();
    expect(bumpTitleVersion("chore(release): v9.9.9-x.1")).toBe("9.9.9-x.1");
    expect(bumpTitleVersion("chore(release): v9")).toBeNull();
    expect(bumpTitleVersion(undefined)).toBeNull();
    expect(
      claimsBump({ baseRef: "develop", title: "chore(release): v1.0.0" })
    ).toBe(true);
    expect(
      claimsBump({ baseRef: "release/v1.0.0", title: "chore(release): v1.0.0" })
    ).toBe(false);
  });

  it("does not exempt a docs-only PR", () => {
    expect(exemption({ ...human, title: "docs: replace names" })).toBeNull();
  });

  it("does not exempt a human takeover of a Dependabot PR", () => {
    expect(
      exemption({ ...human, title: "chore(deps): bump x, takeover of #1410" })
    ).toBeNull();
  });

  it("does not exempt a chore(release): title aimed at another base", () => {
    expect(
      exemption(
        { ...human, baseRef: "feat/other", title: "chore(release): v1.2.0" },
        bumpOk
      )
    ).toBeNull();
  });

  it("does not exempt a lookalike bot name or a release-looking head", () => {
    expect(
      exemption({ ...human, headRef: "release/v1.2.0" } as typeof human)
    ).toBeNull();
    expect(exemption({ ...human, author: "dependabot-fan" })).toBeNull();
    expect(exemption({ ...human, author: "dependabot[bot]x" })).toBeNull();
  });
});

/** The real shape of a bump: `git show 700b5a74` (chore(release): v1.1.0). */
const REAL_BUMP_DIFF = `diff --git a/package-lock.json b/package-lock.json
index 72ab5906..ed101eba 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "tc-mobile",
-  "version": "1.0.2",
+  "version": "1.1.0",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "tc-mobile",
-      "version": "1.0.2",
+      "version": "1.1.0",
       "license": "MIT",
       "dependencies": {
         "@breezystack/lamejs": "^1.2.7",
diff --git a/package.json b/package.json
index 56db9cb8..b2036f86 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "tc-mobile",
-  "version": "1.0.2",
+  "version": "1.1.0",
   "private": true,
   "license": "MIT",
   "type": "module",
`;

const PKG_ONLY = (v: string, extra = "") =>
  `diff --git a/package.json b/package.json
index 1..2 100644
--- a/package.json
+++ b/package.json
@@ -2 +2 @@
-  "version": "1.0.0",
+  "version": "${v}",
${extra}`;

describe("checkBumpDiff — a version bump and nothing else (#1582)", () => {
  it("accepts the real v1.1.0 bump diff, with context and with -U0", () => {
    expect(checkBumpDiff(REAL_BUMP_DIFF, "1.1.0")).toEqual({ ok: true });
    const u0 = REAL_BUMP_DIFF.split("\n")
      .filter((l) => !l.startsWith(" "))
      .join("\n");
    expect(checkBumpDiff(u0, "1.1.0")).toEqual({ ok: true });
  });

  it("accepts a CRLF diff and a prerelease version", () => {
    expect(
      checkBumpDiff(PKG_ONLY("1.2.0-rc.1").replace(/\n/g, "\r\n"), "1.2.0-rc.1")
    ).toEqual({ ok: true });
  });

  it("accepts the iOS MARKETING_VERSION lines beside package.json", () => {
    const d =
      PKG_ONLY("1.2.0") +
      `diff --git a/ios/App/App.xcodeproj/project.pbxproj b/ios/App/App.xcodeproj/project.pbxproj
index 1..2 100644
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@ -314 +314 @@
-				MARKETING_VERSION = 1.1;
+				MARKETING_VERSION = 1.2;
`;
    expect(checkBumpDiff(d, "1.2.0")).toEqual({ ok: true });
  });

  it("rejects the title/diff mismatch (v9.9.9 title, 1.0.1 diff)", () => {
    const r = checkBumpDiff(PKG_ONLY("1.0.1"), "9.9.9-not-a-bump");
    expect(r.ok).toBe(false);
  });

  it.each([
    [
      "a source file beside the bump",
      PKG_ONLY("1.2.0") +
        `diff --git a/src/app.ts b/src/app.ts
index 1..2 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-a
+b
`,
      /src\/app\.ts/,
    ],
    [
      "a dependency added in package.json",
      PKG_ONLY(
        "1.2.0",
        '@@ -9 +9,2 @@\n-    "x": "1"\n+    "x": "1",\n+    "y": "2"\n'
      ),
      /package\.json/,
    ],
    [
      "a script edit in package.json in place of a version line",
      `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -5 +5 @@
-    "lint": "eslint .",
+    "lint": "echo ok",
`,
      /package\.json/,
    ],
    [
      "a lockfile line that is not a version line",
      PKG_ONLY("1.2.0") +
        `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -9 +9 @@
-      "resolved": "https://a",
+      "resolved": "https://b",
`,
      /package-lock\.json/,
    ],
    [
      "a lockfile that bumps a dependency to the same number",
      PKG_ONLY("1.2.0") +
        `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
-  "version": "1.0.0",
+  "version": "1.2.0",
@@ -5 +5 @@
-      "version": "1.0.0",
+      "version": "1.2.0",
@@ -9 +9 @@
-      "version": "0.1.0",
+      "version": "1.2.0",
`,
      /package-lock\.json/,
    ],
    // Bench round 1 (Frank 2): one or two lines is a count, not a location.
    [
      "a lockfile dependency moved to the bumped number, alone",
      PKG_ONLY("1.2.0") +
        `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -500 +500 @@
-      "version": "0.1.0",
+      "version": "1.2.0",
`,
      /package-lock\.json/,
    ],
    [
      "a lockfile root bump plus one dependency moved to the bumped number",
      PKG_ONLY("1.2.0") +
        `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -3 +3 @@
-  "version": "1.0.0",
+  "version": "1.2.0",
@@ -500 +500 @@
-      "version": "0.1.0",
+      "version": "1.2.0",
`,
      /package-lock\.json/,
    ],
    [
      "a pbxproj edit that is not MARKETING_VERSION",
      PKG_ONLY("1.2.0") +
        `diff --git a/ios/App/App.xcodeproj/project.pbxproj b/ios/App/App.xcodeproj/project.pbxproj
--- a/ios/App/App.xcodeproj/project.pbxproj
+++ b/ios/App/App.xcodeproj/project.pbxproj
@@ -1 +1 @@
-				CODE_SIGN_STYLE = Automatic;
+				CODE_SIGN_STYLE = Manual;
`,
      /pbxproj/,
    ],
  ])("rejects %s", (_name, diff, why) => {
    const r = checkBumpDiff(diff, "1.2.0");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringMatching(why) });
  });

  it.each([
    ["an empty diff", ""],
    [
      "a lockfile bump with no package.json",
      REAL_BUMP_DIFF.split("diff --git a/package.json")[0],
    ],
    [
      "a rename",
      `diff --git a/package.json b/package.json.bak
similarity index 100%
rename from package.json
rename to package.json.bak
`,
    ],
    [
      "a file mode change",
      PKG_ONLY("1.2.0").replace(
        "index 1..2 100644",
        "old mode 100644\nnew mode 100755"
      ),
    ],
    [
      "a new file",
      PKG_ONLY("1.2.0") +
        `diff --git a/x.sh b/x.sh
new file mode 100755
index 0..1
`,
    ],
    [
      "a binary file",
      PKG_ONLY("1.2.0") +
        `diff --git a/public/a.png b/public/a.png
index 1..2 100644
Binary files a/public/a.png and b/public/a.png differ
`,
    ],
    [
      "a quoted path",
      PKG_ONLY("1.2.0") +
        'diff --git "a/src/a b.ts" "b/src/a b.ts"\nindex 1..2 100644\n',
    ],
    ["the same file twice", PKG_ONLY("1.2.0") + PKG_ONLY("1.2.0")],
    ["a body line before any header", "+hello\n" + PKG_ONLY("1.2.0")],
  ])("fails closed on %s", (_name, diff) => {
    expect(checkBumpDiff(diff, "1.2.0").ok).toBe(false);
  });

  it("does not read a content line that looks like a header as a header", () => {
    // A removed line `-- x` shows in a diff as `--- x`; inside a hunk it is content.
    const d = PKG_ONLY(
      "1.2.0",
      "@@ -9 +9 @@\n--- a/src/evil.ts\n+++ b/src/evil.ts\n"
    );
    expect(checkBumpDiff(d, "1.2.0").ok).toBe(false);
  });
});

describe("checkBody — placeholders in tags and labels in their own section", () => {
  it("reports Test-first and a Collateral line that are only <code>TBD</code>", () => {
    expect(
      checkBody(
        body({
          testFirst: "<code>TBD</code>",
          collateral: { "help-articles": "<b>N/A</b>" },
        })
      ).sort()
    ).toEqual([
      expect.stringMatching(/Collateral: help-articles/),
      expect.stringMatching(/Test-first/),
    ]);
  });

  // Bench round 3 (George 2): Tier is read inside Risk like the other labels.
  it("does not take a Tier line from another section for the Risk answer", () => {
    const b = body({
      tier: null,
      sections: { "Review evidence": "Tier: T3\nnot yet reviewed" },
    });
    expect(checkBody(b)).toEqual([expect.stringMatching(/Tier/)]);
  });

  // Bench round 2 (George 2): a label counts only inside the section that owns it.
  it("does not take a Summary 'Test-first:' line for the Testing answer", () => {
    const b = body({
      testFirst: "",
      sections: { Summary: "Adds it.\nTest-first: see below\nCloses #1" },
    });
    expect(checkBody(b)).toEqual([expect.stringMatching(/Test-first/)]);
  });

  it("does not let an earlier empty release-notes line shadow the real one", () => {
    const b = body({
      sections: { Summary: "Adds it.\n- release-notes:\nCloses #1" },
    });
    expect(checkBody(b)).toEqual([]);
  });
});

// Round 5 (DRI pick): every free-text slot goes through one validator, and
// this table is what keeps a newly added slot from skipping it.
describe("every free-text slot goes through the one validator", () => {
  const BAD = [
    "[TBD](https://example.com)",
    "TBD",
    "<code>TBD,</code>",
    "(TBD)",
    "`N/A`",
    "N/A — later",
  ];
  const POISON: Record<string, (v: string) => string[]> = {
    closer: (v) =>
      checkBody(body({ closer: `Part-of #1 — ${v} / remaining: x` })),
    "test-first": (v) => checkBody(body({ testFirst: v })),
    "done-when-stem": (v) =>
      checkBody(body({ doneWhen: `- [x] ${v} — Check: test \`x\` → pass` })),
    "done-when-check": (v) =>
      checkBody(body({ doneWhen: `- [x] the real thing — Check: ${v}` })),
    collateral: (v) =>
      COLLATERAL_SURFACES.flatMap((surface) =>
        checkBody(body({ collateral: { [surface]: v } }))
      ),
    taste: (v) => checkBody(body({ taste: `follows pattern (${v})` })),
    "definition-of-done": (v) => [
      ...checkBody(body({ reuse: v })),
      ...checkBody(body({ prodLines: v })),
      ...checkBody(body({ fileSize: v })),
    ],
    "prose-section": (v) =>
      ["Changes", "Review evidence", "Device checks"].flatMap((t) =>
        checkBody(body({ sections: { [t]: v } }))
      ),
    "size-exception": (v) =>
      evaluate(
        {
          ...{
            author: "a",
            baseRef: "develop",
            headRef: "feat/x",
            title: "feat: x",
          },
          body: body({ extra: `size-exception: ${v}\n` }),
        },
        { prodLines: PROD_LINE_CAP + 1 }
      ).missing,
  };

  it("has a poison case for exactly the slots the parser declares", () => {
    expect(Object.keys(POISON).sort()).toEqual(
      FREE_TEXT_SLOTS.map((s: { id: string }) => s.id).sort()
    );
  });

  it("reads every slot from a complete body, so none is vacuous", () => {
    const seen = new Set(
      readSlots(body(), { overCap: true }).map((i: { id: string }) => i.id)
    );
    expect([...seen].sort()).toEqual(Object.keys(POISON).sort());
  });

  for (const id of Object.keys(POISON)) {
    it.each(BAD)(`slot ${id} refuses %j`, (v) => {
      expect(POISON[id]!(v).length).toBeGreaterThan(0);
    });
  }
});

describe("evaluate — exemption and body together", () => {
  const empty = {
    body: "",
    title: "feat: x",
    author: "sethstoll",
    baseRef: "develop",
    headRef: "feat/x",
  };

  it("fails an empty body from a human into develop", () => {
    const r = evaluate(empty);
    expect(r.ok).toBe(false);
    expect(r.exempt).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("passes an empty, oversized PR from Dependabot and into staging/main", () => {
    for (const pr of [
      { ...empty, author: "dependabot[bot]" },
      { ...empty, baseRef: "staging" },
      { ...empty, baseRef: "main" },
      { ...empty, baseRef: "staging", headRef: "release/v1.2.0" },
    ]) {
      const r = evaluate(pr, { prodLines: 99999 });
      expect(r.ok).toBe(true);
      expect(r.exempt).toBeTruthy();
    }
    const bump = evaluate(
      { ...empty, title: "chore(release): v1.2.0" },
      { prodLines: 99999, bump: { ok: true } }
    );
    expect(bump.ok).toBe(true);
    expect(bump.exempt).toBeTruthy();
  });

  it("gates a bump title the diff did not prove", () => {
    const r = evaluate(
      { ...empty, title: "chore(release): v1.2.0" },
      { bump: { ok: false, reason: "src/x.ts is not a version file" } }
    );
    expect(r.ok).toBe(false);
    expect(r.exempt).toBeNull();
    // No verdict at all (diff skipped) is gated too, without the diff note.
    const none = evaluate({ ...empty, title: "chore(release): v1.2.0" });
    expect(none.ok).toBe(false);
    expect(none.exempt).toBeNull();
  });

  // Bench round 1 (Frank 1, George 1): "the full gate" is the gate, not a veto.
  it("passes a disproved bump title on a complete body under the cap", () => {
    expect(
      evaluate(
        { ...empty, title: "chore(release): v1.2.0", body: body() },
        {
          prodLines: 20,
          bump: { ok: false, reason: "CHANGELOG.md is not a version file" },
        }
      )
    ).toEqual({ ok: true, exempt: null, missing: [] });
  });

  it("passes a full body from a human", () => {
    expect(evaluate({ ...empty, body: body() })).toEqual({
      ok: true,
      exempt: null,
      missing: [],
    });
  });

  it("treats a null body as empty", () => {
    expect(evaluate({ ...empty, body: null }).ok).toBe(false);
  });
});

describe("prFromEvent / fetchPr / parseArgs", () => {
  const payload = {
    pull_request: {
      body: "hello",
      title: "feat: x",
      user: { login: "sethstoll" },
      base: { ref: "develop" },
      head: { ref: "feat/x", sha: "abc123" },
    },
  };

  it("reads the fields from a pull_request event payload", () => {
    expect(prFromEvent(payload)).toEqual({
      body: "hello",
      title: "feat: x",
      author: "sethstoll",
      baseRef: "develop",
      headRef: "feat/x",
      headSha: "abc123",
    });
  });

  it("reads a null body as an empty string", () => {
    const p = { pull_request: { ...payload.pull_request, body: null } };
    expect(prFromEvent(p).body).toBe("");
  });

  it("throws on a payload with no pull_request (a push event)", () => {
    expect(() => prFromEvent({ ref: "refs/heads/develop" })).toThrow(
      /pull_request/
    );
  });

  it("fetchPr asks gh for the fields of the named repo and maps them", () => {
    const calls: string[][] = [];
    const pr = fetchPr("12", (args: string[]) => {
      calls.push(args);
      return JSON.stringify({
        body: "b",
        title: "t",
        author: { login: "a" },
        baseRefName: "develop",
        headRefName: "h",
      });
    });
    expect(pr).toMatchObject({ body: "b", author: "a", baseRef: "develop" });
    expect(calls[0]).toEqual([
      "pr",
      "view",
      "12",
      "--repo",
      "unfoldingWord/tc-mobile",
      "--json",
      "body,title,author,baseRefName,headRefName",
    ]);
  });

  it("parses exactly one source", () => {
    expect(parseArgs(["--event", "e.json"])).toMatchObject({
      source: "event",
      value: "e.json",
    });
    expect(parseArgs(["--pr", "7"])).toMatchObject({ source: "pr" });
    expect(parseArgs(["--body-file", "b.md"])).toMatchObject({
      source: "body-file",
    });
  });

  it("rejects no source, two sources, an unknown flag, a missing value and a bad PR number", () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["--pr", "1", "--event", "e"])).toThrow(
      /exactly one/
    );
    expect(() => parseArgs(["--nope", "x"])).toThrow(/usage/);
    expect(() => parseArgs(["--pr"])).toThrow(/requires/);
    expect(() => parseArgs(["--pr", "abc"])).toThrow(/number/);
  });

  it("lets --body-file take the PR kind and range from flags, defaulting to a plain human PR into develop", () => {
    expect(parseArgs(["--body-file", "b.md"]).meta).toEqual({
      title: "",
      author: "",
      baseRef: "develop",
      headRef: "",
    });
    const p = parseArgs([
      "--body-file",
      "b.md",
      "--base",
      "staging",
      "--author",
      "x",
      "--range",
      "a...b",
    ]);
    expect(p.meta).toMatchObject({ baseRef: "staging", author: "x" });
    expect(p.range).toBe("a...b");
  });
});

describe("CLI entry point (real subprocess, not just the exported functions)", () => {
  function run(args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
    // spawnSync, not execFileSync: a passing run's stderr (a NOTE) is kept too.
    const r = spawnSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 15_000,
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  function withTemp<T>(fn: (dir: string) => T, name = "pr-body-") {
    const dir = mkdtempSync(path.join(tmpdir(), name));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** A scratch repo with `origin/develop` and a branch adding `lines` prod lines. */
  function scratchRepo(dir: string, lines: number, testLines = 0) {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: cleanGitEnv(),
        stdio: "pipe",
      });
    git("init", "-q", "-b", "develop");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(path.join(dir, "a.txt"), "x\n");
    git("add", ".");
    git("commit", "-q", "-m", "base", "-m", "base body");
    git("update-ref", "refs/remotes/origin/develop", "HEAD");
    git("checkout", "-q", "-b", "feat/x");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    writeFileSync(path.join(dir, "src", "big.ts"), "x\n".repeat(lines));
    writeFileSync(
      path.join(dir, "tests", "big.test.ts"),
      "x\n".repeat(testLines)
    );
    git("add", ".");
    git("commit", "-q", "-m", "change", "-m", "body");
  }

  it("exits 1 and names the field for a body file missing Test-first", () =>
    withTemp((dir) => {
      const file = path.join(dir, "body.md");
      writeFileSync(file, body({ testFirst: null }));
      const r = run(["--body-file", file, "--range", "none"]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/FAIL/);
      expect(r.stderr).toMatch(/Test-first/);
    }));

  it("exits 0 and prints PASS for a full body file", () =>
    withTemp((dir) => {
      const file = path.join(dir, "body.md");
      writeFileSync(file, body());
      const r = run(["--body-file", file, "--range", "none"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/PASS/);
    }));

  it("works from a directory and a file path that contain a space", () =>
    withTemp((dir) => {
      const spaced = path.join(dir, "with space");
      const file = path.join(spaced, "body file.md");
      mkdirSync(spaced, { recursive: true });
      writeFileSync(file, body({ testFirst: null }));
      const r = run(["--body-file", file], spaced);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Test-first/);
    }, "pr body "));

  it("runs when the script is invoked through a symlinked path", () =>
    withTemp((dir) => {
      const link = path.join(dir, "linked.mjs");
      symlinkSync(SCRIPT, link);
      const file = path.join(dir, "body.md");
      writeFileSync(file, "");
      expect(() =>
        execFileSync("node", [link, "--body-file", file], {
          stdio: ["ignore", "pipe", "pipe"],
        })
      ).toThrow(/Command failed/);
    }));

  it("--event: an empty body from a human fails; Dependabot and a promotion pass", () =>
    withTemp((dir) => {
      const event = (login: string, base: string) => ({
        pull_request: {
          body: null,
          title: "feat: x",
          user: { login },
          base: { ref: base },
          head: { ref: "feat/x", sha: "abc" },
        },
      });
      const files = {
        human: event("sethstoll", "develop"),
        bot: event("dependabot[bot]", "develop"),
        promo: event("sethstoll", "staging"),
      };
      for (const [k, v] of Object.entries(files)) {
        writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
      }
      expect(run(["--event", path.join(dir, "human.json")], dir).status).toBe(
        1
      );
      const bot = run(["--event", path.join(dir, "bot.json")]);
      expect(bot.status).toBe(0);
      expect(bot.stdout).toMatch(/exempt/i);
      expect(run(["--event", path.join(dir, "promo.json")]).status).toBe(0);
    }));

  it("--event: a push-event payload fails closed, not open", () =>
    withTemp((dir) => {
      const f = path.join(dir, "push.json");
      writeFileSync(f, JSON.stringify({ ref: "refs/heads/develop" }));
      const r = run(["--event", f]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/pull_request/);
    }));

  it("--event: fails closed when the size range cannot be computed", () =>
    withTemp((dir) => {
      const f = path.join(dir, "e.json");
      writeFileSync(
        f,
        JSON.stringify({
          pull_request: {
            body: body(),
            title: "feat: x",
            user: { login: "sethstoll" },
            base: { ref: "develop" },
            head: { ref: "feat/x", sha: "0000000" },
          },
        })
      );
      const r = run(["--event", f], dir, cleanGitEnv());
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/size/i);
    }));

  it("size over the cap fails, with the tests excluded from the count; a size-exception passes", () =>
    withTemp((dir) => {
      scratchRepo(dir, PROD_LINE_CAP + 1, 5000);
      const over = path.join(dir, "over.md");
      const ok = path.join(dir, "ok.md");
      writeFileSync(over, body());
      writeFileSync(
        ok,
        body({ extra: "size-exception: one generated table\n" })
      );
      const range = "origin/develop...HEAD";
      const r1 = run(
        ["--body-file", over, "--range", range],
        dir,
        cleanGitEnv()
      );
      expect(r1.status).toBe(1);
      expect(r1.stderr).toContain(String(PROD_LINE_CAP + 1));
      expect(
        run(["--body-file", ok, "--range", range], dir, cleanGitEnv()).status
      ).toBe(0);
    }));

  // Bench round 3 (George 3): --range is data, never a git option.
  it("does not hand a --range that looks like an option to git as one", () =>
    withTemp((dir) => {
      scratchRepo(dir, 3);
      const f = path.join(dir, "b.md");
      const out = path.join(dir, "leaked.txt");
      writeFileSync(f, body());
      run(["--body-file", f, "--range", `--output=${out}`], dir, cleanGitEnv());
      expect(existsSync(out)).toBe(false);
    }));

  // Bench round 1 (George 1): a rename that crosses the size boundary moves
  // the whole file into (or out of) the count; a same-class rename stays free.
  function renameRepo(dir: string, from: string, to: string, lines: number) {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: cleanGitEnv(),
        stdio: "pipe",
      });
    git("init", "-q", "-b", "develop");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    for (const p of [from, to]) {
      mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    }
    const content = Array.from({ length: lines }, (_, i) => `line ${i}\n`);
    writeFileSync(path.join(dir, from), content.join(""));
    git("add", ".");
    git("commit", "-q", "-m", "base", "-m", "base body");
    git("update-ref", "refs/remotes/origin/develop", "HEAD");
    git("checkout", "-q", "-b", "feat/x");
    git("mv", from, to);
    git("commit", "-q", "-m", "move", "-m", "body");
  }

  for (const [from, to, status] of [
    ["tests/big.test.ts", "src/big.ts", 1],
    ["src/big.ts", "tests/big.test.ts", 1],
    ["src/big.ts", "src/moved.ts", 0],
    ["tests/big.test.ts", "docs/big.md", 0],
  ] as const) {
    it(`a pure rename ${from} -> ${to} over the cap exits ${status}`, () =>
      withTemp((dir) => {
        renameRepo(dir, from, to, PROD_LINE_CAP + 1);
        const f = path.join(dir, "b.md");
        writeFileSync(f, body());
        const r = run(
          ["--body-file", f, "--range", "origin/develop...HEAD"],
          dir,
          cleanGitEnv()
        );
        expect(r.status, r.stderr).toBe(status);
        if (status === 1) {
          expect(r.stderr).toContain(String(PROD_LINE_CAP + 1));
        }
      }));
  }

  it("size at the cap passes even with a large tests-only diff beside it", () =>
    withTemp((dir) => {
      scratchRepo(dir, PROD_LINE_CAP, 5000);
      const f = path.join(dir, "b.md");
      writeFileSync(f, body());
      const r = run(
        ["--body-file", f, "--range", "origin/develop...HEAD"],
        dir,
        cleanGitEnv()
      );
      expect(r.status).toBe(0);
    }));

  it("fails closed on no arguments, an unreadable file and malformed JSON", () =>
    withTemp((dir) => {
      expect(run([]).status).toBe(1);
      expect(run([]).stderr).toMatch(/usage/);
      expect(run(["--body-file", path.join(dir, "nope.md")]).status).toBe(1);
      const bad = path.join(dir, "bad.json");
      writeFileSync(bad, "{not json");
      expect(run(["--event", bad]).status).toBe(1);
    }));
  // #1582, the entry path: real subprocess, real git, one scratch repo per case.
  /** develop holds package.json + package-lock.json at 1.0.0; `feat/x` is then `edit`ed. */
  function releaseRepo(dir: string, edit: (dir: string) => void) {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        env: cleanGitEnv(),
        stdio: "pipe",
      });
    const pkg = (v: string, dep = "1") =>
      JSON.stringify(
        {
          name: "t",
          version: v,
          scripts: { a: "x" },
          dependencies: { d: dep },
        },
        null,
        2
      ) + "\n";
    const lock = (v: string) =>
      JSON.stringify(
        { name: "t", version: v, packages: { "": { name: "t", version: v } } },
        null,
        2
      ) + "\n";
    git("init", "-q", "-b", "develop");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(path.join(dir, "package.json"), pkg("1.0.0"));
    writeFileSync(path.join(dir, "package-lock.json"), lock("1.0.0"));
    git("add", ".");
    git("commit", "-q", "-m", "base", "-m", "base body");
    git("update-ref", "refs/remotes/origin/develop", "HEAD");
    git("checkout", "-q", "-b", "release/x");
    edit(dir);
    git("add", ".");
    git("commit", "-q", "-m", "change", "-m", "body");
    return { pkg, lock };
  }
  const RANGE = "origin/develop...HEAD";
  const bumpFiles = (dir: string, v: string) => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "t",
          version: v,
          scripts: { a: "x" },
          dependencies: { d: "1" },
        },
        null,
        2
      ) + "\n"
    );
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify(
        { name: "t", version: v, packages: { "": { name: "t", version: v } } },
        null,
        2
      ) + "\n"
    );
  };
  const emptyBody = (dir: string) => {
    const f = path.join(dir, "..", `${path.basename(dir)}-empty.md`);
    writeFileSync(f, "");
    return f;
  };
  function runBump(dir: string, title: string, head = "release/x") {
    const f = emptyBody(dir);
    try {
      return run(
        ["--body-file", f, "--range", RANGE, "--title", title, "--head", head],
        dir,
        cleanGitEnv()
      );
    } finally {
      rmSync(f, { force: true });
    }
  }

  it("a real bump (version files only) with an empty body passes as exempt", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => bumpFiles(d, "1.1.0"));
      const r = runBump(dir, "chore(release): v1.1.0");
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/exempt.*version files only/i);
    }));

  it("a bump's `release/x` branch name changes nothing: still passes with a feature branch name", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => bumpFiles(d, "1.1.0"));
      expect(runBump(dir, "chore(release): v1.1.0", "chore/bump").status).toBe(
        0
      );
    }));

  it("a release/* branch with a production diff over the cap fails the size cap", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => {
        mkdirSync(path.join(d, "src"), { recursive: true });
        writeFileSync(
          path.join(d, "src", "big.ts"),
          "x\n".repeat(PROD_LINE_CAP + 1)
        );
      });
      const f = path.join(dir, "full.md");
      writeFileSync(f, body());
      const r = run(
        ["--body-file", f, "--range", RANGE, "--head", "release/big-feature"],
        dir,
        cleanGitEnv()
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(String(PROD_LINE_CAP + 1));
    }));

  it.each([
    [
      "a bump title that carries a source file",
      (d: string) => {
        bumpFiles(d, "1.1.0");
        mkdirSync(path.join(d, "src"), { recursive: true });
        writeFileSync(
          path.join(d, "src", "feature.ts"),
          "export const a = 1;\n"
        );
      },
      "chore(release): v1.1.0",
      /new file mode/,
    ],
    [
      "a bump title whose version is not the bumped one",
      (d: string) => bumpFiles(d, "1.0.1"),
      "chore(release): v1.1.0",
      /package(-lock)?\.json changes more than its "version" line, or not to 1\.1\.0/,
    ],
    [
      "a bump title that also edits a dependency in package.json",
      (d: string) => {
        bumpFiles(d, "1.1.0");
        writeFileSync(
          path.join(d, "package.json"),
          JSON.stringify(
            {
              name: "t",
              version: "1.1.0",
              scripts: { a: "x" },
              dependencies: { d: "2" },
            },
            null,
            2
          ) + "\n"
        );
      },
      "chore(release): v1.1.0",
      /package\.json/,
    ],
  ])(
    "%s into develop fails with the full gate and names why",
    (_n, edit, title, why) =>
      withTemp((dir) => {
        releaseRepo(dir, edit);
        const r = runBump(dir, title);
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(why);
      })
  );

  it("a bump title that is not a bump passes on a complete body, and says why it was not exempt", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => {
        bumpFiles(d, "1.1.0");
        writeFileSync(path.join(d, "CHANGELOG.md"), "v1.1.0\n");
      });
      const f = path.join(dir, "..", `${path.basename(dir)}-full.md`);
      writeFileSync(f, body());
      try {
        const r = run(
          [
            "--body-file",
            f,
            "--range",
            RANGE,
            "--title",
            "chore(release): v1.1.0",
          ],
          dir,
          cleanGitEnv()
        );
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/every required PR body field/);
        expect(r.stderr).toMatch(/release bump but the diff is not one/);
      } finally {
        rmSync(f, { force: true });
      }
    }));

  it("a promotion PR from release/* with a huge diff passes by its base", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => {
        mkdirSync(path.join(d, "src"), { recursive: true });
        writeFileSync(
          path.join(d, "src", "big.ts"),
          "x\n".repeat(PROD_LINE_CAP * 3)
        );
      });
      for (const base of ["staging", "main"]) {
        const f = emptyBody(dir);
        const r = run(
          [
            "--body-file",
            f,
            "--range",
            RANGE,
            "--base",
            base,
            "--head",
            "release/v1.2.0",
            "--title",
            "Promote v1.2.0",
          ],
          dir,
          cleanGitEnv()
        );
        rmSync(f, { force: true });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/promotion/i);
      }
    }));

  it("a patch PR into a release/* base (the #1523 shape) is not exempt and passes only with a full body", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => bumpFiles(d, "1.1.1"));
      const title = "chore(release): v1.1.1 — silent-switch fix";
      const f = emptyBody(dir);
      const bare = run(
        [
          "--body-file",
          f,
          "--range",
          RANGE,
          "--base",
          "release/v1.1.1",
          "--head",
          "fix/silent",
          "--title",
          title,
        ],
        dir,
        cleanGitEnv()
      );
      rmSync(f, { force: true });
      expect(bare.status).toBe(1);
      const full = path.join(dir, "full.md");
      writeFileSync(full, body());
      const ok = run(
        [
          "--body-file",
          full,
          "--range",
          RANGE,
          "--base",
          "release/v1.1.1",
          "--head",
          "fix/silent",
          "--title",
          title,
        ],
        dir,
        cleanGitEnv()
      );
      expect(ok.status, ok.stderr).toBe(0);
    }));

  it("--range none skips the diff, so a bump title is gated, not trusted", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => bumpFiles(d, "1.1.0"));
      const f = emptyBody(dir);
      const r = run(
        [
          "--body-file",
          f,
          "--range",
          "none",
          "--title",
          "chore(release): v1.1.0",
        ],
        dir,
        cleanGitEnv()
      );
      rmSync(f, { force: true });
      expect(r.status).toBe(1);
    }));

  it("--event: a real bump passes; the same title with a source file fails; an unreadable diff fails closed", () =>
    withTemp((dir) => {
      releaseRepo(dir, (d) => bumpFiles(d, "1.1.0"));
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: dir,
        env: cleanGitEnv(),
        encoding: "utf8",
      }).trim();
      const ev = (headSha: string, title = "chore(release): v1.1.0") => {
        const f = path.join(dir, `ev-${headSha.slice(0, 4)}.json`);
        writeFileSync(
          f,
          JSON.stringify({
            pull_request: {
              body: "",
              title,
              user: { login: "sethstoll" },
              base: { ref: "develop" },
              head: { ref: "release/x", sha: headSha },
            },
          })
        );
        return f;
      };
      const good = run(["--event", ev(sha)], dir, cleanGitEnv());
      expect(good.status, good.stderr).toBe(0);
      expect(good.stdout).toMatch(/exempt/i);
      const mismatch = run(
        ["--event", ev(sha, "chore(release): v7.7.7")],
        dir,
        cleanGitEnv()
      );
      expect(mismatch.status).toBe(1);
      const lost = run(["--event", ev("0000000")], dir, cleanGitEnv());
      expect(lost.status).toBe(1);
      expect(lost.stderr).toMatch(/bump not checked/);
    }));
});
