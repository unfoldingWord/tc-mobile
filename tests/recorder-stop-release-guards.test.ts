import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Two release-on-throw properties in `use-recorder.ts` (#59, PR #474):
 *
 *   1. `cancel()`'s native `recorder.stop()` call is guarded, so a throw
 *      there cannot skip `releaseStream()` (round-5 cap decision, option A —
 *      see the PR body and the dev-lead decision comment for the rest of
 *      that reduction).
 *   2. `stop()`'s bounded-flush `await new Promise<Blob>` is wrapped in a
 *      `try { ... } finally { ... }` whose `finally` releases the stream and
 *      tap `stop()` already stole out of the shared refs, so a throw from
 *      the executor cannot leave them stranded (George R5 P2, round 6). The
 *      executor's OWN `recorder.stop()` call stays bare — guarding it would
 *      be the J7 shape (correctness depends on the recorder's post-throw
 *      state) that rounds 3 and 4 oscillated on; the round-5 decision left
 *      it out, and round 6 does not reopen it. A `try`/`finally` around the
 *      whole await is a different, state-independent property (J6): once
 *      the executor throws, the blob promise is already rejected and the
 *      take is already lost, so releasing in a `finally` cannot truncate
 *      anything that wasn't already gone.
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. There is no `MediaRecorder`
 * and no renderer in this Node-only suite, so `cancel()` and `stop()` — both
 * `useCallback`s inside `useRecorder()` — cannot be exercised at all, and a
 * throw from either native teardown call cannot be simulated. Removing
 * either guard leaves every other test in the repo green. That is precisely
 * the mutation-survives case AGENTS.md says to close with a gate rather than
 * leave to a reviewer's memory, and it is the same answer #108 reached one
 * function away — see `tests/recorder-resume-race.test.ts`'s "the wiring,
 * not just the helper", whose comment-stripping approach this mirrors.
 *
 * WHAT IT PROVES, EXACTLY: that the source text wraps `cancel()`'s native
 * `stop()` call and reports its failure through the funnel; that `stop()`'s
 * flush await is wrapped in a `try`/`finally` whose `finally` releases both
 * the stream and the tap; and that the flush executor's own `recorder.stop()`
 * call is not itself inside any `try`/`catch`. It does NOT prove either catch
 * or finally behaves correctly at runtime, that either call ever throws, or
 * that any device has run this. The PR body says the same.
 *
 * WHY THE GUARDS EXIST, so a future reader does not delete them as noise:
 *
 *   - An uncaught throw from `cancel()`'s `recorder.stop()` would skip
 *     `releaseStream()` on the next line and propagate out of `cancel()`
 *     into `leave()`, whose contract is "synchronous and total — the
 *     microphone has to be released in the same task as the tap". `cancel()`
 *     is what `pagehide`, navigation and unmount all reach, so an unguarded
 *     throw there would leave a hot microphone on a page that is going away.
 *   - An uncaught throw from `stop()`'s flush executor would skip the
 *     stream/tap release that otherwise runs right after the await: `stop()`
 *     steals both out of the shared refs before the await
 *     (`streamRef.current = null` / `tapRef.current = null`), so a
 *     `cancel()` landing after such a throw finds both refs already null and
 *     releases neither — the original tracks AND the VU clone stay live for
 *     the life of the page (George R5 P2).
 *
 * Neither is a spec-defined case: the current MediaStream Recording spec's
 * `stop()` algorithm defines no throw at all (step 2 is "if state is
 * inactive, abort these steps", not "throw" — see `src/hooks/use-recorder.ts`'s
 * comments on both guards for the citation). No engine in evidence throws
 * from `stop()`. Both guards are insurance against an engine departing from
 * the spec, not a fix for an observed or spec-defined failure.
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

  it("releaseStream() runs unconditionally after the guarded if-block, not nested inside it", () => {
    // A textual "releaseStream() appears after the try/catch" check is not
    // enough (Frank round 5 P2, 4th pass): moving the call INSIDE the
    // `if (recorder && recorder.state !== "inactive")` block, right after
    // the catch, would still leave every anchor in textual order — but then
    // a null `recorder`, or one already `"inactive"`, skips releaseStream()
    // entirely, exactly the hot-mic casualty this gate exists to prevent.
    // So this locates the if-guard's OWN closing brace by brace-counting
    // from its declaration, and requires releaseStream() to sit strictly
    // after it — i.e. outside the conditional, unconditional on the
    // recorder's state.
    const ifGuardStart = cancelBody.indexOf(
      'if (recorder && recorder.state !== "inactive")'
    );
    expect(ifGuardStart).toBeGreaterThan(-1);
    const ifBraceOpen = cancelBody.indexOf("{", ifGuardStart);
    expect(ifBraceOpen).toBeGreaterThan(-1);
    let ifDepth = 0;
    let ifBraceClose = -1;
    for (let i = ifBraceOpen; i < cancelBody.length; i++) {
      if (cancelBody[i] === "{") ifDepth++;
      else if (cancelBody[i] === "}") {
        ifDepth--;
        if (ifDepth === 0) {
          ifBraceClose = i;
          break;
        }
      }
    }
    expect(ifBraceClose).toBeGreaterThan(ifBraceOpen);

    // The guard itself must still live inside this if-block (ties this test
    // to the same guard the others pin, not some other unrelated if).
    const guardAnchor = cancelBody.search(guardPattern);
    expect(guardAnchor).toBeGreaterThan(ifBraceOpen);
    expect(guardAnchor).toBeLessThan(ifBraceClose);

    const releaseAnchor = cancelBody.indexOf("releaseStream();");
    expect(releaseAnchor).toBeGreaterThan(-1);
    // Deleting the call, moving it above the guard, or nesting it inside
    // the if-block (Frank's exact scenario) must all fail this.
    expect(releaseAnchor).toBeGreaterThan(ifBraceClose);
  });
});

/**
 * Round 6 (George R5 P2): the flush executor's bounded `await new
 * Promise<Blob>` is wrapped in `try { ... } finally { ... }`. This replaces
 * round 5's "no try/catch remains around the flush-executor's
 * `recorder.stop()`" case, which pinned the WRONG property once the round-6
 * fix landed — that case would now fail on the CORRECT code, since the
 * executor sits inside a `try` (the outer one wrapping the whole await), even
 * though the executor's own `recorder.stop()` call is still bare. The
 * property that actually matters is pinned below instead: the outer
 * try/finally exists and releases both the stream and the tap, and the
 * native call itself is not additionally wrapped in a `try`/`catch` of its
 * own (a `finally` around the whole await is fine — round 6 does not reopen
 * the J7 question rounds 3/4 oscillated on).
 */
describe("stop()'s flush await releases the stolen stream and tap even when it throws (#59, George R5 P2)", () => {
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  /** Brace-counts from `openIndex` (the index of an opening `{`) to find its
   *  matching close. Shared by every isolation step below. */
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

  /**
   * Isolate `stop()`'s own body, then its `else` branch (the
   * `recorder.state !== "inactive"` arm — the `if` branch, recovering an
   * interruption's own `"inactive"` end, has no flush to await and is
   * untouched by this round), so every assertion below checks THIS branch's
   * wiring specifically and not just "somewhere in the file" — `cancel()`'s
   * guard above also contains `recorder.stop()`, `try`, and `catch`-shaped
   * text, and a plain file-wide match could be satisfied by the wrong site.
   */
  const stopDeclStart = code.indexOf("const stop = useCallback");
  if (stopDeclStart === -1) {
    throw new Error(
      "stop() declaration not found — has it been renamed or moved?"
    );
  }
  const stopBraceOpen = code.indexOf("{", stopDeclStart);
  if (stopBraceOpen === -1) {
    throw new Error("stop()'s opening brace not found");
  }
  const stopBraceClose = matchingBraceClose(code, stopBraceOpen);
  if (stopBraceClose === -1 || stopBraceClose <= stopBraceOpen) {
    throw new Error("stop()'s closing brace not found");
  }
  const stopBody = code.slice(stopBraceOpen, stopBraceClose + 1);

  const elseIdx = stopBody.indexOf("} else {");
  if (elseIdx === -1) {
    throw new Error(
      "stop()'s else branch not found — has the if/else shape changed?"
    );
  }
  const elseBraceOpen = stopBody.indexOf("{", elseIdx + "} else".length);
  if (elseBraceOpen === -1) {
    throw new Error("stop()'s else branch opening brace not found");
  }
  const elseBraceClose = matchingBraceClose(stopBody, elseBraceOpen);
  if (elseBraceClose === -1 || elseBraceClose <= elseBraceOpen) {
    throw new Error("stop()'s else branch closing brace not found");
  }
  const elseBody = stopBody.slice(elseBraceOpen, elseBraceClose + 1);

  /**
   * Within the else branch, find the `try { ... }` that wraps the flush
   * await, and — distinctly — whether it is followed by `catch` or
   * `finally`. Reused by both assertions below: (a) needs the `finally`
   * block's own contents; (b) needs to know the wrapping is a `finally`, not
   * a `catch`, so a future `catch` reintroduced around the same await (the
   * round 3/4 shape) is caught as a DIFFERENT defect from either of these
   * two cases, not silently accepted as "some kind of try is here, fine".
   */
  const tryIdx = elseBody.indexOf("try {");
  if (tryIdx === -1) {
    throw new Error(
      "the flush await's wrapping try not found — has the round-6 fix been reverted?"
    );
  }
  const tryBraceOpen = elseBody.indexOf("{", tryIdx);
  const tryBraceClose = matchingBraceClose(elseBody, tryBraceOpen);
  if (tryBraceClose === -1 || tryBraceClose <= tryBraceOpen) {
    throw new Error("the flush await's try block closing brace not found");
  }
  const tryBody = elseBody.slice(tryBraceOpen, tryBraceClose + 1);

  const afterTry = elseBody.slice(tryBraceClose + 1);
  const finallyMatch = /^\s*finally\s*\{/.exec(afterTry);

  it("the flush await lives inside a try, and the source text still contains the recorder.stop() call it awaits", () => {
    // Both anchors independently checked before anything downstream assumes
    // they exist — a missing `try` or a missing call each get their own
    // clear failure rather than a confusing downstream crash.
    expect(tryIdx).toBeGreaterThan(-1);
    expect(tryBody).toMatch(/blob\s*=\s*await\s+new\s+Promise<Blob>/);
    expect(tryBody).toMatch(/recorder\.stop\s*\(\s*\)\s*;/);
  });

  it("that try is followed by a finally (not a catch) whose body releases both the stream and the tap", () => {
    // Deliberately `finally`, not `catch`: George R5 P2's fix is
    // state-independent (J6) — it releases regardless of whether the
    // executor threw or resolved normally, not "if it threw, then release".
    // A `catch` here would only run on a throw and skip the release on the
    // (also load-bearing) normal-completion path, which already relies on
    // this same release happening.
    expect(finallyMatch).not.toBeNull();
    const finallyBraceOpen =
      tryBraceClose +
      1 +
      (finallyMatch?.index ?? 0) +
      (finallyMatch?.[0].length ?? 0) -
      1;
    expect(finallyBraceOpen).toBeGreaterThan(tryBraceClose);
    const finallyBraceClose = matchingBraceClose(elseBody, finallyBraceOpen);
    expect(finallyBraceClose).toBeGreaterThan(finallyBraceOpen);
    const finallyBody = elseBody.slice(finallyBraceOpen, finallyBraceClose + 1);

    // Deleting either release call, or moving it back out of the finally
    // (reverting to a bare post-await release), must fail this.
    expect(finallyBody).toMatch(/abandonStream\(/);
    expect(finallyBody).toMatch(/\.close\(\)/);
  });

  it("the executor's own recorder.stop() call is not itself inside any try/catch (a try/finally around the whole await is fine)", () => {
    // Distinguishes the round-6 shape (a try/FINALLY around the whole await,
    // with the native call bare inside it) from the round-3/4 shape (a
    // try/CATCH around the native call itself, branching on
    // `recorder.state` afterward) — the latter is the J7 property the
    // round-5 decision explicitly left out and round 6 does not reopen.
    // Only a `try` block that is itself followed by `catch` counts here;
    // the outer try/finally this call sits inside must NOT trip this.
    const isInsideAnyTryCatchBlock = (
      body: string,
      targetIndex: number
    ): boolean => {
      const tryOpen = /\btry\b\s*\{/g;
      let match: RegExpExecArray | null;
      while ((match = tryOpen.exec(body)) !== null) {
        const blockOpen = match.index + match[0].length - 1;
        const blockClose = matchingBraceClose(body, blockOpen);
        if (blockClose === -1) continue;
        const isCatch = /^\s*catch\b/.test(body.slice(blockClose + 1));
        if (isCatch && targetIndex > blockOpen && targetIndex < blockClose) {
          return true;
        }
      }
      return false;
    };

    const stopIdx = elseBody.indexOf("recorder.stop();");
    expect(stopIdx).toBeGreaterThan(-1);
    expect(isInsideAnyTryCatchBlock(elseBody, stopIdx)).toBe(false);
  });
});
