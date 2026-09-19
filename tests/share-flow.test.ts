import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Clock,
  classifyShareError,
  createProgressDriver,
  sentGap,
} from "@/hooks/share-flow";
import {
  MIN_BUSY_MS,
  OUTCOME_HOLD_MS,
  type ShareProgress,
} from "@/hooks/share-progress";

/** Source-shape reads, because there is no renderer here (#197). */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

/**
 * B7 Share (chapter + book) — the share-rejection classifier.
 *
 * The two-gesture flow lives in `useShareFlow` (wrapped by `useChapterShare` and
 * `useBookShare`), whose state machine and the `navigator.share` handoff are
 * React + browser glue this repo has no renderer to exercise (the constraint
 * `tests/use-erase-segment.test.ts` documents). What IS node-testable is the pure
 * decision the classifier makes about a rejection,
 * and it is the one with real product weight: it decides whether a translator
 * sees a failure, gets a silent retry, or the flow simply ends.
 *
 * The distinction that matters most is `NotAllowedError` → `retry`. That was the
 * P1 that sent this PR back: encoding spent the iOS activation window and the
 * share was refused. The rework prevents the refusal, but if one still arrives,
 * treating it as `failed` would throw away the already-encoded File and send the
 * translator back to re-encode — so it must classify as `retry`, keeping the
 * File armed for a fresh tap.
 */
describe("classifyShareError", () => {
  it("treats a dismissed sheet (AbortError) as dismissed, whatever the activation", () => {
    const abort = new DOMException("user cancelled", "AbortError");
    expect(classifyShareError(abort, false)).toBe("dismissed");
    expect(classifyShareError(abort, true)).toBe("dismissed");
  });

  it("treats NotAllowedError with NO live activation as retry, keeping the File", () => {
    // The tap's activation was spent; a fresh tap can still hand over the File.
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    expect(classifyShareError(notAllowed, false)).toBe("retry");
  });

  it("treats NotAllowedError WITH live activation as a real failure, not a loop", () => {
    // Activation was live and share still refused: a standing block (Permissions
    // Policy), so surface an error rather than a "Share now" that never works.
    const notAllowed = new DOMException("blocked by policy", "NotAllowedError");
    expect(classifyShareError(notAllowed, true)).toBe("failed");
  });

  it("treats any other DOMException as a real failure", () => {
    const other = new DOMException("boom", "DataError");
    expect(classifyShareError(other, false)).toBe("failed");
    expect(classifyShareError(other, true)).toBe("failed");
  });

  it("treats a plain Error as a real failure", () => {
    expect(classifyShareError(new Error("network"), false)).toBe("failed");
  });

  it("treats a non-error throw as a real failure", () => {
    expect(classifyShareError("nope", false)).toBe("failed");
    expect(classifyShareError(undefined, true)).toBe("failed");
  });
});

/**
 * `sentGap` (P1, this lane's own review round) — the pure decision that picks
 * `sent` vs `partial` at `send()`'s own settle, node-testable for the same
 * reason `classifyShareError` above is.
 *
 * The defect this closes: a chapter/book share that went out with segments or
 * chapters missing wore the SAME plain success tick a whole share gets — the
 * gap Notice on screen a moment earlier vanished with no trace once the sheet
 * closed, so a facilitator reading only the glyph collected an incomplete
 * chapter believing it whole. `share-progress.ts`'s header on `ShareSettled`
 * names the exact same collision this is #178's own fix shape recreates one
 * screen later, which is why this reuses the mark rather than adding a
 * fourth.
 */
describe("sentGap", () => {
  it("no gap when both counts are zero", () => {
    expect(sentGap({ missing: 0, partial: 0 })).toBeUndefined();
  });

  it("a gap from `missing` alone (a chapter's own left-out segments, or a book's whole missing chapters)", () => {
    expect(sentGap({ missing: 1, partial: 0 })).toEqual({
      missing: 1,
      partial: 0,
    });
  });

  it("a gap from `partial` alone (segments missing inside a book chapter that DID ship)", () => {
    expect(sentGap({ missing: 0, partial: 2 })).toEqual({
      missing: 0,
      partial: 2,
    });
  });

  it("a gap from both at once — a book can carry both", () => {
    expect(sentGap({ missing: 1, partial: 2 })).toEqual({
      missing: 1,
      partial: 2,
    });
  });
});

/**
 * The wiring pins the state machine alone cannot prove: that `send()` reads
 * ITS gap off the ARMED value (not off `missing`/`partial` state, which the
 * same transition already zeroes), that a scrim tap cannot discard an
 * irreversibly in-flight send (P2), and that the guard-hole branch settles
 * the modal like every other outcome (P3) — all three from this lane's own
 * review round. `tests/share-progress.test.ts` already pins the busy/outcome
 * machine and the iOS activation-window shape; this file adds only what
 * changed here.
 */
describe("the wiring around sentGap and the reset guard (this lane's own review round)", () => {
  const flow = read("src/hooks/share-flow.ts");

  it("prepare() arms the gap counts alongside the File, not just in useState", () => {
    expect(flow).toMatch(
      /handoff\.arm\(\{\s*file,\s*staged,\s*missing:\s*prepared\.missing,\s*partial:\s*prepared\.partial \?\? 0,?\s*\}\)/
    );
  });

  it("send() decides sent vs partial through sentGap(armed), never a hand-rolled comparison at the call site", () => {
    const from = flow.indexOf('modal.dispatch({ type: "begin", work: "send"');
    const settleSite = flow.indexOf("const gap = sentGap(armed);", from);
    expect(settleSite).toBeGreaterThan(from);
    expect(flow).toMatch(/settled: gap \? "partial" : "sent"/);
  });

  it("reset() refuses to run while a send is irreversibly in flight (P2)", () => {
    // The scrim's onCancel and the menu's Close/Escape all funnel through
    // reset(); without this guard, any of them can bump the run token under
    // a send that has already asked the OS for a chooser, turning a genuine
    // success into a dropped "superseded" outcome — reproducing #336/#491
    // inside the very modal built to fix it.
    const resetFn = flow.slice(
      flow.indexOf("const reset = useCallback"),
      flow.indexOf("}, [handoff, modal]);", flow.indexOf("const reset ="))
    );
    expect(resetFn).toMatch(/if \(handoff\.sending\) return;/);
    // The guard must be the FIRST statement in the body — before the token
    // bump it exists to prevent.
    const guardAt = resetFn.indexOf("if (handoff.sending) return;");
    const bumpAt = resetFn.indexOf("runIdRef.current += 1;");
    expect(guardAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(guardAt);
  });

  it("the guard-hole branch (armed === null) settles the modal like every other outcome (P3)", () => {
    const holeAt = flow.indexOf("if (armed === null) {");
    const holeEnd = flow.indexOf('return "failed";', holeAt);
    const hole = flow.slice(holeAt, holeEnd);
    expect(hole).toMatch(/type: "begin",\s*work: "send"/);
    expect(hole).toMatch(/type: "settle",\s*settled: "failed"/);
  });
});

/**
 * `createProgressDriver` — the clock-monotonicity fix (Frank round 2, P2 at
 * `e915d05`: `share-flow.ts:704`).
 *
 * The driver scheduled every busy/outcome wake off the wall clock and only
 * rescheduled `if (next !== state)` — the branch guarding the ENTIRE
 * reschedule. If the clock moved BACKWARD between a wake being scheduled and
 * its timer firing, `reduceShareProgress` correctly saw `now` short of the
 * deadline and left the SAME timed state in place, but nothing then replaced
 * the wake that had just fired and nulled itself — so a busy or outcome modal
 * could be stranded on screen forever. Fixed two ways: `createProgressDriver`
 * now takes an injectable `Clock` (production default `performance.now()`,
 * monotonic by spec, so `share-flow.ts`'s own callers can no longer FEED it a
 * backward step) — the reducer's own arithmetic is unchanged, it already took
 * `now` as relative data — and, as a belt for any clock source, a `tick` that
 * leaves the state unchanged now reschedules from the state's OWN wake time
 * (`shareProgressWakeAt`) instead of leaving `wake` at `null`.
 *
 * This block tests the belt directly, with an injected clock this suite steps
 * backward on purpose — the shape that struck the driver at `e915d05`,
 * reproduced here without depending on the real wall clock or on
 * `performance.now()`'s own monotonicity guarantee. Fake timers stand in for
 * the driver's `setTimeout`, and this suite drives both explicitly, one tick
 * at a time, rather than letting the fake clock free-run.
 *
 * Red-first: with the belt's `else if (event.type === "tick") scheduleWake
 * (state);` branch removed, `createProgressDriver` reschedules a wake ONLY
 * when a dispatch changes state — exactly `e915d05`'s own shape, the
 * clock-source difference aside. Run that way, both cases below failed:
 *
 *   - busy hold: `expect(last.phase).toBe("outcome")` — `AssertionError:
 *     expected 'busy' to be 'outcome'`. The driver never recovered: once the
 *     backward-stepped tick fired and found nothing to reschedule it, no
 *     further timer ever ran, and the busy modal stayed up regardless of how
 *     far the clock (or the fake timers) were then advanced.
 *   - outcome hold: `expect(last.phase).toBe("hidden")` — `AssertionError:
 *     expected 'outcome' to be 'hidden'`, and the `driver.hidden()` promise
 *     awaited at the end of that case never settled (the assertion that
 *     follows it never ran) — the exact shape of a `send()` caller left
 *     waiting on a flash that will never clear.
 *
 * Restoring the belt line made both pass. Mutation-confirmed the same way:
 * removing only that one line (leaving everything else in this PR's fix, the
 * injected `Clock`, `performance.now()` default, included) reproduces both
 * failures above; the line is what these tests are pinning.
 */
describe("createProgressDriver — the clock-monotonicity fix (Frank e915d05 P2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A `Clock` this suite can step by hand — including backward. */
  function fakeClock(start: number): Clock & { set: (t: number) => void } {
    let now = start;
    return {
      now: () => now,
      set: (t: number) => {
        now = t;
      },
    };
  }

  it("a clock that steps backward between schedule and fire still clears the busy hold", async () => {
    const clock = fakeClock(0);
    const states: ShareProgress[] = [];
    const driver = createProgressDriver((next) => states.push(next), clock);

    // `prepare`'s own `begin` — busy, nothing pending, nothing to wake for yet.
    driver.dispatch({ type: "begin", work: "prepare", now: clock.now() });

    // A settle lands well before MIN_BUSY_MS (600) has elapsed, so it is HELD:
    // the driver schedules a wake for `since (0) + MIN_BUSY_MS`, 500ms out from
    // `now` (100).
    clock.set(100);
    driver.dispatch({ type: "settle", settled: "sent", now: clock.now() });
    expect(states.at(-1)?.phase).toBe("busy");

    // The clock steps BACKWARD before that wake fires.
    clock.set(50);
    await vi.advanceTimersByTimeAsync(500);

    // The reducer correctly left the busy+pending phase in place (50 - 0 =
    // 50 < 600) — but with the belt removed, nothing replaces the wake that
    // timer just fired and nulled, and the modal is stuck here permanently.
    expect(states.at(-1)?.phase).toBe("busy");

    // The clock recovers, past the ORIGINAL deadline (since 0 + 600 = 600).
    // The belt rescheduled the wake for `600 - 50 = 550`ms out from the
    // backward-stepped fire above, so a further 550ms — with the clock now
    // past the deadline — is what proves the belt: nothing beyond it is
    // required to clear the hold.
    clock.set(650);
    await vi.advanceTimersByTimeAsync(550);

    const last = states.at(-1);
    expect(last?.phase).toBe("outcome");
    if (last?.phase === "outcome") expect(last.settled).toBe("sent");
  });

  it("a clock that steps backward between schedule and fire still clears the outcome hold", async () => {
    const clock = fakeClock(0);
    const states: ShareProgress[] = [];
    const driver = createProgressDriver((next) => states.push(next), clock);

    driver.dispatch({ type: "begin", work: "send", now: clock.now() });
    // The hold has already elapsed by the time this settle lands, so it
    // releases AT ONCE into the outcome phase, `since` = 700 — and the driver
    // schedules a wake for `since (700) + OUTCOME_HOLD_MS (1800)` = 2500,
    // 1800ms out from `now` (700).
    clock.set(700);
    driver.dispatch({ type: "settle", settled: "dismissed", now: clock.now() });
    expect(states.at(-1)?.phase).toBe("outcome");
    const hidden = driver.hidden();

    // The clock steps BACKWARD before that wake fires.
    clock.set(650);
    await vi.advanceTimersByTimeAsync(1800);

    // The reducer correctly left the outcome phase in place
    // (650 - 700 = -50 < OUTCOME_HOLD_MS) — with the belt removed, the
    // modal is now stuck here, and `hidden` above would never resolve.
    expect(states.at(-1)?.phase).toBe("outcome");

    // The clock recovers, past the ORIGINAL deadline (2500). The belt
    // rescheduled the wake for `2500 - 650 = 1850`ms out from the
    // backward-stepped fire above.
    clock.set(2600);
    await vi.advanceTimersByTimeAsync(1850);

    expect(states.at(-1)?.phase).toBe("hidden");
    await hidden; // resolves only because the phase above actually cleared.
  });

  it("MIN_BUSY_MS and OUTCOME_HOLD_MS are the holds these cases exercise", () => {
    // Pins the constants the arithmetic above is written against, so a
    // change to either constant is a visible diff here rather than a silent
    // mismatch between this file's comments and `share-progress.ts`.
    expect(MIN_BUSY_MS).toBe(600);
    expect(OUTCOME_HOLD_MS).toBe(1800);
  });
});
