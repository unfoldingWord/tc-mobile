import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { seedToSegments } from "./support/seed";

/**
 * The chapter row's play control, against the shipped `dist/` build (#1469).
 *
 * jsdom lays nothing out, so the geometry half of the control's promises is
 * here: it is at least 44 by 44, it sits inside the row without overlapping
 * the row's own button text column, and a tap on the row still opens the
 * chapter. What it does not do is play: a chapter with no recording has the
 * control inert, and nothing here records. The sound, the gap and the ring in
 * motion are the device pass (#1470).
 */
test.use({
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
  },
});

for (const width of [320, 360]) {
  test(`a chapter row's play control is 44px, inside the row, and a row tap still opens the chapter at ${width}px (#1469)`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 800 });
    await seedToSegments(page);
    await page.getByRole("button", { name: "Back to books" }).click();
    await page.getByRole("button", { name: /^Book 001, 1 chapter/ }).click();

    // No segment is recorded, so the control is inert and its name says why.
    const play = page.getByRole("button", {
      name: "Chapter 1 has nothing recorded to play",
    });
    await expect(play).toBeVisible();
    await expect(play).toHaveAttribute("aria-disabled", "true");

    const row = page.getByRole("button", { name: "Open Chapter 1" });
    const [playBox, rowBox] = await Promise.all([
      play.boundingBox(),
      row.boundingBox(),
    ]);
    expect(playBox!.width).toBeGreaterThanOrEqual(44);
    expect(playBox!.height).toBeGreaterThanOrEqual(44);
    // Wholly inside the row's box, and not over its text column.
    expect(playBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
    expect(playBox!.x + playBox!.width).toBeLessThanOrEqual(
      rowBox!.x + rowBox!.width + 0.5
    );
    const titleBox = await page
      .locator(".books-chapter-title")
      .first()
      .boundingBox();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(playBox!.x + 0.5);

    // A tap on the row, away from the control, opens the chapter.
    await row.click({ position: { x: 20, y: 20 } });
    await expect(
      page.getByRole("button", { name: "Back to books" })
    ).toBeVisible();
  });
}
