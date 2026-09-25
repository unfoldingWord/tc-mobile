import { describe, expect, it } from "vitest";

import {
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
