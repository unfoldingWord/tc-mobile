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
 *      `try { ... } catch (cause) { ... } finally { ... }`: the `finally`
 *      clears the flush timer and releases the stream and the LOCAL tap
 *      `stop()` already stole out of the shared refs, so a throw from the
 *      executor cannot leave them stranded (George R5 P2, round 6); the
 *      `catch` — on the AWAIT — reports the cause under
 *      `"recorder-stop-flush"` with `console.error` beside it, drops the
 *      recorder ref when it is still this recorder, marks `flushThrew`, and
 *      SEALS the slices MediaRecorder already delivered into `blob` from the
 *      local `chunks` — the same seal the timeout arm uses — then falls
 *      through to `stop()`'s ordinary tail (idle when current; empty →
 *      notice, undecodable → hold with the bytes, decodable → the take)
 *      instead of returning early with `blob: null`, so a throw cannot
 *      discard a take whose slices are in hand and cannot leave the sheet
 *      stuck at `processing` behind a zombie ref that blocks the next
 *      `start()` (#485, George R6; panel r1 P2 on PR #500). The tail's
 *      three exits each write `setState("idle")` behind the `current`
 *      gate, and that write is pinned too (panel r2 P2 on #500: deleting
 *      it had left every case green). The executor's
 *      OWN `recorder.stop()` call stays bare — guarding it would be the J7
 *      shape (correctness depends on the recorder's post-throw state) that
 *      rounds 3 and 4 oscillated on; the round-5 decision left it out, and
 *      neither round 6 nor #485 reopens it. Both the `finally` and the
 *      `catch` are a different, state-independent property (J6): once the
 *      executor throws there is no `onstop` left to await, so nothing here
 *      reads `recorder.state` — the catch reasons only about the ref this
 *      invocation captured and the `chunks`/`mimeType` locals the timeout
 *      arm already relies on.
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
 * flush await is wrapped in a `try`/`catch (cause)`/`finally` whose `catch`
 * reports the cause, drops the ref, marks `flushThrew` and seals `blob` from
 * `chunks` without returning or throwing, and whose `finally` clears the
 * timer and releases the stream and the literal local `tap?.close()`; that
 * the flush `try` holds no nested `try` and the catch reads no
 * `recorder.state`; that the tail's empty-capture exit picks its sentence on
 * `flushThrew`; that each of the tail's three exits writes `setState("idle")`
 * behind its `current` gate and returns straight after; and that the
 * inactive arm closes the same local tap after the blob is sealed. It does
 * NOT prove any catch or finally behaves
 * correctly at runtime, that either call ever throws, or that any device has
 * run this. The PR body says the same.
 *
 * THE GATE IS DELIBERATELY LITERAL. Every pattern below pins one canonical
 * spelling of each statement, not the set of spellings that would also be
 * correct — a refinement of the catch (a different context key, a differently
 * ordered body) lands as a source change AND a gate change in the same
 * commit, and this file going red on correct code is the intended, loud
 * signal for that, never a silent pass. The PR body for #500 records the
 * same.
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
 * stays bare. PR #500's first cut had that catch RETURN `{ samples: null,
 * error, blob: null }` on the premise that "no bytes were sealed, so there
 * are no bytes to keep"; panel r1 (P2) showed the premise false on any
 * engine that honours `recorder.start(250)`: the local `chunks` holds every
 * slice delivered before the throw, and the timeout arm of the SAME
 * executor already seals exactly that array. So the catch now reports the
 * cause (`"recorder-stop-flush"`, `console.error` beside it), drops the ref
 * (when it is still this recorder), marks `flushThrew`, seals `blob` from
 * `chunks` and falls through to the ordinary tail, which sets `idle` when
 * current and turns the bytes into a notice, a hold or a take. That catch
 * reads no `recorder.state`: once the executor throws there is no `onstop`
 * left to await, so it reasons only about the ref and the locals this
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
 * passed 6/6). Both arms now pin the LOCAL `tap?.close()` literally. That is
 * the one canonical spelling this gate chooses so the match can be literal
 * (`if (tap) tap.close();` would also typecheck against `LevelTap | null` and
 * also release the clone; it is simply not the spelling pinned here — panel
 * r1 on PR #500), and it excludes `closeTap()`, which reads the ref `stop()`
 * already nulled — after the steal it is a no-op, and a NEWER recording's
 * tap could be in that ref.
 */
describe("stop() releases the stolen stream and the LOCAL tap in both arms, and its flush-throw path reports, seals what it has and falls through to a tail that returns to idle (#59 #474 R6, #485, panel r1, panel r2)", () => {
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
   * await, then what follows it. Since #485 that is `catch (cause) { ... }` and then
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
   * The ONE contiguous pattern for the throw path (#485, panel r1 on #500;
   * yield added #485 Frank r2 P2 on #500; ORDER pinned to match the
   * inactive arm above, #500 round 3, George r2 G-R2-P2-1, DRI decision
   * 2026-09-19 option A): the try's own closing brace, flowing DIRECTLY into
   * a `catch (cause) {` whose body is exactly, in order: the funnel report
   * under `"recorder-stop-flush"` with `console.error` kept beside it
   * (AGENTS.md "Errors have a channel", the shape `cancel()`'s guard and
   * `stopRecording`'s backstop both use), the identity-gated
   * `recorderRef.current = null`, the `flushThrew = true` mark the tail's
   * empty-capture exit reads for its sentence, `if (stream)
   * abandonStream(stream);` — stopping the stolen tracks BEFORE the yield,
   * not after the seal, is what makes this arm's release order identical to
   * the already-`"inactive"` arm a few lines above it in `stop()` (that arm:
   * abandon the stream, yield, seal, close the tap — see the "already-inactive
   * arm" test above) — ONE macrotask yield (`await new Promise((resolve) =>
   * setTimeout(resolve, 0))`) — a synchronous throw does not prove
   * `dataavailable`/`stop` were not already queued, so this gives a slice
   * already in flight the same one-tick window the inactive arm yields
   * before it seals — and THEN the seal of `blob` from the local `chunks`,
   * the same `new Blob(chunks, { type: recorder.mimeType })` the timeout
   * arm's `finish` builds. The tap is NOT closed in this arm at all — it
   * closes after the seal, in `finally`, same as every other exit from this
   * `else` branch. No `return`, no `throw`: the catch falls through to the
   * tail. It is anchored by `search(...) === tryBraceClose` (the technique
   * `tests/recorder-failure-rows.test.ts` uses), so a detached catch, a
   * `finally` slid in between, or a matching catch on some OTHER try in the
   * branch cannot satisfy it. What it deliberately does NOT allow: a bare
   * `catch {` (the throw would be swallowed with no evidence path — the one
   * event this insurance arm exists to learn about), a bare
   * `recorderRef.current = null` (the identity form is what stays safe if a
   * future await lands before the try), an early `return { …, blob: null }`
   * (discards the slices in hand — the P2 that reshaped this), a
   * `throw`/rethrow (the `UseRecorder.stop` contract says the failure is in
   * the result, and `stopRecording` documents "never rejects"), sealing
   * `blob` IMMEDIATELY after `flushThrew = true` with no yield between them
   * (Frank r2 P2: a queued final slice that lands after an immediate seal is
   * silently omitted), or — the property THIS round adds — abandoning the
   * stream AFTER the yield/seal instead of before them (George r2 G-R2-P2-1:
   * on an engine where the stolen tracks stopping is itself what flushes a
   * still-pending final blob, releasing them only after the seal would seal
   * `[]`). This gate pins the shape George's finding names, not a new rule of
   * its own; it makes no claim about what any engine does after `stop()`
   * throws — the current spec defines no throw at all, and no engine in
   * evidence departs from that.
   */
  const catchPattern =
    /\}\s*catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-stop-flush"\s*\);\s*console\.error\(\s*"Stopping the recorder failed",\s*cause\s*\);\s*if\s*\(\s*recorderRef\.current\s*===\s*recorder\s*\)\s*recorderRef\.current\s*=\s*null\s*;\s*flushThrew\s*=\s*true\s*;\s*if\s*\(\s*stream\s*\)\s*abandonStream\(\s*stream\s*\)\s*;\s*await\s+new\s+Promise\(\s*\(\s*resolve\s*\)\s*=>\s*setTimeout\(\s*resolve,\s*0\s*\)\s*\)\s*;\s*blob\s*=\s*new\s+Blob\(\s*chunks,\s*\{\s*type:\s*recorder\.mimeType,?\s*\}\s*\)\s*;\s*\}/;

  const catchMatch = /^\s*catch\s*\(\s*cause\s*\)\s*\{/.exec(afterTry);
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

  it("that try flows directly into a catch (cause) that reports the row, drops the recorder ref when it is still this recorder, marks flushThrew, abandons the stream, yields, and seals blob from chunks in that order — no return, no throw (#485, panel r1; order #500 round 3)", () => {
    // Dropping the `cause` binding, deleting the `reportFailure` or the
    // `console.error`, deleting the ref null or its identity guard, deleting
    // the `flushThrew` mark, deleting the `abandonStream` call or moving it
    // to after the yield/seal (George r2 G-R2-P2-1), deleting the seal,
    // returning early with `blob: null` (the first cut), replacing the seal
    // with a `throw`, or moving the statements into the `finally` and
    // deleting the catch (then `afterTry` starts at `finally`) must all fail
    // this.
    expect(afterTry).toMatch(/^\s*catch\s*\(\s*cause\s*\)\s*\{/);
    expect(elseBody.search(catchPattern)).toBe(tryBraceClose);
    expect(catchBody).not.toMatch(/\breturn\b/);
    expect(catchBody).not.toMatch(/\bthrow\b/);
  });

  it('"recorder-stop-flush" is one site in the file, and the tail\'s empty-capture exit picks its code on flushThrew (#485, panel r1)', () => {
    // One row key, one site: a second site would double-report the same
    // throw. The code: an empty seal after a throw is "unfinished" (the
    // engine failed), not "silence" (which reads as the translator's own).
    // Since #169 the sentences live in `lib/strings.ts` and the hook
    // emits only the code, so this now pins the CODE the exit picks; the
    // words it maps to are pinned in `tests/capture-failure-copy.test.ts`.
    // `flushThrew` is declared in stop()'s body before the try, so the flag
    // is per invocation.
    const hits = code.match(/"recorder-stop-flush"/g) ?? [];
    expect(hits).toHaveLength(1);
    expect(stopBody).toMatch(/\blet\s+flushThrew\s*=\s*false\s*;/);
    expect(stopBody.indexOf("let flushThrew")).toBeLessThan(
      stopBody.indexOf("try {")
    );
    const afterElse = stopBody.slice(elseBraceClose + 1);
    expect(afterElse).toMatch(
      /blob\.size\s*===\s*0[\s\S]*?flushThrew\s*\?\s*"unfinished"\s*:\s*"silence"/
    );
  });

  it("every exit of the tail returns React state to idle when current — the property #485 finding 1 is named for (panel r2 P2)", () => {
    // #485 finding 1 is "the throw rode out of `stop()` with React state
    // left at `processing`, so the sheet stayed `busy` and every Back
    // stayed". The catch above falls through to the tail precisely so the
    // tail's `setState("idle")` covers the throw path too — but until this
    // case nothing pinned that the tail HAS one: deleting the empty-capture
    // exit's `if (current) setState("idle");` left all nine cases green
    // (panel r2 P2 on #500). A throw-path seal reaches all three exits
    // (empty → notice, decodable → take, undecodable → hold), so all three
    // are pinned, each as one contiguous shape: the exit's own condition or
    // verdict, then the `current`-gated idle write, then the `return {` —
    // nothing in between. Deleting the write, dropping its `current` gate,
    // painting `"processing"` instead, or moving the write below the
    // `return` must all fail this. The tail is `stopBody` after the
    // `if/else` on `recorder.state`, so a `setState` in either arm or in
    // `cancel()` cannot satisfy it.
    const afterElse = stopBody.slice(elseBraceClose + 1);
    // `current` is re-derived from the generation AFTER the flush settles —
    // the throw path's catch runs a microtask later than the throw, and a
    // `leave()` may have moved the generation on since `processing` was set.
    const currentDecl = afterElse.search(
      /\bconst\s+current\s*=\s*generation\s*===\s*generationRef\.current\s*;/
    );
    expect(currentDecl).toBeGreaterThan(-1);
    const emptyExit = afterElse.search(
      /blob\.size\s*===\s*0\s*\)\s*\{\s*if\s*\(\s*current\s*\)\s*setState\(\s*"idle"\s*\)\s*;\s*return\s*\{/
    );
    expect(emptyExit).toBeGreaterThan(currentDecl);
    // The decode exits re-read the generation as `current2` after their own
    // await, then paint idle on the same gate.
    expect(afterElse).toMatch(
      /classifyStopDecode\(\s*\{\s*decoded:\s*true,\s*sampleCount:\s*samples\.length,?\s*\},\s*current2,?\s*\)\s*;\s*if\s*\(\s*current2\s*\)\s*setState\(\s*"idle"\s*\)\s*;\s*return\s*\{/
    );
    expect(afterElse).toMatch(
      /classifyStopDecode\(\s*\{\s*decoded:\s*false,?\s*\},\s*current2,?\s*\)\s*;\s*if\s*\(\s*current2\s*\)\s*setState\(\s*"idle"\s*\)\s*;\s*return\s*\{/
    );
    // The tail owns exactly these three idle writes and never paints
    // anything else: a fourth write, or any other state, is a new exit this
    // gate has not read.
    expect(afterElse.match(/setState\(\s*"idle"\s*\)/g) ?? []).toHaveLength(3);
    expect(afterElse.match(/setState\(/g) ?? []).toHaveLength(3);
  });

  it("the catch is followed by a finally whose body clears the flush timer, releases the stream and closes the LOCAL tap, not the ref (#474 R6, #485, panel r1)", () => {
    // The release stays a `finally`, state-independent (J6): it runs whether
    // the executor threw or resolved normally, after the catch body and
    // before the tail runs.
    expect(finallyMatch).not.toBeNull();
    expect(finallyBraceClose).toBeGreaterThan(finallyBraceOpen);
    // The timer is hoisted out of the executor so the finally can reach it:
    // on the throw path it would otherwise fire up to five seconds later,
    // seal a Blob nobody awaits and resolve an already-rejected promise
    // while holding `chunks` reachable (panel r1 P3). Deleting the hoist or
    // the clear must fail this.
    expect(elseBody).toMatch(/\blet\s+timer\s*:\s*number\s*\|\s*undefined\s*;/);
    expect(elseBody.indexOf("let timer")).toBeLessThan(tryIdx);
    expect(tryBody).toMatch(/\btimer\s*=\s*window\.setTimeout\(/);
    expect(finallyBody).toMatch(/\bclearTimeout\(\s*timer\s*\)\s*;/);
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

  it("the inactive arm's own abandon -> yield -> seal order is pinned too, so it and the throw arm's catch cannot drift apart silently (#500 round 3)", () => {
    // `catchPattern` above pins the throw arm TO this order; this test pins
    // the order in the arm it is pinned to. Without both, an edit to the
    // inactive arm alone could change what "the same order" means without
    // either gate noticing.
    const abandonIdx = ifArmBody.search(
      /\bif\s*\(\s*stream\s*\)\s*abandonStream\(\s*stream\s*\)\s*;/
    );
    const yieldIdx = ifArmBody.indexOf(
      "await new Promise((resolve) => setTimeout(resolve, 0));"
    );
    const sealIdx = ifArmBody.indexOf(
      "blob = new Blob(chunks, { type: recorder.mimeType });"
    );
    expect(abandonIdx).toBeGreaterThan(-1);
    expect(yieldIdx).toBeGreaterThan(-1);
    expect(sealIdx).toBeGreaterThan(-1);
    expect(abandonIdx).toBeLessThan(yieldIdx);
    expect(yieldIdx).toBeLessThan(sealIdx);
  });
});
