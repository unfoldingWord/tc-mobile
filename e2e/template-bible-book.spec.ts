import { expect, test, type Page } from "./support/test";

/**
 * A Bible book from the Template Library (#1450 R7), against `dist-templates/`:
 * a production-mode build that opts in to the provisional template packages
 * (`npm run build:templates`, which sets TC_BAKE_PROVISIONAL_TEMPLATES=1; see
 * `scripts/bake-template-packages.mjs`). Only that build carries the
 * provisional Titus package, so this spec has a build and a preview of its
 * own, and the default `npm run build` stays as it was. That the default
 * build lists no Titus is asserted against `dist/`, in
 * `template-library.spec.ts`.
 *
 * Menu → Templates → "Titus" → Create with the name the field is filled in
 * with → the shelf shows "Titus" with 3 chapters, and chapters 1, 2 and 3
 * open on 9, 7 and 9 segments: the counts of the vendored package
 * (`templates/bible-passages/TIT.json`). Nothing is seeded, and nothing is
 * recorded. Not covered: titles (the dataset has no title table yet), any
 * phone, the soft keyboard and a screen reader.
 */
test.use({ viewport: { width: 360, height: 740 } });

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Templates", exact: true });

const segmentRows = (page: Page) =>
  page.getByRole("button", { name: /^Open segment \d+( · .*)?$/ });

test("create Titus from the Template Library: 3 chapters of 9, 7 and 9 segments (#1450)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Open menu/ }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await expect(panel(page)).toBeVisible();

  // OBS first, then Titus: the package list's order.
  const rows = panel(page).locator("button.template-row .template-row-title");
  await expect(rows).toHaveText(["Open Bible Stories", "Titus"]);

  await page.getByRole("button", { name: /^Titus\b/ }).click();
  const name = page.getByRole("textbox", { name: "Book name" });
  await expect(name).toHaveValue("Titus");
  await page.getByRole("button", { name: "Create book", exact: true }).click();

  await expect(panel(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: "More actions for Titus" })
  ).toBeVisible();

  // Back to the shelf, the book is drawn collapsed again.
  const book = page.getByRole("button", {
    name: "Titus, 3 chapters, collapsed",
  });

  for (const [chapter, count] of [
    [1, 9],
    [2, 7],
    [3, 9],
  ] as const) {
    await book.click();
    await page
      .getByRole("button", { name: `Open Chapter ${chapter}`, exact: true })
      .click();
    await expect(segmentRows(page)).toHaveCount(count);
    await page.getByRole("button", { name: "Back to books" }).click();
  }
});
