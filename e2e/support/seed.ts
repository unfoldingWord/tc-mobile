import { expect, type Page } from "@playwright/test";

/**
 * Seeding a book, a chapter and a segment through the real UI, shared by the
 * specs that need somewhere to navigate TO.
 *
 * Not a harness: the shipped `dist/` build exposes no seeding hook (only
 * `dist-e2e/` carries `src/app/e2e-harness.ts`, and the specs that use these
 * helpers run against `dist/` on purpose — see `playwright.config.ts`). So
 * every step here is the gesture a translator makes, which is also what makes
 * these helpers worth sharing rather than copying: a change to the New Book
 * dialog or the empty-state CTA breaks one file, not each spec that walks past
 * it.
 */

/** The Books "New book" corner/CTA — the only text layer this UI has. */
export function newBookCta(page: Page) {
  return page.getByRole("button", { name: "New book" });
}

/**
 * Seed one book with one chapter and land on that chapter's Segments screen.
 *
 * It goes through the New Book dialog, so since Amendment G (#452 PR3) it is
 * NOT a walk over a shelf that pushes nothing: that dialog is a floor layer, so
 * opening it ARMS the shelf's one protective entry, and closing it by creating
 * the book leaves that entry standing (`back-navigation.spec.ts` case (g)).
 * `openChapter`'s `enterScreen` then RE-STAMPS the standing entry rather than
 * stacking a second one on it (case (i)) — so Segments is still exactly one
 * Back from Books.
 */
export async function seedToSegments(page: Page) {
  await page.goto("/");
  // Empty shelf: the only "New book" is the empty-state CTA (the header + is
  // hidden while empty).
  await newBookCta(page).click();
  await expect(
    page.getByRole("dialog", { name: "Name your new book" })
  ).toBeVisible();
  // Confirm alone accepts the pre-filled placeholder name — the one-tap create.
  await page.getByRole("button", { name: "Create book" }).click();

  // The new book opens expanded; add its first chapter.
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  // Open the chapter → Segments. This is the first transition that pushes a
  // protective history entry.
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
}

/** From Segments, add one segment and open its recorder sheet. */
export async function seedToRecorder(page: Page) {
  await seedToSegments(page);
  // Empty chapter: the only "Add segment" is the empty-state CTA.
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
  // Open the recorder sheet (Segments → Recorder) — a second protective push.
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
}
