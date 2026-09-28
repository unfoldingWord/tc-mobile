import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";
import { seedToRecorder } from "./support/seed";

/**
 * An edit made while a picked span is sounding stops the audition (#361 row 5,
 * the "stop-on-edit" half; #284 is the rule).
 *
 * `onCut` and `onSelectionChange` in `src/components/recorder.tsx` each call
 * `stopPlayback()` before they touch the editor. A cut rematerialises
 * `working`, and a handle move changes the span the audition is OF, so without
 * that call the sheet keeps sounding audio the segment no longer holds, or a
 * span the translator has already moved off. Neither call is reachable from
 * the unit suite, which does not render the recorder, so deleting either one
 * left it green. The Scissors and the handles both stay live while a span
 * sounds (neither is in `stageView`'s `windowControlsInert` class), so both
 * paths are reachable from the UI and this spec drives them in the shipped
 * build.
 *
 * `onPaste` makes the same call and is not driven here: the paste marker
 * unmounts while a buffer sounds (`recorder-discard-clip.spec.ts` pins that),
 * so no tap can reach `onPaste` during an audition.
 *
 * What it observes is the toolbar's Stop control leaving. An audition that
 * nothing stopped would keep it up until the span ran out, so each case first
 * makes the span long and then requires the stop to land well inside it — the
 * premise check below, so a slow runner fails loudly instead of letting the
 * span run out and pass for a stop.
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

/** `CANONICAL_SAMPLE_RATE` in `src/lib/audio/format.ts`: the handles' unit. */
const SAMPLES_PER_SECOND = 44_100;

/** How long the stop may take once the edit lands. */
const STOP_WITHIN_MS = 1000;

const valueOf = async (handle: Locator) =>
  Number(await handle.getAttribute("aria-valuenow"));

/** Press an arrow key on a handle until its value is at or past `target`. */
async function nudgeTo(
  handle: Locator,
  key: "ArrowLeft" | "ArrowRight",
  target: number
) {
  await handle.focus();
  const reached = async () =>
    key === "ArrowLeft"
      ? (await valueOf(handle)) <= target
      : (await valueOf(handle)) >= target;
  // One press moves a handle by 1/400 of the window; the bound stops a handle
  // that has stopped moving from looping forever.
  for (let i = 0; i < 400 && !(await reached()); i++) {
    await handle.press(key);
  }
  expect(await reached()).toBe(true);
}

/**
 * Record a take, enter edit mode, widen the seeded span (the last quarter) to
 * most of the take, and start its audition. Returns the handles, the Stop
 * control, and how long the span sounds for.
 */
async function auditionALongSpan(page: Page) {
  await page.setViewportSize({ width: 390, height: 740 });
  await seedToRecorder(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stopRecording = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stopRecording).toBeVisible();
  await page.waitForTimeout(5000);
  await stopRecording.click();
  await clickEditRecording(page);

  const startHandle = page.getByLabel("Selection start", { exact: true });
  const endHandle = page.getByLabel("Selection end", { exact: true });
  await expect(startHandle).toBeVisible();
  const length = Number(await endHandle.getAttribute("aria-valuemax"));
  expect(length).toBeGreaterThan(0);
  await nudgeTo(startHandle, "ArrowLeft", 0.3 * length);
  const spanMs =
    (((await valueOf(endHandle)) - (await valueOf(startHandle))) /
      SAMPLES_PER_SECOND) *
    1000;

  const toolbar = page.locator(".recorder-toolbar");
  const stopPlaying = toolbar.getByRole("button", {
    name: "Stop playing",
    exact: true,
  });
  // The clock starts BEFORE the tap, so time spent getting Stop on screen
  // counts as span already used up. A zero taken after that would let a span
  // that ran out by itself pass for a stop.
  const playAt = Date.now();
  await toolbar
    .getByRole("button", { name: "Play the selection", exact: true })
    .click();
  await expect(stopPlaying).toBeVisible();
  return { startHandle, stopPlaying, spanMs, playAt };
}

/** Before the edit: enough span is left that running out cannot pass for a stop. */
function expectRoomForTheStop(playAt: number, spanMs: number) {
  expect(
    spanMs - (Date.now() - playAt),
    "not enough span left to tell a stop from the audition ending"
  ).toBeGreaterThan(STOP_WITHIN_MS);
}

/**
 * After the edit: the stop was seen before the span could have run out on its
 * own, or the case proves nothing.
 */
function expectInsideTheSpan(playAt: number, spanMs: number) {
  expect(
    Date.now() - playAt,
    "the audition could have ended by itself: the check did not run inside the span"
  ).toBeLessThan(spanMs);
}

test("a handle move while the span sounds stops the audition (#361)", async ({
  page,
}) => {
  const { startHandle, stopPlaying, spanMs, playAt } =
    await auditionALongSpan(page);
  const before = await valueOf(startHandle);
  expectRoomForTheStop(playAt, spanMs);
  await startHandle.press("ArrowRight");
  await expect(stopPlaying).toHaveCount(0, { timeout: STOP_WITHIN_MS });
  expectInsideTheSpan(playAt, spanMs);
  // The press was a handle move: the start edge went right.
  await expect.poll(() => valueOf(startHandle)).toBeGreaterThan(before);
});

test("a cut while the span sounds stops the audition (#361)", async ({
  page,
}) => {
  const { stopPlaying, spanMs, playAt } = await auditionALongSpan(page);
  const cut = page.getByRole("button", {
    name: "Cut the selection",
    exact: true,
  });
  // The premise: Scissors is live during an audition, so the tap reaches
  // `onCut` rather than a disabled control.
  await expect(cut).toBeEnabled();
  expectRoomForTheStop(playAt, spanMs);
  await cut.click();
  await expect(stopPlaying).toHaveCount(0, { timeout: STOP_WITHIN_MS });
  expectInsideTheSpan(playAt, spanMs);
  // The tap was the cut: the clipboard holds it. Checked after the stop,
  // because the marker only mounts once nothing is sounding.
  await expect(
    page.getByRole("button", { name: "Paste at the line", exact: true })
  ).toBeVisible();
});
