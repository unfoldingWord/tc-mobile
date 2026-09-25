/**
 * The two decisions native-vs-web service-worker handling turns on — DOM-free
 * so a Node test can drive every branch without a browser or a WebView.
 *
 * #923: a phone that upgrades the APK in place (v0.2.12 over v0.2.10) kept
 * showing the OLD build. The cause: nothing stopped `vite-plugin-pwa`'s
 * Workbox service worker registering inside the Capacitor WebView, exactly as
 * it does for the browser PWA. Android's app-upgrade path preserves app data
 * (IndexedDB, Cache Storage, any existing service-worker registration) and
 * only an uninstall clears it — and uninstall deletes every recording, so it
 * can never be the upgrade path (AGENTS.md, "Idempotency is a property, not a
 * policy" is the adjacent principle: an upgrade must be safely re-runnable
 * without a forced wipe).
 *
 * The reliable half of the fix is build-time, not runtime: `vite.config.ts`'s
 * `--mode native` swaps the native build's `dist/sw.js` for
 * `vite-plugin-pwa`'s own `selfDestroying: true` worker, which unregisters
 * itself and clears every cache on activation. A phone already running an OLD
 * worker reaches that new script through the BROWSER's own service-worker
 * update check — which re-fetches the already-registered `sw.js` URL and
 * byte-compares it — a mechanism that runs independent of whatever
 * JavaScript this build ships, so it can rescue a phone even on the very
 * first native launch after the upgrade, before any of this app's own code
 * has had a chance to run at all. See `vite.config.ts`'s native-mode comment.
 *
 * This module is the second, belt-and-braces line: what the NEW bundle's own
 * code does on whichever native launch it DOES get to run on — a fresh
 * native install with no prior registration, or any launch after an old
 * worker has already torn itself down. See `hooks/register-service-worker.ts`
 * for the browser-boundary code that calls these two decisions.
 */

/**
 * Whether this bundle should ever call `navigator.serviceWorker.register`.
 *
 * Inside Capacitor the bundle is already local (`capacitor.config.ts`,
 * `webDir: "dist"`) — an offline precache adds nothing there, and a stale one
 * is the entire defect #923 reports. On the web PWA nothing changes: this is
 * `true` for every build a browser runs.
 */
export function shouldRegisterServiceWorker(isNative: boolean): boolean {
  return !isNative;
}

/**
 * Whether a Cache Storage entry is one Workbox created, and so one native
 * cleanup (`hooks/register-service-worker.ts`) may delete.
 *
 * `workbox-core`'s own default cache-name prefix is `"workbox"`
 * (`node_modules/workbox-core/src/_private/cacheNames.ts`,
 * `_cacheNameDetails.prefix`), so every cache Workbox creates for this app —
 * `workbox-precache-v2-<scope>` is the only one; `vite.config.ts` configures
 * no `runtimeCaching`, so there is no second Workbox cache to name — is
 * `workbox-<something>`. Matching that prefix, rather than deleting every
 * `caches.keys()` entry unconditionally, is what keeps native cleanup from
 * ever reaching a cache some other feature created, now or later.
 *
 * Cache Storage and IndexedDB are two separate browser APIs. This predicate
 * only ever names a Cache Storage entry, so it cannot express "delete the
 * recordings" even by a typo — the safety here is structural, not a check
 * this file has to remember to run.
 */
export function isWorkboxCacheName(name: string): boolean {
  return name.startsWith("workbox-");
}

/** {@link isWorkboxCacheName}, applied to a full `caches.keys()` result —
 *  the exact set native cleanup deletes. */
export function selectCachesToDelete(names: readonly string[]): string[] {
  return names.filter(isWorkboxCacheName);
}
