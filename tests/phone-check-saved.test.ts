import { describe, expect, it, vi } from "vitest";

import {
  ALLOCATION_BREADCRUMB_KEY,
  PHONE_CHECK_CONTEXT,
  SAVED_CHECKS_KEY,
  readSavedChecks,
  writeSavedChecks,
  type BreadcrumbStore,
} from "@/hooks/phone-check-probes";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import {
  claimPhoneCheckRun,
  initialPhoneCheckState,
} from "@/hooks/use-phone-check";
import {
  parseSavedChecks,
  serializeSavedChecks,
  type SavedChecks,
} from "@/lib/phone-check/saved-results";

/**
 * #1009 — the memory ceiling is meant to run last and, on a small phone, ends
 * with the page reloading. Steps 1-3 must survive that reload, or the report
 * the tester copies afterwards says "not run" for device, encode and storage.
 */

function memoryStore(): BreadcrumbStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const FULL: SavedChecks = {
  device: {
    status: "ok",
    value: {
      userAgent: "test UA",
      deviceMemoryGb: 4,
      cores: 8,
      quotaBytes: 1_000_000,
      usageBytes: null,
      persisted: false,
    },
  },
  encode: {
    status: "ok",
    value: { audioSeconds: 300, wallMs: 12_000, mp3Bytes: 2_400_000 },
  },
  storage: { status: "failed", errorName: "QuotaExceededError" },
};

describe("saved step 1-3 results", () => {
  it("round-trip through their serialized form", () => {
    expect(parseSavedChecks(serializeSavedChecks(FULL))).toEqual(FULL);
    const none: SavedChecks = { device: null, encode: null, storage: null };
    expect(parseSavedChecks(serializeSavedChecks(none))).toEqual(none);
  });

  it("read absent, non-JSON and non-object values as nothing saved", () => {
    expect(parseSavedChecks(null)).toBeNull();
    expect(parseSavedChecks("{not json")).toBeNull();
    expect(parseSavedChecks("42")).toBeNull();
    expect(parseSavedChecks("null")).toBeNull();
  });

  it("drop a malformed section and keep the well-formed ones", () => {
    const raw = JSON.stringify({
      device: { status: "ok", value: { userAgent: 7 } },
      encode: FULL.encode,
      storage: { status: "failed" },
    });
    expect(parseSavedChecks(raw)).toEqual({
      device: null,
      encode: FULL.encode,
      storage: null,
    });
  });

  it("reject non-finite numbers, which JSON would have turned into null", () => {
    const raw = JSON.stringify({
      encode: {
        status: "ok",
        value: { audioSeconds: 300, wallMs: "12", mp3Bytes: 1 },
      },
    });
    expect(parseSavedChecks(raw)?.encode).toBeNull();
  });
});

describe("the phone check's first state", () => {
  it("restores saved steps 1-3 AND the reload breadcrumb together", () => {
    const store = memoryStore();
    writeSavedChecks(store, FULL);
    store.setItem(
      ALLOCATION_BREADCRUMB_KEY,
      JSON.stringify({ attemptingMb: 175, lastOkMb: 150 })
    );
    expect(initialPhoneCheckState(store)).toEqual({
      ...FULL,
      allocation: { kind: "reloaded", lastOkMb: 150, attemptingMb: 175 },
      activity: null,
    });
  });

  it("is empty with no store or nothing saved", () => {
    const empty = {
      device: null,
      encode: null,
      storage: null,
      allocation: null,
      activity: null,
    };
    expect(initialPhoneCheckState(null)).toEqual(empty);
    expect(initialPhoneCheckState(memoryStore())).toEqual(empty);
  });

  it("keeps the saved results under their own key, apart from the breadcrumb", () => {
    const store = memoryStore();
    writeSavedChecks(store, FULL);
    expect([...store.map.keys()]).toEqual([SAVED_CHECKS_KEY]);
    expect(SAVED_CHECKS_KEY).not.toBe(ALLOCATION_BREADCRUMB_KEY);
    expect(readSavedChecks(store)).toEqual(FULL);
  });

  it("never throws when storage refuses, and reports the refusal", () => {
    const seen: FailureReport[] = [];
    const unsubscribe = subscribeToFailures((r) => seen.push(r));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const refusing: BreadcrumbStore = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
      removeItem: () => {},
    };
    try {
      expect(() => writeSavedChecks(refusing, FULL)).not.toThrow();
      expect(readSavedChecks(refusing)).toBeNull();
      expect(seen.map((r) => r.context)).toEqual([
        PHONE_CHECK_CONTEXT,
        PHONE_CHECK_CONTEXT,
      ]);
    } finally {
      unsubscribe();
      error.mockRestore();
    }
  });
});

describe("claimPhoneCheckRun", () => {
  // Module-wide, not per screen: a run outlives the screen that started it,
  // and two storage probes on the one throwaway database race each other's
  // deletes.
  it("admits one run at a time until that run releases", () => {
    const release = claimPhoneCheckRun();
    expect(release).not.toBeNull();
    expect(claimPhoneCheckRun()).toBeNull();
    release?.();
    const again = claimPhoneCheckRun();
    expect(again).not.toBeNull();
    again?.();
  });

  it("ignores a second release, so it cannot free someone else's run", () => {
    const first = claimPhoneCheckRun();
    first?.();
    const second = claimPhoneCheckRun();
    first?.();
    expect(claimPhoneCheckRun()).toBeNull();
    second?.();
  });
});
