import { expect, test, type Page } from "@playwright/test";

/**
 * The Books shelf rules the requirements owner decided (#1633, #1634), in
 * headless desktop Chromium against the shipped `dist/` build: a book cannot
 * take a name another book has, whether it is being created or renamed, and
 * a chapter that is moved keeps its own number.
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

test("a moved chapter keeps its own number and the line says where it landed", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page, "Mine");
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: /^Add chapter to/ }).click();
    await page.getByRole("button", { name: "Create chapter" }).click();
  }
  const open = (n: number) =>
    page.getByRole("button", { name: `Open Chapter ${n}` });
  await expect(open(3)).toBeVisible();

  // Hold Chapter 1 for 450 ms, drag it below Chapter 3, release.
  const from = (await open(1).boundingBox())!;
  const to = (await open(3).boundingBox())!;
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

  await expect(page.locator("[data-reorder-status]")).toHaveText(
    "Chapter 1 moved to place 3."
  );
  // The card now reads 2, 3, 1; each row keeps its own number.
  const order = () =>
    page
      .getByRole("button", { name: /^Open Chapter \d$/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  const moved = ["Open Chapter 2", "Open Chapter 3", "Open Chapter 1"];
  await expect.poll(order).toEqual(moved);
  // Stored, not just painted: the order survives a reload.
  await page.reload();
  await page.getByRole("button", { name: /^Mine, / }).click();
  await expect.poll(order).toEqual(moved);
});
