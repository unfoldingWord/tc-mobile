import { describe, expect, it } from "vitest";

import {
  CRITICAL_PRESSURE_FREE_BYTES,
  CRITICAL_PRESSURE_FREE_RATIO,
  LOW_PRESSURE_FREE_BYTES,
  LOW_PRESSURE_FREE_RATIO,
  storagePressure,
} from "@/lib/storage/pressure";

/**
 * #247 — the deferred half of #12: a nearly-full `navigator.storage.estimate()`
 * as a state-in-place marker on Books, one lane over from `persistence.ts`'s
 * `storageMarker`.
 *
 * `storagePressure` is pure — two numbers in, one of three states out — so it
 * is pinned here in plain Node the same way `storageMarker` is. Both threshold
 * families (a byte floor and a free-ratio floor) are proposals from #247's
 * issue body, not a measured fact (see the module's own docblock and AGENTS.md
 * "never claim verification you did not perform"); this file pins the numbers
 * as WRITTEN, not as validated against a real device.
 *
 * Every boundary is tested on both sides of the `<=` so a mutation to `<`
 * (or the reverse) dies here rather than reading as covered by a
 * same-side-only assertion.
 */

describe("storagePressure", () => {
  it("says ok comfortably away from every threshold", () => {
    // 1 GB quota, 100 MB used -> 900 MB / 90% free.
    expect(storagePressure(100_000_000, 1_000_000_000)).toBe("ok");
  });

  describe("the absent/unknown case", () => {
    it("says ok when usage is undefined (no estimate, or estimate() rejected)", () => {
      expect(storagePressure(undefined, 1_000_000_000)).toBe("ok");
    });

    it("says ok when quota is undefined", () => {
      expect(storagePressure(100_000_000, undefined)).toBe("ok");
    });

    it("says ok when both are undefined (absent navigator.storage)", () => {
      expect(storagePressure(undefined, undefined)).toBe("ok");
    });

    it("says ok for a non-finite or non-positive quota, never divides by zero", () => {
      expect(storagePressure(0, 0)).toBe("ok");
      expect(storagePressure(0, -1)).toBe("ok");
      expect(storagePressure(0, NaN)).toBe("ok");
      expect(storagePressure(NaN, 1_000_000_000)).toBe("ok");
    });
  });

  describe("the low-pressure byte floor", () => {
    // Quota chosen so the free-ratio floor (15%) does NOT also trip at the
    // free-byte edge under test: 500 MB quota, 100 MB free -> 20.97% free,
    // comfortably above 15%, so only the byte floor is under test here.
    const quota = 500_000_000;

    it("trips at exactly the byte floor", () => {
      const free = LOW_PRESSURE_FREE_BYTES;
      expect(storagePressure(quota - free, quota)).toBe("low");
    });

    it("does not trip one byte above the floor", () => {
      const free = LOW_PRESSURE_FREE_BYTES + 1;
      expect(storagePressure(quota - free, quota)).toBe("ok");
    });
  });

  describe("the low-pressure free-ratio floor", () => {
    // 10 GB quota so the free amount at the 15% edge (1.5 GB) is nowhere near
    // the 100 MB byte floor — only the ratio floor is under test here.
    const quota = 10_000_000_000;

    it("trips at exactly the ratio floor", () => {
      const free = quota * LOW_PRESSURE_FREE_RATIO;
      expect(storagePressure(quota - free, quota)).toBe("low");
    });

    it("does not trip one byte above the ratio floor", () => {
      const free = quota * LOW_PRESSURE_FREE_RATIO + 1;
      expect(storagePressure(quota - free, quota)).toBe("ok");
    });
  });

  describe("the critical byte floor", () => {
    // 300 MB quota, 30 MB free -> 10.49% free: above the critical ratio (5%)
    // so only the byte floor is under test here. (It is also under the LOW
    // ratio floor, which is expected -- critical implies "worse than low".)
    const quota = 300_000_000;

    it("trips at exactly the byte floor", () => {
      const free = CRITICAL_PRESSURE_FREE_BYTES;
      expect(storagePressure(quota - free, quota)).toBe("critical");
    });

    it("falls back to low one byte above the critical floor", () => {
      const free = CRITICAL_PRESSURE_FREE_BYTES + 1;
      expect(storagePressure(quota - free, quota)).toBe("low");
    });
  });

  describe("the critical free-ratio floor", () => {
    // 10 GB quota so the free amount at the 5% edge (500 MB) is nowhere near
    // the 30 MB byte floor -- only the ratio floor is under test here.
    const quota = 10_000_000_000;

    it("trips at exactly the ratio floor", () => {
      const free = quota * CRITICAL_PRESSURE_FREE_RATIO;
      expect(storagePressure(quota - free, quota)).toBe("critical");
    });

    it("falls back to low one byte above the critical ratio floor", () => {
      const free = quota * CRITICAL_PRESSURE_FREE_RATIO + 1;
      expect(storagePressure(quota - free, quota)).toBe("low");
    });
  });
});
