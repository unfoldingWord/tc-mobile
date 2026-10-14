import { expect, test, type Page } from "@playwright/test";

/**
 * Rename a segment (#591), through the real Segments screen and recorder sheet
 * against the shipped `dist/` build: the row menu's Rename, the label as the
 * row's title line over the wave and in the row's name, the recorder header's
 * crumbs, clearing it back to the ordinal alone, and the label surviving a
 * reload (IndexedDB).
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
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(rowHeading(page)).toHaveText("1");
}

/**
 * The row's left zone. Its accessible name is the action plus the heading
 * ("Open segment 1 · verses 3–4"); its text is the ordinal badge alone.
 */
function rowHeading(page: Page) {
  return page.getByRole("button", { name: /^Open segment 1( · .*)?$/ });
}

/** The row's typed title line (#944), drawn over the wave only when set. */
function rowTitle(page: Page) {
  return page.locator(".row-title");
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

test("a segment's label shows as the row's title and in its name, clears back to the ordinal, and survives a reload", async ({
  page,
}) => {
  await seedOneSegment(page);
  await expect(rowTitle(page)).toHaveCount(0);

  await renameTo(page, "verses 3–4");
  // The badge keeps the ordinal; the label is the title line over the wave.
  await expect(rowHeading(page)).toHaveText("1");
  await expect(rowTitle(page)).toHaveText("verses 3–4");
  await expect(rowHeading(page)).toHaveAccessibleName(
    "Open segment 1 · verses 3–4"
  );

  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Recorder" });
  // The header's crumbs: book, chapter, and this segment's ordinal as the
  // current place. The label is not one of them.
  const crumbs = sheet.locator("header .o4-crumbs .o4-crumb");
  await expect(crumbs).toHaveText(["Book 001", "Chapter 1", "1"]);
  await expect(crumbs.nth(2)).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close recorder" }).click();
  await expect(sheet).toHaveCount(0);

  // Stored, not just painted: a reload rebuilds the row from IndexedDB.
  await page.reload();
  await page
    .getByRole("button", { name: "Book 001, 1 chapter, collapsed" })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(rowTitle(page)).toHaveText("verses 3–4");
  await expect(rowHeading(page)).toHaveAccessibleName(
    "Open segment 1 · verses 3–4"
  );

  // A blank rename clears the label: the ordinal stands alone again.
  await renameTo(page, "   ");
  await expect(rowTitle(page)).toHaveCount(0);
  await expect(rowHeading(page)).toHaveAccessibleName("Open segment 1");
});

/** The accessible name of whatever holds focus, or "BODY" when nothing does. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.tagName;
  });
}

test("focus stays on a control when rename mode ends: Rename after Escape, the row's ≡ after a save", async ({
  page,
}) => {
  await seedOneSegment(page);

  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  await page.getByRole("button", { name: "Rename segment" }).click();
  await expect(
    page.getByRole("textbox", { name: "Segment name" })
  ).toBeFocused();
  // Escape leaves rename mode, not the menu: the field unmounts, so focus must
  // be put somewhere or it falls to <body> behind a modal.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await expect.poll(() => focusedName(page)).toBe("Rename segment");

  // A save closes the menu; focus returns to the control that opened it.
  await page.getByRole("button", { name: "Rename segment" }).click();
  await page.getByRole("textbox", { name: "Segment name" }).fill("verses 3–4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");
});
