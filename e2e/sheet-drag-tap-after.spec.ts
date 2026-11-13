import { existsSync } from "node:fs";

import type { CDPSession, Page } from "@playwright/test";

import { expect, test } from "./support/test";

import { seedToRecorder } from "./support/seed";

/**
 * A tap made just after a sheet is flicked closed is a tap (#1974).
 *
 * #1974: on an Android phone, after the recorder's ≡ sheet was dragged
 * closed by its grip, a tap on the Play button under it did nothing, and a
 * second tap was needed. In Chromium a tap soon after a quick release on
 * the grip can fire no click, although the grip is `touch-action: none`;
 * that the browser reads the release as a fling and the tap only stops it
 * is an inference. `Menu` now cancels the drag's own `touchmove`s
 * (`components/menu.tsx`), which keeps the next tap a tap.
 *
 * Touch here is Chromium's own touch input (CDP `Input.dispatchTouchEvent`
 * with touch emulation), not a mouse, because the fling exists only for
 * touch. The moves are sent back to back, so the release is a fast flick.
 * Whether a phone's own touch screen and WebView do the same is the device
 * check, not this spec.
 *
 * The release ends over Play and must not start playback; a tap on Play
 * 100 ms after it must. The guard against a release's own trailing click
 * (#1273, #1318) is pinned in `tests/sheet-close.test.ts`, where the click
 * can be dispatched by hand.
 */
test.use({
  permissions: ["microphone"],
  hasTouch: true,
  isMobile: true,
  viewport: { width: 360, height: 740 },
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

async function recordShortTake(page: Page) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1200);
  await stop.click();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
}

function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  at?: { x: number; y: number }
) {
  return cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: at ? [at] : [],
  });
}

test("a tap on Play just after the ≡ sheet is flicked closed starts playback (#1974)", async ({
  page,
}) => {
  await seedToRecorder(page);
  await recordShortTake(page);
  const play = page.getByRole("button", {
    name: "Play recording",
    exact: true,
  });
  await expect(play).toBeEnabled();
  const playing = page.getByRole("button", {
    name: "Stop playing",
    exact: true,
  });
  const target = await play.boundingBox();
  expect(target, "Play is not laid out").not.toBeNull();
  const x = target!.x + target!.width / 2;
  const playY = target!.y + target!.height / 2;

  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const sheet = page.locator(".menu-panel:has(.recorder-menu-tile)");
  await expect(sheet).toBeVisible();
  const grip = await sheet.locator(".menu-grip").boundingBox();
  expect(grip, "the grip is not laid out").not.toBeNull();
  const gripY = grip!.y + grip!.height / 2;
  expect(playY - gripY).toBeGreaterThan(100);

  // Flick the grip straight down and let go over Play.
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, "touchStart", { x, y: gripY });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, "touchMove", {
      x,
      y: gripY + ((playY - gripY) * i) / steps,
    });
  }
  await touch(cdp, "touchEnd");
  await expect(sheet).toHaveCount(0);

  // The release over Play is not a tap on it.
  await page.waitForTimeout(100);
  await expect(playing).toHaveCount(0);

  // A new tap, 100 ms after the release, is.
  await touch(cdp, "touchStart", { x, y: playY });
  await touch(cdp, "touchEnd");
  await expect(playing).toBeVisible({ timeout: 1000 });
});
