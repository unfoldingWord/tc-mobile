import { expect, test, type Page } from "@playwright/test";

/**
 * The mic panel's second-refusal state at a small phone (#1569), on the
 * shipped `dist/` build. jsdom computes no boxes, so this is the layout half
 * of `tests/mic-settings-steps.test.ts`: with the longest walk-through on
 * screen (Safari on iOS, four steps) and the real refusal sentence, Retry and
 * Back must sit inside a 360x640 viewport without scrolling, and the last
 * step must be reachable by scrolling the panel's own body.
 *
 * The refusal is real code, not a stub of the panel: `getUserMedia` rejects
 * with `NotAllowedError`, so the recorder's own classifier words the message
 * (microphone permission granted to the page, so it reads the OS-blocked
 * sentence, the longest). The user agent is set to an iPhone Safari string so
 * `readMicSettingsPlatform` picks the iOS walk-through. This is a layout
 * check in headless Chromium; it is not a device run.
 */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test.use({
  permissions: ["microphone"],
  userAgent: IPHONE_SAFARI,
  viewport: { width: 360, height: 640 },
});

async function openRecorder(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill("Job");
  await page.getByRole("button", { name: "Create book", exact: true }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill("One");
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open One" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
}

test("the second-refusal steps leave Retry and Back on screen and scrollable", async ({
  page,
}) => {
  await openRecorder(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const retry = page.getByRole("button", { name: "Try again" });
  const back = page.getByRole("button", { name: "Go back" });
  await expect(retry).toBeVisible();
  // First refusal: the panel as it always was.
  await expect(page.locator(".o4-err-steps")).toHaveCount(0);
  await expect(page.locator(".o4-err-title")).toContainText(
    "Your device is not letting the app use the microphone"
  );

  await retry.click();
  const steps = page.locator(".o4-err-steps li");
  await expect(steps).toHaveCount(4);
  // The steps showing: the compact header, and the long sentence is gone.
  await expect(page.locator(".o4-err-head")).toBeVisible();
  await expect(page.locator(".o4-err-title")).toHaveText("Microphone is off");

  const viewport = page.viewportSize()!;
  for (const control of [retry, back]) {
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }

  // A reviewer's picture of the state under test, written only on request.
  if (process.env.MIC_STEPS_SHOT) {
    await page.locator("#launch-intro").waitFor({ state: "hidden" });
    await page.screenshot({ path: process.env.MIC_STEPS_SHOT });
  }

  // All four steps are on screen WITHOUT scrolling, above Retry. Scrolling
  // the body stays as a fallback for a shorter screen.
  const retryTop = (await retry.boundingBox())!.y;
  for (let i = 0; i < 4; i++) {
    const box = (await steps.nth(i).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(retryTop);
  }
});
