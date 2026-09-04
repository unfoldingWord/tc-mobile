import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { deleteClip, newClipId, putClip } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { clearAllStores } from "./support";

/**
 * The clip write and the clip delete ask for strict durability (#179, #163) —
 * T1, `lib/storage`.
 *
 * The same asymmetry #179 closed for `saveTake` and `clearSegmentTake`: a
 * transaction that reports success under the browser default (relaxed on
 * Chromium) may not have been flushed, so a crash or a power loss just after it
 * returns can take the write with it. Both transactions here move the only copy
 * of a clip's audio — `putClip` puts the bytes there, `deleteClip` removes them
 * — which is the same bar, for the same reason.
 *
 * `getClip` and `getClipMeta` are deliberately NOT here: durability is a
 * property of a write, and a read has nothing to flush.
 *
 * This is a CONTRACT test, and that limit is the point — the same one
 * `tests/take-durability.test.ts` states: fake-indexeddb accepts the options bag
 * and stores nothing to flush, so no test in this repo can exercise real
 * durability semantics. What it pins is that the option is ASKED FOR at both
 * sites, which is the part that silently regresses in an edit. Whether a given
 * phone honours it is platform behaviour, unmeasured here.
 *
 * The assertion reads the third argument of `IDBDatabase.transaction`, because
 * neither function returns its transaction — so the arguments they pass are the
 * only seam to observe. `unwrap` reaches past idb's proxy to the native database
 * the wrapper ultimately calls, so the spy sees exactly what `lib/storage`
 * passed.
 */

/** The options bag of every transaction `run` opens, in call order. */
async function transactionOptionsDuring(
  run: () => Promise<void>
): Promise<(IDBTransactionOptions | undefined)[]> {
  const raw = unwrap(await getDb()) as IDBDatabase;
  const spy = vi.spyOn(raw, "transaction");
  try {
    await run();
    return spy.mock.calls.map((call) => call[2]);
  } finally {
    spy.mockRestore();
  }
}

const samples = (n: number): Int16Array =>
  Int16Array.from({ length: n }, (_, i) => i + 1);

beforeEach(async () => {
  await clearAllStores();
});

describe("clip writes ask for strict durability", () => {
  it("putClip opens its transaction with durability: strict", async () => {
    const options = await transactionOptionsDuring(async () => {
      await putClip(newClipId(), samples(1000), CANONICAL_SAMPLE_RATE);
    });

    expect(options).toEqual([{ durability: "strict" }]);
  });

  it("deleteClip opens its transaction with durability: strict", async () => {
    // Written BEFORE the spy is installed, so only the delete's transaction is
    // observed.
    const clipId = newClipId();
    await putClip(clipId, samples(1000), CANONICAL_SAMPLE_RATE);

    const options = await transactionOptionsDuring(async () => {
      await deleteClip(clipId);
    });

    expect(options).toEqual([{ durability: "strict" }]);
  });
});
