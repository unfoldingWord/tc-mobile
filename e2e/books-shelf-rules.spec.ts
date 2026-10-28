import { expect, test, type Page } from "@playwright/test";

/**
 * The Books shelf rules the requirements owner decided (#1633, #1272), in
 * headless desktop Chromium against the shipped `dist/` build: a book cannot
 * take a name another book has, whether it is being created or renamed, and
 * a chapter's number is its slot, so a moved chapter takes its new slot's
 * number and the badges still read 1, 2, 3 (#1272, answer B, which replaced
 * #1634's "keeps its own number").
 *
 * Reads IndexedDB directly as well as the screen, so "refused" means nothing
 * was written, not only that a line appeared.
 *
 * Not covered: an existing pair of duplicate names being left alone. Only a
 * build from before the rule can make one, and this suite has no way to seed
 * past the rule (the shipped build has no harness), so that arm stays in the
 * Node tests. The chapter move is a mouse drag after a 450 ms hold in
 * Chromium; a finger on a phone, scrolling while lifted, and a screen reader
 * hearing the line are device rows (#1233).
 */

const TAKEN = "Another book has this name. Type a different name.";

/** Every row of one object store, read straight from IndexedDB. */
function storeRows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("tc-mobile");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(name).objectStore(name).getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(all.result as T[]);
          };
        };
      }),
    store
  );
}

const bookNames = async (page: Page) =>
  (await storeRows<{ name: string }>(page, "books")).map((b) => b.name).sort();

async function createBook(page: Page, name: string) {
  await page.getByRole("button", { name: "New book" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await page.getByRole("button", { name: "Create book" }).click();
}

test("a new book cannot take a name another book has", async ({ page }) => {
  await page.goto("/");
  await createBook(page, "Mine");
  await expect(
    page.getByRole("button", { name: "More actions for Mine" })
  ).toBeVisible();

  await createBook(page, "Mine");
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  // Refused in words, the sheet stays open on the same field, nothing made.
  await expect(sheet.getByText(TAKEN)).toBeVisible();
  await expect(sheet).toBeVisible();
  expect(await bookNames(page)).toEqual(["Mine"]);

  // A different name is then accepted from the same sheet.
  await page.getByRole("textbox", { name: "Book name" }).fill("Ours");
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => bookNames(page)).toEqual(["Mine", "Ours"]);
});

test("a rename to a taken name is refused and the old name stays", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page, "Mine");
  await createBook(page, "Ours");
  await expect(
    page.getByRole("button", { name: "More actions for Ours" })
  ).toBeVisible();

  await page.getByRole("button", { name: "More actions for Ours" }).click();
  await page.getByRole("button", { name: "Rename book" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill("Mine");
  await page.getByRole("button", { name: "Save name" }).click();

  await expect(page.getByText(TAKEN).first()).toBeVisible();
  expect(await bookNames(page)).toEqual(["Mine", "Ours"]);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "More actions for Ours" })
  ).toBeVisible();
});

test("a moved chapter takes its new slot's number and the badges still read 1, 2, 3", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page, "Mine");
  // The first chapter is named, so the move can be seen; the other two keep
  // the default, so their titles follow their slots.
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill("Intro");
  await page.getByRole("button", { name: "Create chapter" }).click();
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole("button", { name: /^Add chapter to/ }).click();
    await page.getByRole("button", { name: "Create chapter" }).click();
  }
  const open = (title: string) =>
    page.getByRole("button", { name: `Open ${title}` });
  await expect(open("Chapter 3")).toBeVisible();

  // Hold Intro (slot 1) for 450 ms, drag it below Chapter 3, release.
  const from = (await open("Intro").boundingBox())!;
  const to = (await open("Chapter 3").boundingBox())!;
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const targetY = to.y + to.height + 4;
  for (let i = 1; i <= 12; i += 1) {
    const y = from.y + from.height / 2 + ((targetY - from.y) * i) / 12;
    await page.mouse.move(x, y);
  }
  await page.mouse.up();

  // Slot to slot (Q4 (a)).
  await expect(page.locator("[data-reorder-status]")).toHaveText(
    "Chapter 1 is now chapter 3."
  );
  // Intro now sits in slot 3. The two unnamed chapters moved up and read
  // their new slots, and the badges still read 1, 2, 3 top to bottom.
  const order = () =>
    page
      .locator("button.books-chapter")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const badges = () => page.locator(".books-chapter-num").allTextContents();
  const moved = ["Open Chapter 1", "Open Chapter 2", "Open Intro"];
  await expect.poll(order).toEqual(moved);
  await expect.poll(badges).toEqual(["1", "2", "3"]);
  // Stored, not just painted: the order survives a reload, and the move wrote
  // no chapter row, so every stored number is still the one it was made with
  // (the DRI's S1, no schema change).
  await page.reload();
  await page.getByRole("button", { name: /^Mine, / }).click();
  await expect.poll(order).toEqual(moved);
  await expect.poll(badges).toEqual(["1", "2", "3"]);
  const stored = await storeRows<{ name: string | null; number: number }>(
    page,
    "chapters"
  );
  expect(
    stored
      .map((c) => [c.name, c.number])
      .sort((a, b) => Number(a[1]) - Number(b[1]))
  ).toEqual([
    ["Intro", 1],
    [null, 2],
    [null, 3],
  ]);
});
