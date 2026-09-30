import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";
import { seedToRecorder } from "./support/seed";

/**
 * An edit-mode audition of a picked span draws its playhead INSIDE the band
 * being heard (#361 row 5, the round-2 surviving mutant of #345).
 *
 * `soundRange` in `src/components/recorder.tsx` sounds `working.subarray(
 * start, end)`, so the audio boundary reports milliseconds into the SPAN, not
 * into the take. `soundingOffsetRef` is pinned to the span's start at the tap
 * and `readSoundingElapsed` adds it back, so `PlayheadOverlay` can map a
 * position within the drawn buffer. Dropping either half leaves the pure
 * `auditionPlan` tests green, because the offset lives in the component. The
 * line would then travel from the start of the TAKE, left of the band.
 *
 * The span is moved to about [0.60, 0.85] of the take first, so the whole band
 * sits on the canvas and the line has room to travel across it. The seeded
 * span (the last quarter) is not used: with the line resting at the end of the
 * take, part of the drawn window left of the band is blank, and a span that
 * starts off-canvas lets the overlay's edge clamp hide where the line starts.
 * The first assertion below states that premise, so a layout change that moves
 * the band off-canvas fails here rather than weakening the check.
 *
 * What it observes is the overlay's own imperative `left`, sampled every
 * animation frame while the line is shown. It does not check what is heard.
 * The whole-view narrowing, the other #345 survivor, is pinned in
 * `tests/recorder-stage.test.ts` against the pure `stageView`.
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

/** A take long enough that a quarter of it sounds for well over a second. */
async function recordTake(page: Page) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(3000);
  await stop.click();
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
  // One press moves a handle by 1/400 of the window; the bound stops a handle
  // that has stopped moving from looping forever.
  for (let i = 0; i < 400 && !(await reached()); i++) {
    await handle.press(key);
  }
  expect(await reached()).toBe(true);
}

type Sample = { line: number; bandLeft: number; bandRight: number };

test("an audition of a picked span draws its playhead inside the band (#361)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await seedToRecorder(page);
  await recordTake(page);
  await clickEditRecording(page);

  const startHandle = page.getByLabel("Selection start", { exact: true });
  const endHandle = page.getByLabel("Selection end", { exact: true });
  await expect(startHandle).toBeVisible();
  const length = Number(await endHandle.getAttribute("aria-valuemax"));
  expect(length).toBeGreaterThan(0);
  // The start goes first, so the span never inverts.
  await nudgeTo(startHandle, "ArrowLeft", 0.6 * length);
  await nudgeTo(endHandle, "ArrowLeft", 0.85 * length);

  const canvas = await page.locator(".recorder-canvas").boundingBox();
  const band = await page.locator(".selection-band").boundingBox();
  expect(canvas).not.toBeNull();
  expect(band).not.toBeNull();
  // The premise: the whole band is on the canvas, with room left of it.
  expect(band!.x).toBeGreaterThan(canvas!.x + 8);
  expect(band!.x + band!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);

  // Start sampling before the tap, so the first frames of the play are seen.
  // The line is the overlay's 2px `aria-hidden` child of the canvas, found by
  // shape rather than by a theme class, and shown only while `opacity` is 1.
  const sampling = page.evaluate(
    () =>
      new Promise<Sample[]>((resolve) => {
        const stage = document.querySelector(".recorder-canvas")!;
        const line = [
          ...stage.querySelectorAll<HTMLElement>("[aria-hidden='true']"),
        ].find((el) => getComputedStyle(el).width === "2px");
        const bandEl = document.querySelector(".selection-band");
        if (!line || !bandEl) return resolve([]);
        const out: Sample[] = [];
        const began = performance.now();
        const tick = () => {
          if (line.style.opacity === "1") {
            const l = line.getBoundingClientRect();
            const b = bandEl.getBoundingClientRect();
            out.push({ line: l.left, bandLeft: b.left, bandRight: b.right });
          }
          if (performance.now() - began < 3000) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      })
  );
  await page
    .locator(".recorder-toolbar")
    .getByRole("button", { name: "Play the selection", exact: true })
    .click();
  const samples = await sampling;

  expect(samples.length).toBeGreaterThan(10);
  // Every drawn position lies on the band, give or take a pixel of rounding
  // and the line's own 2px width.
  for (const s of samples) {
    expect(s.line).toBeGreaterThanOrEqual(s.bandLeft - 2);
    expect(s.line).toBeLessThanOrEqual(s.bandRight + 2);
  }
  // And the line travels across it rather than sitting at one edge.
  const xs = samples.map((s) => s.line);
  const travelled = Math.max(...xs) - Math.min(...xs);
  expect(travelled).toBeGreaterThan(band!.width / 2);
});

// The same offset's other reader. `stopPlayback` adds `soundingOffsetRef` to
// the boundary's position before `freezePlaybackPan` writes it into
// `panState`, the record insertion offset. Dropping that term leaves the test
// above green, because it only reads the overlay's own path. The line would
// then land where playback had reached measured from the start of the TAKE:
// a Stop after Play from a mid-take line would jump the line back, and the
// next Record would splice there.
//
// A Play from the rest starts at sample 0, so its offset is 0 and cannot show
// the leak. The first play therefore only moves the line into the take; the
// second starts there, so its offset is non-zero. Each line position is read
// as the next edit entry's seed: `seedSelection` starts the span at the line,
// and both stops leave the line far enough from the end that the span need not
// slide back.
test("a Stop after Play from a mid-take line leaves the line past where it started (#361)", async ({
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
  await page.waitForTimeout(5000);
  await stopRecording.click();

  const toolbar = page.locator(".recorder-toolbar");
  const play = toolbar.getByRole("button", {
    name: /^Play (from the line|recording)$/,
  });
  const stopPlaying = toolbar.getByRole("button", {
    name: "Stop playing",
    exact: true,
  });
  const startHandle = page.getByLabel("Selection start", { exact: true });
  const endHandle = page.getByLabel("Selection end", { exact: true });

  /** Play for `ms`, then Stop, and read where the line came to rest. */
  const playThenRead = async (ms: number) => {
    await expect(
      page.getByRole("button", { name: "Record", exact: true })
    ).toBeVisible();
    await play.click();
    await expect(stopPlaying).toBeVisible();
    await page.waitForTimeout(ms);
    await stopPlaying.click();
    await expect(play).toBeVisible();
    await clickEditRecording(page);
    await expect(startHandle).toBeVisible();
    const line = await valueOf(startHandle);
    const length = Number(await endHandle.getAttribute("aria-valuemax"));
    await page
      .getByRole("button", { name: "Done editing", exact: true })
      .click();
    await expect(startHandle).toHaveCount(0);
    return { line, length };
  };

  const first = await playThenRead(2000);
  expect(first.length).toBeGreaterThan(0);
  // The premise: the first play moved the line off the start and left room
  // before the end, so the second play starts mid-take.
  expect(first.line).toBeGreaterThan(0.15 * first.length);
  expect(first.line).toBeLessThan(0.6 * first.length);

  const second = await playThenRead(800);
  // With the offset, the line is past where the second play began. Without
  // it, the line sits about 800 ms into the take, before that point.
  expect(second.line).toBeGreaterThan(first.line);
});
