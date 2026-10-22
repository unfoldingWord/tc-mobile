import { expect, test, type Page } from "@playwright/test";

import { seedToRecorder } from "./support/seed";

/**
 * The recorder's microphone-refusal card at a small phone, once per shipped
 * language (#1603), on the shipped `dist/` build. A title that wraps to a
 * second line pushes the refusal sentence below the bottom of
 * `.o4-err-body`, which scrolls inside the room the sheet leaves, so the last
 * line is cut off with no sign that it can be reached. jsdom computes no
 * boxes, so only a browser can measure it.
 *
 * The claim is: the body's scrollHeight is at most its clientHeight, in both
 * refusal wordings (`micPrompt` when the page has not been refused by the OS
 * yet, `micOsBlocked` when the microphone is granted to the page), for English
 * and every language whose table is complete.
 *
 * The refusal is real code: `getUserMedia` rejects with `NotAllowedError` and
 * the recorder's own classifier words the message. The language is switched
 * the way a phone does it, by changing `navigator.languages` and firing
 * `languagechange` while the recorder is idle (`hooks/phone-locale.ts`), so
 * the seeding walk can use English labels. This is a layout check in headless
 * Chromium at 360x640. It is not a device run and says nothing about whether
 * the wording is right.
 */
test.use({ viewport: { width: 360, height: 640 } });

const LOCALES = ["en", "es", "fr", "pt", "id", "sw", "hi"] as const;

async function switchLanguage(page: Page, tag: string) {
  await page.evaluate((t) => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => [t],
    });
    window.dispatchEvent(new Event("languagechange"));
  }, tag);
  await expect(page.locator("html")).toHaveAttribute("lang", tag);
}

for (const tag of LOCALES) {
  for (const state of ["micPrompt", "micOsBlocked"] as const) {
    test(`${tag} ${state}: the refusal card shows its whole sentence at 360px (#1603)`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      if (state === "micOsBlocked") {
        await context.grantPermissions(["microphone"]);
      }
      await seedToRecorder(page);
      const record = await page
        .getByRole("button", { name: "Record", exact: true })
        .elementHandle();
      expect(record).not.toBeNull();
      await switchLanguage(page, tag);
      await record!.click();

      const body = page.locator(".o4-err-body");
      await expect(body).toBeVisible();
      await expect(page.locator(".o4-err-sub")).not.toHaveText("");
      const fit = await body.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(
        fit.scrollHeight,
        `${tag} ${state}: ${fit.scrollHeight}/${fit.clientHeight}`
      ).toBeLessThanOrEqual(fit.clientHeight);

      if (process.env.MIC_REFUSAL_SHOT) {
        await page.locator("#launch-intro").waitFor({ state: "hidden" });
        await page.screenshot({
          path: `${process.env.MIC_REFUSAL_SHOT}/${tag}-${state}.png`,
        });
      }
    });
  }
}
