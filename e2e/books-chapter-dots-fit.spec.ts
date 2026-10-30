import { existsSync } from "node:fs";

import { expect, test, type Page } from "./support/test";

import { seedToSegments } from "./support/seed";

/**
 * The new-look (O4) Books chapter row with MANY segments, and with every dot
 * state, against the shipped `dist/` build (#1229, #1233).
 *
 * Every O4 chapter row draws a title line since #1219, so its dots get the
 * room under that line. At the smallest dot step that room holds three rows
 * of dots; a chapter with more segments than that must still show the whole
 * title line and every dot inside the row, so the green share the row shows
 * is the chapter's real share. jsdom computes no boxes, so this is the layout
 * half of `tests/books-o4.test.ts`'s arithmetic and of
 * `tests/books-chapter-dots-room.test.ts`'s declared values.
 *
 * The fake media device is for the dot-state case only: a recorded or
 * finished dot needs a real take, the same pattern `segment-menu-tile-fit`
 * uses. No physical microphone runs in CI or in this container.
 */
test.use({
  permissions: ["microphone"],
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

/** The design's row height, 12 + 44 + 12 (`3-components/books.css`). */
const ROW_HEIGHT = 68;
/**
 * Three rows of 16 dots, what the 320px phone's 110px column holds at the 5/2
 * step since the row's ⋮ shares the end slot with play (#1730).
 */
const THREE_ROWS = 48;

async function addSegments(page: Page, from: number, to: number) {
  for (let i = from; i < to; i++) {
    await page
      .getByRole("button", { name: "Add segment", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: `Open recorder for segment ${i + 1}` })
    ).toBeAttached();
  }
}

/** Back to the shelf, with the one book opened so its chapter row shows. */
async function openShelfRow(page: Page) {
  await page.getByRole("button", { name: "Back to books" }).click();
  await page.getByRole("button", { name: /^Book 001, 1 chapter/ }).click();
  const row = page.getByRole("button", { name: "Open Chapter 1" });
  await expect(row).toBeVisible();
  return row;
}

/** Back from the shelf into the chapter. */
async function reopenChapter(page: Page) {
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
}

async function measureRow(page: Page) {
  return page.getByRole("button", { name: "Open Chapter 1" }).evaluate((el) => {
    const rowBox = el.getBoundingClientRect();
    const title = el.querySelector(".books-chapter-title")!;
    const titleBox = title.getBoundingClientRect();
    const dotsBox = el.querySelector(".books-dots")!.getBoundingClientRect();
    const dotEls = [...el.querySelectorAll(".books-dots > i")];
    const dots = dotEls.map((dot) => dot.getBoundingClientRect());
    const inside = (b: DOMRect, outer: DOMRect) =>
      b.top >= outer.top - 0.5 &&
      b.bottom <= outer.bottom + 0.5 &&
      b.left >= outer.left - 0.5 &&
      b.right <= outer.right + 0.5;
    return {
      rowHeight: rowBox.height,
      titleHeight: titleBox.height,
      titleText: title.textContent,
      titleInRow: inside(titleBox, rowBox),
      dotCount: dots.length,
      dotStates: dotEls.map((dot) => dot.getAttribute("data-state")),
      dotsInColumn: dots.filter((d) => inside(d, dotsBox)).length,
      dotsInRow: dots.filter((d) => inside(d, rowBox)).length,
      dotsBelowTitle: dots.every((d) => d.top >= titleBox.bottom - 0.5),
    };
  });
}

for (const width of [320, 360]) {
  // Past the three rows of 16 dots the 110px column holds at the 5/2 step.
  // At 360px the column is 150 and holds three rows of 21, so 80 is past it.
  const SEGMENTS = 80;
  test(`an O4 chapter row with ${SEGMENTS} segments keeps its title line and every dot inside the row at ${width}px (#1229)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await seedToSegments(page);
    await addSegments(page, 0, SEGMENTS);
    await openShelfRow(page);

    const measured = await measureRow(page);
    expect(measured.titleText).toBe("Chapter 1");
    // The title line's own 20px (`3-components/books.css`), not a squashed share of it.
    // Sub-pixel layout can land a hair off, so the bound is half a pixel.
    expect(Math.abs(measured.titleHeight - 20)).toBeLessThan(0.5);
    expect(measured.titleInRow).toBe(true);
    expect(measured.dotCount).toBe(SEGMENTS);
    // Every dot drawn, and none clipped by the dots' column or the row.
    expect(measured.dotsInColumn).toBe(SEGMENTS);
    expect(measured.dotsInRow).toBe(SEGMENTS);
    expect(measured.dotsBelowTitle).toBe(true);
    // And the row grew to hold them at both widths: a floor, not a cap. The
    // play control took the chevron's 28px and widened the slot to 44
    // (#1469), and the row's ⋮ widened it to 72 (#1730), so even the 360px
    // column no longer holds 80 dots in 68px.
    expect(measured.rowHeight).toBeGreaterThan(ROW_HEIGHT + 0.5);
  });

  const pastTheFloor =
    width === 320
      ? `grows past them at ${width}px`
      : `is still ${ROW_HEIGHT}px with one more at ${width}px`;
  test(`an O4 chapter row stays ${ROW_HEIGHT}px tall up to ${THREE_ROWS} dots and ${pastTheFloor} (#1233)`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 800 });
    await seedToSegments(page);

    await addSegments(page, 0, 3);
    await openShelfRow(page);
    const few = await measureRow(page);
    expect(few.dotCount).toBe(3);
    expect(Math.abs(few.rowHeight - ROW_HEIGHT)).toBeLessThan(0.5);

    await reopenChapter(page);
    await addSegments(page, 3, THREE_ROWS);
    await openShelfRow(page);
    const full = await measureRow(page);
    expect(full.dotCount).toBe(THREE_ROWS);
    expect(Math.abs(full.rowHeight - ROW_HEIGHT)).toBeLessThan(0.5);
    expect(full.dotsInRow).toBe(THREE_ROWS);

    // One dot past the three rows: at 320px it wraps onto a fourth row and
    // the row must grow. At 360px the column is wider (three rows of 21) and
    // still holds it, so the row stays on the 68px floor.
    await reopenChapter(page);
    await addSegments(page, THREE_ROWS, THREE_ROWS + 1);
    await openShelfRow(page);
    const over = await measureRow(page);
    expect(over.dotCount).toBe(THREE_ROWS + 1);
    expect(over.dotsInRow).toBe(THREE_ROWS + 1);
    if (width === 320) {
      expect(over.rowHeight).toBeGreaterThan(ROW_HEIGHT + 0.5);
    } else {
      expect(Math.abs(over.rowHeight - ROW_HEIGHT)).toBeLessThan(0.5);
    }
  });

  test(`an O4 chapter row draws finished, recorded and empty dots inside a ${ROW_HEIGHT}px row at ${width}px (#1233)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 800 });
    await seedToSegments(page);
    await addSegments(page, 0, 3);

    // Segments 1 and 3 get a real take, then segment 3 is marked finished.
    // Segment 2 stays empty, so segment order (recorded, empty, finished)
    // differs from the grouped order the row draws.
    for (const n of [1, 3]) {
      await page
        .getByRole("button", { name: `Open recorder for segment ${n}` })
        .click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      const stop = page.getByRole("button", {
        name: "Stop recording",
        exact: true,
      });
      await expect(stop).toBeVisible();
      // The take exists once the recorder's own clock has passed a second.
      await expect(page.locator(".recorder-status .t-timer")).toHaveText(
        /^00:0[1-9]$/
      );
      await stop.click();
      await expect(
        page.getByRole("button", { name: "Record", exact: true })
      ).toBeVisible();
      await page.getByRole("button", { name: "Close recorder" }).click();
      await expect(
        page.getByRole("button", { name: `More actions for segment ${n}` })
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "More actions for segment 3" })
      .click();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("button", { name: "Mark segment 3 done", exact: true })
      .click();

    await openShelfRow(page);
    const measured = await measureRow(page);
    // Grouped, not in segment order. The segments are recorded (1), empty (2)
    // and finished (3), so segment order would read recorded, empty,
    // finished; the row reads finished, then recorded, then empty.
    expect(measured.dotStates).toEqual(["finished", "recorded", "empty"]);
    expect(measured.dotsInColumn).toBe(3);
    expect(measured.dotsInRow).toBe(3);
    expect(Math.abs(measured.rowHeight - ROW_HEIGHT)).toBeLessThan(0.5);
  });
}
