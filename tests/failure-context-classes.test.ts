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
 * itself and the thin wrappers that forward a literal to it. Every string
 * literal inside that argument counts, so a ternary of two literals yields
 * both.
 *
 * COMPUTED CONTEXTS. A sink call whose context argument holds no literal is a
 * computed site. Each is listed in `COMPUTED_SITES` with where its literals
 * come from. A computed site not listed there fails, so a new one cannot slip
 * in unclassified. The wrappers' literals are read at THEIR call sites (they
 * are sinks too), which is why a computed forwarding site is safe to allow.
 *
 * WHAT THIS DOES NOT SEE: a context built by string concatenation or a
 * template literal with an interpolation is not a literal; it would land in
 * `COMPUTED_SITES` or fail. A new wrapper that forwards to `reportFailure`
 * under a name not in `SINKS` is a computed site at its `reportFailure` call,
 * which is how it gets noticed. A class is a statement about whether ≡
 * lights; it does not say a row is written on a device.
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

/** Files whose `reportFailure` is the definition or a signature, not a call. */
const SKIP_FILES: ReadonlySet<string> = new Set(["hooks/report-failure.ts"]);

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

/** The literals a context argument can evaluate to: the argument itself, or
 *  either branch of a conditional (never its condition, which only picks). */
function literalsIn(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isParenthesizedExpression(node)) return literalsIn(node.expression);
  if (ts.isConditionalExpression(node)) {
    return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)];
  }
  return [];
}

interface Scan {
  readonly contexts: Set<string>;
  readonly computed: string[];
}

function scan(read: (file: string) => string, files: string[]): Scan {
  const contexts = new Set<string>();
  const computed: string[] = [];
  for (const file of files) {
    const relative = path.relative(SRC, file).split(path.sep).join("/");
    if (SKIP_FILES.has(relative)) continue;
    const text = read(file);
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        // A bare local `report` is a sink only where it forwards a context;
        // elsewhere (use-books, the chapter queue, the exporter) it is not.
        const index =
          name === null ||
          (name === "report" && !REPORT_SINK_FILES.has(relative))
            ? undefined
            : SINKS[name];
        const arg = index === undefined ? undefined : node.arguments[index];
        if (arg !== undefined) {
          const literals = literalsIn(arg);
          if (literals.length > 0) {
            for (const literal of literals) contexts.add(literal);
          } else {
            computed.push(`${relative}::${arg.getText(source)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const m of text.matchAll(/\bPHONE_CHECK_CONTEXT\s*=\s*"([^"]+)"/g)) {
      contexts.add(m[1] as string);
    }
  }
  return { contexts, computed };
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
  "template-create": "lights",
  "template-load": "lights",
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
function markerCollections(): Map<string, string[]> {
  const file = path.join(SRC, "lib/failure-marker.ts");
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const found = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || init === undefined) continue;
      const list = ts.isNewExpression(init) ? init.arguments?.[0] : init;
      if (list !== undefined && ts.isArrayLiteralExpression(list)) {
        found.set(
          declaration.name.text,
          list.elements.flatMap((element) => literalsIn(element))
        );
      }
    }
  }
  return found;
}

const live = scan((file) => readFileSync(file, "utf8"), sourceFiles(SRC));

describe("every failure-log context is classified (#1838)", () => {
  it("every computed sink call is a listed forwarding site", () => {
    const unlisted = live.computed.filter((site) => !(site in COMPUTED_SITES));
    expect(unlisted).toEqual([]);
  });

  it("every context written in src/ is in the table", () => {
    const missing = [...live.contexts].filter((c) => !(c in CLASSES)).sort();
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
});
