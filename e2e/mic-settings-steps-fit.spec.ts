import { expect, test, type Page } from "./support/test";

/**
 * The mic panel's second-refusal state at a small phone (#1569), on the
 * shipped `dist/` build. jsdom computes no boxes, so this is the layout half
 * of `tests/mic-settings-steps.test.ts`: with the longest walk-through on
 * screen (the iOS app, four steps) and the real refusal sentence, Retry and
 * Back must sit inside a 360x640 viewport without scrolling, and every step
 * must be on screen without scrolling, inside the panel's content box. A long
 * word must wrap inside its step, and at 360x480 the body scrolls while Retry
 * and Back stay on screen.
 *
 * The refusal is real code, not a stub of the panel: `getUserMedia` rejects
 * with `NotAllowedError`, so the recorder's own classifier words the message
 * (microphone permission granted to the page, so it reads the OS-blocked
 * sentence, the longest). Capacitor's custom-platform hook names the iOS shell so
 * `readMicSettingsPlatform` picks the iOS walk-through. This is a layout
 * check in headless Chromium; it is not a device run.
 */
test.use({
  permissions: ["microphone"],
  viewport: { width: 360, height: 640 },
});

async function openRecorder(page: Page) {
  await page.addInitScript(() => {
    // The native-platform signal the app reads: Capacitor's own custom
    // platform hook, so `Capacitor.getPlatform()` answers "ios" and the iOS
    // app walk-through (four steps, the longest) is chosen by the real code.
    (
      window as unknown as { CapacitorCustomPlatform: { name: string } }
    ).CapacitorCustomPlatform = { name: "ios" };
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

test("the second-refusal steps show every step with Retry and Back on screen", async ({
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

  // All four steps are on screen WITHOUT scrolling, above Retry, and inside
  // the panel's content box sideways too (#1747, from #1571): the list was
  // capped at 320px inside a 316px content box.
  await shakeSettled(page);
  const retryTop = (await retry.boundingBox())!.y;
  const content = await contentBox(page);
  for (let i = 0; i < 4; i++) {
    const box = (await steps.nth(i).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(retryTop);
    expect(box.x).toBeGreaterThanOrEqual(content.left);
    expect(box.x + box.width).toBeLessThanOrEqual(content.right);
  }
  // Nothing in the body can scroll sideways.
  const body = page.locator(".o4-err-body");
  const sideways = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways).toBe(0);

  // One gap above Retry, not two (#1747): the panel's own 22px gap is the
  // whole space between the body and the footer.
  const bodyBox = (await body.boundingBox())!;
  expect(retryTop - (bodyBox.y + bodyBox.height)).toBeCloseTo(22, 0);
});

test("a step text with one long word wraps inside its row", async ({
  page,
}) => {
  await openRecorder(page);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  const step = page.locator(".o4-err-steps li").first();
  await expect(step).toBeVisible();
  // A translation may carry a word longer than the row. The text must wrap
  // inside the row, not push the row past the list.
  const text = step.locator(".o4-err-step-text");
  await text.evaluate((el) => {
    el.textContent = "Mikrofonberechtigungseinstellungen".repeat(2);
  });
  await shakeSettled(page);
  const row = (await step.boundingBox())!;
  const textBox = (await text.boundingBox())!;
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(row.x + row.width);
  expect(await step.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  const content = await contentBox(page);
  expect(row.x + row.width).toBeLessThanOrEqual(content.right);
});

test.describe("on a shorter screen", () => {
  test.use({ viewport: { width: 360, height: 480 } });

  test("the steps scroll inside the body while Retry and Back stay put", async ({
    page,
  }) => {
    await openRecorder(page);
    await page.getByRole("button", { name: "Record", exact: true }).click();
    const retry = page.getByRole("button", { name: "Try again" });
    const back = page.getByRole("button", { name: "Go back" });
    await retry.click();
    const steps = page.locator(".o4-err-steps li");
    await expect(steps).toHaveCount(4);

    const body = page.locator(".o4-err-body");
    // The fallback is exercised: the body, not the page, overflows.
    expect(
      await body.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeGreaterThan(0);
    const viewport = page.viewportSize()!;
    for (const control of [retry, back]) {
      const box = (await control.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    // The last step is reachable by scrolling the body, and lands above Retry.
    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    const last = (await steps.nth(3).boundingBox())!;
    const retryTop = (await retry.boundingBox())!.y;
    expect(last.y).toBeGreaterThanOrEqual(0);
    expect(last.y + last.height).toBeLessThanOrEqual(retryTop);
  });
});

/**
 * Waits out the refusal shake (3-components/motion.css), which moves the body sideways
 * by a few pixels, so a horizontal box is read at rest.
 */
async function shakeSettled(page: Page) {
  await page
    .locator(".o4-err-body")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(() => {})
    );
}

/** The panel's content box: its border box less its inline padding. */
async function contentBox(page: Page) {
  return page.locator(".o4-err-split").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + parseFloat(cs.paddingLeft),
      right: r.right - parseFloat(cs.paddingRight),
    };
  });
}
