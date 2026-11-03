import { existsSync } from "node:fs";

import { expect, test, type Page } from "./support/test";
import {
  asInstalledApp,
  nativeShareCount,
  readStagedFiles,
  spyNativeShare,
} from "./support/installed-app";

import { editRecordingButton } from "./recorder-fixtures";

/**
 * The language ask on a book's first Export project (#1492), against the
 * shipped `dist/` build in headless desktop Chromium at 360 px: the bundled
 * list is not fetched at app start, the ask searches it ignoring case and
 * accents and is navigable from the keyboard, Cancel writes nothing, a pick
 * goes straight on to the export, the stored tag reaches `metadata.json`, and
 * the next export does not ask again.
 *
 * `navigator.share` is stubbed (headless Chromium has none). Not covered: any
 * phone, the soft keyboard, a screen reader, and the real share sheet.
 */
test.use({
  permissions: ["microphone"],
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function recordOneSegment(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
}

/** The one zip this page has shared so far, as Latin-1 text. */
/**
 * The zip the installed app's one-tap share just staged, as Latin-1 text so
 * the test can find `metadata.json`'s language tag in its bytes. It waits for
 * the one Share call of this page load, then reads the newest staged file.
 */
async function sharedZip(page: Page): Promise<string> {
  await expect.poll(() => nativeShareCount(page)).toBe(1);
  const staged = await readStagedFiles(page);
  expect(staged.length).toBeGreaterThan(0);
  const newest = staged[staged.length - 1]!;
  expect(newest.path).toMatch(/\/Book_001_-_project\.zip$/);
  return Buffer.from(newest.base64, "base64").toString("latin1");
}

async function openBookMenu(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
}

test("the first Export project asks the language once and the bundle carries it (#1492)", async ({
  page,
}, testInfo) => {
  await asInstalledApp(page);
  await spyNativeShare(page);
  const listRequests: string[] = [];
  page.on("request", (r) => {
    if (/language-list-[\w-]+\.js/.test(r.url())) listRequests.push(r.url());
  });

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await recordOneSegment(page);
  // App start and a whole recording session never loaded the list. (The
  // service worker's precache fetches it from its own context, which
  // `page.on("request")` does not see.)
  expect(listRequests).toEqual([]);

  // Cancel writes nothing: the next Export asks again.
  await openBookMenu(page);
  await page.getByRole("button", { name: "Export project" }).click();
  const search = page.getByRole("searchbox", { name: "Search languages" });
  await expect(search).toBeFocused();
  expect(listRequests).toHaveLength(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export project" })
  ).toBeFocused();
  await page.getByRole("button", { name: "Export project" }).click();
  await expect(search).toBeVisible();

  // Case- and accent-insensitive, and the rows are reached with the arrows.
  await search.fill("FRANCAIS");
  await search.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAccessibleName(
    "French français fr"
  );
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAccessibleName(
    "French français fr-BE"
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(":focus")).toHaveAccessibleName(
    "French français fr"
  );

  // The tag search, then the pick goes straight on to the export.
  await search.fill("tpi");
  await page
    .getByRole("button", { name: "Tok Pisin tpi", exact: true })
    .click();
  expect(await sharedZip(page)).toMatch(/"tag": *"tpi"/);

  // Asked once: after a reload, the next export goes straight through, with
  // no ask, and the second staged file carries the stored tag.
  await openBookMenu(page);
  await page.getByRole("button", { name: "Export project" }).click();
  await expect(search).toHaveCount(0);
  expect(await sharedZip(page)).toMatch(/"tag": *"tpi"/);
  await page.screenshot({
    path: testInfo.outputPath("after-export-360.png"),
  });
});

test("the language ask at 360 px, dark and light (#1492)", async ({
  page,
}, testInfo) => {
  await asInstalledApp(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(
    page.getByRole("button", { name: /^Add chapter to/ })
  ).toBeVisible();
  for (const scheme of ["dark", "light"] as const) {
    await page.goto("/");
    await expect(page.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    if (scheme === "dark") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } else {
      // The theme control lives in Settings (#1575).
      await page.getByRole("button", { name: /^Open menu/ }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: /light screen/i })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: "More actions for Book 001" })
      .click();
    await page.getByRole("button", { name: "Export project" }).click();
    const dialog = page.getByRole("dialog", { name: "Book" });
    await expect(
      page.getByRole("button", { name: "A-Pucikwar apq", exact: true })
    ).toBeVisible();
    const right = await dialog.evaluate(
      (el) => el.getBoundingClientRect().right
    );
    expect(right).toBeLessThanOrEqual(360);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    expect(overflow).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: testInfo.outputPath(`language-ask-${scheme}-360.png`),
    });
    await page
      .getByRole("searchbox", { name: "Search languages" })
      .fill("kiswahili");
    await page.screenshot({
      path: testInfo.outputPath(`language-ask-search-${scheme}-360.png`),
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.keyboard.press("Escape");
  }
});
