import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bodyAfter, matchingBraceClose, stripComments } from "./support";

/**
 * Three recorder-path failure rows reach the funnel (`reportFailure`) from
 * code the Node suite cannot execute:
 *
 *   1. `onInterrupted` in `start()` (use-recorder.ts) reports ONE row per
 *      take, context key `"recorder-interrupted-active"`, when an
 *      interruption arrives while the native recorder is still
 *      `"recording"` or `"paused"` — the arm on which the handler releases
 *      nothing (#478, the #59 residual). The row names the two facts the
 *      handler can observe: `recorder.state` and `event.type` (`error` from
 *      the recorder or `ended` from a track), and carries the `error`
 *      feed's native `DOMException` as its `cause` (George R1 P3). Whether
 *      the mic is actually still hot on that arm is NOT observable there
 *      and the row does not claim it. The `"inactive"` arm — the
 *      device-verified #59 path — gets no row.
 *   2. `start()` itself (use-recorder.ts) reports ONE row under
 *      `"recorder-start-resume-timeout"` when `raceAudioResume()` resolved
 *      `true` (its 1000 ms timer won) AND the start is still the current
 *      generation after the await (#475; George R1 P2 moved the report out
 *      of the helper's timer so a cancelled start writes nothing).
 *   3. `stopRecording()`'s backstop `catch` (use-audio-session.ts) reports
 *      the cause under `"recorder-stop-backstop"`, with the existing
 *      `console.error` kept beside it, not replaced (#480; AGENTS.md
 *      "Errors have a channel before they have copy").
 *
 * A fourth, `"recorder-stop-flush"` (#485) — `stop()`'s own catch on its
 * bounded flush in use-recorder.ts — is pinned by
 * `tests/recorder-stop-release-guards.test.ts`, whose contiguous
 * catch-pattern already carries the report and the `console.error` beside
 * it, plus a one-site check on the key; it is not repeated here.
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
 * each report, on the arm and in the order specified, once — the #478
 * handler holds exactly one `reportFailure(` call site (assertion 6) and
 * its message interpolates `${event.type}` and `${recorder.state}`
 * (assertion 1's pattern). It does NOT
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

describe("source pins (text shape only): onInterrupted's still-active arm reports once per take (#478)", () => {
  /**
   * Comment strip is safe for `src/hooks/use-recorder.ts`:
   * `tests/recorder-resume-race.test.ts` established it holds no `//` or
   * `/*` inside a string literal, and the #478 template literal added here
   * contains neither (re-checked by grep for this PR).
   */
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  const startBody = bodyAfter(code, "const start = useCallback");
  // Both handler slots (`recorder.onerror`, `track.onended`) pass an Event;
  // the row reads `event.type` from it (#478 Shape).
  const handlerDecl = "const onInterrupted = (event: Event) => {";
  const handlerBody = bodyAfter(startBody, handlerDecl);

  /**
   * The ONE contiguous pattern: the `else if` on the still-active arm, its
   * once-guard, the guard being set, and the report under its own key. A
   * detached `if (!interruptionReported)` elsewhere, or a report with no
   * guard, cannot satisfy this. The `new Error(...)` segment requires a
   * template literal that interpolates `${event.type}` and then
   * `${recorder.state}` — the two facts beyond the key the row exists to
   * carry (#478 Shape: "the recorder state and which event arrived"). An
   * earlier `[\s\S]*?` admitted `new Error(``)` (panel r1 mutation M15,
   * 8/8 green). `[^`]` spans newlines, so a Prettier wrap still matches.
   *
   * The `{ cause: "error" in event ? event.error : undefined }` segment is
   * George R1 P3: the `error` feed's event carries the native failure as
   * `.error` (`ErrorEvent.error` in lib.dom — `MediaRecorderErrorEvent` is
   * not declared at TypeScript 5.9.3, so the narrowing is structural), and
   * `describeCause` (lib/failure-text.ts) walks `.cause`, so the durable row
   * names the `DOMException` (`NotReadableError`, `InvalidStateError`, …)
   * instead of only "an error arrived". The `ended` feed has no such field
   * and the ternary's `undefined` arm keeps that row's shape unchanged.
   */
  const reportPattern =
    /\}\s*else\s+if\s*\(\s*!interruptionReported\s*\)\s*\{\s*interruptionReported\s*=\s*true;\s*reportFailure\(\s*new Error\(\s*`[^`]*\$\{event\.type\}[^`]*\$\{recorder\.state\}[^`]*`\s*,\s*\{\s*cause:\s*"error"\s+in\s+event\s*\?\s*event\.error\s*:\s*undefined\s*,?\s*\}\s*\),\s*"recorder-interrupted-active"\s*\);\s*\}/;

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

  it("(6) the handler holds exactly one report site and sets the once-guard exactly once", () => {
    // (1)-(3) pin the guarded else-if and its key, but none of them counts
    // CALLS: a second, unguarded `reportFailure(...)` placed before the arm
    // split, under any other key, passed all of them (panel r1 mutation:
    // inserted after `setState("processing")`, 8/8 green). That shape
    // writes a row per lifecycle event — `error` AND every `ended` — and on
    // the inactive arm too, breaking both halves of #478 constraint (1).
    // Counting the handler's call sites is what closes it.
    expect(handlerBody.match(/reportFailure\s*\(/g) ?? []).toHaveLength(1);
    expect(
      handlerBody.match(/interruptionReported\s*=\s*true/g) ?? []
    ).toHaveLength(1);
  });

  it("(7) reportFailure is the real import from ./report-failure, not a same-named local", () => {
    // Mirrors the #480 gate's (3): the contiguous pattern in (1) is satisfied
    // by ANY `reportFailure(` text, so a local no-op declared in this file
    // (or in `start()`'s closure) would pass (1)-(6) and write no row. The
    // import must be present and no declaration may shadow it.
    expect(code).toMatch(
      /import\s*\{\s*reportFailure\s*\}\s*from\s*"\.\/report-failure"\s*;/
    );
    expect(code).not.toMatch(/(?:const|let|function)\s+reportFailure\b/);
  });
});

describe("source pins (text shape only): start() writes the resume-timeout row itself, after its generation check (#475, George R1 P2; raceAudioResume moved to audio-io.ts for #469)", () => {
  /**
   * WHY THE ROW MOVED OUT OF `raceAudioResume` (George R1 P2). The helper's
   * timer used to call `reportFailure` directly. `cancel()` bumps
   * `generationRef` and releases the stream but never holds that timer, and
   * a Close / Back / `pagehide` while `"requesting"` does not route through
   * `stopRecording()` (`attemptsCapture("requesting")` is false in
   * `lib/takes/close-plan.ts`), so a Record tap abandoned inside the
   * 1000 ms wait still landed a durable #108 row and lit the Books `≡` for
   * a start that had already been discarded. The helper has no generation
   * to check; `start()` does. So `raceAudioResume` now resolves `true` when
   * its timer won, and `start()` reports — after the same generation check
   * it already made after the await, so a cancelled or superseded start
   * reports nothing. The wait itself stays un-aborted (the original #108
   * defect was an unbounded wait, and a cancelled start() must still never
   * hang on a `resume()` that never settles).
   *
   * `tests/recorder-resume-race.test.ts` proves the helper's half at
   * runtime (the boolean, and that its timer branch is silent). This gate
   * pins `start()`'s half, which the Node suite cannot execute: the awaited
   * boolean, the report sitting CONTIGUOUSLY after the generation check
   * (not before it, not elsewhere), the message naming the bound, and the
   * key being one site in the file that is NOT inside `raceAudioResume`.
   *
   * MOVED (#469): `raceAudioResume` now lives in `audio-io.ts` (playSamples
   * needs the identical bound), generalized to take a
   * `rejectionContextKey` argument instead of hardcoding
   * `"recorder-start-resume"` — so its own body no longer contains that
   * literal at all, and assertion (3) below checks the parameterized shape
   * (`reportFailure(cause, rejectionContextKey)`) against `audio-io.ts`
   * rather than the old hardcoded string against `use-recorder.ts`.
   */
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const code = stripComments(readFileSync(sourceUrl, "utf8"));
  const audioIoSourceUrl = new URL("../src/hooks/audio-io.ts", import.meta.url);
  const raceBody = bodyAfter(
    stripComments(readFileSync(audioIoSourceUrl, "utf8")),
    "function raceAudioResume"
  );

  const startBody = bodyAfter(code, "const start = useCallback");

  const awaitPattern =
    /const\s+resumeTimedOut\s*=\s*await\s+raceAudioResume\s*\(\s*"recorder-start-resume"\s*\)\s*;/;

  /**
   * ONE contiguous pattern: the generation check that follows the await
   * (its exact `abandonStream(stream); return false;` body), then the
   * `if (resumeTimedOut)` report under its own key with a message that
   * interpolates the bound constant. Moving the report above the check,
   * detaching it from the check, or dropping it cannot satisfy this.
   */
  const gatedReportPattern =
    /if\s*\(\s*generation\s*!==\s*generationRef\.current\s*\)\s*\{\s*abandonStream\(\s*stream\s*\)\s*;\s*return\s+false\s*;\s*\}\s*if\s*\(\s*resumeTimedOut\s*\)\s*\{\s*reportFailure\(\s*new Error\(\s*`[^`]*\$\{RESUME_TIMEOUT_MS\}[^`]*`\s*\),\s*"recorder-start-resume-timeout"\s*\)\s*;\s*\}/;

  it("(1) start() captures raceAudioResume()'s boolean from its one awaited call, passing its own rejection-context key", () => {
    expect(startBody).toMatch(awaitPattern);
    expect(startBody.match(/await\s+raceAudioResume\s*\(/g) ?? []).toHaveLength(
      1
    );
  });

  it("(2) the report is contiguous with, and AFTER, the generation check that directly follows the await", () => {
    const awaitMatch = startBody.match(awaitPattern);
    expect(awaitMatch).not.toBeNull();
    const awaitAt = startBody.search(awaitPattern);
    const reportAt = startBody.search(gatedReportPattern);
    expect(reportAt).toBeGreaterThan(awaitAt);
    // Nothing but whitespace between the await and the check+report: the
    // check the report sits behind IS the one absorbing a cancel() that
    // landed during the wait, not some later generation check in start().
    const awaitEnd = awaitAt + (awaitMatch as RegExpMatchArray)[0].length;
    expect(startBody.slice(awaitEnd, reportAt)).toMatch(/^\s*$/);
  });

  it('(3) "recorder-start-resume-timeout" is one site in the file, inside start(), and is NEVER inside raceAudioResume\'s own (audio-io.ts) body', () => {
    expect(code.match(/"recorder-start-resume-timeout"/g) ?? []).toHaveLength(
      1
    );
    expect(startBody).toMatch(/"recorder-start-resume-timeout"/);
    expect(raceBody).not.toMatch(/recorder-start-resume-timeout/);
    // The timer branch reports nothing: the helper's single report site is
    // the rejection branch, under the CALLER'S key — a parameter, not a
    // hardcoded literal, since playSamples (#469) passes its own
    // ("playback-resume").
    expect(raceBody.match(/reportFailure\s*\(/g) ?? []).toHaveLength(1);
    expect(raceBody).toMatch(
      /reportFailure\(\s*cause\s*,\s*rejectionContextKey\s*\)/
    );
  });
});

describe("source pins (text shape only): stopRecording()'s backstop catch reports to the funnel (#480)", () => {
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
