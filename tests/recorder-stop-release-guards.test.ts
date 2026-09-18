import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Three release-on-throw properties in `use-recorder.ts` (#59, PR #474,
 * #485):
 *
 *   1. `cancel()`'s native `recorder.stop()` call is guarded, so a throw
 *      there cannot skip `releaseStream()` (round-5 cap decision, option A —
 *      see the PR body and the dev-lead decision comment for the rest of
 *      that reduction).
 *   2. `stop()`'s bounded-flush `await new Promise<Blob>` is wrapped in a
 *      `try { ... } catch { ... } finally { ... }`: the `finally` releases
 *      the stream and the LOCAL tap `stop()` already stole out of the shared
 *      refs, so a throw from the executor cannot leave them stranded (George
 *      R5 P2, round 6); the `catch` — on the AWAIT — returns React state to
 *      `idle` when current, drops the recorder ref when it is still this
 *      recorder, and returns the failure in the `StopResult` instead of
 *      rethrowing, so the sheet is not stuck at `processing` behind a zombie
 *      ref that blocks the next `start()` (#485, George R6). The executor's
 *      OWN `recorder.stop()` call stays bare — guarding it would be the J7
 *      shape (correctness depends on the recorder's post-throw state) that
 *      rounds 3 and 4 oscillated on; the round-5 decision left it out, and
 *      neither round 6 nor #485 reopens it. Both the `finally` and the
 *      `catch` are a different, state-independent property (J6): once the
 *      executor throws, the blob promise is already rejected and the take is
 *      already lost, so nothing here reads `recorder.state` — the catch
 *      reasons only about the generation and the ref this invocation
 *      captured.
 *   3. The already-`"inactive"` arm (an interruption ended the recorder on
 *      its own) releases the stream and closes the same LOCAL tap after the
 *      blob is sealed (#485 finding 2).
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
 * flush await is wrapped in a `try`/`catch`/`finally` whose `catch` sets
 * idle, drops the ref and returns the failure, and whose `finally` releases
 * the stream and the literal local `tap?.close()`; that the flush `try`
 * holds no nested `try` and the catch reads no `recorder.state`; and that
 * the inactive arm closes the same local tap after the blob is sealed. It
 * does NOT prove any catch or finally behaves correctly at runtime, that
 * either call ever throws, or that any device has run this. The PR body says
 * the same.
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
 * Round 6 (George R5 P2) wrapped the flush executor's bounded `await new
 * Promise<Blob>` in `try { ... } finally { ... }`, and this describe pinned
 * "finally, NOT catch" — a `catch` around the same await was read as the
 * round-3/4 shape (a guard whose correctness branches on the recorder's
 * post-throw `state`, the J7 question the round-5 cap left out). #485
 * (George R6 on #474) supersedes that pin: the same throw ALSO rode out of
 * `stop()` with React state left at "processing" and `recorderRef` still
 * holding the dead recorder, so the sheet stayed `busy`, every Back stayed,
 * and a later `start()` returned early on the zombie ref. The fix is a
 * `catch` on the AWAIT — not on the executor's own `recorder.stop()`, which
 * stays bare — that sets `idle` (when current), drops the ref (when it is
 * still this recorder) and returns the failure in the `StopResult`. That
 * catch reads no `recorder.state`: once the executor throws the take is
 * already lost, so it reasons only about the generation and the ref this
 * invocation captured (J6). What separates J6 from J7 is therefore NOT
 * "catch vs finally" but two properties pinned below instead: the flush
 * `try` contains no nested `try` (the native call inside the executor is
 * bare), and neither the catch body nor the text between it and the
 * `finally` mentions `recorder.state`.
 *
 * Also #485 finding 2: the `finally`'s close was matched as any `.close()`,
 * so `tapRef.current?.close()` — a no-op after `stop()` stole the tap into
 * the local `tap` and nulled `tapRef` — passed the gate while the VU clone's
 * tracks stayed live (mutation run at origin/develop's test text: it passed
 * 6/6). And the already-`"inactive"` arm's own `tap?.close()` — the reason the
 * shared close was split in #474 — was not gated at all (deleting it also
 * passed 6/6). Both arms now pin the LOCAL `tap?.close()` literally: `tap` is
 * typed `LevelTap | null`, so `tap?.close()` is the only spelling that
 * typechecks, and `closeTap()` reads the ref `stop()` already nulled — after
 * the steal it is a no-op, and a NEWER recording's tap could be in that ref.
 */
describe("stop() releases the stolen stream and the LOCAL tap in both arms, and its flush-throw path returns to idle (#59 #474 R6, #485)", () => {
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
   * Isolate `stop()`'s own body, then BOTH arms of its `if/else` on
   * `recorder.state`: the `if` arm recovers an interruption's own
   * `"inactive"` end (no flush to await; gated since #485), the `else` arm
   * drives the bounded flush. Every assertion below checks ONE arm's wiring
   * specifically and not just "somewhere in the file" — `cancel()`'s guard
   * above also contains `recorder.stop()`, `try`, and `catch`-shaped text,
   * and each arm contains a `tap?.close()`, so a plain file-wide or
   * whole-`stop()` match could be satisfied by the wrong site.
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

  const ifLiteral = 'if (recorder.state === "inactive") {';
  const ifIdx = stopBody.indexOf(ifLiteral);
  if (ifIdx === -1) {
    throw new Error(
      "stop()'s inactive arm not found — has the if/else shape changed?"
    );
  }
  const ifBraceOpen = ifIdx + ifLiteral.length - 1;
  const ifBraceClose = matchingBraceClose(stopBody, ifBraceOpen);
  if (ifBraceClose === -1 || ifBraceClose <= ifBraceOpen) {
    throw new Error("stop()'s inactive arm closing brace not found");
  }
  const ifArmBody = stopBody.slice(ifBraceOpen, ifBraceClose + 1);

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
   * await, then what follows it. Since #485 that is `catch { ... }` and then
   * `finally { ... }`; each is located from the previous block's matching
   * close so the three are proven CONTIGUOUS, not merely present somewhere
   * in the branch.
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

  /**
   * The ONE contiguous pattern for the throw path (#485): the try's own
   * closing brace, flowing DIRECTLY into a `catch {` (no binding — the cause
   * is not reported on this path; see the source comment) whose body is
   * exactly, in order: the generation-gated `setState("idle")`, the
   * identity-gated `recorderRef.current = null`, and the literal three-field
   * return carrying the same sentence `stopRecording`'s backstop uses. It is
   * anchored by `search(...) === tryBraceClose` (the technique
   * `tests/recorder-failure-rows.test.ts` uses), so a detached catch, a
   * `finally` slid in between, or a matching catch on some OTHER try in the
   * branch cannot satisfy it. What it deliberately does NOT allow: a bare
   * `setState("idle")` (a superseded stop would repaint a newer recording's
   * screen), a bare `recorderRef.current = null` (accepted by George as
   * safe today, but the identity form is what stays safe if a future await
   * lands before the try), or a `throw`/rethrow in place of the return (the
   * `UseRecorder.stop` contract says the failure is in the result, and
   * `stopRecording` documents "never rejects").
   */
  const catchPattern =
    /\}\s*catch\s*\{\s*if\s*\(\s*generation\s*===\s*generationRef\.current\s*\)\s*setState\(\s*"idle"\s*\)\s*;\s*if\s*\(\s*recorderRef\.current\s*===\s*recorder\s*\)\s*recorderRef\.current\s*=\s*null\s*;\s*return\s*\{\s*samples:\s*null,\s*error:\s*"Could not finish this recording\.",\s*blob:\s*null,?\s*\}\s*;\s*\}/;

  const catchMatch = /^\s*catch\s*\{/.exec(afterTry);
  const catchBraceOpen =
    catchMatch === null
      ? -1
      : tryBraceClose + 1 + catchMatch.index + catchMatch[0].length - 1;
  const catchBraceClose =
    catchBraceOpen === -1 ? -1 : matchingBraceClose(elseBody, catchBraceOpen);
  const catchBody =
    catchBraceClose === -1
      ? ""
      : elseBody.slice(catchBraceOpen, catchBraceClose + 1);
  const afterCatch =
    catchBraceClose === -1 ? "" : elseBody.slice(catchBraceClose + 1);
  const finallyMatch = /^\s*finally\s*\{/.exec(afterCatch);
  const finallyBraceOpen =
    finallyMatch === null
      ? -1
      : catchBraceClose + 1 + finallyMatch.index + finallyMatch[0].length - 1;
  const finallyBraceClose =
    finallyBraceOpen === -1
      ? -1
      : matchingBraceClose(elseBody, finallyBraceOpen);
  const finallyBody =
    finallyBraceClose === -1
      ? ""
      : elseBody.slice(finallyBraceOpen, finallyBraceClose + 1);

  it("the flush await lives inside a try, and the source text still contains the recorder.stop() call it awaits", () => {
    // Both anchors independently checked before anything downstream assumes
    // they exist — a missing `try` or a missing call each get their own
    // clear failure rather than a confusing downstream crash.
    expect(tryIdx).toBeGreaterThan(-1);
    expect(tryBody).toMatch(/blob\s*=\s*await\s+new\s+Promise<Blob>/);
    expect(tryBody).toMatch(/recorder\.stop\s*\(\s*\)\s*;/);
  });

  it("that try flows directly into a catch that sets idle when current, drops the recorder ref when it is still this recorder, and returns the failure in the result (#485)", () => {
    // Deleting the `setState("idle")`, dropping its generation guard,
    // deleting the ref null or its identity guard, replacing the `return`
    // with a `throw`, or moving the three statements into the `finally` and
    // deleting the catch (then `afterTry` starts at `finally`) must all fail
    // this.
    expect(afterTry).toMatch(/^\s*catch\s*\{/);
    expect(elseBody.search(catchPattern)).toBe(tryBraceClose);
  });

  it("the catch is followed by a finally whose body releases the stream and closes the LOCAL tap, not the ref (#474 R6, #485)", () => {
    // The release stays a `finally`, state-independent (J6): it runs whether
    // the executor threw or resolved normally, after the catch body and
    // before the catch's return value is delivered.
    expect(finallyMatch).not.toBeNull();
    expect(finallyBraceClose).toBeGreaterThan(finallyBraceOpen);
    // Deleting either release call, or moving it back out of the finally
    // (reverting to a bare post-await release), must fail this.
    expect(finallyBody).toMatch(/abandonStream\(/);
    // Literally `tap?.close()`: `tapRef.current?.close()` and `closeTap()`
    // both read the ref `stop()` nulled before the await — a no-op that
    // leaves the VU clone's tracks live, and a newer recording's tap could
    // be in that ref. The old `/\.close\(\)/` let the first one through.
    expect(finallyBody).toMatch(/\btap\?\.close\(\)\s*;/);
    expect(finallyBody).not.toMatch(/closeTap\s*\(/);
    expect(finallyBody).not.toMatch(/tapRef/);
  });

  it("the catch reads nothing unobservable: no nested try inside the flush try, and no recorder.state in the catch or before the finally", () => {
    // This is what separates the #485 shape (J6: a catch on the AWAIT that
    // reasons only about the generation and the ref this invocation
    // captured) from the round-3/4 shape (J7: a try/catch around the native
    // `recorder.stop()` itself, branching on `recorder.state` afterward to
    // decide whether to seal now or keep waiting). The round-5 cap left J7
    // out and #485 does not reopen it; wrapping the executor's own
    // `recorder.stop()` in its own try, or adding an
    // `if (recorder.state === "inactive")` anywhere in the catch, must fail
    // this. The `if` arm's own `recorder.state` test sits outside `elseBody`
    // and cannot trip it.
    expect(tryBody.slice(1)).not.toMatch(/\btry\b/);
    expect(catchBody).not.toBe("");
    expect(catchBody).not.toMatch(/recorder\.state/);
    expect(afterTry.slice(0, afterTry.length - afterCatch.length)).not.toMatch(
      /recorder\.state/
    );
  });

  it("the already-inactive arm releases the stream and closes the LOCAL tap, after the blob is sealed (#485)", () => {
    // The `if` arm is the device-verified #59 recovery path (an interruption
    // ended the recorder on its own). Its `tap?.close()` was split out of the
    // shared post-if/else close in #474 R6 and was not gated at all —
    // deleting it left this file 6/6 green at origin/develop's text. The
    // order matters too: the clone's tracks are stopped only once the flush
    // window is past and the blob is sealed, so moving the close above
    // `blob = new Blob(` must fail this.
    expect(ifBraceClose).toBe(elseIdx); // the slice ends where `} else {` begins
    expect(ifArmBody).toMatch(
      /\bif\s*\(\s*stream\s*\)\s*abandonStream\(\s*stream\s*\)\s*;/
    );
    expect(ifArmBody).toMatch(/\btap\?\.close\(\)\s*;/);
    expect(ifArmBody).not.toMatch(/closeTap\s*\(/);
    expect(ifArmBody).not.toMatch(/tapRef/);
    const sealIdx = ifArmBody.indexOf("blob = new Blob(");
    expect(sealIdx).toBeGreaterThan(-1);
    expect(ifArmBody.search(/\btap\?\.close\(\)/)).toBeGreaterThan(sealIdx);
  });
});
