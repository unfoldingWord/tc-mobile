import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";
import { seedToRecorder } from "./support/seed";

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

  // #925: undoing the cut now puts its audio back with the clipboard EMPTY —
  // the discard came first — so this is the one undo of a cut that opens a
  // frame; with the phrase still waiting it stays on the line
  // (`recorder-selection.spec.ts`). The clipboard stays empty through it: an
  // undone cut does not refill the slot, so no paste button or bin comes
  // back, and a Cut here would replace nothing.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(startHandle).toBeVisible();
  await expect(cut).toBeEnabled();
  await expect(endHandle).toHaveAttribute(
    "aria-valuemax",
    String(originalLength)
  );
  await expect(paste).toHaveCount(0);
  await expect(bin).toHaveCount(0);

  // The erase door still asks the erase question, not the discard one.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear recording", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Clear this recording?" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

// #361 row 6: the controls that read or move the pan window stand down while a
// buffer sounds. With a cut on the clipboard, edit-mode Play scrolls the clip
// under the line, so the paste marker's "here" would name a sample that is
// sliding away. `stageView`'s `windowControlsInert` is pinned as a pure truth
// table in `tests/recorder-stage.test.ts`, and the Zoom and bin gates by source
// shape. Nothing rendered the paste marker's own term, so dropping it left the
// suite green. This checks the wiring in the shipped build: the marker and the
// bin unmount and Zoom greys for as long as Play sounds, and all three come
// back on Stop.
test("while Play sounds, the paste marker and the bin leave and Zoom greys (#361)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await seedToRecorder(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stopRecording = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stopRecording).toBeVisible();
  // Long enough that the shortened take still sounds for a few seconds, so
  // the assertions below run while it is playing.
  await page.waitForTimeout(4000);
  await stopRecording.click();
  await clickEditRecording(page);

  const toolbar = page.locator(".recorder-toolbar");
  const paste = page.getByRole("button", {
    name: "Paste at the line",
    exact: true,
  });
  const bin = page.getByRole("button", {
    name: "Throw away the cut audio",
    exact: true,
  });
  const zoom = toolbar.getByRole("button", {
    name: "Zoomed to the whole segment. Zoom in to a quarter.",
    exact: true,
  });
  const play = toolbar.getByRole("button", {
    name: /^Play (from the line|recording)$/,
  });
  const stopPlaying = toolbar.getByRole("button", {
    name: "Stop playing",
    exact: true,
  });

  await expect(
    page.getByLabel("Selection start", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cut the selection", exact: true })
    .click();
  // The premise, at rest: the clipboard's controls are up and Zoom is live.
  await expect(paste).toBeVisible();
  await expect(bin).toBeVisible();
  await expect(zoom).toBeEnabled();

  await play.click();
  await expect(stopPlaying).toBeVisible();
  await expect(paste).toHaveCount(0);
  await expect(bin).toHaveCount(0);
  await expect(zoom).toBeDisabled();
  // Still sounding once all three have been seen, so they were read during
  // playback and not after it ran out.
  await expect(stopPlaying).toBeVisible();

  await stopPlaying.click();
  await expect(play).toBeVisible();
  await expect(paste).toBeVisible();
  await expect(bin).toBeVisible();
  await expect(zoom).toBeEnabled();
});
