import { expect, test, type Page } from "@playwright/test";

/**
 * Closing a book, chapter or segment ≡ menu returns focus to the ⋮ that
 * opened it (#679), against the shipped `dist/` build. The restore lives at
 * each menu's own open/close edge: `books-screen.tsx`, `segments-screen.tsx`
 * and `segment-row.tsx`.
 *
 * Each case reads focus right after the close action with `expect.poll`, the
 * pattern `segment-rename.spec.ts`'s focus case uses for the same shape.
 * `expect.poll` absorbs scheduling jitter around the click or keypress. A red
 * run here does not by itself tell "never restores" from "restores late".
 *
 * No microphone, no recorded audio anywhere in this spec — every menu here
 * is reachable on a never-recorded book/chapter/segment.
 */

/** The accessible name of whatever holds focus, or "BODY" when nothing does. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.tagName;
  });
}

/** One book, one chapter, one segment — landed on the Segments screen. */
async function seedToSegments(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: /^Open segment 1/ })
  ).toBeVisible();
}

test("the book ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  const opener = page.getByRole("button", {
    name: "More actions for Book 001",
  });
  await expect(opener).toBeVisible();

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for Book 001");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for Book 001");
});

test("the chapter ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for this chapter",
  });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect
    .poll(() => focusedName(page))
    .toBe("More actions for this chapter");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect
    .poll(() => focusedName(page))
    .toBe("More actions for this chapter");
});

test("the segment ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for segment 1",
  });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");
});
