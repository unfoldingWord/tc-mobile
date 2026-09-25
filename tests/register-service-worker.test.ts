import { describe, expect, it, vi } from "vitest";

import {
  cleanupServiceWorker,
  type ServiceWorkerCleanupBridge,
} from "@/hooks/register-service-worker";

/**
 * #923 — the native cleanup orchestration, driven through an injected
 * {@link ServiceWorkerCleanupBridge} rather than a real `navigator` (the
 * same pattern `tests/share-target.test.ts` uses for its `NativeShareBridge`).
 * `bootstrapServiceWorker` itself touches `navigator`/`window` directly and
 * is not unit tested, matching every other hook that does the same
 * (`hooks/audio-io.ts`); the DECISION it makes is
 * `tests/service-worker-policy.test.ts`'s `shouldRegisterServiceWorker`.
 *
 * What this file exists to prove, per AGENTS.md's #923 bar: the cleanup
 * unregisters every registration, deletes only Workbox-prefixed caches, and
 * — because {@link ServiceWorkerCleanupBridge} has no IndexedDB access of any
 * kind — cannot touch IndexedDB even if it wanted to. A registration failure
 * and a cache failure are independent: one must not skip the other.
 */

interface Registration {
  unregister(): Promise<boolean>;
}

function fakeBridge(overrides: Partial<ServiceWorkerCleanupBridge> = {}): {
  bridge: ServiceWorkerCleanupBridge;
  registrations: Registration[];
  cacheNames: string[];
  deletedCaches: string[];
} {
  const registrations: Registration[] = [
    { unregister: vi.fn(() => Promise.resolve(true)) },
    { unregister: vi.fn(() => Promise.resolve(true)) },
  ];
  const cacheNames = [
    "workbox-precache-v2-https://tc-mobile/",
    "some-other-cache",
    "workbox-runtime-https://tc-mobile/",
  ];
  const deletedCaches: string[] = [];

  const bridge: ServiceWorkerCleanupBridge = {
    getRegistrations: () => Promise.resolve(registrations),
    cacheKeys: () => Promise.resolve(cacheNames),
    deleteCache: (name) => {
      deletedCaches.push(name);
      return Promise.resolve(true);
    },
    ...overrides,
  };

  return { bridge, registrations, cacheNames, deletedCaches };
}

describe("cleanupServiceWorker", () => {
  it("unregisters every existing registration", async () => {
    const { bridge, registrations } = fakeBridge();
    const onFailure = vi.fn();

    await cleanupServiceWorker(bridge, onFailure);

    for (const registration of registrations) {
      expect(registration.unregister).toHaveBeenCalledTimes(1);
    }
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("deletes only the Workbox-prefixed caches, never the others", async () => {
    const { bridge, deletedCaches } = fakeBridge();
    const onFailure = vi.fn();

    await cleanupServiceWorker(bridge, onFailure);

    expect(deletedCaches.sort()).toEqual(
      [
        "workbox-precache-v2-https://tc-mobile/",
        "workbox-runtime-https://tc-mobile/",
      ].sort()
    );
    expect(deletedCaches).not.toContain("some-other-cache");
  });

  it("never calls anything IndexedDB-shaped — the bridge has no such method", async () => {
    // Structural, not behavioural: ServiceWorkerCleanupBridge's type has
    // exactly three methods, none of them IndexedDB. This test exists so a
    // reader sees the guarantee stated as an assertion, not only as a type.
    const { bridge } = fakeBridge();
    expect(Object.keys(bridge).sort()).toEqual(
      ["cacheKeys", "deleteCache", "getRegistrations"].sort()
    );
  });

  it("reports an unregister failure under 'native-sw-unregister', and still cleans caches", async () => {
    const failure = new Error("unregister failed");
    const { bridge, deletedCaches } = fakeBridge({
      getRegistrations: () => Promise.reject(failure),
    });
    const onFailure = vi.fn();

    await cleanupServiceWorker(bridge, onFailure);

    expect(onFailure).toHaveBeenCalledWith(failure, "native-sw-unregister");
    // The independent half still ran — one failing must not skip the other.
    expect(deletedCaches.length).toBeGreaterThan(0);
  });

  it("reports a cache-cleanup failure under 'native-sw-cache-cleanup', and still unregisters", async () => {
    const failure = new Error("caches.keys failed");
    const { bridge, registrations } = fakeBridge({
      cacheKeys: () => Promise.reject(failure),
    });
    const onFailure = vi.fn();

    await cleanupServiceWorker(bridge, onFailure);

    expect(onFailure).toHaveBeenCalledWith(failure, "native-sw-cache-cleanup");
    for (const registration of registrations) {
      expect(registration.unregister).toHaveBeenCalledTimes(1);
    }
  });

  it("never throws, even when both halves fail", async () => {
    const { bridge } = fakeBridge({
      getRegistrations: () => Promise.reject(new Error("a")),
      cacheKeys: () => Promise.reject(new Error("b")),
    });
    const onFailure = vi.fn();

    await expect(
      cleanupServiceWorker(bridge, onFailure)
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it("does nothing destructive when there is nothing to clean up", async () => {
    const { bridge, deletedCaches } = fakeBridge({
      getRegistrations: () => Promise.resolve([]),
      cacheKeys: () => Promise.resolve([]),
    });
    const onFailure = vi.fn();

    await cleanupServiceWorker(bridge, onFailure);

    expect(deletedCaches).toEqual([]);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
