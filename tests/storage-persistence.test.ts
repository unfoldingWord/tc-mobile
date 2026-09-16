import { describe, expect, it, vi } from "vitest";

import {
  ensurePersistedStorage,
  type StorageDurabilityManager,
} from "@/hooks/use-storage-persistence";
import { storageMarker } from "@/lib/storage/persistence";

/**
 * #12 — durable storage: the request, and the one thing the Books screen says
 * about the answer.
 *
 * IndexedDB is this app's system of record (`src/lib/storage/db.ts`), not a
 * cache, and the browser does not agree: without a granted persistence request
 * the origin's storage is best-effort and may be evicted under disk pressure.
 * There is no import or restore path, so eviction is total. This covers the two
 * halves that CAN be covered in plain Node — the marker decision, and the
 * browser sequence through an injected manager.
 *
 * George round 1 (#214) found two lifecycle bugs in the React half: the marker
 * did not re-check `hasContent` (P2-1, a deleted-to-empty shelf kept a stale
 * warning up) and the resolved answer was not cached at module scope (P2-2, a
 * Books remount blinked the marker off for a tick). `storageMarker` now takes
 * `hasContent` and `native` as well as `persisted`, and both new inputs are
 * pinned below with the same red-first/mutation discipline as the original
 * three-state `persisted` case. The P2-2 caching fix lives entirely in the
 * React effect, which this file still cannot reach — see the note below.
 *
 * What is NOT covered here: `useStoragePersistence` itself (this repo has no
 * jsdom or renderer — the same limitation `tests/use-erase-segment.test.ts`
 * documents) — so the module-scope `resolvedAnswer` cache that fixes P2-2 is
 * review/on-device surface, not pinned by a test — and the real
 * `navigator.storage` answer on a device. Whether an installed PWA on Android
 * is granted persistence is unknown and must be read off a device; nothing in
 * this repository can answer it. Whether `Capacitor.isNativePlatform()`
 * correctly reports `true` inside the training APK is likewise unobserved;
 * owed on #245.
 */

/** A `navigator.storage` stand-in, with only the methods a case needs. */
const manager = (
  parts: Partial<Record<"persisted" | "persist", () => Promise<boolean>>>
): StorageDurabilityManager => parts;

describe("storageMarker", () => {
  it("marks storage that the browser has refused to persist", () => {
    expect(storageMarker(false, true, false)).toBe("not-persisted");
  });

  it("says nothing when storage is persisted", () => {
    expect(storageMarker(true, true, false)).toBeNull();
  });

  it("says nothing when the answer is unknown", () => {
    // The load-bearing case. `navigator.storage` may be absent (older iOS
    // Safari), and a query can reject — both arrive here as `undefined`. A
    // `!persisted` test would mark those devices "not persisted", which is a
    // warning we have no evidence for, on the one platform this repo has
    // actually run on. Unknown is silence, never a warning.
    expect(storageMarker(undefined, true, false)).toBeNull();
  });

  it("says nothing once the shelf has emptied back out (George R1 P2-1)", () => {
    // A stale `false` reading from before the last book was deleted (#344) or
    // a second tab's `dropBookCard` must not keep the eviction warning up over
    // the empty-shelf invite — the marker is about a shelf that currently
    // holds something, not one that once did.
    expect(storageMarker(false, false, false)).toBeNull();
  });

  it("never shows inside the Capacitor training shell, regardless of persisted() (George residual, #214)", () => {
    // Native storage is not evicted the way a browser tab's is
    // (docs/research/native-packaging.md); the browser-eviction copy would be
    // simply false there, whatever `persisted()` answers inside the WebView.
    // Both an otherwise-showable `false` and an `undefined` answer are covered
    // so a mutation cannot pass by short-circuiting `native` only inside one
    // branch of the `persisted` check.
    expect(storageMarker(false, true, true)).toBeNull();
    expect(storageMarker(undefined, true, true)).toBeNull();
  });
});

describe("ensurePersistedStorage", () => {
  it("asks first, and makes no request when storage is already persisted", async () => {
    const persist = vi.fn(async () => true);
    const answer = await ensurePersistedStorage(
      manager({ persisted: async () => true, persist })
    );
    expect(answer).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("requests persistence when the browser has not granted it", async () => {
    const persist = vi.fn(async () => true);
    const answer = await ensurePersistedStorage(
      manager({ persisted: async () => false, persist })
    );
    expect(answer).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports a refused request as not persisted", async () => {
    const answer = await ensurePersistedStorage(
      manager({ persisted: async () => false, persist: async () => false })
    );
    expect(answer).toBe(false);
  });

  it("is safely re-runnable: a granted request is not asked for twice", async () => {
    // Idempotency is a property here, not a policy (AGENTS.md): the sequence
    // reads `persisted()` before it ever calls `persist()`, so re-running it
    // against a device that granted the first request performs no second
    // request at all.
    let granted = false;
    const persist = vi.fn(async () => {
      granted = true;
      return true;
    });
    const m = manager({ persisted: async () => granted, persist });

    expect(await ensurePersistedStorage(m)).toBe(true);
    expect(await ensurePersistedStorage(m)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("treats an absent API as unknown", async () => {
    // iOS Safari may expose no `navigator.storage` at all, and a plain Node run
    // has none either. Absent is unknown — never an error, never a warning.
    expect(await ensurePersistedStorage(undefined)).toBeUndefined();
    expect(await ensurePersistedStorage(manager({}))).toBeUndefined();
  });

  it("treats an absent persisted() as unknown and requests nothing", async () => {
    // `persisted()` and `persist()` are the same spec addition and ship
    // together, so this shape is theoretical — but a bare `persist()` we cannot
    // read back may raise a permission prompt on a browser that prompts, and we
    // would have no answer to record. Ask nothing rather than that.
    const persist = vi.fn(async () => true);
    expect(await ensurePersistedStorage(manager({ persist }))).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it("never throws when the query rejects, and requests nothing", async () => {
    const persist = vi.fn(async () => true);
    const answer = await ensurePersistedStorage(
      manager({
        persisted: () => Promise.reject(new Error("no storage manager")),
        persist,
      })
    );
    expect(answer).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it("never throws when the request itself rejects, and keeps the known answer", async () => {
    // The query already said false, so that stays the answer: the request
    // failing does not make durability unknown, it leaves it ungranted.
    const answer = await ensurePersistedStorage(
      manager({
        persisted: async () => false,
        persist: () => Promise.reject(new Error("refused")),
      })
    );
    expect(answer).toBe(false);
  });
});
