import { existsSync } from "node:fs";

import { expect, test } from "./support/test";

/**
 * An engine too old for the build shows a plain update screen, not an empty
 * page (#1944).
 *
 * Against the shipped `dist/` build in headless desktop Chromium. The old
 * engine is simulated, not run: an init script deletes the built-ins the
 * check looks for before any page script runs, which is what an Android
 * System WebView 91 lacks. Covered: the check in `index.html` shows the
 * screen, removes the app's mount point, and stays out of the way when the
 * features are present. Not covered: a real WebView 91 (the emulator run is a
 * device row on #1944), any other missing built-in, and the screen's look on a
 * phone.
 *
 * The service worker is blocked so each load reads `index.html` from the
 * preview server rather than a cache.
 */
test.use({
  serviceWorkers: "block",
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
  },
});

const SCREEN = "#old-webview-screen";

test("a missing built-in shows the update screen, not an empty page (#1944)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error: simulating an engine that predates Object.hasOwn.
    delete Object.hasOwn;
  });
  await page.goto("/");

  const screen = page.locator(SCREEN);
  await expect(screen).toBeVisible();
  // The picture carries the meaning for a person who may not read.
  await expect(screen.locator("svg")).toBeVisible();
  await expect(screen).toContainText("Android System WebView");
  // The app was stopped from starting: nothing mounts under the screen.
  await expect(page.locator("#root")).toHaveCount(0);
});

test("a missing String.replaceAll alone also shows the update screen (#1944)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error: simulating an engine that predates replaceAll.
    delete String.prototype.replaceAll;
  });
  await page.goto("/");
  await expect(page.locator(SCREEN)).toBeVisible();
});

test("a missing crypto.randomUUID in a secure context shows the update screen (#1944)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // @ts-expect-error: simulating an engine that predates randomUUID.
    delete Crypto.prototype.randomUUID;
  });
  await page.goto("/");
  await expect(page.locator(SCREEN)).toBeVisible();
});

test("with every built-in present the check is invisible and the app renders (#1944)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeAttached();
  await expect(page.locator(SCREEN)).toHaveCount(0);
});
