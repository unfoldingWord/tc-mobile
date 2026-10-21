import { execFileSync } from "node:child_process";
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
  evaluate,
  exemption,
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
  ])("rejects the non-answer %j", (v) => expect(isAnswer(v)).toBe(false));
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
      { added: 0, deleted: 0, path: "src/new.ts" },
      { added: 0, deleted: 0, path: "public/x.png" },
      { added: 10, deleted: 0, path: "docs/x.md" },
    ]);
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

  it("exempts a release/* head from the cap", () => {
    expect(
      evaluate({ ...empty, headRef: "release/v1.2.0" }, { prodLines: 9999 }).ok
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

  it("exempts a chore(release): bump into develop", () => {
    expect(exemption({ ...human, title: "chore(release): v1.1.0" })).toMatch(
      /release/i
    );
  });

  // Bench round 1 (George 2): AGENTS.md's release PR is `chore(release): vX.Y.Z`.
  it.each(["chore(release): v1.1.0-rc.2", "chore(release): v0.2.14 — promote"])(
    "exempts the release title %j",
    (title) => expect(exemption({ ...human, title })).toMatch(/release/i)
  );

  it.each(["chore(release): wip", "chore(release): v9", "chore(release):"])(
    "does not exempt the release look-alike %j into develop",
    (title) => expect(exemption({ ...human, title })).toBeNull()
  );

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
      exemption({
        ...human,
        baseRef: "feat/other",
        title: "chore(release): v9",
      })
    ).toBeNull();
  });

  it("does not exempt a lookalike bot name or a release-looking head", () => {
    expect(exemption({ ...human, author: "dependabot-fan" })).toBeNull();
    expect(exemption({ ...human, author: "dependabot[bot]x" })).toBeNull();
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
      { ...empty, title: "chore(release): v1.2.0" },
    ]) {
      const r = evaluate(pr, { prodLines: 99999 });
      expect(r.ok).toBe(true);
      expect(r.exempt).toBeTruthy();
    }
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
    try {
      const stdout = execFileSync("node", [SCRIPT, ...args], {
        encoding: "utf8",
        timeout: 15_000,
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as {
        status: number | null;
        stdout: string;
        stderr: string;
      };
      return { status: e.status, stdout: e.stdout, stderr: e.stderr };
    }
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
});
