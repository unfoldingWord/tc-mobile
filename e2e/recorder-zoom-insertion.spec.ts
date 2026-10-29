import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page } from "./support/test";

import { clickEditRecording, editRecordingButton } from "./recorder-fixtures";
import { seedToRecorder } from "./support/seed";

/**
 * A zoom with a selection open moves the VIEW, never the record insertion
 * offset (#361 row 4, the round-1 P1 of #346).
 *
 * `onToggleZoom` in `src/components/recorder.tsx` writes its fit into
 * `zoomPan`, which `effectivePan` reads only in edit mode with a selection
 * open. Writing it into `panState` instead would move the line the next
 * recording splices at. That swap left every unit test green, because the
 * writer lives in the component and the unit suite does not render it. This
 * spec reaches it through the shipped build.
 *
 * What it observes is the next edit entry's seed. `selectionReseed` seeds from
 * `windowAt(insertionPan)`, and `seedSelection` starts the span at the line,
 * sliding it back only as far as the end of the take forces. So while the
 * line rests at the end of the take (a fresh take leaves it there, and nothing
 * here drags the pan), the re-entered span's end handle sits at the end of the
 * take. A zoom fit leaked into the insertion offset puts the line mid-clip,
 * and the span opens there instead.
 *
 * The span is moved well away from the end first, with the handles' arrow
 * keys. The seeded span is the last quarter of the take, and a zoom to a
 * quarter pins that span's start (the wider-than-the-window branch of
 * `panForZoom`), which puts the fit only an eighth of the take from the end.
 * From there the seed slides back to the same place either way, so the leak
 * would not show.
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

/** The take's decoded length, in seconds. Recording runs past it. */
const TAKE_SECONDS = 1;

type Decoded = { frames: number; kept: number };
type DecodeLog = { __decodes?: Decoded[] };

/**
 * Cuts every decode in the page to `seconds`, so the take has the same length
 * in every run.
 *
 * The capture runs on the wall clock, and the encoder hands over whole frames,
 * so a take stopped after a set wait comes out one frame longer or shorter
 * from run to run. Every handle offset is a fraction of that length, and so is
 * the number of key presses `nudgeTo` takes, so the computed-style diff tool
 * (#954) saw this spec differ against itself. The take still goes through the
 * real MediaRecorder and the real `decodeAudioData`; only the tail past
 * `seconds` is dropped, before the app reads the buffer. Each decode is logged
 * on `window.__decodes`, and `recordShortTake` asserts the one it made was cut.
 */
async function fixDecodedLength(page: Page, seconds: number) {
  await page.addInitScript((s: number) => {
    const log: Decoded[] = [];
    (window as DecodeLog).__decodes = log;
    const proto = BaseAudioContext.prototype;
    const decode = proto.decodeAudioData;
    proto.decodeAudioData = async function (
      this: BaseAudioContext,
      data: ArrayBuffer
    ) {
      const full = await decode.call(this, data);
      const length = Math.round(s * full.sampleRate);
      log.push({ frames: full.length, kept: Math.min(length, full.length) });
      if (full.length <= length) return full;
      const cut = new AudioBuffer({
        length,
        numberOfChannels: full.numberOfChannels,
        sampleRate: full.sampleRate,
      });
      for (let c = 0; c < full.numberOfChannels; c++) {
        cut.copyToChannel(full.getChannelData(c).subarray(0, length), c);
      }
      return cut;
    };
  }, seconds);
}

async function recordShortTake(page: Page) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();
  // Well past TAKE_SECONDS, so the cut, not the wall clock, sets the length.
  await page.waitForTimeout(TAKE_SECONDS * 1000 + 500);
  await stop.click();
  // The premise of the cut: the take's one decode was longer than it kept.
  const decodes = () =>
    page.evaluate(() => (window as DecodeLog).__decodes ?? []);
  await expect.poll(async () => (await decodes()).length).toBe(1);
  const [take] = await decodes();
  expect(take!.frames).toBeGreaterThan(take!.kept);
}

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
  // One press moves a handle by 1/400 of the window, so a whole take at
  // whole zoom is 400 presses. The bound stops a handle that has stopped
  // moving from looping forever.
  for (let i = 0; i < 400 && !(await reached()); i++) {
    await handle.press(key);
  }
  expect(await reached()).toBe(true);
}

for (const width of [320, 390]) {
  test(`a zoom with a selection open leaves the insertion line at the end of the take (${width}px, #361)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await fixDecodedLength(page, TAKE_SECONDS);
    await seedToRecorder(page);
    await recordShortTake(page);
    await clickEditRecording(page);

    const startHandle = page.getByLabel("Selection start", { exact: true });
    const endHandle = page.getByLabel("Selection end", { exact: true });
    await expect(startHandle).toBeVisible();
    const length = Number(await endHandle.getAttribute("aria-valuemax"));
    expect(length).toBeGreaterThan(0);
    // The fresh seed: the last quarter of the take, ending at the line.
    await expect(endHandle).toHaveAttribute("aria-valuenow", String(length));

    // Move the span to about [0.30, 0.40] of the take. The start goes first,
    // so the span never inverts.
    await nudgeTo(startHandle, "ArrowLeft", 0.3 * length);
    await nudgeTo(endHandle, "ArrowLeft", 0.4 * length);
    expect(await valueOf(endHandle)).toBeGreaterThan(
      await valueOf(startHandle)
    );

    // Zoom to a quarter. The span is narrower than the window, so the fit
    // lands the view about 0.43 of the way into the take.
    const zoomIn = page.getByRole("button", {
      name: "Zoomed out. Zoom in to a quarter.",
      exact: true,
    });
    await zoomIn.click();
    await expect(zoomIn).toHaveCount(0);

    // Leave edit mode and come back. Leaving resets the zoom to whole and
    // drops the view pan, and the new seed is taken from the insertion line.
    // The ✕ toggle is the exit (#1252; #1243 removed the header's
    // "Editing" pill, which was the direct "Done editing" button).
    await editRecordingButton(page).click();
    await expect(startHandle).toHaveCount(0);
    await clickEditRecording(page);
    await expect(startHandle).toBeVisible();

    // The line never left the end of the take, so the span ends there again.
    // With the fit leaked into the insertion offset it would end near 0.68.
    await expect(endHandle).toHaveAttribute("aria-valuemax", String(length));
    await expect(endHandle).toHaveAttribute("aria-valuenow", String(length));
  });
}
