import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";

/**
 * Right-to-left mirroring, against the shipped `dist/` build (#1552, part of
 * #1458). The source test (`tests/rtl-logical-properties.test.ts`) pins which
 * declarations are logical; only a browser can say what the cascade does with
 * them under `dir="rtl"`. At 360 px wide this checks that the chrome mirrors
 * (the back arrow, the play control on the chapter row, the Books header's start padding) and
 * that the waveform's time axis does NOT: time runs left to right in every
 * locale, so the selection's start handle stays to the left of its end handle.
 *
 * `dir` is set on the root by hand after boot, the one attribute
 * `hooks/phone-locale.ts` writes; no Arabic text is shown or checked.
 *
 * NOT covered, and not claimed: no Arabic was checked visually, and nothing
 * here ran on a phone. That is a later device pass.
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

const MIRRORED = "matrix(-1, 0, 0, 1, 0, 0)";

async function setDir(page: Page, dir: "ltr" | "rtl") {
  await page.evaluate((d) => {
    document.documentElement.dir = d;
  }, dir);
}

async function transformOf(glyph: Locator) {
  await expect(glyph).toBeVisible();
  return glyph.evaluate((el) => getComputedStyle(el).transform);
}

for (const dir of ["ltr", "rtl"] as const) {
  test(`dir=${dir} at 360px: chrome mirrors, the waveform axis does not (#1552)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await setDir(page, dir);
    const rtl = dir === "rtl";

    await page.getByRole("button", { name: "New book" }).click();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.getByRole("button", { name: /^Add chapter to/ }).click();
    await page.getByRole("button", { name: "Create chapter" }).click();

    // The Books header's start padding is 10px on the start edge only.
    const header = await page.locator(".books-header").evaluate((el) => {
      const s = getComputedStyle(el);
      return { left: s.paddingLeft, right: s.paddingRight };
    });
    expect(rtl ? header.right : header.left).toBe("10px");
    expect(rtl ? header.left : header.right).toBe("12px");

    // The list's start side: the first thing in a chapter row (its number)
    // hugs the row's start edge.
    const row = await page.locator(".books-chapter").first().boundingBox();
    // The play control (#1469, which took the chevron's place) sits on the
    // row's END edge, 16px in: the right at ltr, the left at rtl.
    const play = await page.locator(".books-play").first().boundingBox();
    expect(play).not.toBeNull();
    expect(row).not.toBeNull();
    const fromEnd = rtl
      ? play!.x - row!.x
      : row!.x + row!.width - (play!.x + play!.width);
    expect(Math.abs(fromEnd - 16)).toBeLessThan(0.5);

    const num = await page.locator(".books-chapter-num").first().boundingBox();
    expect(row).not.toBeNull();
    expect(num).not.toBeNull();
    if (rtl) {
      expect(row!.x + row!.width - (num!.x + num!.width)).toBeLessThan(
        num!.x - row!.x
      );
    } else {
      expect(num!.x - row!.x).toBeLessThan(
        row!.x + row!.width - (num!.x + num!.width)
      );
    }

    await page.getByRole("button", { name: "Open Chapter 1" }).click();
    // The back arrow flips at rtl.
    expect(
      await transformOf(
        page.getByRole("button", { name: "Back to books" }).locator("svg")
      )
    ).toBe(rtl ? MIRRORED : "none");

    await page.getByRole("button", { name: "Add segment" }).click();
    await page
      .getByRole("button", { name: "Open recorder for segment 1" })
      .click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Record", exact: true })
    ).toBeVisible();
    await clickEditRecording(page);

    // The time axis stays left to right: the start handle is left of the end
    // handle in both directions.
    const start = await page
      .getByLabel("Selection start", { exact: true })
      .boundingBox();
    const end = await page
      .getByLabel("Selection end", { exact: true })
      .boundingBox();
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start!.x).toBeLessThan(end!.x);
  });
}
