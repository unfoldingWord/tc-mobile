import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * The segment ≡ menu's O4 tile grid, at phone width, when it holds FOUR real
 * tiles (Done, Edit, Clear, Delete) — the row's `hasClip` state, against the
 * shipped `dist/` build.
 *
 * #1119 round 5 (George Medium 1): the row's last tile was clipped past the
 * panel edge at 320px. This spec asserts that every tile's centre lands
 * inside the viewport. `o4-tiles--compact` (`src/app/styles/o4/menus.css`)
 * is the fix: it applies only to this four-tile row (`segment-row.tsx`'s
 * `hasClip` branch), not to every `TileGrid` — the three-tile row (no stored
 * clip, Clear absent) keeps the pinned size.
 *
 * This spec needs a REAL recorded take to reach the four-tile row, so it
 * uses synthetic Chromium media (`--use-fake-device-for-media-stream`), the
 * same pattern `recorder-menu-half-screen.spec.ts` and `recorder-selection.spec.ts`
 * use — no physical microphone runs in CI or in this container.
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

/** One book, one chapter, one RECORDED segment — landed back on Segments. */
async function seedRecordedSegment(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
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
  await page.getByRole("button", { name: "Close recorder" }).click();
  await expect(
    page.getByRole("button", { name: "More actions for segment 1" })
  ).toBeVisible();
}

const WIDTHS = [320, 360];

// The four tiles this row draws once it has a clip, left to right, in the
// DRI's 2026-09-28 order (Done, Edit, Clear, Delete) — this spec does not
// re-check the order (the render tests in
// `tests/o4-menus-chapter-segment.test.ts` pin it), only that each one's
// centre lands inside the viewport it was rendered at.
const TILE_LABELS = [
  "Mark segment 1 done",
  "Edit segment 1",
  "Clear recording",
  "Delete segment",
];

for (const width of WIDTHS) {
  test(`the segment ≡ menu's four tiles all stay inside a ${width}px-wide screen, with a real recorded take (#1119)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await useO4(page);
    await seedRecordedSegment(page);

    await page
      .getByRole("button", { name: "More actions for segment 1" })
      .click();
    const menu = page.getByRole("dialog", { name: "More" });
    await expect(menu).toBeVisible();
    // The rendered sheet's own slide-in animation, so the boxes below are
    // measured where the row comes to rest, not mid-transition
    // (`recorder-menu-half-screen.spec.ts` measures the same way).
    await menu.evaluate((el) =>
      Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished)
      ).then(() => undefined)
    );

    for (const label of TILE_LABELS) {
      const tile = menu.getByRole("button", { name: label, exact: true });
      await expect(tile).toBeVisible();
      const box = await tile.boundingBox();
      expect(box, `${label} has no box at ${width}px`).not.toBeNull();
      const centreX = box!.x + box!.width / 2;
      expect(
        centreX,
        `${label}'s centre (${centreX}px) left a ${width}px-wide viewport`
      ).toBeGreaterThanOrEqual(0);
      expect(
        centreX,
        `${label}'s centre (${centreX}px) left a ${width}px-wide viewport`
      ).toBeLessThanOrEqual(width);
      // The repo's own 44px touch-target floor (`tests/touch-policy.test.ts`),
      // not the pinned 76px token — the compact row is allowed to be smaller
      // than the token, never smaller than the floor every other control
      // respects.
      expect(
        box!.width,
        `${label}'s tap target (${box!.width}px wide) is under the 44px floor`
      ).toBeGreaterThanOrEqual(44);
    }
  });
}
