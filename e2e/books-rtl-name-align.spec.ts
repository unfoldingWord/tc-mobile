import { expect, test, type Page } from "@playwright/test";

/**
 * A SHORT book name on the new-look (O4) Books shelf sits at the edge its own
 * direction starts from, against the shipped `dist/` build (#1267, #1278 from
 * PR #1270's review). The fix is two rules that only the cascade and layout
 * can show together: `.books-name` grows to fill the row (`o4/books.css`),
 * and `[dir="auto"] { text-align: start }` (`3-components.css`) puts the text
 * at the row's end when the name is right-to-left. A long name overflows and
 * hides both, so these names are short enough to leave the row mostly empty.
 */

async function createBook(page: Page, name: string) {
  await page.getByRole("button", { name: "New book" }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await page.getByRole("button", { name: "Create book", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Where a book's name text is drawn, against its own box and its row's
 * content box: the text's left and right edges are a `Range` over the text
 * node, which is the glyphs' extent, not the span's.
 */
async function measureName(page: Page, name: string) {
  const span = page.locator(".books-name", { hasText: name });
  await expect(span).toBeVisible();
  return span.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const row = el.parentElement!;
    const rowBox = row.getBoundingClientRect();
    const rowStyle = getComputedStyle(row);
    const rowContentRight =
      rowBox.right -
      parseFloat(rowStyle.paddingRight) -
      parseFloat(rowStyle.borderRightWidth);
    return {
      direction: getComputedStyle(el).direction,
      elided: el.scrollWidth > el.clientWidth,
      textLeft: text.left,
      textRight: text.right,
      textWidth: text.width,
      boxLeft: box.left,
      boxRight: box.right,
      boxWidth: box.width,
      rowContentRight,
    };
  });
}

const RTL_SHORT = "רות.";
const LTR_SHORT = "Ruth.";

for (const width of [320, 412]) {
  test(`O4 Books at ${width}px: a short right-to-left name sits at the row's end, a short left-to-right one at its start (#1267)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await createBook(page, RTL_SHORT);
    await createBook(page, LTR_SHORT);

    const rtl = await measureName(page, RTL_SHORT);
    const ltr = await measureName(page, LTR_SHORT);

    for (const m of [rtl, ltr]) {
      expect(m.elided).toBe(false);
      // The name's box fills the rest of the row, ending at its content edge.
      expect(Math.abs(m.boxRight - m.rowContentRight)).toBeLessThanOrEqual(1);
      // Short: the box has room to spare, so where the text sits in it is
      // the alignment, not the overflow.
      expect(m.boxWidth - m.textWidth).toBeGreaterThan(16);
    }
    expect(rtl.direction).toBe("rtl");
    expect(ltr.direction).toBe("ltr");
    // Right-to-left starts at the right: the text ends flush with the box.
    expect(Math.abs(rtl.textRight - rtl.boxRight)).toBeLessThanOrEqual(1);
    // Left-to-right starts at the left, so the stagger is the name's own.
    expect(Math.abs(ltr.textLeft - ltr.boxLeft)).toBeLessThanOrEqual(1);
  });
}
