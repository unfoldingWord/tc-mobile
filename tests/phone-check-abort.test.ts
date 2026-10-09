// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserAllocationDeps, settleProbe } from "@/hooks/phone-check-probes";
import {
  isPhoneCheckRunning,
  runMemoryCheck,
  runPhoneChecks,
  usePhoneCheck,
} from "@/hooks/use-phone-check";
import { subscribeToFailures } from "@/hooks/report-failure";
import { runAllocationSteps } from "@/lib/phone-check/allocation";

/**
 * #1014 item 6: the phone check's probes stop when the screen that started
 * them goes away. The pure loop, the storage probe, the failure funnel, the
 * run sequencing and the hook's unmount are each pinned below. The real
 * encoder worker is not run here (Node has no worker); its signal wiring is
 * pinned in `phone-check-encode.test.ts`. Nothing here ran on a device.
 */

const probeSeam = vi.hoisted(() => ({
  signals: [] as Array<AbortSignal | undefined>,
  deviceGate: null as Promise<void> | null,
}));

vi.mock("@/hooks/finish-transcode", () => ({
  pauseTranscodeSweep: () => {},
  resumeTranscodeSweep: () => {},
  transcodeSweepSettled: () => Promise.resolve(),
}));

// Only the device read is replaced, so the hook can be held mid-run; the
// rest of the probes module is real.
vi.mock("@/hooks/phone-check-probes", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/hooks/phone-check-probes")>();
  return {
    ...real,
    readDeviceInfo: async () => {
      await probeSeam.deviceGate;
      return {
        userAgent: "t",
        deviceMemoryGb: null,
        cores: null,
        quotaBytes: null,
        usageBytes: null,
        persisted: null,
      };
    },
    runWorkerEncodeProbe: (signal?: AbortSignal) => {
      probeSeam.signals.push(signal);
      return Promise.resolve({ audioSeconds: 1, wallMs: 1, mp3Bytes: 1 });
    },
  };
});

function aborted(): AbortSignal {
  const run = new AbortController();
  run.abort();
  return run.signal;
}

describe("runAllocationSteps with an aborted signal", () => {
  it("rejects before allocating and still clears the breadcrumb", async () => {
    const writes: unknown[] = [];
    const allocate = vi.fn();
    await expect(
      runAllocationSteps({
        steps: [1, 2],
        allocate,
        writeBreadcrumb: (c) => void writes.push(c),
        yieldTurn: () => Promise.resolve(),
        signal: aborted(),
      })
    ).rejects.toBeDefined();
    expect(allocate).not.toHaveBeenCalled();
    expect(writes).toEqual([null]);
  });

  it("stops without allocating when aborted while yielding", async () => {
    const run = new AbortController();
    const allocate = vi.fn();
    await expect(
      runAllocationSteps({
        steps: [1, 2],
        allocate,
        writeBreadcrumb: () => {},
        yieldTurn: () => {
          run.abort();
          return Promise.resolve();
        },
        signal: run.signal,
      })
    ).rejects.toBeDefined();
    expect(allocate).not.toHaveBeenCalled();
  });

  it("stops at the next step when aborted mid-run", async () => {
    const run = new AbortController();
    const allocate = vi.fn(() => run.abort());
    await expect(
      runAllocationSteps({
        steps: [1, 2, 3],
        allocate,
        writeBreadcrumb: () => {},
        yieldTurn: () => Promise.resolve(),
        signal: run.signal,
      })
    ).rejects.toBeDefined();
    expect(allocate).toHaveBeenCalledTimes(1);
  });
});

describe("browserAllocationDeps", () => {
  it("carries the caller's signal into the allocation loop", () => {
    const { signal } = new AbortController();
    expect(browserAllocationDeps(null, () => {}, signal).signal).toBe(signal);
  });
});

describe("settleProbe and an abort", () => {
  it("reports a real failure to the funnel", async () => {
    const seen: unknown[] = [];
    const off = subscribeToFailures((r) => void seen.push(r));
    await settleProbe(() => Promise.reject(new Error("boom")));
    off();
    expect(seen).toHaveLength(1);
  });

  it("does not report a rejection the abort caused", async () => {
    const seen: unknown[] = [];
    const off = subscribeToFailures((r) => void seen.push(r));
    const signal = aborted();
    const outcome = await settleProbe(
      () => Promise.reject(signal.reason),
      signal
    );
    off();
    expect(seen).toHaveLength(0);
    expect(outcome.status).toBe("failed");
  });
});

describe("runPhoneChecks and runMemoryCheck with an aborted signal", () => {
  it("lands nothing after the abort and starts no later probe", async () => {
    const run = new AbortController();
    const land = vi.fn();
    const encode = vi.fn();
    await expect(
      runPhoneChecks(
        {
          device: async () => {
            run.abort();
            return { status: "failed", errorName: "x" };
          },
          encode,
          storage: encode,
        },
        land,
        () => {},
        run.signal
      )
    ).rejects.toBeDefined();
    expect(encode).not.toHaveBeenCalled();
    // Only the opening reset landed; the device result did not.
    expect(land).toHaveBeenCalledTimes(1);
  });

  it("starts no storage probe when aborted during the encode", async () => {
    const run = new AbortController();
    const storage = vi.fn();
    const land = vi.fn();
    await expect(
      runPhoneChecks(
        {
          device: async () => ({ status: "failed", errorName: "x" }),
          encode: async () => {
            run.abort();
            return { status: "failed", errorName: "x" };
          },
          storage,
        },
        land,
        () => {},
        run.signal
      )
    ).rejects.toBeDefined();
    expect(storage).not.toHaveBeenCalled();
    expect(land).not.toHaveBeenCalledWith(
      expect.objectContaining({ encode: expect.anything() })
    );
  });

  it("lands no storage result when aborted during the storage probe", async () => {
    const run = new AbortController();
    const land = vi.fn();
    await expect(
      runPhoneChecks(
        {
          device: async () => ({ status: "failed", errorName: "x" }),
          encode: async () => ({ status: "failed", errorName: "x" }),
          storage: async () => {
            run.abort();
            return { status: "failed", errorName: "x" };
          },
        },
        land,
        () => {},
        run.signal
      )
    ).rejects.toBeDefined();
    expect(land).not.toHaveBeenCalledWith(
      expect.objectContaining({ storage: expect.anything() })
    );
  });

  it("lands nothing at all when aborted while waiting for the sweep", async () => {
    const land = vi.fn();
    const device = vi.fn();
    await expect(
      runPhoneChecks(
        { device, encode: device, storage: device },
        land,
        () => {},
        aborted()
      )
    ).rejects.toBeDefined();
    expect(land).not.toHaveBeenCalled();
    expect(device).not.toHaveBeenCalled();
  });

  it("runs the memory ceiling not at all when aborted while waiting", async () => {
    const allocate = vi.fn();
    await expect(
      runMemoryCheck(
        {
          allocate,
          writeBreadcrumb: () => {},
          yieldTurn: () => Promise.resolve(),
          signal: aborted(),
        },
        () => {}
      )
    ).rejects.toBeDefined();
    expect(allocate).not.toHaveBeenCalled();
  });
});

function Owner({ expose }: { expose: (run: () => void) => void }): null {
  const { runChecks } = usePhoneCheck();
  useEffect(() => {
    expose(runChecks);
  }, [expose, runChecks]);
  return null;
}

describe("usePhoneCheck unmounting mid-run", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    probeSeam.signals.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("aborts the run, starts no later probe, and frees the run slot", async () => {
    let open!: () => void;
    probeSeam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let start: (() => void) | undefined;
    const expose = (run: () => void) => {
      start = run;
    };
    await act(async () => root.render(createElement(Owner, { expose })));

    await act(async () => start?.());
    expect(isPhoneCheckRunning()).toBe(true);

    await act(async () => root.unmount());
    // The device read is still pending; releasing it must not start the encode.
    open();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(probeSeam.signals).toEqual([]);
  });

  it("hands the live run's signal to the encode while mounted, unaborted", async () => {
    probeSeam.deviceGate = null;
    let start: (() => void) | undefined;
    const expose = (run: () => void) => {
      start = run;
    };
    await act(async () => root.render(createElement(Owner, { expose })));
    await act(async () => start?.());
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(probeSeam.signals).toHaveLength(1);
    expect(probeSeam.signals[0]?.aborted).toBe(false);
    await act(async () => root.unmount());
  });
});
