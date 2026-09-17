import { describe, expect, it, vi } from "vitest";

import {
  readStorageEstimate,
  type StorageEstimateSource,
} from "@/hooks/use-storage-estimate";

/**
 * #247 — the browser-boundary half of the storage-pressure marker.
 * `readStorageEstimate` is a plain async function over an injected source,
 * the same shape `ensurePersistedStorage` (`tests/storage-persistence.test.ts`)
 * is tested through, so it is exercised here in plain Node without a jsdom or
 * a real `navigator.storage`. The React hook it backs, `useStorageEstimate`,
 * is DOM-boundary/render surface with no test in this repo — see that hook's
 * own docblock.
 */

const source = (
  parts: Partial<{
    estimate: () => Promise<{ usage?: number; quota?: number }>;
  }>
): StorageEstimateSource => parts;

describe("readStorageEstimate", () => {
  it("reads usage and quota from a successful estimate()", async () => {
    const reading = await readStorageEstimate(
      source({ estimate: async () => ({ usage: 100, quota: 1000 }) })
    );
    expect(reading).toEqual({ usage: 100, quota: 1000 });
  });

  it("passes through a partial estimate as-is (both fields are optional in the spec)", async () => {
    const reading = await readStorageEstimate(
      source({ estimate: async () => ({ usage: 100 }) })
    );
    expect(reading).toEqual({ usage: 100, quota: undefined });
  });

  it("treats an absent API as null", async () => {
    expect(await readStorageEstimate(undefined)).toBeNull();
    expect(await readStorageEstimate(source({}))).toBeNull();
  });

  it("never throws when estimate() rejects", async () => {
    const estimate = vi.fn(() =>
      Promise.reject(new Error("no storage manager"))
    );
    const reading = await readStorageEstimate(source({ estimate }));
    expect(reading).toBeNull();
    expect(estimate).toHaveBeenCalledTimes(1);
  });
});
