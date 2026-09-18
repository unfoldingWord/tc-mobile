import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Two recorder-path failure rows reach the funnel (`reportFailure`) from
 * code the Node suite cannot execute:
 *
 *   1. `onInterrupted` in `start()` (use-recorder.ts) reports ONE row per
 *      take, context key `"recorder-interrupted-active"`, when an
 *      interruption arrives while the native recorder is still
 *      `"recording"` or `"paused"` — the arm on which the microphone stays
 *      live on the frozen sheet until Back (#478, the #59 residual). The
 *      `"inactive"` arm — the device-verified #59 path — gets no row.
 *   2. `stopRecording()`'s backstop `catch` (use-audio-session.ts) reports
 *      the cause under `"recorder-stop-backstop"`, with the existing
 *      `console.error` kept beside it, not replaced (#480; AGENTS.md
 *      "Errors have a channel before they have copy").
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. `start()` is a
 * `useCallback` inside `useRecorder()` and `onInterrupted` is created inside
 * `start()`; `stopRecording` is a `useCallback` inside `useAudioSession()`.
 * This suite has no renderer, no `MediaRecorder` and no `AudioContext`
 * (`tests/audio-session.test.ts` and
 * `tests/recorder-stop-release-guards.test.ts` both say so), so neither
 * site can be reached at runtime here, and removing either report would
 * leave every other test green. That is the mutation-survives case
 * AGENTS.md says to close with a gate; this file mirrors
 * `tests/recorder-stop-release-guards.test.ts` (comment strip, brace-counted
 * isolation, one contiguous pattern per site — the Frank round-5 lesson
 * recorded there: tie guard + set + report into ONE regex, so a detached
 * guard cannot satisfy it).
 *
 * WHAT IT PROVES, EXACTLY: text shape only. That the source text contains
 * each report, on the arm and in the order specified, once. It does NOT
 * prove either site behaves correctly at runtime, that any phone ever
 * reaches the still-active arm or ever hits the resume bound, or that the
 * row lands in the log on a device — collecting exactly that evidence is
 * what #478 and #475 exist for. Nothing here has been run on a device.
 *
 * ONE ROW PER INTERRUPTION (#478 constraint 1). `onInterrupted` is bound to
 * `recorder.onerror` AND to every capture track's `onended`, so one
 * interruption can invoke it more than once, in different tasks. The
 * funnel's own dedup (report-failure.ts) collapses only the SAME object
 * identity under the same context within one microtask; each call here
 * synthesizes a fresh `Error`, so the funnel would NOT collapse them. The
 * `let interruptionReported = false;` local in `start()`'s closure is what
 * closes it: per take by construction (a fresh binding per `start()`), set
 * on the first still-active invocation, never reset. Assertion (4) pins
 * that scope — a declaration INSIDE the handler would reset on every call.
 */

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Brace-counts from `openIndex` (the index of an opening `{`) to find its
 *  matching close, or -1. */
const matchingBraceClose = (body: string, openIndex: number): number => {
  let depth = 0;
  for (let i = openIndex; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** Slice out the `{ ... }` body that follows the first occurrence of
 *  `declaration` in `code`, throwing (not failing an assertion) when the
 *  anchor is gone — a renamed callback is a harness defect, not a finding. */
const bodyAfter = (code: string, declaration: string): string => {
  const declStart = code.indexOf(declaration);
  if (declStart === -1) {
    throw new Error(`${declaration} not found — has it been renamed or moved?`);
  }
  const open = code.indexOf("{", declStart);
  if (open === -1) throw new Error(`${declaration}: opening brace not found`);
  const close = matchingBraceClose(code, open);
  if (close === -1 || close <= open) {
    throw new Error(`${declaration}: closing brace not found`);
  }
  return code.slice(open, close + 1);
};

describe("onInterrupted reports the still-active arm once per take (#478)", () => {
  /**
   * Comment strip is safe for `src/hooks/use-recorder.ts`:
   * `tests/recorder-resume-race.test.ts` established it holds no `//` or
   * `/*` inside a string literal, and the #478 template literal added here
   * contains neither (re-checked by grep for this PR).
   */
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  const startBody = bodyAfter(code, "const start = useCallback");
  const handlerDecl = "const onInterrupted = () => {";
  const handlerBody = bodyAfter(startBody, handlerDecl);

  /**
   * The ONE contiguous pattern: the `else if` on the still-active arm, its
   * once-guard, the guard being set, and the report under its own key. A
   * detached `if (!interruptionReported)` elsewhere, or a report with no
   * guard, cannot satisfy this. `[\s\S]*?` inside `new Error(...)` survives
   * a Prettier wrap of the message.
   */
  const reportPattern =
    /\}\s*else\s+if\s*\(\s*!interruptionReported\s*\)\s*\{\s*interruptionReported\s*=\s*true;\s*reportFailure\(\s*new Error\([\s\S]*?\),\s*"recorder-interrupted-active"\s*\);\s*\}/;

  it("(1) the handler body carries guard + set + report as one contiguous else-if", () => {
    expect(handlerBody).toMatch(reportPattern);
  });

  it('(2) the report sits on the else arm of `if (recorder.state === "inactive")`, never inside the inactive block', () => {
    const inactiveIf = 'if (recorder.state === "inactive") {';
    const inactiveStart = handlerBody.indexOf(inactiveIf);
    expect(inactiveStart).toBeGreaterThan(-1);
    const inactiveOpen = handlerBody.indexOf("{", inactiveStart);
    const inactiveClose = matchingBraceClose(handlerBody, inactiveOpen);
    expect(inactiveClose).toBeGreaterThan(inactiveOpen);

    // The inactive block — the device-verified #59 path — carries no report
    // at all. Moving the call inside it fails here directly.
    expect(handlerBody.slice(inactiveOpen, inactiveClose + 1)).not.toMatch(
      /reportFailure\s*\(/
    );
    // The pattern's leading `}` IS the inactive block's closing brace, so the
    // match begins exactly at that close and `else` immediately follows it:
    // the report is on the still-active arm of THIS if, not inside the
    // block and not on some other conditional later on.
    const reportAt = handlerBody.search(reportPattern);
    expect(reportAt).toBe(inactiveClose);
    expect(handlerBody.slice(inactiveClose + 1)).toMatch(/^\s*else\b/);
    expect(
      handlerBody.indexOf("reportFailure(", inactiveClose)
    ).toBeGreaterThan(inactiveClose);
  });

  it('(3) "recorder-interrupted-active" is one site in the file', () => {
    const hits = code.match(/"recorder-interrupted-active"/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("(4) the once-guard is a per-take local declared in start()'s closure before the handler, not inside it", () => {
    const decl = /let\s+interruptionReported\s*=\s*false\s*;/;
    const declAt = startBody.search(decl);
    expect(declAt).toBeGreaterThan(-1);
    // Inside the handler it would reset on every call, and `error` then
    // `ended` for one interruption would write two rows.
    expect(handlerBody).not.toMatch(decl);
    expect(declAt).toBeLessThan(startBody.indexOf(handlerDecl));
  });

  it("(5) the generation guard still precedes the report inside the handler", () => {
    const guardAt = handlerBody.search(
      /if\s*\(\s*generation\s*!==\s*generationRef\.current\s*\)\s*return\s*;/
    );
    expect(guardAt).toBeGreaterThan(-1);
    const reportAt = handlerBody.search(reportPattern);
    expect(reportAt).toBeGreaterThan(-1);
    // A superseded recorder's interruption never reports.
    expect(guardAt).toBeLessThan(reportAt);
  });
});

describe("stopRecording()'s backstop catch reaches the funnel (#480)", () => {
  /**
   * Comment strip safety for `src/hooks/use-audio-session.ts` had not been
   * established before this file (the two earlier gates checked only
   * use-recorder.ts). Checked for this PR: a grep for `//` or `/*` inside a
   * double-quoted, single-quoted or template literal in that file returned
   * no match, so the strip cannot truncate a literal and mis-isolate
   * `stopRecording`'s body.
   */
  const sourceUrl = new URL(
    "../src/hooks/use-audio-session.ts",
    import.meta.url
  );
  const raw = readFileSync(sourceUrl, "utf8");
  const code = stripComments(raw);

  const stopBody = bodyAfter(code, "const stopRecording = useCallback");

  /**
   * try → its catch → the report → the KEPT console.error, contiguous and in
   * that order. Deleting either line, swapping them, or moving the report
   * into an unrelated catch fails this. Report-before-log is pinned on
   * purpose: the funnel is the channel, the console line is the desk read.
   */
  const backstopPattern =
    /try\s*\{\s*return\s+await\s+endRecording\(\)\s*;\s*\}\s*catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-stop-backstop"\s*\);\s*console\.error\(\s*"Stopping the recorder failed",\s*cause\s*\);/;

  it("(1) the catch reports the cause first and keeps console.error beside it", () => {
    expect(stopBody).toMatch(backstopPattern);
  });

  it('(2) "recorder-stop-backstop" is one site in the file', () => {
    const hits = code.match(/"recorder-stop-backstop"/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("(3) reportFailure is the real import from ./report-failure, not a same-named local", () => {
    // The pattern above cannot be satisfied by a local no-op shadow if the
    // import is required to be present.
    expect(code).toMatch(
      /import\s*\{\s*reportFailure\s*\}\s*from\s*"\.\/report-failure"\s*;/
    );
    expect(code).not.toMatch(/(?:const|let|function)\s+reportFailure\b/);
  });
});
