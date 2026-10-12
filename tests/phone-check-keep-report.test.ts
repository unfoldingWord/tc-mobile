// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSavedChecks, SAVED_CHECKS_KEY } from "@/hooks/phone-check-probes";
import {
  isPhoneCheckRunning,
  usePhoneCheck,
  type PhoneCheckState,
} from "@/hooks/use-phone-check";
import type { SavedChecks } from "@/lib/phone-check/saved-results";

/**
 * #1379 item 4: an aborted run leaves the earlier report in place. The probes
 * are replaced so a test can hold a run after the opening state has landed.
 */

const seam = vi.hoisted(() => ({
  deviceGate: null as Promise<void> | null,
  deviceFails: false,
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
    runWorkerEncodeProbe: () =>
      Promise.resolve({ audioSeconds: 2, wallMs: 2, mp3Bytes: 2 }),
    runStorageProbe: () => Promise.resolve({ bytes: 2, writeMs: 2, readMs: 2 }),
  };
});

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
    seam.deviceFails = false;
    latest = undefined;
    start = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
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
    expect(savedNow()).toEqual({ device: null, encode: null, storage: null });

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

  it("leaves nothing saved when there was no earlier report", async () => {
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
    expect(savedNow()).toEqual({ device: null, encode: null, storage: null });
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
