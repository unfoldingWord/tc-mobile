import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { editRecordingButton } from "./recorder-fixtures";

/**
 * The "Export project" row in a book's menu (#1457), against the shipped
 * `dist/` build in headless desktop Chromium: it sits directly after Share
 * book in the menu's tiles, hands the sheet a zip named `<book> - project.zip`
 * read from the OPFS spool, and says "nothing to share" for a book with no
 * audio, as Share book does.
 *
 * `navigator.share` is stubbed (headless Chromium has none). Not covered: any
 * phone, the real share sheet, the Capacitor shell, and another app opening
 * the zip; those are device-only. Synthetic Chromium media, not a physical
 * microphone.
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

const SPOOL_DIR = "tc-mobile-share-spool";

interface SharedFile {
  readonly name: string;
  readonly head: number[];
  readonly spoolFiles: string[];
}

async function newBook(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
}

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
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
}

test("Export project sits right after Share book and shares the project zip from the spool (#1457)", async ({
  page,
}, testInfo) => {
  await page.addInitScript((dir) => {
    const w = window as unknown as { __shared?: unknown };
    Object.assign(navigator, {
      canShare: () => true,
      share: async ({ files }: { files: File[] }) => {
        const file = files[0]!;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const root = await navigator.storage.getDirectory();
        const spool = await root.getDirectoryHandle(dir);
        const spoolFiles: string[] = [];
        for await (const name of (
          spool as unknown as { keys(): AsyncIterable<string> }
        ).keys())
          spoolFiles.push(name);
        w.__shared = {
          name: file.name,
          head: [...bytes.slice(0, 4)],
          spoolFiles,
        };
      },
    });
  }, SPOOL_DIR);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await newBook(page);
  await recordOneSegment(page);
  // The row's place: Share book, then Export project, in the one tile row,
  // inside a 360 px sheet, in light and in dark (the screenshots are for the
  // review record).
  const tiles = page.locator(".o4-tiles .o4-tile");
  for (const scheme of ["dark", "light"] as const) {
    await page.goto("/");
    await expect(page.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    if (scheme === "light") {
      // The theme is a stored choice, not the OS setting; it lasts across
      // the reloads below.
      await page.getByRole("button", { name: "Open menu" }).click();
      await page
        .getByRole("dialog", { name: "Menu" })
        .getByRole("button", { name: /light screen/i })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: "More actions for Book 001" })
      .click();
    await expect(tiles.nth(0)).toHaveAccessibleName("Share book");
    await expect(tiles.nth(1)).toHaveAccessibleName("Export project");
    const widest = await tiles.evaluateAll((els) =>
      Math.max(...els.map((el) => el.getBoundingClientRect().right))
    );
    expect(widest).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: testInfo.outputPath(`book-menu-${scheme}-360.png`),
    });
  }

  await page.getByRole("button", { name: "Export project" }).click();
  await page.getByRole("button", { name: "Share now" }).click();

  await expect
    .poll(() => page.evaluate(() => "__shared" in (window as object)))
    .toBe(true);
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: SharedFile }).__shared
  );
  expect(shared.name).toBe("Book 001 - project.zip");
  expect(shared.head).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(shared.spoolFiles).toHaveLength(1);

  await expect
    .poll(() =>
      page.evaluate(async (dir) => {
        const root = await navigator.storage.getDirectory();
        const spool = await root.getDirectoryHandle(dir);
        const names: string[] = [];
        for await (const name of (
          spool as unknown as { keys(): AsyncIterable<string> }
        ).keys())
          names.push(name);
        return names.length;
      }, SPOOL_DIR)
    )
    .toBe(0);
});

test("Export project on a book with no audio says there is nothing to share, in place (#1457)", async ({
  page,
}) => {
  // Headless Chromium has no Web Share; without a stub the flow refuses
  // before it builds anything, which is a different message.
  await page.addInitScript(() => {
    Object.assign(navigator, {
      canShare: () => true,
      share: async () => undefined,
    });
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await newBook(page);
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
  await page.getByRole("button", { name: "Export project" }).click();
  await expect(
    page.getByText("Record a segment before sharing this book.")
  ).toBeVisible();
  // No send is armed: the Share tile is still Share book.
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
});
