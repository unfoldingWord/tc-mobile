import { describe, expect, it, vi } from "vitest";

import {
  bumpStoragePressure,
  readStorageEstimate,
  storageEstimateSourceOf,
  storagePressureGeneration,
  type StorageEstimateSource,
} from "@/hooks/use-storage-pressure";
import {
  CRITICAL_PRESSURE_FREE_BYTES,
  CRITICAL_PRESSURE_FREE_PERCENT,
  LOW_PRESSURE_FREE_BYTES,
  LOW_PRESSURE_FREE_PERCENT,
  MAX_SAFE_BYTE_COUNT,
  storagePressure,
  storagePressureMarker,
} from "@/lib/storage/pressure";

/**
 * #247 — how full this origin's storage is: the pure three-band decision, and
 * the `navigator.storage.estimate()` call that feeds it. The sibling of #12's
 * `storageMarker`/`ensurePersistedStorage` pair, tested the same way and in
 * the same two halves.
 *
 * Both halves run in plain Node: `storagePressure` is arithmetic over two
 * numbers, and `readStorageEstimate` takes its source injected, the way
 * `ensurePersistedStorage` takes its manager
 * (`tests/storage-persistence.test.ts`). No jsdom, no real
 * `navigator.storage`.
 *
 * Not covered here: `useStoragePressure` effects or real device readings of
 * `usage`/`quota`. The thresholds below are pinned as written; these tests
 * do not establish that the thresholds are appropriate on a device.
 *
 * Every threshold is asserted on BOTH sides of its `<`, and every disjunct is
 * asserted with the other one deliberately not tripping, so a `<` -> `<=` or
 * an `||` -> `&&` mutation kills a named case here rather than reading as
 * covered.
 */

describe("storagePressure", () => {
  it("says ok comfortably clear of every threshold", () => {
    // 1 GB quota, 100 MB used -> 900 MB and 90% free.
    expect(storagePressure(100_000_000, 1_000_000_000)).toBe("ok");
  });

  describe("readings it refuses to judge", () => {
    // The load-bearing half of this module. A marker that fires on a browser
    // that answered `undefined` is worse than no marker at all: it is a
    // warning with no evidence behind it, and the translator cannot tell the
    // two apart. "unknown" is a distinct state from "ok" on purpose — "ok" is
    // a positive claim of headroom, and we only get to make it from numbers.
    // Both render nothing; only one of them is an assertion.

    it("is unknown when usage is absent (no API, or estimate() rejected)", () => {
      expect(storagePressure(undefined, 1_000_000_000)).toBe("unknown");
    });

    it("is unknown when quota is absent", () => {
      expect(storagePressure(100_000_000, undefined)).toBe("unknown");
    });

    it("is unknown when both are absent", () => {
      expect(storagePressure(undefined, undefined)).toBe("unknown");
    });

    it("is unknown for a zero quota, and never a false critical", () => {
      // The trap this case exists for: zero free out of zero quota is
      // arithmetically "0% free", which every threshold below would read as
      // critical. A browser that reports no quota has told us nothing.
      expect(storagePressure(0, 0)).toBe("unknown");
      expect(storagePressure(1000, 0)).toBe("unknown");
    });

    it("is unknown for a negative quota or a negative usage", () => {
      expect(storagePressure(0, -1)).toBe("unknown");
      expect(storagePressure(-1, 1_000_000_000)).toBe("unknown");
    });

    it("is unknown for NaN or Infinity in either field", () => {
      expect(storagePressure(NaN, 1_000_000_000)).toBe("unknown");
      expect(storagePressure(100, NaN)).toBe("unknown");
      expect(storagePressure(Number.POSITIVE_INFINITY, 1_000_000_000)).toBe(
        "unknown"
      );
      expect(storagePressure(100, Number.POSITIVE_INFINITY)).toBe("unknown");
    });

    it("is unknown for a figure too large to be a byte count", () => {
      // Past the ceiling the percent comparison stops being exact, and far
      // enough past it `free * 100` reaches Infinity — at which point every
      // comparison answers nonsense rather than failing loudly. Refusing is
      // the only honest answer; a guessed band is not.
      expect(storagePressure(0, Number.MAX_VALUE)).toBe("unknown");
      expect(storagePressure(Number.MAX_VALUE, 1_000_000_000)).toBe("unknown");
      expect(storagePressure(0, Number.MAX_SAFE_INTEGER)).toBe("unknown");
      expect(storagePressure(0, MAX_SAFE_BYTE_COUNT + 1)).toBe("unknown");
      expect(storagePressure(MAX_SAFE_BYTE_COUNT + 1, 1_000_000_000)).toBe(
        "unknown"
      );
    });

    it("still judges a reading exactly at the ceiling", () => {
      // The other half of the gate: the bound rejects what it exists to
      // reject and passes what it does not. Frank round 1 P3 — the docblock
      // claims `free * 100` and `quota * PERCENT` are exact for every figure
      // this module accepts, and `Number.MAX_SAFE_INTEGER` as the bound made
      // that claim false (at 9_007_199_254_740_987 / 7_656_119_366_529_839
      // the exact answer is "low" and the float answer was "ok"). The ceiling
      // is a hundredth of that, so the products stay inside the safe range.
      expect(storagePressure(0, MAX_SAFE_BYTE_COUNT)).toBe("ok");

      // A quota at the ceiling, rounded to a multiple of 20 so 15% of it is
      // an integer: the percent edge is still decided exactly up here.
      const quota = 90_071_992_547_400;
      const floor = (quota * LOW_PRESSURE_FREE_PERCENT) / 100;
      expect(storagePressure(quota - floor, quota)).toBe("ok");
      expect(storagePressure(quota - floor + 1, quota)).toBe("low");
    });
  });

  describe("the low-pressure byte floor", () => {
    // 500 MB quota so the percent floor is NOT also tripping at the byte edge
    // under test: 100 MiB free of 500 MB is 20.9%, clear of 15%.
    const quota = 500_000_000;

    it("does not trip with exactly the floor still free", () => {
      // "under 100 MB" (#247) means under: holding exactly the headroom we
      // insist on is still holding it.
      expect(storagePressure(quota - LOW_PRESSURE_FREE_BYTES, quota)).toBe(
        "ok"
      );
    });

    it("trips one byte below the floor", () => {
      expect(storagePressure(quota - LOW_PRESSURE_FREE_BYTES + 1, quota)).toBe(
        "low"
      );
    });
  });

  describe("the low-pressure percent floor", () => {
    // 10 GB quota so the free amount at the 15% edge (1.5 GB) is nowhere near
    // the 100 MB byte floor: only the percent floor is under test here.
    const quota = 10_000_000_000;
    const floor = (quota * LOW_PRESSURE_FREE_PERCENT) / 100; // 1_500_000_000

    it("does not trip with exactly the floor still free", () => {
      expect(storagePressure(quota - floor, quota)).toBe("ok");
    });

    it("trips one byte below the floor", () => {
      expect(storagePressure(quota - floor + 1, quota)).toBe("low");
    });
  });

  describe("the critical byte floor", () => {
    // 300 MB quota: 30 MiB free is 10.4%, clear of the 5% percent floor, so
    // only the byte floor is under test. It IS under the low percent floor,
    // which is the point — critical means worse than low.
    const quota = 300_000_000;

    it("does not trip with exactly the floor still free, and reads low instead", () => {
      expect(storagePressure(quota - CRITICAL_PRESSURE_FREE_BYTES, quota)).toBe(
        "low"
      );
    });

    it("trips one byte below the floor", () => {
      expect(
        storagePressure(quota - CRITICAL_PRESSURE_FREE_BYTES + 1, quota)
      ).toBe("critical");
    });
  });

  describe("the critical percent floor", () => {
    // 10 GB quota so the free amount at the 5% edge (500 MB) is nowhere near
    // the 30 MB byte floor.
    const quota = 10_000_000_000;
    const floor = (quota * CRITICAL_PRESSURE_FREE_PERCENT) / 100; // 500_000_000

    it("does not trip with exactly the floor still free, and reads low instead", () => {
      expect(storagePressure(quota - floor, quota)).toBe("low");
    });

    it("trips one byte below the floor", () => {
      expect(storagePressure(quota - floor + 1, quota)).toBe("critical");
    });
  });

  describe("either floor is enough on its own", () => {
    // The `||`s. A percentage alone lets a huge-quota device burn a huge
    // absolute amount before it warns; a byte floor alone fires immediately on
    // a device whose whole quota is small. Each case below trips exactly one
    // of the pair, so an `||` collapsed to `&&` kills it.

    it("is low on the byte floor alone (percent nowhere near)", () => {
      // The two floors only separate in this direction below ~699 MB of
      // quota: 500 MB quota with 90 MiB free is 18.9% free — clear of the 15%
      // percent floor — and still under the 100 MiB byte floor.
      expect(storagePressure(500_000_000 - 90 * 1024 * 1024, 500_000_000)).toBe(
        "low"
      );
    });

    it("is low on the percent floor alone (bytes nowhere near)", () => {
      // 10 GB quota, 1 GB free: 10% free, and 1 GB is ten times the byte
      // floor.
      expect(storagePressure(9_000_000_000, 10_000_000_000)).toBe("low");
    });

    it("is critical on the byte floor alone (percent nowhere near)", () => {
      // 300 MB quota, 20 MiB free: 6.99% free, above the 5% percent floor.
      expect(storagePressure(300_000_000 - 20 * 1024 * 1024, 300_000_000)).toBe(
        "critical"
      );
    });

    it("is critical on the percent floor alone (bytes nowhere near)", () => {
      // 10 GB quota, 400 MB free: 4% free, and 400 MB is thirteen times the
      // 30 MB byte floor.
      expect(storagePressure(9_600_000_000, 10_000_000_000)).toBe("critical");
    });
  });

  describe("no room at all", () => {
    it("is critical with nothing free", () => {
      expect(storagePressure(1_000_000_000, 1_000_000_000)).toBe("critical");
    });

    it("is critical when usage exceeds quota", () => {
      // Over-quota is a real reading, not a malformed one: a browser can
      // lower a quota under device pressure while data already sits above it.
      // Negative headroom is worse than none, never an unknown and never ok.
      expect(storagePressure(1_200_000_000, 1_000_000_000)).toBe("critical");
    });
  });
});

/** A `navigator.storage` stand-in with only the method a case needs. */
const source = (
  parts: Partial<{
    estimate: () => Promise<{ usage?: number; quota?: number }>;
  }>
): StorageEstimateSource => parts;

describe("readStorageEstimate", () => {
  it("reads usage and quota back from a successful estimate()", async () => {
    expect(
      await readStorageEstimate(
        source({ estimate: async () => ({ usage: 100, quota: 1000 }) })
      )
    ).toEqual({ usage: 100, quota: 1000 });
  });

  it("passes a partial answer through (both fields are optional in the spec)", async () => {
    expect(
      await readStorageEstimate(
        source({ estimate: async () => ({ usage: 100 }) })
      )
    ).toEqual({ usage: 100, quota: undefined });
  });

  it("returns null when there is no API to ask", async () => {
    expect(await readStorageEstimate(undefined)).toBeNull();
    expect(await readStorageEstimate(source({}))).toBeNull();
  });

  it("never rejects when estimate() rejects", async () => {
    const estimate = vi.fn(() => Promise.reject(new Error("no storage")));
    expect(await readStorageEstimate(source({ estimate }))).toBeNull();
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it("never throws when estimate() throws synchronously", async () => {
    const estimate = vi.fn(() => {
      throw new Error("not a function call that returns a promise");
    });
    expect(await readStorageEstimate(source({ estimate }))).toBeNull();
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it("never throws when reading the method itself throws", async () => {
    // Frank round 1 P2-2. `estimate` is a property, and a property can be an
    // accessor: a source whose getter throws made this function REJECT,
    // because the read happened before the `try`. The hook attaches only
    // `.then`, so that landed as an unhandled rejection in a mount effect —
    // precisely what "never rejects" exists to prevent. Everything the
    // function touches now happens inside the try.
    const hostile = {
      get estimate(): () => Promise<{ usage?: number; quota?: number }> {
        throw new Error("hostile getter");
      },
    };
    await expect(readStorageEstimate(hostile)).resolves.toBeNull();
  });

  it("never throws when reading a field of the answer throws", async () => {
    // The same shape one level in: `usage` and `quota` are properties too.
    const estimate = async () =>
      ({
        get usage(): number {
          throw new Error("hostile field");
        },
        quota: 1000,
      }) as unknown as { usage?: number; quota?: number };
    await expect(readStorageEstimate(source({ estimate }))).resolves.toBeNull();
  });

  it("returns null for a primitive answer, rather than reading fields off it", async () => {
    // A number has no `usage`, so destructuring it would quietly produce a
    // reading of two `undefined`s — "the browser answered, partially" — when
    // what happened is that it answered nonsense. `null` says the second.
    const estimate = async () =>
      42 as unknown as { usage?: number; quota?: number };
    expect(await readStorageEstimate(source({ estimate }))).toBeNull();
  });

  it("returns null for an answer that is not an object at all", async () => {
    const estimate = async () =>
      null as unknown as { usage?: number; quota?: number };
    expect(await readStorageEstimate(source({ estimate }))).toBeNull();
  });

  it("drops a field that is not a number, rather than passing a lie on", async () => {
    // The return type says `number | undefined`; only this line makes that
    // true at runtime. `storagePressure` then reads the dropped field as the
    // unknown it is, instead of comparing a string against a byte floor.
    const estimate = async () =>
      ({ usage: "lots", quota: 1000 }) as unknown as {
        usage?: number;
        quota?: number;
      };
    expect(await readStorageEstimate(source({ estimate }))).toEqual({
      usage: undefined,
      quota: 1000,
    });
  });

  it("leaves range sanity to storagePressure, and does not pre-judge it", async () => {
    // One place decides what a usable byte count is, and it is the pure
    // module. The boundary only answers "did the browser hand back numbers".
    expect(
      await readStorageEstimate(
        source({ estimate: async () => ({ usage: -1, quota: 0 }) })
      )
    ).toEqual({ usage: -1, quota: 0 });
    expect(storagePressure(-1, 0)).toBe("unknown");
  });
});

describe("storagePressureMarker", () => {
  /**
   * George R4 G5. The other two producers for the Books standing-condition
   * slot return `null` for silence — `storageMarker`
   * (`lib/storage/persistence.ts`) and `encoderNotice`
   * (`components/encoder-notice.ts`) — so a consumer writes
   * `{marker && <Notice>}`. A hook that always returns a string makes that
   * `&&` always true, and the screen paints the word `ok`. The four-state
   * union stays inside this module, where the bands are decided; what leaves
   * is what there is to show.
   */

  it("shows the two bands worth showing", () => {
    expect(storagePressureMarker("low")).toBe("low");
    expect(storagePressureMarker("critical")).toBe("critical");
  });

  it("is null for ok and for unknown — the two silences", () => {
    // Different reasons, same rendering: "ok" is headroom we measured,
    // "unknown" is a question we could not ask. Neither is a marker.
    expect(storagePressureMarker("ok")).toBeNull();
    expect(storagePressureMarker("unknown")).toBeNull();
  });
});

describe("storageEstimateSourceOf", () => {
  /**
   * Frank round 2: `readStorageEstimate` protects its own body, but its
   * ARGUMENT is evaluated first — and finding the source means reading
   * `navigator` and then `navigator.storage`, two properties that can be
   * accessors or proxy traps and can throw (a `SecurityError` in an embedded
   * shell is the realistic case). That threw synchronously inside the mount
   * effect, before the cleanup was installed. Taking the scope as an argument
   * is what lets these cases exist at all: `globalThis` is the only reference
   * in the chain that cannot throw.
   */

  it("finds the manager on a scope that has one", () => {
    const storage = { estimate: async () => ({ usage: 1, quota: 2 }) };
    expect(storageEstimateSourceOf({ navigator: { storage } })).toBe(storage);
  });

  it("is undefined when the scope, the navigator or the manager is missing", () => {
    // The plain Node case is the third of these: Node 22 has a `navigator`
    // and no `navigator.storage`.
    expect(storageEstimateSourceOf(undefined)).toBeUndefined();
    expect(storageEstimateSourceOf({})).toBeUndefined();
    expect(storageEstimateSourceOf({ navigator: {} })).toBeUndefined();
  });

  it("is undefined for a manager that is not an object", () => {
    expect(
      storageEstimateSourceOf({ navigator: { storage: null } })
    ).toBeUndefined();
    expect(
      storageEstimateSourceOf({ navigator: { storage: 42 } })
    ).toBeUndefined();
  });

  it("never throws when reading navigator throws", () => {
    const scope = {
      get navigator(): unknown {
        throw new Error("SecurityError");
      },
    };
    expect(storageEstimateSourceOf(scope)).toBeUndefined();
  });

  it("never throws when reading navigator.storage throws", () => {
    const scope = {
      navigator: {
        get storage(): unknown {
          throw new Error("SecurityError");
        },
      },
    };
    expect(storageEstimateSourceOf(scope)).toBeUndefined();
  });

  it("never throws when the scope is a proxy whose traps throw", () => {
    const scope = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        has() {
          throw new Error("trap");
        },
      }
    );
    expect(storageEstimateSourceOf(scope)).toBeUndefined();
  });
});

describe("bumpStoragePressure", () => {
  /**
   * #542 Part A (DRI decision, 2026-09-24): "build the module-scope
   * estimate() invalidation now, bumped by book delete/create, without a
   * device reading." `bumpStoragePressure` is that invalidation — a
   * module-scope generation counter, in the same shape `mp3-codec.ts`'s
   * encoder health and `failure-log.ts`'s log count already use — that
   * `useStoragePressure` (untestable here without a DOM renderer, same
   * limitation as every other effect in this module) takes as an effect
   * dependency so a bump makes it re-read `estimate()` without a remount.
   *
   * This is the whole of what can be pinned in Node: the counter's own
   * contract. `storagePressureGeneration()` exists only to make that
   * possible — see its own docblock.
   *
   * Deltas, not absolute values, throughout: `generation` is module-scope
   * state shared by every test in this file (and every other `it` in this
   * `describe`), so an assertion on an absolute count would be order-
   * dependent (#542).
   */

  it("advances the generation by exactly one per call", () => {
    const before = storagePressureGeneration();
    bumpStoragePressure();
    expect(storagePressureGeneration()).toBe(before + 1);
  });

  it("is monotonic across repeated calls — never resets, never decreases", () => {
    const before = storagePressureGeneration();
    bumpStoragePressure();
    bumpStoragePressure();
    bumpStoragePressure();
    expect(storagePressureGeneration()).toBe(before + 3);
  });

  it("tolerates being called more than once for one logical write, harmlessly", () => {
    // The idempotency property this needs: a retried book create/delete that
    // calls this twice must not corrupt anything or throw — it costs one
    // extra `estimate()` read in whichever mount is live, nothing else.
    const before = storagePressureGeneration();
    expect(() => {
      bumpStoragePressure();
      bumpStoragePressure();
    }).not.toThrow();
    expect(storagePressureGeneration()).toBe(before + 2);
  });
});
