import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { lightsFailureMarker } from "@/lib/failure-marker";

/**
 * #1838 — every failure-log context is classified on purpose.
 *
 * `lightsFailureMarker` lights the Books ≡ marker for any context it does not
 * list. That default is right for a failure channel, but it also meant a new
 * `reportFailure` context got its class by silence. This gate makes the choice
 * explicit: each context written in `src/` must appear in `CLASSES` below,
 * classed "lights" or "logged only", and the class the table claims must be
 * the one `lightsFailureMarker` returns.
 *
 * HOW CONTEXTS ARE FOUND. `src/` is parsed with the TypeScript compiler, so a
 * comment or a string that merely mentions a call is never read as one. The
 * context argument is read at each call of a sink in `SINKS`: `reportFailure`
 * itself and the thin wrappers that forward a literal to it.
 *
 * ONE RULE FOR "RESOLVED". An argument (and each member of a classification
 * set in `failure-marker.ts`) is resolved only when every leaf is a string
 * literal, after unwrapping parentheses, `as`, `satisfies`, `!` and `<T>`
 * casts and reading both branches of a conditional. If any leaf is not, the
 * whole site is unresolved; it is never half read. The literal leaves of an
 * unresolved site are still recorded, so they must be classified too.
 *
 * COMPUTED CONTEXTS. An unresolved sink site is a computed site, keyed
 * `file::argument text`. Each is listed in `COMPUTED_SITES` with where its
 * literals come from; one not listed there fails, and a listed one that is no
 * longer live fails too. The wrappers' literals are read at THEIR call sites
 * (they are sinks too), which is why a computed forwarding site is safe to
 * allow. An unresolved member of a classification set is kept as text, so the
 * liveness check reports it instead of dropping it.
 *
 * WHAT THIS DOES NOT SEE: the callee is matched by name, so a sink imported
 * under an alias, called through element access (`sinks["reportFailure"](…)`)
 * or reached by spread (`reportFailure(...args)`) is invisible. A context
 * built from an identifier that points at a literal (`const c = "x"`) is a
 * computed site, not a read of `"x"`. A new wrapper that forwards to
 * `reportFailure` under a name not in `SINKS` is a computed site at its
 * `reportFailure` call, which is how it gets noticed. A class is a statement
 * about whether ≡ lights; it does not say a row is written on a device.
 */

type Class = "lights" | "logged only";

/** Sink name -> index of the context argument. */
const SINKS: Readonly<Record<string, number>> = {
  reportFailure: 1,
  reportFailureTo: 1,
  reportPlaybackFailure: 1,
  report: 1, // replay-pending-takes, use-chapter-play, deps.report in chapter-player and stale-chunk-reload
  stopTracks: 1,
  raceAudioResume: 0,
  reportPendingResult: 0,
};

/**
 * Computed sink calls, keyed `file::argument text`, each with the reason it is
 * allowed. The literals behind them are read where they are written.
 */
const COMPUTED_SITES: Readonly<Record<string, string>> = {
  "hooks/audio-io.ts::rejectionContextKey":
    "raceAudioResume's parameter; its callers pass literals",
  "hooks/audio-io.ts::context":
    "stopTracks' parameter; its callers pass literals",
  "hooks/phone-check-probes.ts::PHONE_CHECK_CONTEXT":
    'the constant PHONE_CHECK_CONTEXT = "phone-check", read as a literal below',
  "hooks/use-phone-check.ts::PHONE_CHECK_CONTEXT":
    'the constant PHONE_CHECK_CONTEXT = "phone-check", read as a literal below',
  "hooks/replay-pending-takes.ts::context":
    "report()'s parameter; its callers pass literals",
  "hooks/use-audio-session.ts::context":
    "reportPlaybackFailure's parameter; its callers pass literals",
  "hooks/use-save-take.ts::context":
    "reportPendingResult's parameter; its callers pass literals",
};

/** The files where a local `report(cause, context)` is a failure sink. */
const REPORT_SINK_FILES: ReadonlySet<string> = new Set([
  "hooks/replay-pending-takes.ts",
  "hooks/use-chapter-play.ts",
  "hooks/chapter-player.ts",
  "hooks/stale-chunk-reload.ts",
]);

const SRC = path.resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

/** Peel the wrappers that change a node's type but not its value. */
function unwrap(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The one rule. A node is resolved only when EVERY leaf is a string literal,
 * after unwrapping parentheses, `as`, `satisfies`, `!` and `<T>` casts and
 * descending into both branches of a conditional (never its condition, which
 * only picks). Returns the literals, or `null` when any leaf is not one, so a
 * mixed argument is never half read. Used by both readers: a sink argument and
 * a member of a classification set.
 */
function resolveAll(node: ts.Node): string[] | null {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return [inner.text];
  }
  if (ts.isConditionalExpression(inner)) {
    const whenTrue = resolveAll(inner.whenTrue);
    const whenFalse = resolveAll(inner.whenFalse);
    return whenTrue === null || whenFalse === null
      ? null
      : [...whenTrue, ...whenFalse];
  }
  return null;
}

/** The string-literal leaves of a node, even when it also has other leaves.
 *  Only for classifying what a mixed site CAN be; never proof a site is
 *  resolved. */
function literalLeaves(node: ts.Node): string[] {
  const inner = unwrap(node);
  if (ts.isConditionalExpression(inner)) {
    return [
      ...literalLeaves(inner.whenTrue),
      ...literalLeaves(inner.whenFalse),
    ];
  }
  return resolveAll(inner) ?? [];
}

interface Scan {
  readonly contexts: Set<string>;
  readonly computed: string[];
}

/** Scan fixture text as if it were `hooks/probe.ts`. */
function probe(code: string): Scan {
  const out: Scan = { contexts: new Set(), computed: [] };
  scanSource("hooks/probe.ts", code, out);
  return out;
}

/** Scan one file's text. `relative` is its path under `src/`. */
function scanSource(relative: string, text: string, out: Scan): void {
  const source = ts.createSourceFile(
    relative,
    text,
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "PHONE_CHECK_CONTEXT" &&
      node.initializer !== undefined
    ) {
      // The constant the phone check's computed sites forward.
      const value = resolveAll(node.initializer);
      if (value === null) {
        out.computed.push(
          `${relative}::PHONE_CHECK_CONTEXT = ${node.initializer.getText(source)}`
        );
      } else {
        for (const literal of value) out.contexts.add(literal);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      // A bare local `report` is a sink only where it forwards a context;
      // elsewhere (use-books, the chapter queue, the exporter) it is not.
      const index =
        name === null || (name === "report" && !REPORT_SINK_FILES.has(relative))
          ? undefined
          : SINKS[name];
      const arg = index === undefined ? undefined : node.arguments[index];
      if (arg !== undefined) {
        const resolved = resolveAll(arg);
        if (resolved === null) {
          // Mixed or computed: the whole site is unresolved. Its literal
          // leaves are still recorded so they must be classified too.
          for (const literal of literalLeaves(arg)) out.contexts.add(literal);
          out.computed.push(`${relative}::${arg.getText(source)}`);
        } else {
          for (const literal of resolved) out.contexts.add(literal);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function scan(read: (file: string) => string, files: string[]): Scan {
  const out: Scan = { contexts: new Set(), computed: [] };
  for (const file of files) {
    const relative = path.relative(SRC, file).split(path.sep).join("/");
    scanSource(relative, read(file), out);
  }
  return out;
}

/**
 * The decision for every context. A new context is a new line here; choosing
 * "logged only" also means listing it in `failure-marker.ts`, which the class
 * check below enforces. Inference: most of these were classed by the default
 * rather than by a recorded decision; the "logged only" rows are the ones with
 * a recorded pick (the DRI on #1076, #1692 and PR #1706) or the same rule.
 */
const CLASSES: Readonly<Record<string, Class>> = {
  "about-licence-text": "lights",
  "audio-clock-stalled-on-return": "lights",
  "book-cover-colour": "lights",
  "book-delete": "lights",
  "book-export-bundle": "lights",
  "book-language": "lights",
  "book-licence": "lights",
  "book-provenance-read": "logged only",
  "book-reorder": "lights",
  "books-add-chapter": "lights",
  "books-create": "lights",
  "books-load": "lights",
  "books-rename": "lights",
  "chapter-add-segment": "lights",
  "chapter-load": "lights",
  "chapter-play": "lights",
  "chapter-rename": "lights",
  "chapter-reorder": "lights",
  "chapter-set-finished": "lights",
  "encoder-health": "lights",
  "encoder-recover": "lights",
  "erase-segment": "lights",
  "failure-log-clear": "lights",
  "failure-log-share-prepare": "lights",
  "failure-log-share-send": "lights",
  "language-list": "lights",
  "native-back-exit": "lights",
  "native-back-handler": "lights",
  "native-back-listener": "lights",
  "native-back-remove": "lights",
  "native-sw-cache-cleanup": "lights",
  "native-sw-unregister": "lights",
  "pending-take-delete": "lights",
  "pending-take-read": "lights",
  "pending-take-refused": "lights",
  "pending-take-replayed": "logged only",
  "pending-take-write": "lights",
  "phone-check": "lights",
  "playback-buffer": "lights",
  "playback-buffer-tap-resume": "logged only",
  "playback-clock-stalled": "lights",
  "playback-context-close": "lights",
  "playback-dangling": "lights",
  "playback-resume": "lights",
  "playback-resume-timeout": "lights",
  "playback-resume-unusable": "lights",
  "playback-take": "lights",
  "playback-tap-resume": "lights",
  "recorder-back-no-handle": "lights",
  "recorder-cancel-stop": "lights",
  "recorder-capture-stalled": "lights",
  "recorder-close-rejected": "lights",
  "recorder-close-tail": "lights",
  "recorder-commit-close": "lights",
  "recorder-commit-stop": "lights",
  "recorder-decode-retry-resume": "logged only",
  "recorder-edit-apply": "logged only",
  "recorder-finished-flag": "logged only",
  "recorder-foreground-resume": "logged only",
  "recorder-interrupted-active": "lights",
  "recorder-mic-refused": "logged only",
  "recorder-mic-start": "lights",
  "recorder-recovered-save": "lights",
  "recorder-recovered-share": "lights",
  "recorder-release-track": "lights",
  "recorder-segment-load": "lights",
  "recorder-segment-reload": "lights",
  "recorder-segment-resume-retry": "logged only",
  "recorder-start": "lights",
  "recorder-start-resume": "lights",
  "recorder-start-resume-timeout": "lights",
  "recorder-stop-backstop": "lights",
  "recorder-stop-flush": "lights",
  "recorder-take-cap": "logged only",
  "recorder-tap-clock-stalled": "lights",
  "recorder-tap-clone-stop": "lights",
  "recorder-tap-open": "lights",
  render: "lights",
  "save-take": "lights",
  "segment-delete": "lights",
  "segment-rename": "lights",
  "segment-reorder": "lights",
  "share-prepare": "lights",
  "share-send": "lights",
  "share-spool-release": "lights",
  "sheet-open-resume": "logged only",
  "stale-chunk": "lights",
  "stale-chunk-reload": "logged only",
  "storage-pressure-bump": "lights",
  "system-bars-style": "logged only",
  "template-create": "lights",
  "template-load": "lights",
  "transcode-compressor": "lights",
  "transcode-segment": "lights",
  "transcode-stall-accounting": "lights",
  "transcode-sweep": "lights",
  "uncaught-error": "lights",
  "unhandled-rejection": "lights",
  "use-settings: persist": "lights",
  "use-theme: persist": "lights",
};

/** The classification collections `failure-marker.ts` declares, by name. */
const MARKER_SETS: readonly string[] = [
  "INFORMATIONAL_CONTEXTS",
  "ROUTINE_RECOVERABLE_CONTEXTS",
  "RESUME_CONTEXTS",
];

/** Name -> string literals of each top-level collection constant in
 *  `failure-marker.ts` (a `new Set([...])` or an array of strings). */
function markerCollections(
  text: string = readFileSync(path.join(SRC, "lib/failure-marker.ts"), "utf8")
): Map<string, string[]> {
  const source = ts.createSourceFile(
    "lib/failure-marker.ts",
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const found = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || init === undefined) continue;
      const inner = unwrap(init);
      const list = ts.isNewExpression(inner)
        ? inner.arguments?.[0] === undefined
          ? undefined
          : unwrap(inner.arguments[0])
        : inner;
      if (list !== undefined && ts.isArrayLiteralExpression(list)) {
        // A member that does not resolve is kept as its source text, which no
        // `src/` context equals, so the liveness check reports it instead of
        // dropping it. A conditional member contributes each branch it can be.
        found.set(
          declaration.name.text,
          list.elements.flatMap(
            (element) =>
              resolveAll(element) ?? [`<unresolved> ${element.getText(source)}`]
          )
        );
      }
    }
  }
  return found;
}

const live = scan((file) => readFileSync(file, "utf8"), sourceFiles(SRC));

describe("every failure-log context is classified (#1838)", () => {
  it("every computed sink call is a listed forwarding site", () => {
    const unlisted = live.computed.filter(
      (site) => !Object.hasOwn(COMPUTED_SITES, site)
    );
    expect(unlisted).toEqual([]);
  });

  it("every listed forwarding site is still a live computed site", () => {
    const stale = Object.keys(COMPUTED_SITES)
      .filter((site) => !live.computed.includes(site))
      .sort();
    expect(stale).toEqual([]);
  });

  it("every context written in src/ is in the table", () => {
    const missing = [...live.contexts]
      .filter((c) => !Object.hasOwn(CLASSES, c))
      .sort();
    expect(missing).toEqual([]);
  });

  it("every table entry is still written in src/", () => {
    const stale = Object.keys(CLASSES)
      .filter((c) => !live.contexts.has(c))
      .sort();
    expect(stale).toEqual([]);
  });

  it("each context's class matches lightsFailureMarker", () => {
    const wrong = Object.entries(CLASSES)
      .filter(
        ([context, expected]) =>
          (lightsFailureMarker(context) ? "lights" : "logged only") !== expected
      )
      .map(([context]) => context)
      .sort();
    expect(wrong).toEqual([]);
  });

  it("failure-marker.ts declares exactly the classification sets this gate reads", () => {
    expect([...markerCollections().keys()].sort()).toEqual(
      [...MARKER_SETS].sort()
    );
  });

  it("every context a classification set names is still written in src/", () => {
    const collections = markerCollections();
    const dead: string[] = [];
    for (const name of MARKER_SETS) {
      const members = collections.get(name) ?? [];
      expect(members.length, `${name} is empty or unread`).toBeGreaterThan(0);
      for (const member of members) {
        if (!live.contexts.has(member)) dead.push(`${name}: ${member}`);
      }
    }
    expect(dead).toEqual([]);
  });

  describe("conditional contexts", () => {
    it("a fully literal conditional is accepted, both branches read", () => {
      const out = probe('reportFailure(e, flag ? "a-one" : "b-two");');
      expect([...out.contexts].sort()).toEqual(["a-one", "b-two"]);
      expect(out.computed).toEqual([]);
    });

    it("a nested fully literal conditional is accepted", () => {
      const out = probe(
        'reportFailure(e, x ? "a-one" : y ? "b-two" : "c-three");'
      );
      expect([...out.contexts].sort()).toEqual(["a-one", "b-two", "c-three"]);
      expect(out.computed).toEqual([]);
    });

    it("a mixed conditional keeps its computed branch", () => {
      const out = probe(
        'reportFailure(e, flag ? "save-take" : "unknown-" + suffix);'
      );
      expect(out.contexts.has("save-take")).toBe(true);
      expect(out.computed).toEqual([
        'hooks/probe.ts::flag ? "save-take" : "unknown-" + suffix',
      ]);
    });

    it("a computed branch nested inside a conditional is kept", () => {
      const out = probe(
        'reportFailure(e, x ? "a-one" : y ? "b-two" : dynamic);'
      );
      expect(out.computed).toEqual([
        'hooks/probe.ts::x ? "a-one" : y ? "b-two" : dynamic',
      ]);
      const deep = probe(
        'reportFailure(e, x ? (y ? other : "a-one") : "b-two");'
      );
      expect(deep.computed).toEqual([
        'hooks/probe.ts::x ? (y ? other : "a-one") : "b-two"',
      ]);
    });

    it("a computed branch is rejected unless listed", () => {
      const out = probe('reportFailure(e, flag ? "save-take" : dynamic);');
      expect(
        out.computed.filter((site) => !Object.hasOwn(COMPUTED_SITES, site))
      ).toEqual(['hooks/probe.ts::flag ? "save-take" : dynamic']);
    });
  });

  describe("wrapped and mixed leaves, at both readers", () => {
    it("`as const`, `satisfies`, parentheses and `!` resolve at a sink", () => {
      const out = probe(
        [
          'reportFailure(e, "a-one" as const);',
          'reportFailure(e, ("b-two") satisfies string);',
          'reportFailure(e, flag ? ("c-three" as const) : "d-four");',
        ].join("\n")
      );
      expect([...out.contexts].sort()).toEqual([
        "a-one",
        "b-two",
        "c-three",
        "d-four",
      ]);
      expect(out.computed).toEqual([]);
    });

    it("a wrapped non-literal leaf at a sink is still a computed site", () => {
      const out = probe("reportFailure(e, (name as string));");
      expect(out.computed).toEqual(["hooks/probe.ts::(name as string)"]);
    });

    it("a mixed argument at a sink is one unresolved site, not a half read", () => {
      const out = probe('reportFailure(e, flag ? "a-one" : name);');
      expect(out.computed).toHaveLength(1);
    });

    it("`as const` inside a classification set is still a member", () => {
      const sets = markerCollections(
        'const A: ReadonlySet<string> = new Set(["x-ctx" as const, ("y-ctx") satisfies string]);'
      );
      expect(sets.get("A")).toEqual(["x-ctx", "y-ctx"]);
    });

    it("a non-literal set member is kept so liveness reports it", () => {
      const sets = markerCollections(
        'const A: readonly string[] = ["x-ctx", other, flag ? "y-ctx" : mixed];'
      );
      const members = sets.get("A") ?? [];
      expect(members).toHaveLength(3);
      expect(members[0]).toBe("x-ctx");
      for (const member of members.slice(1)) {
        expect(live.contexts.has(member)).toBe(false);
      }
    });

    it("an array wrapped in `as const` is still read as a set", () => {
      const sets = markerCollections(
        'const A = ["x-ctx"] as const; const B = new Set(["y-ctx"] as const);'
      );
      expect(sets.get("A")).toEqual(["x-ctx"]);
      expect(sets.get("B")).toEqual(["y-ctx"]);
    });

    it("PHONE_CHECK_CONTEXT is read from its initializer, not from comments", () => {
      const real = probe('export const PHONE_CHECK_CONTEXT = "phone-real";');
      expect([...real.contexts]).toEqual(["phone-real"]);
      const commented = probe(
        "// PHONE_CHECK_CONTEXT = \"phone-comment\"\nexport const PHONE_CHECK_CONTEXT = 'phone-single';"
      );
      expect([...commented.contexts]).toEqual(["phone-single"]);
    });
  });
});
