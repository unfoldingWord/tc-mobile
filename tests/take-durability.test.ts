import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  addChapter,
  addSegment,
  clearSegmentTake,
  createBook,
  saveTake,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { clearAllStores } from "./support";

/**
 * The take write asks for strict durability (#179) — T1, `lib/storage`.
 *
 * A transaction that returns success under the browser default (relaxed on
 * Chromium) may not have been flushed yet, so a crash or a power loss just
 * after a translator stops recording can take the recording with it. The two
 * transactions here are the ones that create and remove the ONLY copy of a
 * take, which is why they are held to the same bar `commitTranscode` already
 * meets (ADR 0009).
 *
 * This is a CONTRACT test, and that limit is the point: fake-indexeddb accepts
 * the options bag and stores nothing to flush, so no test in this repo can
 * exercise real durability semantics. What it pins is that the option is
 * ASKED FOR at both sites — the part that can silently regress in an edit.
 * Whether a given phone honours it is platform behaviour, unmeasured here.
 *
 * The assertion reads the third argument of `IDBDatabase.transaction`, because
 * neither the DOM nor fake-indexeddb exposes the durability back on the
 * transaction object. `unwrap` reaches past idb's proxy to the native database
 * the wrapper ultimately calls, so the spy sees exactly the arguments
 * `lib/storage` passed.
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

/** A book/chapter/segment to record into, created BEFORE the spy is installed. */
async function emptySegment() {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
}

beforeEach(async () => {
  await clearAllStores();
});

describe("take writes ask for strict durability", () => {
  it("saveTake opens its transaction with durability: strict", async () => {
    const segmentId = await emptySegment();

    const options = await transactionOptionsDuring(async () => {
      await saveTake(
        segmentId,
        newClipId(),
        samples(1000),
        CANONICAL_SAMPLE_RATE
      );
    });

    expect(options).toEqual([{ durability: "strict" }]);
  });

  it("clearSegmentTake opens its transaction with durability: strict", async () => {
    const segmentId = await emptySegment();
    await saveTake(
      segmentId,
      newClipId(),
      samples(1000),
      CANONICAL_SAMPLE_RATE
    );

    const options = await transactionOptionsDuring(async () => {
      await clearSegmentTake(segmentId);
    });

    expect(options).toEqual([{ durability: "strict" }]);
  });
});
