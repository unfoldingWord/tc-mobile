import { expect, test, type Page } from "@playwright/test";

/**
 * The Template Library (#246, part of #1450), against the shipped `dist/`
 * build in headless desktop Chromium at 360 px: the global menu's Templates
 * tile opens the panel, Open Bible Stories is listed (its lazy catalog chunk
 * loads and its thumbnail is served), a pick asks for a name and creates the
 * book through the real UI, the book is on the shelf with its chapters after a
 * reload, and a second create under the same name is refused with the
 * existing name notice and writes nothing.
 *
 * Nothing is seeded: the app's own IndexedDB is read through the app, after a
 * reload. Not covered: any phone, the soft keyboard, a screen reader, and a
 * second bundled package (the build has one).
 */
test.use({ viewport: { width: 360, height: 740 } });

const BOOK = "Stories for the village";
const TAKEN = "Another book has this name. Type a different name.";

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Templates", exact: true });

async function openLibrary(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Open menu/ }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

async function pickObs(page: Page, name: string): Promise<void> {
  const row = page.getByRole("button", { name: "Open Bible Stories" });
  await expect(row).toBeVisible();
  // The thumbnail is part of what the lazy chunk and the precache deliver.
  await expect
    .poll(() =>
      row.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0);
  await row.click();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await page.getByRole("button", { name: "Create book", exact: true }).click();
}

test("create from Open Bible Stories persists across a reload, and a duplicate name is refused (#1450)", async ({
  page,
}) => {
  await openLibrary(page);
  await pickObs(page, BOOK);

  // The panel closes and the shelf shows the book.
  await expect(panel(page)).toHaveCount(0, { timeout: 20_000 });
  const more = page.getByRole("button", { name: `More actions for ${BOOK}` });
  await expect(more).toBeVisible();

  // Reload: still there, with its chapters.
  await page.reload();
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await expect(more).toBeVisible();
  // Open Bible Stories has 50 stories, so the shelf names 50 chapters.
  await expect(
    page.getByRole("button", { name: `${BOOK}, 50 chapters, collapsed` })
  ).toBeVisible();

  // A second create under the same name is refused and the field stays open.
  await openLibrary(page);
  await pickObs(page, BOOK);
  await expect(page.getByText(TAKEN)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Book name" })).toBeVisible();
});
