import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { editRecordingButton } from "./recorder-fixtures";
import { seedToRecorder } from "./support/seed";

/**
 * The Segments row menu's Edit opens the recorder in edit mode (#286 item 2).
 * Before it, the sheet opened in record mode and the translator had to tap
 * Edit a second time, inside the sheet, to reach the editor the menu had
 * promised.
 *
 * The row side, that Edit passes `"edit"` and the row's other openers pass
 * nothing, is `tests/segment-row-edit-entry.test.ts`. This spec is the sheet
 * side: `Recorder`'s `openInEdit` entry, which the unit suite cannot reach
 * because it does not render the recorder.
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

/** Record a short take on segment 1, then close the sheet back to Segments. */
async function recordAndClose(page: Page) {
  await page.setViewportSize({ width: 390, height: 740 });
  await seedToRecorder(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1200);
  await stop.click();
  // The commit has landed once the toolbar's Edit is no longer busy
  // (`recorder-fixtures.ts`), so the close below saves nothing new.
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  await page.getByRole("button", { name: "Close recorder" }).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
}

test("the row menu's Edit opens the recorder in edit mode (#286)", async ({
  page,
}) => {
  await recordAndClose(page);
  await page
    .getByRole("button", { name: "More actions for segment 1", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Edit segment 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  // No second Edit tap: the sheet is in edit mode with a frame seeded.
  // The toggle is the ✕ exit while editing (#1252).
  await expect(editRecordingButton(page)).toHaveAccessibleName("Stop editing");
  await expect(
    page.getByLabel("Selection start", { exact: true })
  ).toBeVisible();
});

test("the row itself still opens the recorder in record mode (#286)", async ({
  page,
}) => {
  await recordAndClose(page);
  // The row's own open control. Its accessible name is also "Edit segment
  // 1", so it is found by its class, outside any dialog.
  await page.locator("button.row-open").first().click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(editRecordingButton(page)).toHaveAccessibleName(
    /^Edit recording/
  );
  await expect(page.getByLabel("Selection start", { exact: true })).toHaveCount(
    0
  );
});
