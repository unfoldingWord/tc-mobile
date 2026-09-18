import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `cancel()`'s native `MediaRecorder.stop()` call is guarded (#59, PR #474,
 * reduced at the round-5 cap to this one guard — see the PR body and the
 * dev-lead decision comment for the rest of the reduction). The `stop()`
 * flush hunk this file used to also cover was reverted to `develop`'s text
 * in the same change; the last case below pins that it stays reverted.
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. There is no `MediaRecorder`
 * and no renderer in this Node-only suite, so `cancel()` — a `useCallback`
 * inside `useRecorder()` — cannot be exercised at all, and a throw from the
 * native teardown call cannot be simulated. Removing the `try`/`catch` leaves
 * every other test in the repo green. That is precisely the
 * mutation-survives case AGENTS.md says to close with a gate rather than
 * leave to a reviewer's memory, and it is the same answer #108 reached one
 * function away — see `tests/recorder-resume-race.test.ts`'s "the wiring,
 * not just the helper", whose comment-stripping approach this mirrors.
 *
 * WHAT IT PROVES, EXACTLY: that the source text wraps `cancel()`'s native
 * `stop()` call, reports its failure through the funnel, and still releases
 * the stream afterward. It does NOT prove the catch behaves correctly at
 * runtime, that the call ever throws, or that any device has run this. The
 * PR body says the same.
 *
 * WHY THE GUARD EXISTS, so a future reader does not delete it as noise: an
 * uncaught throw from `cancel()`'s `recorder.stop()` would skip
 * `releaseStream()` on the next line and propagate out of `cancel()` into
 * `leave()`, whose contract is "synchronous and total — the microphone has
 * to be released in the same task as the tap". `cancel()` is what
 * `pagehide`, navigation and unmount all reach, so an unguarded throw there
 * would leave a hot microphone on a page that is going away. This is NOT a
 * spec-defined case: the current MediaStream Recording spec's `stop()`
 * algorithm defines no throw at all (step 2 is "if state is inactive, abort
 * these steps", not "throw" — see `src/hooks/use-recorder.ts`'s comment on
 * the guard for the citation). No engine in evidence throws from `stop()`.
 * The guard is insurance against an engine departing from the spec, not a
 * fix for an observed or spec-defined failure.
 */
describe("cancel()'s native recorder.stop() call is guarded (#59)", () => {
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);

  /**
   * Comments are stripped so the gate reads CODE, not prose about code: the
   * guard's own comments discuss `stop()` and throwing, and a naive match
   * would score documentation. Safe in this file specifically —
   * `tests/recorder-resume-race.test.ts` established that
   * `src/hooks/use-recorder.ts` contains no `//` or `/*` inside a string
   * literal, so the strip cannot misfire on one.
   */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  /**
   * Isolate `cancel()`'s own body (brace-counted from its declaration) so
   * every assertion below checks THIS callback's wiring specifically, not
   * just "somewhere in the file" — `stop()`'s flush executor also mentions
   * `recorder.stop()`, `reportFailure` and (transitively, via other call
   * sites in the file) similar shapes, and a plain file-wide match could be
   * satisfied by the wrong site.
   */
  const declStart = code.indexOf("const cancel = useCallback");
  if (declStart === -1) {
    throw new Error(
      "cancel() declaration not found — has it been renamed or moved?"
    );
  }
  const braceOpen = code.indexOf("{", declStart);
  if (braceOpen === -1) {
    throw new Error("cancel()'s opening brace not found");
  }
  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose === -1 || braceClose <= braceOpen) {
    throw new Error("cancel()'s closing brace not found");
  }
  const cancelBody = code.slice(braceOpen, braceClose + 1);

  it("wraps the native recorder.stop() call in cancel() inside a try", () => {
    // Deleting the `try` (leaving a bare `recorder.stop();`) must fail this.
    expect(cancelBody).toMatch(/try\s*\{\s*recorder\.stop\s*\(\s*\)\s*;/);
  });

  it('the catch binds cause and calls reportFailure(cause, "recorder-cancel-stop")', () => {
    // Emptying the catch body, or dropping the `cause` binding, or changing
    // the context string, must fail this.
    expect(cancelBody).toMatch(
      /catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-cancel-stop"\s*\);\s*\}/
    );
  });

  it("releaseStream() follows the try/catch, not the other way around", () => {
    // Both anchors must be found (indexOf === -1 fails the test outright,
    // never compares as "less than" and passes vacuously) before their
    // order is compared. Deleting the releaseStream() call, or moving it
    // above the try/catch, must fail this.
    const catchAnchor = cancelBody.search(
      /catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-cancel-stop"\s*\);\s*\}/
    );
    const releaseAnchor = cancelBody.indexOf("releaseStream();");
    expect(catchAnchor).toBeGreaterThan(-1);
    expect(releaseAnchor).toBeGreaterThan(-1);
    expect(releaseAnchor).toBeGreaterThan(catchAnchor);
  });

  it("no try/catch remains around the flush-executor's recorder.stop() — the reverted hunk stays reverted", () => {
    /**
     * Isolate the flush executor's own body the same way, so this checks
     * the SPECIFIC call site `stop()`'s bounded flush reverted back to
     * `develop`'s bare `recorder.stop();`, not the file as a whole (which
     * would also be satisfied if both call sites had been left guarded, or
     * both reverted, and would say nothing about which is which).
     */
    const flushDeclStart = code.indexOf("new Promise<Blob>");
    expect(flushDeclStart).toBeGreaterThan(-1);
    const flushBraceOpen = code.indexOf("{", flushDeclStart);
    expect(flushBraceOpen).toBeGreaterThan(-1);
    let flushDepth = 0;
    let flushBraceClose = -1;
    for (let i = flushBraceOpen; i < code.length; i++) {
      if (code[i] === "{") flushDepth++;
      else if (code[i] === "}") {
        flushDepth--;
        if (flushDepth === 0) {
          flushBraceClose = i;
          break;
        }
      }
    }
    expect(flushBraceClose).toBeGreaterThan(flushBraceOpen);
    const flushBody = code.slice(flushBraceOpen, flushBraceClose + 1);

    // The call is present and bare. Scoped to the text immediately BEFORE
    // this specific call, not "no `try` anywhere in the executor" — a
    // future, unrelated `try` guarding something else in this same
    // executor (constructing the Blob, arming the timer) would be
    // legitimate and must not fail this gate (Frank round 5 P2). Only a
    // `try {` whose next statement is this `recorder.stop()` call counts
    // as the reverted hunk coming back.
    const stopIdx = flushBody.indexOf("recorder.stop();");
    expect(stopIdx).toBeGreaterThan(-1);
    const immediatelyBefore = flushBody.slice(0, stopIdx);
    expect(immediatelyBefore).not.toMatch(/try\s*\{\s*$/);
  });
});
