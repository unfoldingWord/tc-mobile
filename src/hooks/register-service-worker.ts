import { reportFailure } from "@/hooks/report-failure";
import { isNativeShell } from "@/hooks/share-target";
import {
  selectCachesToDelete,
  shouldRegisterServiceWorker,
} from "@/lib/service-worker-policy";

/**
 * The one call `src/app/main.tsx` makes to decide whether this launch
 * registers a service worker or tears one down (#923).
 *
 * **Web build:** unchanged. `vite.config.ts` keeps `injectRegister: "auto"`
 * for the web build exactly as before, so `vite-plugin-pwa`'s own
 * auto-injected `<script>` (`dist/registerSW.js`) still registers `/sw.js` on
 * `window`'s `load` event, with the same `skipWaiting`/`clientsClaim`
 * Workbox behaviour as today. This module does nothing at all on that build
 * — see {@link bootstrapServiceWorker}'s early return.
 *
 * **Native build:** `vite.config.ts`'s `--mode native` sets
 * `injectRegister: false`, so the native `dist/index.html` ships with NO
 * registration script at all — nothing in a fresh native install can create
 * a service-worker registration through the default path. This module is
 * the belt-and-braces second line, for whichever native launch its own code
 * DOES get to run on: it unregisters any registration and deletes any
 * Workbox cache a previous, non-native-aware build left behind. It never
 * registers one itself.
 *
 * Why this alone does not fix a phone stuck on an old build after an
 * in-place upgrade, and why that is not this module's job: the very FIRST
 * native launch after an upgrade may still be served by the OLD worker's own
 * precache, so it is the OLD JavaScript — without this guard — that runs, and
 * this function never executes at all that launch. `vite.config.ts`'s
 * `selfDestroying: true` native `sw.js` is what reaches that phone instead,
 * through the browser's own service-worker update check against the
 * already-registered script URL — a mechanism independent of which JS is
 * running. See that file's native-mode comment for the full reasoning.
 */

/** The pieces of `navigator.serviceWorker` and Cache Storage native cleanup
 *  touches, injected so the orchestration below can be driven from Node with
 *  fakes (`tests/register-service-worker.test.ts`) — the same shape as
 *  `hooks/share-target.ts`'s `NativeShareBridge`. Deliberately has no
 *  IndexedDB access of any kind: the recordings live there, and a bridge
 *  that cannot reach IndexedDB cannot delete them even by accident. */
export interface ServiceWorkerCleanupBridge {
  getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]>;
  cacheKeys(): Promise<readonly string[]>;
  deleteCache(name: string): Promise<boolean>;
}

/** Where a cleanup or registration failure is reported — `reportFailure` in
 *  production, a recording fake in tests. */
export type FailureSink = (cause: unknown, context: string) => void;

/**
 * Unregister every existing service-worker registration and delete only its
 * Workbox caches ({@link selectCachesToDelete}). Never touches IndexedDB —
 * {@link ServiceWorkerCleanupBridge} has no IndexedDB access at all, so this
 * function cannot reach the recordings even by accident.
 *
 * Unregistering and deleting caches are independent failure surfaces — a
 * `caches.delete` rejection must not skip the registrations still waiting to
 * be unregistered, and vice versa — so each runs in its own `try`/`catch` and
 * reports through `reportFailureTo` rather than letting either throw past
 * this function. Never throws itself, for the same reason `reportFailure`'s
 * own callers never let it (`hooks/report-failure.ts`): this runs from the
 * app's entry point, where a throw has nowhere to go.
 */
export async function cleanupServiceWorker(
  bridge: ServiceWorkerCleanupBridge,
  reportFailureTo: FailureSink
): Promise<void> {
  try {
    const registrations = await bridge.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister())
    );
  } catch (cause) {
    reportFailureTo(cause, "native-sw-unregister");
  }

  try {
    const names = await bridge.cacheKeys();
    await Promise.all(
      selectCachesToDelete(names).map((name) => bridge.deleteCache(name))
    );
  } catch (cause) {
    reportFailureTo(cause, "native-sw-cache-cleanup");
  }
}

/** The real `navigator.serviceWorker` + Cache Storage bridge. Not unit
 *  tested — browser globals, same rule as every other hook that touches them
 *  (`hooks/audio-io.ts`, `hooks/share-target.ts`'s native bridge). What IS
 *  unit tested is {@link cleanupServiceWorker} above, driven through a fake
 *  built the same shape as this one. */
function realCleanupBridge(): ServiceWorkerCleanupBridge {
  return {
    getRegistrations: () => navigator.serviceWorker.getRegistrations(),
    cacheKeys: () =>
      typeof caches === "undefined" ? Promise.resolve([]) : caches.keys(),
    deleteCache: (name) => caches.delete(name),
  };
}

/**
 * The one call site `src/app/main.tsx` makes.
 *
 * Web: does nothing — `vite-plugin-pwa`'s own injected script keeps
 * registering `/sw.js` exactly as it does today (see this module's header).
 *
 * Native: never registers; unregisters anything already there and clears
 * only Workbox caches (see this module's header for why this is a
 * second line, not the fix for the first native launch after an upgrade).
 */
export function bootstrapServiceWorker(
  reportFailureTo: FailureSink = reportFailure
): void {
  if (shouldRegisterServiceWorker(isNativeShell())) return;
  if (!("serviceWorker" in navigator)) return;
  void cleanupServiceWorker(realCleanupBridge(), reportFailureTo);
}
