import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Both native `MediaRecorder.stop()` calls in `use-recorder.ts` are guarded
 * (#59).
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. There is no `MediaRecorder`
 * and no renderer in this Node-only suite, so neither `stop()` nor `cancel()`
 * — both `useCallback`s inside `useRecorder()` — can be exercised at all, and a
 * throw from a native teardown call cannot be simulated. Removing either
 * `try`/`catch` leaves every other test in the repo green. That is precisely
 * the mutation-survives case AGENTS.md says to close with a gate rather than
 * leave to a reviewer's memory, and it is the same answer #108 reached one
 * function away — see `tests/recorder-resume-race.test.ts`'s "the wiring, not
 * just the helper", whose comment-stripping approach this mirrors.
 *
 * WHAT IT PROVES, EXACTLY: that the source text wraps both calls. It does NOT
 * prove the catch behaves correctly at runtime, that either call ever throws,
 * or that any device has run this. The PR body says the same.
 *
 * WHY THE GUARDS EXIST, so a future reader does not delete them as noise:
 *
 *   - `stop()`'s call is the last statement of a Promise executor, so an
 *     uncaught throw REJECTS the blob promise and the confirmed take comes back
 *     `{ samples: null, blob: null }` — lost — even though the bounded timer
 *     armed just above would have sealed whatever `chunks` already held.
 *   - `cancel()`'s throw would skip `releaseStream()` and propagate into
 *     `leave()`, breaking its "synchronous and total" contract and leaving a hot
 *     microphone on a page that is going away.
 *
 * Neither is a fix for an observed failure: per the MediaStream Recording spec
 * `stop()` throws `InvalidStateError` only when the recorder is already
 * `"inactive"`, and both call sites test `state !== "inactive"` first.
 */
describe("both native recorder.stop() calls are guarded (#59)", () => {
  const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);

  /**
   * Comments are stripped so the gate reads CODE, not prose about code: the
   * guards' own comments discuss `stop()` and throwing, and a naive match would
   * score documentation. Safe in this file specifically — `tests/
   * recorder-resume-race.test.ts` established that it contains no `//` or `/*`
   * inside a string literal, so the strip cannot misfire on one.
   */
  const code = readFileSync(sourceUrl, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("has exactly the two native stop() call sites this gate knows about", () => {
    // Pinned as a COUNT, not merely "all of them are guarded": that phrasing
    // alone passes vacuously if both calls are deleted, and it would silently
    // stop covering a third call site somebody adds later. A legitimate new
    // native stop() is welcome — it just has to update this number
    // deliberately, and be guarded to pass the next case.
    const calls = code.match(/recorder\.stop\s*\(\s*\)/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("wraps every one of them in a try/catch — remove either and this dies", () => {
    const calls = code.match(/recorder\.stop\s*\(\s*\)/g) ?? [];
    const guarded =
      code.match(/try\s*\{\s*recorder\.stop\s*\(\s*\);\s*\}\s*catch/g) ?? [];
    expect(guarded).toHaveLength(calls.length);
  });

  it("routes both failures to the durable funnel, not to a bare console", () => {
    // AGENTS.md: "console.error is not a channel on a phone in a village."
    // `reportFailure` is the funnel (#167/#205) and keeps a console line of its
    // own, so this loses nothing a maintainer had. Distinct context keys, so the
    // stored log says WHICH teardown failed — the free-string `context` the
    // funnel documents as "one key per site", needing no change outside this
    // file.
    expect(code).toMatch(
      /catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-stop"\s*\);/
    );
    expect(code).toMatch(
      /catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-cancel-stop"\s*\);/
    );
  });

  it("seals the take immediately when a thrown stop() left the recorder active", () => {
    // Reporting alone would leave the blob promise waiting out the full
    // STOP_FLUSH_TIMEOUT_MS for an `onstop` that cannot come — five seconds of
    // hot microphone after a CONFIRMED stop, unreachable by cancel()/pagehide
    // because this stop already stole the stream and tap out of the shared
    // refs, and five seconds of unconfirmed audio still appending to `chunks`.
    // The bound is for a flush in flight; a throw may mean there is none, so
    // the catch has to branch on the recorder's own state.
    //
    // Deleting the branch, or dropping either statement inside it, must fail
    // here: nothing else in the suite notices, because there is no
    // MediaRecorder to throw.
    expect(code).toMatch(
      /catch\s*\(\s*cause\s*\)\s*\{\s*reportFailure\(\s*cause,\s*"recorder-stop"\s*\);\s*if\s*\(\s*recorder\.state\s*!==\s*"inactive"\s*\)\s*\{\s*clearTimeout\(\s*timer\s*\);\s*finish\(\s*\);\s*\}\s*\}/
    );
  });

  it("arms the bound BEFORE the call whose catch clears it", () => {
    // `timer` and `finish` are both read inside that catch, so both must
    // already be initialised when it runs. They are `const`s in the same
    // Promise-executor block declared above the `try`; a declaration moved
    // below it would be a TDZ ReferenceError raised from inside a catch
    // handler — on the one path that exists to keep a confirmed take alive.
    // Order, asserted by position rather than trusted.
    const executor = code.slice(code.indexOf("const finish ="));
    expect(executor).not.toHaveLength(0);
    const timerDecl = executor.indexOf("const timer =");
    const guardedCall = executor.indexOf("recorder.stop()");
    expect(timerDecl).toBeGreaterThan(0);
    expect(guardedCall).toBeGreaterThan(timerDecl);
  });
});
