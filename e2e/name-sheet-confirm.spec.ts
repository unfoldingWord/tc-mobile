import { expect, test, type Page } from "@playwright/test";

/**
 * The O4 name sheet's Confirm commits under Apple WebKit's focus rule (#1099).
 *
 * THE RULE. In Safari and in the iOS WebView a `<button>` is not
 * mouse-focusable: a press on one does not move focus to it, it clears focus,
 * unless the page cancels the `mousedown`. Chromium, and the WebKit build
 * Playwright ships for Linux, both focus the button instead, which is why the
 * other specs never saw this. `emulateAppleButtonFocus` below reproduces the
 * Apple half in Chromium: after the page's own listeners have run, an
 * uncancelled `mousedown` on a button blurs whatever held focus and cancels
 * the native focus move. It is a model of the rule, not Safari, so a green run
 * here is not an iPhone run.
 *
 * WHY IT MATTERS HERE. `o4/sheets.css` docks the sheet at the top while
 * `.name-edit:focus-within` holds and at the bottom otherwise. Under the rule
 * above, pressing Confirm emptied `:focus-within`, the sheet dropped to the
 * bottom between `mousedown` and `mouseup`, the `mouseup` landed on the scrim,
 * and the `click` went to the scrim — `Menu`'s scrim-tap close. The sheet
 * closed and nothing was written. `NameEdit` now cancels a `mousedown` inside
 * its form that is not on the field, so focus stays in the form through the
 * press.
 *
 * Each case uses a real mouse press through `locator.click()` (press and
 * release at the control's centre) and reads the result from IndexedDB as well
 * as the screen, so "closed" and "stored" are two separate assertions.
 */

/** Apple WebKit's button-focus rule, applied after the page's own handlers. */
async function emulateAppleButtonFocus(page: Page) {
  await page.addInitScript(() => {
    // Bubble phase on window: every React root and portal listener sits below
    // it, so `defaultPrevented` already reflects what the app did.
    window.addEventListener("mousedown", (event) => {
      const target = event.target as Element | null;
      if (!target?.closest("button")) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
  });
}

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
  (await storeRows<{ name: string }>(page, "books")).map((b) => b.name);
const chapterNames = async (page: Page) =>
  (await storeRows<{ name: string | null }>(page, "chapters")).map(
    (c) => c.name
  );

/**
 * How a sheet is committed. The case under test presses Confirm with the
 * mouse; the setup steps before it press Enter, which submits the form with no
 * `mousedown` at all, so a case fails on its own sheet and not on its setup.
 */
type Commit = "confirm" | "enter";

async function commit(page: Page, how: Commit, confirmName: string) {
  if (how === "enter") await page.keyboard.press("Enter");
  else
    await page.getByRole("button", { name: confirmName, exact: true }).click();
}

async function createBook(page: Page, name: string, how: Commit) {
  await page.getByRole("button", { name: "New book" }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await commit(page, how, "Create book");
  await expect(sheet).toHaveCount(0);
}

async function createChapter(page: Page, name: string, how: Commit) {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new chapter" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Chapter name" }).fill(name);
  await commit(page, how, "Create chapter");
  await expect(sheet).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await emulateAppleButtonFocus(page);
});

test("+ new book: Confirm creates the named book", async ({ page }) => {
  await page.goto("/");
  await createBook(page, "Mine", "confirm");
  await expect.poll(() => bookNames(page)).toEqual(["Mine"]);
  await expect(
    page.getByRole("button", { name: "More actions for Mine" })
  ).toBeVisible();
});

test("+ new chapter: Confirm creates the named chapter", async ({ page }) => {
  await page.goto("/");
  await createBook(page, "Mine", "enter");
  await createChapter(page, "2:1-4", "confirm");
  await expect.poll(() => chapterNames(page)).toEqual(["2:1-4"]);
});

test("rename book: Confirm stores the new name", async ({ page }) => {
  await page.goto("/");
  await createBook(page, "Mine", "enter");
  await page.getByRole("button", { name: "More actions for Mine" }).click();
  await page.getByRole("button", { name: "Rename book" }).click();
  await page.getByRole("textbox", { name: "Book name" }).fill("Ours");
  await commit(page, "confirm", "Save name");
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => bookNames(page)).toEqual(["Ours"]);
  await expect(
    page.getByRole("button", { name: "More actions for Ours" })
  ).toBeVisible();
});

test("rename chapter: Confirm stores the new name", async ({ page }) => {
  await page.goto("/");
  await createBook(page, "Mine", "enter");
  await createChapter(page, "Chapter 1", "enter");
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page
    .getByRole("button", { name: "More actions for this chapter" })
    .click();
  await page.getByRole("button", { name: "Rename chapter" }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill("2:1-4");
  await commit(page, "confirm", "Save name");
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect.poll(() => chapterNames(page)).toEqual(["2:1-4"]);
});
