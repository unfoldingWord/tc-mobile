import { expect, test } from "@playwright/test";

import { seedToSegments } from "./support/seed";

/**
 * The new-look (O4) Books chapter row with MANY segments, against the shipped
 * `dist/` build (#1229).
 *
 * Every O4 chapter row draws a title line since #1219, so its dots get the
 * room under that line. At the smallest dot step that room holds three rows
 * of dots; a chapter with more segments than that must still show the whole
 * title line and every dot inside the row, so the green share the row shows
 * is the chapter's real share. jsdom computes no boxes, so this is the layout
 * half of `tests/books-o4.test.ts`'s arithmetic.
 */

// Past the three rows of 22 dots the 154px column holds at the 5/2 step.
const SEGMENTS = 80;

test(`an O4 chapter row with ${SEGMENTS} segments keeps its title line and every dot inside the row at 320px (#1229)`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 800 });
  await seedToSegments(page);
  for (let i = 0; i < SEGMENTS; i++) {
    await page
      .getByRole("button", { name: "Add segment", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: `Open recorder for segment ${i + 1}` })
    ).toBeAttached();
  }
  await page.getByRole("button", { name: "Back to books" }).click();
  // The shelf comes back with the book collapsed; open it to see the row.
  await page.getByRole("button", { name: /^Book 001, 1 chapter/ }).click();

  const row = page.getByRole("button", { name: "Open Chapter 1" });
  await expect(row).toBeVisible();
  const measured = await row.evaluate((el) => {
    const rowBox = el.getBoundingClientRect();
    const title = el.querySelector(".books-chapter-title")!;
    const titleBox = title.getBoundingClientRect();
    const dotsBox = el.querySelector(".books-dots")!.getBoundingClientRect();
    const dots = [...el.querySelectorAll(".books-dots > i")].map((dot) =>
      dot.getBoundingClientRect()
    );
    const inside = (b: DOMRect, outer: DOMRect) =>
      b.top >= outer.top - 0.5 &&
      b.bottom <= outer.bottom + 0.5 &&
      b.left >= outer.left - 0.5 &&
      b.right <= outer.right + 0.5;
    return {
      titleHeight: titleBox.height,
      titleText: title.textContent,
      titleInRow: inside(titleBox, rowBox),
      dotCount: dots.length,
      dotsInColumn: dots.filter((d) => inside(d, dotsBox)).length,
      dotsInRow: dots.filter((d) => inside(d, rowBox)).length,
      dotsBelowTitle: dots.every((d) => d.top >= titleBox.bottom - 0.5),
    };
  });

  expect(measured.titleText).toBe("Chapter 1");
  // The title line's own 20px (`o4/books.css`), not a squashed share of it.
  expect(measured.titleHeight).toBe(20);
  expect(measured.titleInRow).toBe(true);
  expect(measured.dotCount).toBe(SEGMENTS);
  // Every dot drawn, and none clipped by the dots' column or the row.
  expect(measured.dotsInColumn).toBe(SEGMENTS);
  expect(measured.dotsInRow).toBe(SEGMENTS);
  expect(measured.dotsBelowTitle).toBe(true);
});
