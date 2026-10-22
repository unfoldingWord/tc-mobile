import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Touch-and-hold to read a cut-off book, chapter or segment name (#1284, S14),
 * against the shipped `dist/` build at 360 px: the bubble shows the whole name
 * while the press stays, puts it away on release, and the same press does not
 * also open the row, lift it for reorder or open its menu. A name that fits is
 * left to the row's own hold, which still lifts.
 *
 * Pointer events here come from Playwright's mouse, which Chromium reports as
 * a pointer of type "mouse". What this does not exercise: a real finger, the
 * phone's long-press callout, and any device.
 *
 * Set HOLD_REVEAL_SHOTS to a directory to save the 360 px screenshots.
 */

const BOOK =
  "The Complete Collection of Oral Stories for the Mountain Villages";
const LONG_CHAPTER =
  "A very long chapter name that goes on past the end of the row";
const LONG_SEGMENT =
  "Verses three to nine, the sower and the four kinds of soil";

/** Holds the centre of `el` for `ms`, leaving the press down. */
async function pressAndHold(page: Page, el: Locator, ms = 650) {
  const box = (await el.boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
}

const bubble = (page: Page) => page.locator(".name-reveal");

async function shot(page: Page, name: string) {
  const dir = process.env.HOLD_REVEAL_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function newChapter(page: Page, name: string) {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill(name);
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
}

async function seed(page: Page, theme: "light" | "dark" = "dark") {
  await page.setViewportSize({ width: 360, height: 780 });
  // The app reads its own stored theme, never the OS setting (#171).
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("tc-mobile.theme", t);
    } catch {
      // The default theme stands.
    }
  }, theme);
  await page.goto("/");
  // The launch intro covers the screen for its first moments.
  await expect(page.locator("#launch-intro")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill(BOOK);
  await page.getByRole("button", { name: "Create book" }).click();
  await newChapter(page, LONG_CHAPTER);
  await newChapter(page, "Short");
}

test("a held, cut-off book name and chapter title show whole and leave the row alone", async ({
  page,
}) => {
  await seed(page);
  const card = page.getByRole("button", { name: /^The Complete Collection/ });
  await expect(card).toHaveAttribute("aria-expanded", "true");
  // The name is the accessible name already: no gesture needed to hear it.
  await expect(card).toHaveAccessibleName(new RegExp(BOOK));

  // Book name.
  const name = page.locator(".books-name");
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  );
  await pressAndHold(page, name);
  await expect(bubble(page)).toHaveText(BOOK);
  await shot(page, "books-name-hold");
  await page.mouse.up();
  await expect(bubble(page)).toHaveCount(0);
  // The release did not toggle the book, and nothing was lifted.
  await expect(card).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-reordering]")).toHaveCount(0);

  // Chapter title: inside the row's open button.
  const title = page.locator(".books-chapter-title").first();
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  );
  await pressAndHold(page, title);
  await expect(bubble(page)).toHaveText(LONG_CHAPTER);
  await expect(page.locator("[data-reordering]")).toHaveCount(0);
  await shot(page, "books-chapter-hold");
  await page.mouse.up();
  await expect(bubble(page)).toHaveCount(0);
  // Its own click on the row did not open the chapter.
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );
  await expect(page.locator("[data-reordering]")).toHaveCount(0);

  // A plain tap on the same title still opens the chapter.
  await title.click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
});

test("a held cut-off name ended without a plain release still leaves the row alone", async ({
  page,
}) => {
  await seed(page);
  const card = page.getByRole("button", { name: /^The Complete Collection/ });
  const title = page.locator(".books-chapter-title").first();

  // Escape while the name is up, then release on the row.
  await pressAndHold(page, page.locator(".books-name"));
  await expect(bubble(page)).toHaveText(BOOK);
  await page.keyboard.press("Escape");
  await expect(bubble(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(card).toHaveAttribute("aria-expanded", "true");

  // Escape on the chapter title, then release: the chapter does not open.
  await pressAndHold(page, title);
  await expect(bubble(page)).toHaveText(LONG_CHAPTER);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );

  // Moved past the slop before the hold, then released on the title.
  const box = (await title.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 24, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 64, y, { steps: 4 });
  await page.mouse.up();
  await expect(bubble(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );

  // An ordinary tap afterwards still opens the chapter.
  await title.click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
});

test("a title that fits still lifts for reorder and shows no bubble", async ({
  page,
}) => {
  await seed(page);
  const short = page.locator(".books-chapter-title", { hasText: "Short" });
  expect(await short.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false
  );
  await pressAndHold(page, short);
  await expect(page.locator(".books-chapters[data-reordering]")).toHaveCount(1);
  await expect(bubble(page)).toHaveCount(0);
  await page.mouse.up();
});

test("a held, cut-off segment title and chapter title show whole on the Segments screen", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: `Open ${LONG_CHAPTER}` }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  await page.getByRole("button", { name: "Rename segment" }).click();
  await page.getByRole("textbox", { name: "Segment name" }).fill(LONG_SEGMENT);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);

  const open = page.getByRole("button", { name: /^Open segment 1/ });
  await expect(open).toHaveAccessibleName(`Open segment 1 · ${LONG_SEGMENT}`);

  const row = page.locator(".row-title");
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  );
  await pressAndHold(page, row);
  await expect(bubble(page)).toHaveText(LONG_SEGMENT);
  // Not lifted for reorder, and the recorder did not open.
  await expect(page.locator(".segments-item--lifted")).toHaveCount(0);
  await shot(page, "segments-row-hold");
  await page.mouse.up();
  await expect(bubble(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);

  const head = page.locator(".segments-title");
  expect(await head.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  );
  await pressAndHold(page, head);
  await expect(bubble(page)).toHaveText(LONG_CHAPTER);
  await page.mouse.up();
  await expect(bubble(page)).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the bubble reads in ${scheme} at 360 px and stays inside the screen`, async ({
    page,
  }) => {
    await seed(page, scheme);
    await pressAndHold(page, page.locator(".books-chapter-title").first());
    const b = bubble(page);
    await expect(b).toHaveText(LONG_CHAPTER);
    const box = (await b.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await shot(page, `bubble-${scheme}`);
    await page.mouse.up();
  });
}
