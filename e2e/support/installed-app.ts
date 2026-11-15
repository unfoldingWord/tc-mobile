import type { Page } from "@playwright/test";

/**
 * Make the next page loads read as the installed app, the way the app itself
 * decides it: `Capacitor.isNativePlatform()` is `getPlatform() !== "web"`, and
 * Capacitor reads a `CapacitorCustomPlatform` global for the name
 * (`e2e/mic-settings-steps-fit.spec.ts` uses the same hook for iOS). Export
 * project works in the installed app only (#1457, R3), so a spec that drives
 * the export in the shipped browser build needs this before it navigates.
 *
 * Call it before `page.goto`: an init script runs on later documents only.
 * It adds no production switch; it is the page's own platform answer. Under a
 * custom platform Capacitor serves a plugin's web implementation, so a spec
 * that reads what reached `navigator.share` still sees the web share, not a
 * phone's share sheet. Nothing here runs on a device.
 */
export async function asInstalledApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { CapacitorCustomPlatform: { name: string } }
    ).CapacitorCustomPlatform = { name: "android" };
  });
}

/** What the spy below records for each `Share.share` call. */
export interface StagedFile {
  readonly path: string;
  /** The whole staged file, base64, as the plugin stores it. */
  readonly base64: string;
}

/**
 * Spy on the share the installed app makes. Under the custom platform
 * Capacitor serves the Share plugin's web implementation, which calls
 * `navigator.share` once per `Share.share` (it drops `files`, so the spy
 * counts calls and cannot see the path). `window.__nativeShares` is that
 * count. Call before `page.goto`.
 */
export async function spyNativeShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __nativeShares: number };
    w.__nativeShares = 0;
    Object.assign(navigator, {
      canShare: () => true,
      share: async () => {
        w.__nativeShares += 1;
      },
    });
  });
}

/** How many times the installed app's Share plugin was invoked. */
export function nativeShareCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __nativeShares?: number }).__nativeShares ?? 0
  );
}

/**
 * The files the native route staged for sharing, read back from where it put
 * them: the Filesystem plugin's web implementation keeps each file in the
 * IndexedDB database "Disc", store "FileStorage", keyed by path, with the
 * content as base64. The route stages under `tc-mobile-share/` in the cache
 * directory (oldest first), and removes the directory only when the share rejects, so a
 * share that went through leaves the file to read.
 */
export function readStagedFiles(page: Page): Promise<StagedFile[]> {
  return page.evaluate(
    () =>
      new Promise<{ path: string; base64: string }[]>((resolve, reject) => {
        const open = indexedDB.open("Disc");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("FileStorage")) {
            db.close();
            resolve([]);
            return;
          }
          const all = db
            .transaction("FileStorage")
            .objectStore("FileStorage")
            .getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(
              (
                all.result as {
                  path: string;
                  type: string;
                  ctime: number;
                  content?: string;
                }[]
              )
                .sort((a, b) => a.ctime - b.ctime)
                .filter(
                  (e) =>
                    e.type === "file" &&
                    e.path.includes("tc-mobile-share/") &&
                    typeof e.content === "string"
                )
                .map((e) => ({ path: e.path, base64: e.content! }))
            );
          };
        };
      })
  );
}
