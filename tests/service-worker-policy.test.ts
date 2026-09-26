import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  NATIVE_TEARDOWN_SW,
  isWorkboxCacheName,
  selectCachesToDelete,
  shouldRegisterServiceWorker,
} from "@/lib/service-worker-policy";

/**
 * #923 — the two DOM-free decisions native-vs-web service-worker handling
 * turns on. The browser-boundary orchestration that calls these
 * (`hooks/register-service-worker.ts`) is covered separately in
 * `tests/register-service-worker.test.ts`, through an injected bridge.
 */
describe("shouldRegisterServiceWorker", () => {
  it("registers on the web (not native)", () => {
    expect(shouldRegisterServiceWorker(false)).toBe(true);
  });

  it("never registers on native — the entire point of #923", () => {
    expect(shouldRegisterServiceWorker(true)).toBe(false);
  });
});

describe("isWorkboxCacheName", () => {
  it("matches Workbox's own precache cache name", () => {
    // workbox-core's default prefix + precache suffix
    // (node_modules/workbox-core/src/_private/cacheNames.ts):
    // `workbox-precache-v2-<scope>`.
    expect(isWorkboxCacheName("workbox-precache-v2-https://tc-mobile/")).toBe(
      true
    );
  });

  it("matches any other workbox-prefixed cache (runtime, google analytics)", () => {
    expect(isWorkboxCacheName("workbox-runtime-https://tc-mobile/")).toBe(true);
  });

  it("does not match a cache with no workbox- prefix", () => {
    expect(isWorkboxCacheName("some-other-cache")).toBe(false);
  });

  it("does not match a name that merely contains 'workbox' mid-string", () => {
    // Prefix, not substring — a cache named by something else that happens
    // to mention workbox must not be swept up.
    expect(isWorkboxCacheName("my-workbox-cache")).toBe(false);
  });

  it("is case-sensitive — Cache Storage names are exact strings", () => {
    expect(isWorkboxCacheName("Workbox-precache-v2")).toBe(false);
  });
});

describe("selectCachesToDelete", () => {
  it("keeps only workbox- prefixed names, in order", () => {
    expect(
      selectCachesToDelete([
        "workbox-precache-v2-scope",
        "some-other-cache",
        "workbox-runtime-scope",
      ])
    ).toEqual(["workbox-precache-v2-scope", "workbox-runtime-scope"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(selectCachesToDelete(["a", "b"])).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectCachesToDelete([])).toEqual([]);
  });
});

/**
 * Runs the native worker's source against fake worker globals. Every async
 * step (unregister, each cache delete, each navigate) returns a promise the
 * test settles by hand, so the test can see whether the promise handed to
 * `waitUntil` is still pending while any of them is.
 */
function loadTeardownWorker(cacheNames: string[], clientUrls: string[]) {
  const pending: Array<{ what: string; resolve: () => void }> = [];
  const hold = (what: string) =>
    new Promise<void>((resolve) => pending.push({ what, resolve }));
  const listeners = new Map<string, (event: unknown) => void>();
  const deleted: string[] = [];
  const navigated: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    registration: { unregister: () => hold("unregister") },
    caches: {
      keys: () => Promise.resolve([...cacheNames]),
      delete: (name: string) => {
        deleted.push(name);
        return hold(`delete ${name}`);
      },
    },
    clients: {
      matchAll: () =>
        Promise.resolve(
          clientUrls.map((url) => ({
            url,
            navigate: (to: string) => {
              navigated.push(to);
              return hold(`navigate ${to}`);
            },
          }))
        ),
    },
  };
  runInNewContext(NATIVE_TEARDOWN_SW, { self, Promise });
  const dispatch = (type: string): Promise<unknown> | undefined => {
    let extended: Promise<unknown> | undefined;
    listeners.get(type)?.({
      waitUntil: (p: Promise<unknown>) => {
        extended = p;
      },
    });
    return extended;
  };
  return { pending, deleted, navigated, dispatch };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("NATIVE_TEARDOWN_SW (the native build's dist/sw.js, #923)", () => {
  it("binds the whole teardown to the activate event's lifetime", async () => {
    const worker = loadTeardownWorker(
      ["workbox-precache-v2-scope", "workbox-runtime-scope"],
      ["https://localhost/", "https://localhost/book/1"]
    );
    const extended = worker.dispatch("activate");
    expect(extended).toBeInstanceOf(Promise);

    let settled = false;
    void extended!.then(() => (settled = true));

    // Settle each held step one at a time; the lifetime promise must stay
    // pending until the very last one — a dropped `return` in the chain
    // either resolves it early or starts navigating before the deletes
    // settle, and fails one of the checks below.
    const released: string[] = [];
    for (;;) {
      await flush();
      const next = worker.pending.shift();
      if (!next) break;
      expect(settled).toBe(false);
      // Reloading a window while its caches are still being deleted races
      // the teardown; every delete must settle before any navigation starts.
      if (next.what.startsWith("delete ")) {
        expect(worker.navigated).toEqual([]);
      }
      released.push(next.what);
      next.resolve();
    }
    await flush();
    expect(settled).toBe(true);
    expect(released).toEqual([
      "unregister",
      "delete workbox-precache-v2-scope",
      "delete workbox-runtime-scope",
      "navigate https://localhost/",
      "navigate https://localhost/book/1",
    ]);
  });

  it("deletes only workbox- caches, the same policy as runtime cleanup", async () => {
    const worker = loadTeardownWorker(
      ["workbox-precache-v2-scope", "some-other-cache", "my-workbox-cache"],
      []
    );
    const extended = worker.dispatch("activate");
    for (;;) {
      await flush();
      const next = worker.pending.shift();
      if (!next) break;
      next.resolve();
    }
    await extended;
    expect(worker.deleted).toEqual(
      selectCachesToDelete([
        "workbox-precache-v2-scope",
        "some-other-cache",
        "my-workbox-cache",
      ])
    );
  });

  it("extends install with skipWaiting so it activates without a restart", () => {
    const worker = loadTeardownWorker([], []);
    expect(worker.dispatch("install")).toBeInstanceOf(Promise);
  });

  it("never names IndexedDB", () => {
    expect(NATIVE_TEARDOWN_SW).not.toMatch(/indexedDB/i);
  });
});
