import { expect, test, type Locator, type Page } from "./support/test";

/**
 * Hold a cut-off name on the Books and Segments screens to read it whole (S14, #1284,
 * #1711), against the shipped `dist/` build.
 *
 * WHY THIS EXISTS. `tests/hold-reveal.test.ts` and
 * `tests/hold-reveal-books.test.ts` run in Node and jsdom, which have no
 * layout: `scrollWidth > clientWidth` is always 0 there, so the one rule the
 * feature rests on (only a name that is really cut off claims the press) is
 * decided in a real browser or nowhere. Here the ellipsis is real.
 *
 * WHAT THIS DRIVES. Headless desktop Chromium with a MOUSE, at 360 px wide.
 * It is not a phone and not a touch run: Playwright's mouse raises a primary
 * pointer with `button 0`, which is all `hooks/use-hold-reveal.ts` checks, so
 * the hook's own paths run, but a finger's pan-to-`pointercancel`, a long
 * press raising the Android callout and iOS Safari's own layout are still the
 * device check.
 */

const LONG_BOOK =
  "The Complete Account Of The Long Journey Told In Full Without Any Cuts";
const SHORT_BOOK = "Ruth";
const LONG_CHAPTER =
  "Verses one through twenty-four read aloud together with the whole group";
const SHORT_CHAPTER = "1:1-4";
/** Past the 450 ms hold, with room to spare. */
const PAST_HOLD_MS = 700;
const GUTTER = 16;
const WIDTH = 360;

async function seed(page: Page, theme: "light" | "dark") {
  await page.setViewportSize({ width: WIDTH, height: 780 });
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("tc-mobile.theme", t);
    } catch {
      // The default theme stands.
    }
  }, theme);
  await page.goto("/");
  await expect(page.locator("#launch-intro")).toHaveCount(0, {
    timeout: 15_000,
  });
  for (const name of [SHORT_BOOK, LONG_BOOK]) {
    await page.getByRole("button", { name: "New book" }).click();
    await page.getByRole("textbox", { name: "Book name" }).fill(name);
    await page.getByRole("button", { name: "Create book" }).click();
  }
  // Both books stay open; both chapters go in the long-named one.
  for (const title of [SHORT_CHAPTER, LONG_CHAPTER]) {
    await page
      .getByRole("button", { name: `Add chapter to ${LONG_BOOK}` })
      .click();
    await page.getByRole("textbox", { name: "Chapter name" }).fill(title);
    await page
      .getByRole("button", { name: "Create chapter", exact: true })
      .click();
  }
}

const bookName = (page: Page, text: string) =>
  page.locator(".books-name", { hasText: text });
const chapterTitle = (page: Page, text: string) =>
  page.locator(".books-chapter-title", { hasText: text });
const bookToggle = (page: Page, text: string) =>
  page.locator(".books-card-hit", { has: bookName(page, text) });

const isCutOff = (el: Locator) =>
  el.evaluate((n) => n.scrollWidth > n.clientWidth);

/** Press on the element's centre and hold past the reveal. */
async function holdOn(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(PAST_HOLD_MS);
}

async function expectBubbleWhole(page: Page, text: string) {
  const bubble = page.locator(".name-reveal");
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toHaveText(text);
  const box = (await bubble.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(GUTTER - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(WIDTH - GUTTER + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  // The whole name is in it: no line of it is clipped.
  expect(await bubble.evaluate((n) => n.scrollWidth > n.clientWidth + 1)).toBe(
    false
  );
}

for (const mode of [
  { label: "light, left-to-right", theme: "light", dir: "ltr" },
  { label: "dark, left-to-right", theme: "dark", dir: "ltr" },
  { label: "light, right-to-left", theme: "light", dir: "rtl" },
] as const) {
  test.describe(`Books at 360px, ${mode.label}`, () => {
    test.beforeEach(async ({ page }) => {
      await seed(page, mode.theme);
      if (mode.dir === "rtl") {
        await page.evaluate(() => {
          document.documentElement.dir = "rtl";
        });
      }
    });

    test("a cut-off book name holds to a bubble with the whole name, then the release opens nothing", async ({
      page,
    }) => {
      const name = bookName(page, LONG_BOOK);
      const toggle = bookToggle(page, LONG_BOOK);
      expect(await isCutOff(name)).toBe(true);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");

      await holdOn(page, name);
      await expectBubbleWhole(page, LONG_BOOK);
      // The press is the name's: the card did not lift for a reorder.
      await expect(page.locator(".books-card-lifted")).toHaveCount(0);

      await page.mouse.up();
      // The one click the release lands is swallowed: no collapse.
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".name-reveal")).toHaveCount(0);
    });

    test("a cut-off chapter title shows whole, does not lift, and opens no screen on release", async ({
      page,
    }) => {
      const title = chapterTitle(page, LONG_CHAPTER);
      expect(await isCutOff(title)).toBe(true);

      await holdOn(page, title);
      await expectBubbleWhole(page, LONG_CHAPTER);
      await expect(page.locator(".books-lifted")).toHaveCount(0);

      await page.mouse.up();
      await expect(
        page.getByRole("button", { name: "Back to books" })
      ).toHaveCount(0);
      await expect(page.locator(".name-reveal")).toHaveCount(0);
    });

    test("a name that fits shows no bubble and its press still reaches the reorder hold", async ({
      page,
    }) => {
      const book = bookName(page, SHORT_BOOK);
      expect(await isCutOff(book)).toBe(false);
      await holdOn(page, book);
      await expect(page.locator(".name-reveal")).toHaveCount(0);
      await expect(page.locator(".books-card-lifted")).toHaveCount(1);
      await page.mouse.up();

      const title = chapterTitle(page, SHORT_CHAPTER);
      expect(await isCutOff(title)).toBe(false);
      await holdOn(page, title);
      await expect(page.locator(".name-reveal")).toHaveCount(0);
      await expect(page.locator(".books-lifted")).toHaveCount(1);
      await page.mouse.up();
    });
  });
}

const LONG_SEGMENT =
  "The healing of the man with the withered hand on the Sabbath";
const SHORT_SEGMENT = "v 5-6";

/** Rename the segment whose ordinal is `n` through its row menu. */
async function renameSegment(page: Page, n: number, label: string) {
  await page
    .getByRole("button", { name: `More actions for segment ${n}` })
    .click();
  await page.getByRole("button", { name: "Rename segment" }).click();
  await page.getByRole("textbox", { name: "Segment name" }).fill(label);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
}

test.describe("Segments at 360px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: WIDTH, height: 780 });
    await page.goto("/");
    await expect(page.locator("#launch-intro")).toHaveCount(0, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "New book" }).click();
    await page.getByRole("button", { name: "Create book" }).click();
    await page.getByRole("button", { name: /^Add chapter to/ }).click();
    await page
      .getByRole("textbox", { name: "Chapter name" })
      .fill(LONG_CHAPTER);
    await page
      .getByRole("button", { name: "Create chapter", exact: true })
      .click();
    await page.getByRole("button", { name: `Open ${LONG_CHAPTER}` }).click();
    for (const n of [1, 2]) {
      await page.getByRole("button", { name: "Add segment" }).click();
      await expect(
        page.getByRole("button", { name: `More actions for segment ${n}` })
      ).toBeVisible();
    }
    await renameSegment(page, 1, LONG_SEGMENT);
    await renameSegment(page, 2, SHORT_SEGMENT);
  });

  const rowTitle = (page: Page, text: string) =>
    page.locator(".row-title", { hasText: text });

  test("a cut-off segment title holds to a bubble, does not lift, and opens nothing on release", async ({
    page,
  }) => {
    const title = rowTitle(page, LONG_SEGMENT);
    expect(await isCutOff(title)).toBe(true);
    await holdOn(page, title);
    await expectBubbleWhole(page, LONG_SEGMENT);
    await expect(page.locator(".segments-item--lifted")).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator(".name-reveal")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Recorder" })).toHaveCount(0);
  });

  test("a cut-off chapter name holds to a bubble with the whole name", async ({
    page,
  }) => {
    const name = page.locator(".segments-title");
    expect(await isCutOff(name)).toBe(true);
    await holdOn(page, name);
    await expectBubbleWhole(page, LONG_CHAPTER);
    await page.mouse.up();
    await expect(page.locator(".name-reveal")).toHaveCount(0);
  });

  test("a title that fits shows no bubble and its press still lifts the row", async ({
    page,
  }) => {
    const title = rowTitle(page, SHORT_SEGMENT);
    expect(await isCutOff(title)).toBe(false);
    await holdOn(page, title);
    await expect(page.locator(".name-reveal")).toHaveCount(0);
    await expect(page.locator(".segments-item--lifted")).toHaveCount(1);
    await page.mouse.up();
  });
});
