// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToFailures } from "@/hooks/report-failure";
import { readSavedChecks, SAVED_CHECKS_KEY } from "@/hooks/phone-check-probes";
import {
  isPhoneCheckRunning,
  usePhoneCheck,
  type PhoneCheckState,
} from "@/hooks/use-phone-check";
import type { SavedChecks } from "@/lib/phone-check/saved-results";
import type { DspBenchResult } from "@/types/audio";

/**
 * #1379 item 4: an aborted run leaves the earlier report in place. The probes
 * are replaced so a test can hold a run after the opening state has landed.
 */

const seam = vi.hoisted(() => ({
  deviceGate: null as Promise<void> | null,
  encodeGate: null as Promise<void> | null,
  dspGate: null as Promise<void> | null,
  deviceFails: false,
  throwOnWriteCall: 0,
  writeCalls: 0,
}));

vi.mock("@/hooks/finish-transcode", () => ({
  pauseTranscodeSweep: () => {},
  resumeTranscodeSweep: () => {},
  transcodeSweepSettled: () => Promise.resolve(),
}));

vi.mock("@/hooks/phone-check-probes", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/hooks/phone-check-probes")>();
  return {
    ...real,
    // Counts the saved-report writes, and throws on the numbered one, so a test
    // can make the restore itself fail at a chosen call.
    writeSavedChecks: (
      ...args: Parameters<typeof real.writeSavedChecks>
    ): void => {
      seam.writeCalls += 1;
      if (seam.writeCalls === seam.throwOnWriteCall) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      real.writeSavedChecks(...args);
    },
    readDeviceInfo: async () => {
      await seam.deviceGate;
      if (seam.deviceFails) throw new TypeError("device read failed");
      return {
        userAgent: "new-run",
        deviceMemoryGb: null,
        cores: null,
        quotaBytes: null,
        usageBytes: null,
        persisted: null,
      };
    },
    runWorkerEncodeProbe: async () => {
      await seam.encodeGate;
      return { audioSeconds: 2, wallMs: 2, mp3Bytes: 2 };
    },
    runDspProbe: async () => {
      await seam.dspGate;
      const run = benchResult(2);
      return { cold: run, warm: run };
    },
    runStorageProbe: () => Promise.resolve({ bytes: 2, writeMs: 2, readMs: 2 }),
  };
});

/** A DSP benchmark run whose every figure is `n`, so two runs are told apart. */
function benchResult(n: number): DspBenchResult {
  return {
    audioSeconds: n,
    chunks: n,
    measureMs: n,
    applyMs: n,
    stageMs: { highPass: n, kWeight: n, truePeak: n, gain: n, limiter: n },
    slowestChunkMs: n,
    workingSetBytes: n,
    checksum: n,
    loudnessLufs: n,
    truePeakDbtp: n,
    gainDb: n,
    limiterMaxReductionDb: n,
  };
}

const BLANK: SavedChecks = {
  device: null,
  encode: null,
  dsp: null,
  storage: null,
};

const EARLIER: SavedChecks = {
  device: {
    status: "ok",
    value: {
      userAgent: "earlier",
      deviceMemoryGb: 4,
      cores: 8,
      quotaBytes: 1,
      usageBytes: 1,
      persisted: true,
    },
  },
  encode: {
    status: "ok",
    value: { audioSeconds: 1, wallMs: 1, mp3Bytes: 1 },
  },
  dsp: { status: "ok", value: { cold: benchResult(1), warm: benchResult(1) } },
  storage: { status: "ok", value: { bytes: 1, writeMs: 1, readMs: 1 } },
};

let latest: PhoneCheckState | undefined;
let start: (() => void) | undefined;

function Owner(): null {
  const { state, runChecks } = usePhoneCheck();
  useEffect(() => {
    latest = state;
    start = runChecks;
  }, [state, runChecks]);
  return null;
}

function savedNow(): SavedChecks | null {
  return readSavedChecks(window.sessionStorage);
}

describe("an aborted phone-check run keeps the earlier report", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.sessionStorage.clear();
    seam.deviceGate = null;
    seam.encodeGate = null;
    seam.dspGate = null;
    seam.deviceFails = false;
    seam.throwOnWriteCall = 0;
    seam.writeCalls = 0;
    latest = undefined;
    start = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    // The run slot is module-global, and a test may leave a second root mounted.
    await act(async () => root.unmount());
    container.remove();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function mountWithEarlier(): Promise<void> {
    window.sessionStorage.setItem(SAVED_CHECKS_KEY, JSON.stringify(EARLIER));
    await act(async () => root.render(createElement(Owner)));
  }

  it("persists the earlier report after an abort one probe in, and a remount shows it", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    // The opening state has landed: the run replaced the report with blanks.
    expect(savedNow()).toEqual(BLANK);

    await act(async () => root.unmount());
    open();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(savedNow()).toEqual(EARLIER);

    root = createRoot(container);
    await act(async () => root.render(createElement(Owner)));
    expect(latest?.device).toEqual(EARLIER.device);
    expect(latest?.encode).toEqual(EARLIER.encode);
    expect(latest?.storage).toEqual(EARLIER.storage);
  });

  it("saves the blank report, not an invented one, when there was no earlier report", async () => {
    await act(async () => root.render(createElement(Owner)));
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    await act(async () => root.unmount());
    open();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(savedNow()).toEqual(BLANK);
  });

  it("shows the earlier report to a screen remounted before the held probe is released", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    expect(isPhoneCheckRunning()).toBe(true);

    await act(async () => root.unmount());
    // The probe in flight has not reached its abort boundary yet.
    expect(isPhoneCheckRunning()).toBe(true);

    root = createRoot(container);
    await act(async () => root.render(createElement(Owner)));
    expect(latest?.device).toEqual(EARLIER.device);
    expect(latest?.encode).toEqual(EARLIER.encode);
    expect(latest?.storage).toEqual(EARLIER.storage);

    open();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(savedNow()).toEqual(EARLIER);
  });

  it("shows a screen remounted during the wind-down as busy until the slot is released", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    await act(async () => root.unmount());

    root = createRoot(container);
    await act(async () => root.render(createElement(Owner)));
    try {
      // The slot is still held by the run winding down, so Start would return
      // without doing anything: the screen must read as busy, not idle.
      expect(isPhoneCheckRunning()).toBe(true);
      expect(latest?.activity).toEqual({ kind: "stopping" });
    } finally {
      // Released either way, so a red here cannot hold the module-wide slot
      // for every later case.
      open();
    }
    await vi.waitFor(() => {
      expect(latest?.activity).toBeNull();
    });
    expect(isPhoneCheckRunning()).toBe(false);
  });

  it("restores the earlier report whole after a partial run, and a released probe cannot undo it", async () => {
    await mountWithEarlier();
    let openEncode!: () => void;
    seam.encodeGate = new Promise<void>((resolve) => {
      openEncode = resolve;
    });
    await act(async () => start?.());
    // The device probe landed ok on the new run; the encode is held.
    await vi.waitFor(() => {
      expect(savedNow()?.device).toMatchObject({
        status: "ok",
        value: { userAgent: "new-run" },
      });
    });
    expect(savedNow()?.encode).toBeNull();

    await act(async () => root.unmount());
    expect(savedNow()).toEqual(EARLIER);
    openEncode();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    // Item 6: the released probe reaches the gate, finds the signal aborted and
    // lands nothing, so the restore stands.
    expect(savedNow()).toEqual(EARLIER);
    root = createRoot(container);
    await act(async () => root.render(createElement(Owner)));
    expect(latest?.device).toEqual(EARLIER.device);
    expect(latest?.encode).toEqual(EARLIER.encode);
    expect(latest?.storage).toEqual(EARLIER.storage);
  });

  it("restores the earlier report, DSP included, after an abort during the DSP step (#1433)", async () => {
    await mountWithEarlier();
    let openDsp!: () => void;
    seam.dspGate = new Promise<void>((resolve) => {
      openDsp = resolve;
    });
    await act(async () => start?.());
    // Device and encode landed on the new run; the DSP step is held.
    await vi.waitFor(() => {
      expect(savedNow()?.encode).toMatchObject({ value: { mp3Bytes: 2 } });
    });
    expect(latest?.activity).toEqual({ kind: "dsp" });
    expect(savedNow()?.dsp).toBeNull();

    await act(async () => root.unmount());
    expect(savedNow()).toEqual(EARLIER);
    openDsp();
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    // The released step finds the signal aborted and lands nothing; storage never runs.
    expect(savedNow()).toEqual(EARLIER);
    root = createRoot(container);
    await act(async () => root.render(createElement(Owner)));
    expect(latest?.dsp).toEqual(EARLIER.dsp);
  });

  it("releases the run slot even when writing the earlier report back throws", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    try {
      await act(async () => root.unmount());
      open();
      await vi.waitFor(() => {
        expect(isPhoneCheckRunning()).toBe(false);
      });
    } finally {
      setItem.mockRestore();
    }
    expect(Storage.prototype.setItem).toBe(realSetItem);
  });

  it("reports a restore that throws at unmount instead of letting it escape the cleanup, and still releases the slot", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    const seen: unknown[] = [];
    const off = subscribeToFailures((r) => void seen.push(r));
    // The writes so far are the run's opening blanks; the next is the unmount's.
    seam.throwOnWriteCall = seam.writeCalls + 1;
    try {
      await act(async () => root.unmount());
      open();
      await vi.waitFor(() => {
        expect(isPhoneCheckRunning()).toBe(false);
      });
    } finally {
      off();
    }
    expect(seen.length).toBeGreaterThan(0);
  });

  it("releases the run slot when the run's own restore throws", async () => {
    await mountWithEarlier();
    let open!: () => void;
    seam.deviceGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await act(async () => start?.());
    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => void unhandled.push(cause);
    process.on("unhandledRejection", onUnhandled);
    // Skip the unmount's restore; the throw lands on the `finally`'s call.
    seam.throwOnWriteCall = seam.writeCalls + 2;
    try {
      await act(async () => root.unmount());
      open();
      await vi.waitFor(() => {
        expect(isPhoneCheckRunning()).toBe(false);
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still replaces the report whole when the run finishes", async () => {
    await mountWithEarlier();
    await act(async () => start?.());
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    const now = savedNow();
    expect(now?.device).toMatchObject({ status: "ok" });
    expect(now?.device).not.toEqual(EARLIER.device);
    expect(now?.encode).toMatchObject({ value: { mp3Bytes: 2 } });
    expect(now?.dsp).toMatchObject({ value: { warm: { checksum: 2 } } });
    expect(now?.storage).toMatchObject({ value: { bytes: 2 } });
    expect(latest?.encode).toMatchObject({ value: { mp3Bytes: 2 } });
  });

  it("still saves a probe that failed for a real reason", async () => {
    await mountWithEarlier();
    seam.deviceFails = true;
    await act(async () => start?.());
    await vi.waitFor(() => {
      expect(isPhoneCheckRunning()).toBe(false);
    });
    expect(savedNow()?.device).toEqual({
      status: "failed",
      errorName: "TypeError",
    });
    expect(savedNow()?.encode).toMatchObject({ status: "ok" });
  });
});
