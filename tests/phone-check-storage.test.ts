import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALLOCATION_BREADCRUMB_KEY,
  PHONE_CHECK_CONTEXT,
  PHONE_CHECK_DB_NAME,
  readAllocationBreadcrumb,
  readDeviceInfo,
  runStorageProbe,
  settleProbe,
  writeAllocationBreadcrumb,
  type BreadcrumbStore,
} from "@/hooks/phone-check-probes";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { runAllocationSteps } from "@/lib/phone-check/allocation";

/**
 * #1009 — the phone check never touches the app's data.
 *
 * The storage probe must use its own throwaway IndexedDB database and delete
 * it afterwards, on success and on failure; and the probes run here must never
 * open a connection of their own to the app's database (`"tc-mobile"`,
 * `lib/storage/db.ts`). The proof is a spy on `indexedDB.open` — the one door
 * every IndexedDB connection goes through, `idb` and `getDb` alike —
 * recording every name opened while the device, storage and allocation probes
 * run. It does not run the worker encode, and no durable failure log is
 * subscribed here: in the app, a probe FAILURE reaches the failure log through
 * `reportFailure`, and that log writes to its own store in the app's database
 * by design.
 */

/** The app's database name, private to `lib/storage/db.ts`; kept in sync by hand as in db-open.test.ts. */
const APP_DB_NAME = "tc-mobile";

const SMALL = { bytes: 64 * 1024, chunkBytes: 16 * 1024 } as const;

let opened: string[];
let restoreOpen: () => void;

beforeEach(() => {
  opened = [];
  const real = indexedDB.open.bind(indexedDB);
  const spy = vi
    .spyOn(indexedDB, "open")
    .mockImplementation((name, version) => {
      opened.push(name);
      return real(name, version);
    });
  restoreOpen = () => spy.mockRestore();
});

afterEach(() => {
  restoreOpen();
});

async function databaseNames(): Promise<string[]> {
  const all = await indexedDB.databases();
  return all.map((d) => d.name ?? "");
}

describe("the storage probe's throwaway database", () => {
  it("is not the app's database", () => {
    expect(PHONE_CHECK_DB_NAME).not.toBe(APP_DB_NAME);
  });

  it("writes and reads back, reports the bytes, and deletes the database", async () => {
    const result = await runStorageProbe(SMALL);
    expect(result.bytes).toBe(SMALL.bytes);
    expect(result.writeMs).toBeGreaterThanOrEqual(0);
    expect(result.readMs).toBeGreaterThanOrEqual(0);
    // It really did open its own database — so the "deleted" check below is
    // about a database that existed, not one that never did.
    expect(opened).toContain(PHONE_CHECK_DB_NAME);
    expect(await databaseNames()).not.toContain(PHONE_CHECK_DB_NAME);
  });

  it("times the writes only, not building the test chunks", async () => {
    // A clock that moves only while a chunk is being built: if building sat
    // inside the timed region, the write time would be chunks x 1000 ms.
    let t = 0;
    const result = await runStorageProbe({
      ...SMALL,
      now: () => t,
      onChunkFilled: () => {
        t += 1000;
      },
    });
    expect(result.writeMs).toBe(0);
    expect(result.readMs).toBe(0);
  });

  it("deletes the database when the probe fails part-way", async () => {
    let reads = 0;
    const failingClock = () => {
      reads += 1;
      if (reads === 2)
        throw new Error("clock failed after the first write batch");
      return 0;
    };
    await expect(
      runStorageProbe({ ...SMALL, now: failingClock })
    ).rejects.toThrow("clock failed");
    expect(opened).toContain(PHONE_CHECK_DB_NAME);
    expect(await databaseNames()).not.toContain(PHONE_CHECK_DB_NAME);
  });
});

describe("the check never opens the app's database", () => {
  it("opens no database but its own across every probe it runs in Node", async () => {
    const device = await settleProbe(() =>
      readDeviceInfo({
        userAgent: "test",
        storage: {
          estimate: async () => ({ quota: 1, usage: 0 }),
          persisted: async () => false,
        },
      })
    );
    const storage = await settleProbe(() => runStorageProbe(SMALL));
    const crumbs = new Map<string, string>();
    const store: BreadcrumbStore = {
      getItem: (k) => crumbs.get(k) ?? null,
      setItem: (k, v) => void crumbs.set(k, v),
      removeItem: (k) => void crumbs.delete(k),
    };
    await runAllocationSteps({
      steps: [1, 2],
      allocate: () => {},
      writeBreadcrumb: (crumb) => writeAllocationBreadcrumb(store, crumb),
      yieldTurn: () => Promise.resolve(),
    });

    expect(device.status).toBe("ok");
    expect(storage.status).toBe("ok");
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((name) => name !== PHONE_CHECK_DB_NAME)).toEqual([]);
    expect(await databaseNames()).not.toContain(APP_DB_NAME);
  });
});

describe("settleProbe", () => {
  it("reports a throw to the funnel as phone-check and returns its name", async () => {
    const seen: FailureReport[] = [];
    const unsubscribe = subscribeToFailures((r) => seen.push(r));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cause = new TypeError("boom");
      const outcome = await settleProbe(() => Promise.reject(cause));
      expect(outcome).toEqual({ status: "failed", errorName: "TypeError" });
      expect(seen).toEqual([{ context: PHONE_CHECK_CONTEXT, cause }]);
      expect(PHONE_CHECK_CONTEXT).toBe("phone-check");
    } finally {
      unsubscribe();
      error.mockRestore();
    }
  });
});

describe("the allocation breadcrumb store", () => {
  it("writes, reads back and clears under one key", () => {
    const crumbs = new Map<string, string>();
    const store: BreadcrumbStore = {
      getItem: (k) => crumbs.get(k) ?? null,
      setItem: (k, v) => void crumbs.set(k, v),
      removeItem: (k) => void crumbs.delete(k),
    };
    writeAllocationBreadcrumb(store, { attemptingMb: 50, lastOkMb: 25 });
    expect([...crumbs.keys()]).toEqual([ALLOCATION_BREADCRUMB_KEY]);
    expect(readAllocationBreadcrumb(store)).toEqual({
      attemptingMb: 50,
      lastOkMb: 25,
    });
    writeAllocationBreadcrumb(store, null);
    expect(readAllocationBreadcrumb(store)).toBeNull();
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
      expect(() =>
        writeAllocationBreadcrumb(refusing, { attemptingMb: 25, lastOkMb: 0 })
      ).not.toThrow();
      expect(readAllocationBreadcrumb(refusing)).toBeNull();
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
