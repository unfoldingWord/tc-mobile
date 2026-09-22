import { expect, test, type Page } from "@playwright/test";

/**
 * Rename a segment (#591), through the real Segments screen and recorder sheet
 * against the shipped `dist/` build: the row menu's Rename, the label beside
 * the ordinal on the row and in the recorder breadcrumb, clearing it back to
 * the ordinal alone, and the label surviving a reload (IndexedDB).
 *
 * The segment is never recorded — this project has no microphone — which is
 * also the case that matters most here: a facilitator labels segments while
 * setting a chapter up, before anything is recorded.
 */

async function seedOneSegment(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  // Confirm alone accepts the pre-filled placeholder name.
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(rowHeading(page)).toHaveText("1");
}

/** The row's left zone: its accessible name is the action, its text the heading. */
function rowHeading(page: Page) {
  return page.getByRole("button", { name: "Open segment 1" });
}

async function renameTo(page: Page, label: string) {
  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  await page.getByRole("button", { name: "Rename segment" }).click();
  await page.getByRole("textbox", { name: "Segment name" }).fill(label);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
}

test("a segment's label shows after its ordinal on the row and in the recorder, clears back to the ordinal, and survives a reload", async ({
  page,
}) => {
  await seedOneSegment(page);

  await renameTo(page, "verses 3–4");
  await expect(rowHeading(page)).toHaveText("1 · verses 3–4");

  await page.getByRole("button", { name: "Record segment 1" }).click();
  const sheet = page.getByRole("dialog", { name: "Recorder" });
  await expect(sheet).toContainText("Book 001 > Chapter 1 > 1 · verses 3–4");
  await page.getByRole("button", { name: "Close recorder" }).click();
  await expect(sheet).toHaveCount(0);

  // Stored, not just painted: a reload rebuilds the row from IndexedDB.
  await page.reload();
  await page
    .getByRole("button", { name: "Book 001, 1 chapter, collapsed" })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(rowHeading(page)).toHaveText("1 · verses 3–4");

  // A blank rename clears the label: the ordinal stands alone again.
  await renameTo(page, "   ");
  await expect(rowHeading(page)).toHaveText("1");
});
