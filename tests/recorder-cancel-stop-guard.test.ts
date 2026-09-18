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

  /**
   * True when `targetIndex` falls inside the braces of ANY `try { ... }`
   * block in `body`, regardless of what else that block contains or where
   * the target sits within it. Brace-counted (not "immediately after `try
   * {`") so a `try` block with an earlier, unrelated statement before the
   * target — `try { void 0; recorder.stop(); } catch (...) { ... }` — is
   * still caught (Frank round 5 P2, second pass: the prior "text
   * immediately before the call" check missed exactly this shape). Scanning
   * per `try` occurrence and bounding by that block's own matching brace —
   * not "any `try` anywhere in `body`" — keeps an unrelated `try` elsewhere
   * in the same executor from causing a false positive (Frank round 5 P2,
   * first pass).
   */
  const isInsideAnyTryBlock = (body: string, targetIndex: number): boolean => {
    const tryOpen = /\btry\b\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = tryOpen.exec(body)) !== null) {
      const blockOpen = match.index + match[0].length - 1;
      let blockDepth = 0;
      let blockClose = -1;
      for (let i = blockOpen; i < body.length; i++) {
        if (body[i] === "{") blockDepth++;
        else if (body[i] === "}") {
          blockDepth--;
          if (blockDepth === 0) {
            blockClose = i;
            break;
          }
        }
      }
      if (blockClose === -1) continue;
      if (targetIndex > blockOpen && targetIndex < blockClose) return true;
    }
    return false;
  };

  /**
   * The ONE pattern every positive assertion below is anchored to: a `try`
   * wrapping exactly `recorder.stop();`, flowing DIRECTLY (no `finally`, no
   * intervening statement) into a `catch (cause)` whose body is exactly the
   * `reportFailure` call. Contiguous, not "a try exists somewhere AND a
   * matching catch exists somewhere else in the body" — that decomposed
   * shape is satisfied by a `try { recorder.stop(); } finally {}` sitting
   * next to an UNRELATED `try { x(); } catch (cause) { reportFailure(cause,
   * "recorder-cancel-stop"); }`, which lets a throwing `stop()` propagate
   * uncaught while every assertion still passes (Frank round 5 P2, on the
   * decomposed version of this gate). Tying try/catch/report into one
   * contiguous regex closes that: no detached catch, and no unrelated
   * statement standing in for it, can satisfy this pattern.
   */
  const guardPattern =
    /try\s*\{\s*recorder\.stop\s*\(\s*\)\s*;\s*\}\s*catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-cancel-stop"\s*\);\s*\}/;

  it("wraps the native recorder.stop() call in cancel() inside a try that flows directly into its own catch", () => {
    // Deleting the `try` (leaving a bare `recorder.stop();`), or detaching
    // it from its catch (e.g. a `finally` in between), must fail this.
    expect(cancelBody).toMatch(guardPattern);
  });

  it('that same try flows into a catch that binds cause and calls reportFailure(cause, "recorder-cancel-stop")', () => {
    // Emptying the catch body, dropping the `cause` binding, changing the
    // context string, or — per Frank round 5 P2 — satisfying this from an
    // UNRELATED try/catch elsewhere in the body while the real try/finally
    // lets the throw through, must all fail this: the pattern requires the
    // catch to be the one directly following THIS try.
    expect(cancelBody).toMatch(guardPattern);
  });

  it("releaseStream() follows the try/catch, not the other way around", () => {
    // Both anchors must be found (indexOf === -1 fails the test outright,
    // never compares as "less than" and passes vacuously) before their
    // order is compared. Deleting the releaseStream() call, or moving it
    // above the try/catch, must fail this.
    const catchAnchor = cancelBody.search(guardPattern);
    const releaseAnchor = cancelBody.indexOf("releaseStream();");
    expect(catchAnchor).toBeGreaterThan(-1);
    expect(releaseAnchor).toBeGreaterThan(-1);
    expect(releaseAnchor).toBeGreaterThan(catchAnchor);
  });

  /**
   * PINS THE CURRENT DECISION, NOT A PERMANENT BAN. Frank round 5 P2 (3rd
   * pass) read this as claiming the flush-executor `stop()` must NEVER be
   * guarded — and objected that a future PR re-adding a guard there, on
   * real evidence (e.g. #478 showing the still-active interruption arm IS
   * reached on a device), would go red for a legitimate change.
   *
   * That is this repo's established gate shape, not a defect in it:
   * `tests/precache-manifest.test.ts`'s "matches the intended allowlist
   * exactly" pins today's decided `INTENDED` set the same way and says so
   * explicitly — "Changing the precached set is a deliberate act, and
   * updating INTENDED is how it is recorded" (precache-manifest.test.ts:
   * 136-138). This test plays the same role for the round-5 cap decision:
   * it pins that THIS hunk is reverted as of THIS PR, so a silent
   * reintroduction (a bad rebase, an errant cherry-pick, a merge conflict
   * resolved the wrong way) fails loudly instead of quietly undoing the
   * decision — not that the guard can never legitimately return. A future
   * PR that re-adds it on real evidence updates this test in the same
   * change, the same way `INTENDED` gets updated when `jpg` legitimately
   * re-enters the precache.
   */
  it("no try/catch remains around the flush-executor's recorder.stop() — the reverted hunk stays reverted (pins the round-5 decision; update this test in the same PR that legitimately re-adds a guard here)", () => {
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

    // The call is present and bare — not nested inside ANY try block in
    // this executor, no matter what else that block contains or where the
    // call sits within it (a leading unrelated statement before it still
    // counts as wrapped). Scoped to whichever `try` block, if any, actually
    // CONTAINS this call — not "no `try` anywhere in the executor" — so a
    // future, unrelated `try` guarding something else in this same executor
    // (constructing the Blob, arming the timer) stays legitimate and does
    // not fail this gate (Frank round 5 P2, first pass).
    const stopIdx = flushBody.indexOf("recorder.stop();");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(isInsideAnyTryBlock(flushBody, stopIdx)).toBe(false);
  });
});
