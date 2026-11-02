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
