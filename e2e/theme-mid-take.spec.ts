import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { seedToRecorder } from "./support/seed";
import { LIGHT_FLOOR, floorOf, resolved } from "./support/theme";

/**
 * Changing the theme WHILE a take is recording (#149).
 *
 * The case `theme-toggle.spec.ts` does not reach, raised as a nonblocking QA
 * suggestion on PR 623: its recorder case opens an idle, empty sheet, and the
 * condition #149 is about — the sun reaching the screen — arrives mid-capture.
 *
 * Its own file rather than a describe in that spec because the fake microphone
 * needs `test.use({ launchOptions })`, which forces a new worker and so is
 * rejected inside a describe group. `playwright.config.ts` lists it explicitly
 * in the `chromium-shipped-build` project, per that file's rule that a new spec
 * must fail to run visibly rather than silently join a catch-all.
 *
 * WHAT THIS IS REALLY GUARDING. Mounting `ThemeControl` inside the recorder
 * puts a `useSyncExternalStore` subscriber in a tree that is capturing audio,
 * and a toggle re-renders it. The PR's claim is that the blast radius stops
 * at the leaf (plus the canvases, which subscribe on their own account), so a
 * toggle cannot disturb a live take. Until this case that claim rested on
 * reading the code. Here the take is actually running when the theme flips.
 *
 * DRIVING A LIVE TAKE IS ESTABLISHED HERE, which the file header's "the
 * recorder cannot [be driven honestly]" predates:
 * `e2e/recorder-selection.spec.ts` records against
 * `--use-fake-device-for-media-stream` and asserts on the resulting take. The
 * same flags are scoped to this describe.
 *
 * WHAT IS ASSERTED, and what is NOT. Capture is still live after the toggle
 * (the transport still offers Stop), the elapsed timer has ADVANCED across
 * it, the menu keeps the toggle reachable, and the take still commits
 * afterwards — so the toggle neither cancelled nor stalled the capture.
 * Nothing here inspects the captured samples: a fake device emits a synthetic
 * tone, so "the audio is intact" is not a claim Chromium can settle, and it
 * stays a device item (#245). Timer text over a synthetic clock is the honest
 * observable; sample integrity is not.
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

/** The recorder's elapsed readout (`t-timer`), as whole seconds. */
const elapsedSeconds = async (page: Page) => {
  const text = (await page.locator(".t-timer").innerText()).trim();
  const [minutes, seconds] = text.split(":");
  return Number(minutes) * 60 + Number(seconds);
};

test("a toggle mid-take leaves the capture running, and the take still commits", async ({
  page,
}) => {
  await seedToRecorder(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Start capturing, and wait until the transport says a take is live.
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();

  // Let the timer leave 0:00, so "advanced" below compares two real readings
  // rather than one reading against a clock that had not started.
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(0);
  const beforeToggle = await elapsedSeconds(page);

  // The `≡` stays reachable mid-take on purpose (Edit commits-then-edits a
  // live take, #134), which is what makes the toggle reachable here at all.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "More", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: /light screen/i }).click();

  // The screen repaints, in the shipped cascade, mid-capture.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);

  // And the take is still running: the transport still offers Stop, and the
  // clock has moved past the reading taken before the toggle. A toggle that
  // cancelled or stalled the capture fails one of these two.
  await expect(stop).toBeVisible();
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(beforeToggle);

  // The menu is still up and still offers the way back, so a wrong guess
  // costs one tap in the same place — mid-take as anywhere else.
  await expect(
    menu.getByRole("button", { name: /dark screen/i })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Finally, the take commits: since #614 the tap that ends a recording
  // commits it in place, so Record coming back is the take having landed
  // rather than the sheet merely idling.
  await stop.click();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  // Still light after the commit — the theme outlived the take it spanned.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
