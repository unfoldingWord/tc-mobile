import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * A lazy chunk that will not load reloads the page once, then fails (#1421
 * O1; the DRI's pick, verbatim: "Reload once, then fail (Recommended)").
 *
 * Against the shipped `dist/` build in headless desktop Chromium. The
 * language list behind Export project stands in for any lazy chunk: its
 * request is answered the way the host answers a file that no longer exists
 * (`not_found_handling: "single-page-application"` in `wrangler.jsonc`), with
 * the app's HTML. The service worker is blocked so the route sees the request.
 *
 * Covered: Chromium's own error for that import, the `vite:preloadError`
 * wiring, one reload, and no second reload in the same build. Not covered:
 * WebKit and Gecko, a real service-worker update, and any phone.
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

test("a missing lazy chunk reloads once, then fails without reloading (#1421)", async ({
  page,
}) => {
  await page.route(/language-list-[\w-]+\.js$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>tC Mobile</title>",
    })
  );
  const rows: string[] = [];
  page.on("console", (message) => {
    const match = /^\[(stale-chunk[\w-]*)\]/.exec(message.text());
    if (match?.[1]) rows.push(match[1]);
  });
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(
    page.getByRole("button", { name: /^Add chapter to/ })
  ).toBeVisible();

  const openExport = async () => {
    await expect(page.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    await page
      .getByRole("button", { name: "More actions for Book 001" })
      .click();
    await page.getByRole("button", { name: "Export project" }).click();
  };

  await page.goto("/");
  const loadsBefore = loads;
  await openExport();
  // The failed import reloads the page once.
  await expect.poll(() => loads).toBe(loadsBefore + 1);
  expect(rows).toEqual(["stale-chunk-reload"]);

  // Same build, same tab: the next failure reports and does not reload.
  await openExport();
  await expect.poll(() => rows).toEqual(["stale-chunk-reload", "stale-chunk"]);
  await page.waitForTimeout(1000);
  expect(loads).toBe(loadsBefore + 1);
});
