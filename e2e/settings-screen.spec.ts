import { expect, test, type Page } from "@playwright/test";

import { DARK_FLOOR, LIGHT_FLOOR, floorOf, resolved } from "./support/theme";

/**
 * The Settings screen (#1575), against the shipped `dist/` build: the gear in
 * the Books header opens it and Back closes it; the light/dark control moved
 * there from the ≡ menu and still repaints; the S12 switch changes a chapter's
 * label and is remembered across a reload.
 *
 * The cascade-level theme properties (metas, persistence, the failed-write
 * path) stay in `theme-toggle.spec.ts`, which now reaches the toggle through
 * this screen. This file owns the screen itself.
 */

async function createBook(page: Page, name: string) {
  await page.getByRole("button", { name: "New book" }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await page.getByRole("button", { name: "Create book", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function createChapter(page: Page, name: string) {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new chapter" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Chapter name" }).fill(name);
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
}

const gear = (page: Page) =>
  page.getByRole("button", { name: "Settings", exact: true });
const settings = (page: Page) =>
  page.getByRole("dialog", { name: "Settings", exact: true });

test.use({ viewport: { width: 360, height: 740 } });

test("the gear opens Settings, Back to books closes it, and focus returns to the gear", async ({
  page,
}) => {
  await page.goto("/");
  await expect(settings(page)).toHaveCount(0);

  await gear(page).click();
  await expect(settings(page)).toBeVisible();
  await expect(
    settings(page).getByRole("button", { name: /light screen/i })
  ).toBeVisible();
  await expect(
    settings(page).getByRole("button", { name: "Always show chapter numbers" })
  ).toHaveAttribute("aria-pressed", "false");

  await settings(page)
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await expect(settings(page)).toHaveCount(0);
  await expect(gear(page)).toBeFocused();

  // Escape is the other way out, and the browser's Back a third.
  await gear(page).click();
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings(page)).toHaveCount(0);
});

test("the browser's Back closes Settings and stays on Books", async ({
  page,
}) => {
  await page.goto("/");
  await gear(page).click();
  await expect(settings(page)).toBeVisible();
  await page.goBack();
  await expect(settings(page)).toHaveCount(0);
  await expect(gear(page)).toBeVisible();
});

test("the theme moved: the ≡ menu no longer holds it, Settings does, and it repaints", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("button", { name: /(light|dark) screen/i })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await resolved(page, await floorOf(page))).toBe(DARK_FLOOR);
  await gear(page).click();
  await settings(page)
    .getByRole("button", { name: /light screen/i })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);
  // The row stays open and becomes its own undo.
  await expect(settings(page)).toBeVisible();
  await expect(
    settings(page).getByRole("button", { name: /dark screen/i })
  ).toBeVisible();
});

test("always show chapter numbers: off keeps the name, on shows the number, and it survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page, "Mark");
  await createChapter(page, "The sower");
  const title = page.locator(".books-chapter-title");
  await expect(title).toHaveText("The sower");

  await gear(page).click();
  const row = settings(page).getByRole("button", {
    name: "Always show chapter numbers",
  });
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await settings(page)
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await expect(title).toHaveText("Chapter 1");

  await page.reload();
  // A reload collapses the shelf, so open the book again to see its chapters.
  await page.getByRole("button", { name: /^Mark, / }).click();
  await expect(page.locator(".books-chapter-title")).toHaveText("Chapter 1");
  await gear(page).click();
  await expect(
    settings(page).getByRole("button", { name: "Always show chapter numbers" })
  ).toHaveAttribute("aria-pressed", "true");
  await settings(page)
    .getByRole("button", { name: "Always show chapter numbers" })
    .click();
  await settings(page)
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await expect(page.locator(".books-chapter-title")).toHaveText("The sower");
});

test("even out the volume: on by default, off is stored as 0, and it survives a reload", async ({
  page,
}) => {
  const KEY = "tc-mobile.normalize-on-finished";
  const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY);
  const row = () =>
    settings(page).getByRole("button", {
      name: "Even out the volume when done",
    });

  await page.goto("/");
  await gear(page).click();
  await expect(row()).toHaveAttribute("aria-pressed", "true");
  // Never written until the person chooses.
  expect(await stored()).toBeNull();

  await row().click();
  await expect(row()).toHaveAttribute("aria-pressed", "false");
  expect(await stored()).toBe("0");

  await page.reload();
  await gear(page).click();
  await expect(row()).toHaveAttribute("aria-pressed", "false");

  await row().click();
  await expect(row()).toHaveAttribute("aria-pressed", "true");
  expect(await stored()).toBe("1");
});
