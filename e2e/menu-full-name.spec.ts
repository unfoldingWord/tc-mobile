import { expect, test, type Locator, type Page } from "./support/test";

/**
 * The row menus show a long name whole at their top (#1284, the requirements
 * owner's U3: "When tapping the kebab to open the menu, show the full chapter
 * name at the top of that menu"), against the shipped `dist/` build at 360 px:
 * the chapter, book and segment menus. The name wraps onto as many lines as it
 * needs, is not clipped by its box or the screen, and the menu keeps its
 * accessible name. No device was used; Chromium only.
 *
 * Set MENU_FULL_NAME_SHOTS to a directory to save the screenshots.
 */

const BOOK =
  "The Complete Collection of Oral Stories for the Mountain Villages";
const CHAPTER =
  "A very long chapter name that goes on past the end of the row and then some";
const SEGMENT = "Verses three to nine, the sower and the four kinds of soil";

async function seed(page: Page, theme: "light" | "dark", width = 360) {
  await page.setViewportSize({ width, height: 780 });
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
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill(BOOK);
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill(CHAPTER);
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
}

async function shot(page: Page, name: string) {
  const dir = process.env.MENU_FULL_NAME_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** The line wraps (more than one line tall) and none of it is clipped. */
async function expectWholeAndWrapped(line: Locator, text: string, width = 360) {
  await expect(line).toHaveText(text);
  const m = await line.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    return {
      clippedX: el.scrollWidth > el.clientWidth + 1,
      clippedY: el.scrollHeight > el.clientHeight + 1,
      lines: Math.round(box.height / lineHeight),
      left: box.left,
      right: box.right,
      ellipsis: getComputedStyle(el).textOverflow === "ellipsis",
    };
  });
  expect(m.clippedX).toBe(false);
  expect(m.clippedY).toBe(false);
  expect(m.ellipsis).toBe(false);
  expect(m.lines).toBeGreaterThan(1);
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(width);
}

for (const theme of ["light", "dark"] as const) {
  test(`the chapter menu opens with the whole chapter name at its top, wrapped, at 360 px in ${theme}`, async ({
    page,
  }) => {
    await seed(page, theme);
    await page.getByRole("button", { name: `Open ${CHAPTER}` }).click();
    await page
      .getByRole("button", { name: "More actions for this chapter" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Chapter" });
    await expect(dialog).toBeVisible();
    await expectWholeAndWrapped(dialog.locator(".o4-sheet-name"), CHAPTER);
    // The accessible name of the menu is unchanged by the heading.
    await expect(dialog).toHaveAccessibleName("Chapter");
    await shot(page, `chapter-menu-${theme}`);
  });
}

test("the book menu shows the whole book name, wrapped", async ({ page }) => {
  await seed(page, "dark");
  await page.getByRole("button", { name: `More actions for ${BOOK}` }).click();
  const dialog = page.getByRole("dialog", { name: "Book" });
  await expectWholeAndWrapped(dialog.locator(".books-sheet-name"), BOOK);
  await shot(page, "book-menu");
});

test("the segment menu shows the whole segment name, wrapped", async ({
  page,
}) => {
  await seed(page, "dark");
  await page.getByRole("button", { name: `Open ${CHAPTER}` }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  await page.getByRole("button", { name: "Rename segment" }).click();
  await page.getByRole("textbox", { name: "Segment name" }).fill(SEGMENT);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  const dialog = page.getByRole("dialog", { name: "More" });
  await expectWholeAndWrapped(dialog.locator(".o4-menu-title"), SEGMENT);
  await shot(page, "segment-menu");
});

for (const width of [320, 360]) {
  test(`the recorder menu opens with the whole chapter name at its top, wrapped, at ${width} px (#1284)`, async ({
    page,
  }) => {
    await seed(page, "dark", width);
    await page.getByRole("button", { name: `Open ${CHAPTER}` }).click();
    await page.getByRole("button", { name: "Add segment" }).click();
    await page
      .getByRole("button", { name: "Open recorder for segment 1" })
      .click();
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "More" });
    await expect(dialog).toBeVisible();
    await expectWholeAndWrapped(
      dialog.locator(".o4-sheet-name"),
      CHAPTER,
      width
    );
    await shot(page, `recorder-menu-${width}`);
  });
}
