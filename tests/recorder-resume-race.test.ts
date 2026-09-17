import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `raceAudioResume` bounds the one blocking `await resumeAudioContext()` in
 * `start()` (use-recorder.ts, between `getUserMedia` and `new MediaRecorder`,
 * #108). WebKit's `resume()` from `"interrupted"` can hang; an unbounded await
 * there leaves the recorder stuck in `requesting` forever, with the mic already
 * hot. This bounds the WAIT — proceeding once `RESUME_START_TIMEOUT_MS`
 * elapses — without ever letting a resume rejection escape unhandled or go
 * unreported, and without ever calling `raceAudioResume` again.
 *
 * `resumeAudioContext` is called SYNCHRONOUSLY as the first statement (so the
 * user-gesture timing `start()`'s own comments rely on is unchanged); the
 * function itself never rejects (a caller that awaited a rejection here would
 * break the "the mic is live either way" contract `start()` already relies on
 * for its generation check). A late rejection is routed to `reportFailure`
 * instead of being swallowed silently or left as an unhandled rejection on the
 * losing side of the race.
 *
 * Mirrors `tests/foreground-resume.test.ts`'s `vi.mock("@/hooks/audio-io")`
 * shape (same 5-member mock — `raceAudioResume` calls the already-imported
 * `resumeAudioContext`, so no new binding is added to that surface) and
 * `tests/encoder-deadline.test.ts`'s `vi.useFakeTimers()` /
 * `vi.advanceTimersByTimeAsync` pattern. Bare `setTimeout`/`clearTimeout`
 * (never `window.*`) is what makes this testable at all in this Node-only
 * suite (no jsdom) — the same bare-timer precedent already used in this file
 * at use-recorder.ts:748 and :896.
 */

const { resumeAudioContext } = vi.hoisted(() => ({
  resumeAudioContext: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/hooks/audio-io", () => ({
  resumeAudioContext,
  createLevelTap: vi.fn(),
  decodeToCanonical: vi.fn(),
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
}));

const { reportFailure } = vi.hoisted(() => ({
  reportFailure: vi.fn(),
}));

vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

import { RESUME_START_TIMEOUT_MS, raceAudioResume } from "@/hooks/use-recorder";

/** A promise plus externally-callable settlers, for controlling exactly when
 *  the mocked `resumeAudioContext()` resolves or rejects. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resumeAudioContext.mockReset();
  reportFailure.mockReset();
});

describe("raceAudioResume (#108)", () => {
  it("resolves promptly when resume completes immediately", async () => {
    resumeAudioContext.mockResolvedValue(undefined);

    // No advanceTimersByTimeAsync — a healthy resume must not wait for the
    // timer at all, only for its own microtasks to flush.
    await expect(raceAudioResume()).resolves.toBeUndefined();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("THE #108 REGRESSION ITSELF — resolves after the timeout when resume never settles", async () => {
    resumeAudioContext.mockReturnValue(new Promise(() => {}));

    let resolved = false;
    const race = raceAudioResume().then(() => {
      resolved = true;
    });

    // Flush microtasks without advancing the clock: must still be pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    await race;
    expect(resolved).toBe(true);
  });

  it("does not resolve before the timeout elapses", async () => {
    resumeAudioContext.mockReturnValue(new Promise(() => {}));

    let resolved = false;
    void raceAudioResume().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS - 1);
    expect(resolved).toBe(false);
  });

  it("a late REJECTION after the timeout reaches reportFailure, unswallowed", async () => {
    const gate = deferred<void>();
    resumeAudioContext.mockReturnValue(gate.promise);

    const race = raceAudioResume();
    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    await race;
    expect(reportFailure).not.toHaveBeenCalled();

    const cause = new Error("resume rejected late");
    gate.reject(cause);
    // Let the rejection's own handler run.
    await Promise.resolve();
    await Promise.resolve();

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, expect.any(String));
  });

  it("an early REJECTION before the timeout still reaches reportFailure, and the function still resolves (not rejects)", async () => {
    const cause = new Error("resume rejected early");
    resumeAudioContext.mockRejectedValue(cause);

    await expect(raceAudioResume()).resolves.toBeUndefined();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, expect.any(String));
  });

  it("a late RESOLVE after the timeout reports nothing", async () => {
    const gate = deferred<void>();
    resumeAudioContext.mockReturnValue(gate.promise);

    const race = raceAudioResume();
    await vi.advanceTimersByTimeAsync(RESUME_START_TIMEOUT_MS);
    await race;

    gate.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("clears the pending timer once resume settles early", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    resumeAudioContext.mockResolvedValue(undefined);

    await raceAudioResume();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
