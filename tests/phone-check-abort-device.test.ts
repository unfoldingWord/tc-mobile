import { describe, expect, it, vi } from "vitest";

import { readDeviceInfo, settleProbe } from "@/hooks/phone-check-probes";
import { subscribeToFailures } from "@/hooks/report-failure";

/**
 * #1379 item 5: `navigator.storage.estimate()` and `persisted()` take no signal
 * and may never answer. The device read honours the run's abort anyway, so a
 * cancel or an unmount ends it with the abort's own reason.
 */

const NEVER = new Promise<never>(() => {});

describe("readDeviceInfo and an abort", () => {
  it("ends a hung estimate() with the signal's reason", async () => {
    const run = new AbortController();
    const pending = readDeviceInfo(
      { storage: { estimate: () => NEVER } },
      run.signal
    );
    run.abort();
    await expect(pending).rejects.toBe(run.signal.reason);
  });

  it("ends a hung persisted() with the signal's reason", async () => {
    const run = new AbortController();
    const persisted = vi.fn(() => NEVER);
    const pending = readDeviceInfo(
      {
        storage: {
          estimate: async () => ({ quota: 1, usage: 0 }),
          persisted,
        },
      },
      run.signal
    );
    // Abort only once persisted() is the call that is hung.
    await vi.waitFor(() => expect(persisted).toHaveBeenCalled());
    run.abort();
    await expect(pending).rejects.toBe(run.signal.reason);
  });

  it("calls nothing on an already-aborted signal and rejects with its reason", async () => {
    const run = new AbortController();
    run.abort(new Error("custom reason"));
    const estimate = vi.fn(() => Promise.reject(new Error("quota")));
    const persisted = vi.fn(() => Promise.reject(new Error("persist")));
    await expect(
      readDeviceInfo({ storage: { estimate, persisted } }, run.signal)
    ).rejects.toBe(run.signal.reason);
    expect(estimate).not.toHaveBeenCalled();
    expect(persisted).not.toHaveBeenCalled();
  });

  it("leaves no unhandled rejection when the call it abandons rejects later", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => void unhandled.push(cause);
    process.on("unhandledRejection", onUnhandled);
    try {
      const run = new AbortController();
      // The abort lands between the call and the race: the abandoned path.
      const estimate = () => {
        run.abort();
        return Promise.reject(new Error("quota"));
      };
      await expect(
        readDeviceInfo({ storage: { estimate } }, run.signal)
      ).rejects.toBe(run.signal.reason);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("leaves no unhandled rejection when a call already being raced rejects after the abort", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => void unhandled.push(cause);
    process.on("unhandledRejection", onUnhandled);
    try {
      const run = new AbortController();
      let rejectEstimate!: (cause: unknown) => void;
      const estimate = vi.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectEstimate = reject;
          })
      );
      const pending = readDeviceInfo({ storage: { estimate } }, run.signal);
      // The race is attached; only now does the run abort and the call reject.
      expect(estimate).toHaveBeenCalled();
      run.abort();
      await expect(pending).rejects.toBe(run.signal.reason);
      rejectEstimate(new Error("quota"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("is recognised as the abort by settleProbe, so nothing reaches the funnel", async () => {
    const seen: unknown[] = [];
    const off = subscribeToFailures((r) => void seen.push(r));
    const run = new AbortController();
    const outcome = settleProbe(
      () => readDeviceInfo({ storage: { estimate: () => NEVER } }, run.signal),
      run.signal
    );
    run.abort();
    expect((await outcome).status).toBe("failed");
    off();
    expect(seen).toHaveLength(0);
  });

  it("still reads a normal device when the signal never aborts", async () => {
    const run = new AbortController();
    const info = await readDeviceInfo(
      {
        userAgent: "ua",
        storage: {
          estimate: async () => ({ quota: 10, usage: 2 }),
          persisted: async () => true,
        },
      },
      run.signal
    );
    expect(info).toMatchObject({
      userAgent: "ua",
      quotaBytes: 10,
      usageBytes: 2,
      persisted: true,
    });
  });

  it("surfaces an estimate() that rejects while the signal is live", async () => {
    const boom = new Error("estimate failed");
    await expect(
      readDeviceInfo(
        { storage: { estimate: () => Promise.reject(boom) } },
        new AbortController().signal
      )
    ).rejects.toBe(boom);
  });

  it("removes its abort listener once the read settles", async () => {
    const run = new AbortController();
    const remove = vi.spyOn(run.signal, "removeEventListener");
    await readDeviceInfo(
      { storage: { estimate: async () => ({ quota: 1, usage: 0 }) } },
      run.signal
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
