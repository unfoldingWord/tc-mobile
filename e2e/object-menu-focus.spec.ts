import { expect, test, type Page } from "@playwright/test";

/**
 * Closing a book, chapter or segment ≡ menu returns focus to the ⋮ that
 * opened it (#679), against the shipped `dist/` build.
 *
 * #73 described this gap for `Menu` and `EraseConfirm`, and #97 closed it
 * with `src/hooks/use-focus-restore.ts` — but that hook was never wired to
 * the Books/Segments row-menu open/close edges themselves (`books-screen.tsx`
 * `onOpenShareMenu`/its own restore effect, `segments-screen.tsx`
 * `openChapterMenu`/its own restore effect, and `segment-row.tsx`'s
 * `onMenuChromeClose`, all added by this change). Before that wiring,
 * `document.activeElement` landed on `<body>` after Close or Escape, on all
 * three menus — the exact defect #679 describes.
 *
 * Read RIGHT AFTER the close action, with `expect.poll` rather than a bare
 * read (the same pattern `segment-rename.spec.ts`'s own focus case already
 * uses for this identical "the ≡ after a close" shape): the fix restores
 * focus in the SAME React commit that lifts `inert` (a `useLayoutEffect`, not
 * a `useEffect` or a timer), so nothing here is polling for a late arrival —
 * `expect.poll`'s job is to absorb ordinary Playwright/React scheduling
 * jitter around the click/keypress itself, not to mask a delayed restore.
 * Before the fix this poll never turns green (`document.activeElement` stays
 * `<body>` for the whole timeout), which is what a delayed-by-a-frame restore
 * would look like too — so a failing run here does not by itself distinguish
 * "never restores" from "restores one frame late". What DOES distinguish them
 * is the code: `focusRestoreTarget` reads `inert` synchronously off the
 * captured element inside the SAME layout effect that the `inert` attribute's
 * own removal committed in, so there is no frame in which the observation
 * could be right one tick and wrong the next.
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
