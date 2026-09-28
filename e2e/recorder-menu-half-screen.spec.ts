import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { seedToRecorder } from "./support/seed";

/**
 * The O4 recorder menu stays under half the screen, so the waveform above it
 * stays in view (#927, the requirements owner's ask; the cap is
 * `o4/menus.css`'s `.menu-panel:has(.recorder-menu-tile)` rule from #994).
 *
 * #994 put the cap in CSS but nothing measured it on a rendered page. This
 * spec opens the real menu over a recorded take in the shipped `dist/` build,
 * at phone-sized viewports, and measures the sheet and the stage with
 * `boundingBox`. It asserts geometry only: that the sheet is no taller than
 * half the viewport, and that the waveform canvas's midline sits above the
 * sheet's top edge. Whether the waveform READS well through the scrim is a
 * judgment for a person looking at a phone, not something this spec checks.
 *
 * The short 360 x 480 case is there so the cap itself is exercised: its
 * `capBites` flag asserts that the sheet's content overflows and the sheet
 * scrolls, so the half-screen limit there comes from the cap and not from the
 * content happening to be short. If the tiles ever shrink enough that this
 * stops being true, that assertion fails and a shorter viewport is needed.
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

/** Opt into the O4 look before the app boots (`lib/design.ts`'s key). */
async function useO4(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tc-mobile.design", "o4");
  });
}

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

const VIEWPORTS = [
  { width: 360, height: 800, capBites: false },
  { width: 360, height: 640, capBites: false },
  { width: 390, height: 740, capBites: false },
  { width: 360, height: 480, capBites: true },
];

for (const viewport of VIEWPORTS) {
  test(`the O4 recorder menu stays under half a ${viewport.width}x${viewport.height} screen (#927)`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await useO4(page);
    await seedToRecorder(page);
    await expect(page.locator("html")).toHaveAttribute("data-design", "o4");
    await recordShortTake(page);

    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    const panel = page.locator(".menu-panel:has(.recorder-menu-tile)");
    await expect(panel).toBeVisible();
    // Measure the sheet where it comes to rest, not mid-slide.
    await panel.evaluate((el) =>
      Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished)
      ).then(() => undefined)
    );

    const sheet = await panel.boundingBox();
    const wave = await page.locator(".recorder-canvas").boundingBox();
    expect(sheet).not.toBeNull();
    expect(wave).not.toBeNull();

    // The ask: the sheet is no taller than half the screen (+0.5 px for
    // sub-pixel rounding of 50dvh).
    expect(sheet!.height).toBeLessThanOrEqual(viewport.height / 2 + 0.5);
    // The waveform stays in view: its midline, where the take's shape is
    // centred, is above the sheet's top edge. The sheet may still cover the
    // lower part of the waveform on a short screen; this does not claim it
    // clears the whole canvas.
    expect(wave!.y + wave!.height / 2).toBeLessThan(sheet!.y);

    if (viewport.capBites) {
      // The content is taller than the cap, so the sheet scrolls rather than
      // growing over the waveform.
      expect(
        await panel.evaluate((el) => el.scrollHeight > el.clientHeight)
      ).toBe(true);
    }
  });
}
