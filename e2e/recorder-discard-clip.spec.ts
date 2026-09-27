import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";

/**
 * The clipboard's bin (#862): after a cut, a greyed trash can sits under the
 * red line. It opens the same confirm dialog the whole-take erase uses;
 * Cancel keeps the cut waiting, and confirming empties the clipboard, so the
 * paste button and the bin leave, the take is unchanged, and a selection
 * frame is available again.
 *
 * Synthetic Chromium media (`--use-fake-device-for-media-stream`), not a
 * physical microphone, as `recorder-selection.spec.ts` does.
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

test("the bin under the line throws away a cut and brings the frame back (#862)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await clickEditRecording(page);

  const startHandle = page.getByLabel("Selection start", { exact: true });
  const endHandle = page.getByLabel("Selection end", { exact: true });
  const cut = page.getByRole("button", {
    name: "Cut the selection",
    exact: true,
  });
  const paste = page.getByRole("button", {
    name: "Paste at the line",
    exact: true,
  });
  const bin = page.getByRole("button", {
    name: "Throw away the cut audio",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Throw away the cut audio?",
  });

  await expect(startHandle).toBeVisible();
  // No cut yet: nothing to throw away.
  await expect(bin).toHaveCount(0);
  const originalLength = Number(await endHandle.getAttribute("aria-valuemax"));
  expect(originalLength).toBeGreaterThan(0);

  await cut.click();
  await expect(startHandle).toHaveCount(0);
  await expect(paste).toBeVisible();
  await expect(bin).toBeVisible();
  // Below the line: the bin sits under the canvas, the paste marker above.
  const canvasBox = (await page.locator(".recorder-canvas").boundingBox())!;
  const binBox = (await bin.boundingBox())!;
  expect(binBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height);

  // Cancel keeps the cut on the clipboard.
  await bin.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(paste).toBeVisible();
  await expect(bin).toBeVisible();
  await expect(startHandle).toHaveCount(0);

  // Confirming empties it: paste and bin leave, and a frame is back over the
  // take the cut already shortened — the bin changes the clipboard only.
  await bin.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Throw away", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(paste).toHaveCount(0);
  await expect(bin).toHaveCount(0);
  await expect(startHandle).toBeVisible();
  await expect(cut).toBeEnabled();
  const afterLength = Number(await endHandle.getAttribute("aria-valuemax"));
  expect(afterLength).toBeGreaterThan(0);
  expect(afterLength).toBeLessThan(originalLength);

  // The erase door still asks the erase question, not the discard one.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Erase recording", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Erase this recording?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
