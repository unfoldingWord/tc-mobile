import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import {
  PHONE_CHECK_DB_NAME,
  runStorageProbe,
} from "@/hooks/phone-check-probes";

/**
 * #1014 item 6: the storage probe stops on an abort and still deletes its
 * throwaway database. Its own file, in the Node environment, because a typed
 * array read back out of fake-indexeddb under jsdom is another realm's and
 * fails the probe's own read-back check.
 */

const SMALL = { bytes: 64 * 1024, chunkBytes: 16 * 1024 } as const;

async function databaseNames(): Promise<(string | undefined)[]> {
  return (await indexedDB.databases()).map((d) => d.name);
}

describe("runStorageProbe with an aborted signal", () => {
  it("rejects before writing and leaves no database behind", async () => {
    const run = new AbortController();
    run.abort();
    await expect(
      runStorageProbe({ ...SMALL, signal: run.signal })
    ).rejects.toBeDefined();
    expect(await databaseNames()).not.toContain(PHONE_CHECK_DB_NAME);
  });

  it("builds no further chunk once aborted mid-write", async () => {
    const run = new AbortController();
    const onChunkFilled = vi.fn(() => run.abort());
    await expect(
      runStorageProbe({ ...SMALL, onChunkFilled, signal: run.signal })
    ).rejects.toBeDefined();
    expect(onChunkFilled).toHaveBeenCalledTimes(1);
    expect(await databaseNames()).not.toContain(PHONE_CHECK_DB_NAME);
  });

  it("does not read back once aborted before the read", async () => {
    const run = new AbortController();
    const chunks = SMALL.bytes / SMALL.chunkBytes;
    const onChunkFilled = vi.fn();
    // The probe's own read-phase seam, not a clock-read count: the abort lands
    // when the read phase starts, whatever else reads the clock.
    const onReadStart = vi.fn(() => run.abort());
    const rejection = await runStorageProbe({
      ...SMALL,
      onReadStart,
      onChunkFilled,
      signal: run.signal,
    }).then(
      () => "resolved",
      (cause: unknown) => cause
    );
    expect(rejection).toBe(run.signal.reason);
    // Every chunk was written first, so the abort landed in the read phase and
    // not in the write loop.
    expect(onReadStart).toHaveBeenCalledTimes(1);
    expect(onChunkFilled).toHaveBeenCalledTimes(chunks);
    expect(await databaseNames()).not.toContain(PHONE_CHECK_DB_NAME);
  });

  it("still completes when the signal never aborts", async () => {
    const run = new AbortController();
    const result = await runStorageProbe({ ...SMALL, signal: run.signal });
    expect(result.bytes).toBe(SMALL.bytes);
  });
});
