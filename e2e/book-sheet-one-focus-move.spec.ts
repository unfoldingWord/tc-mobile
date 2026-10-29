import { expect, test, type Page } from "./support/test";

/**
 * #1387 item 1 — closing the book sheet over its delete ask moves focus ONCE.
 *
 * The sheet's focus restore used to land on the row's ⋮ and the delete-confirm
 * hand-off then moved it to the row: two focus changes, which a screen reader
 * can announce as two. This records every `focusin` the page sees across the
 * close and asserts on the sequence, in both states: the delete-ask close
 * (one move, to the row, never the ⋮) and the ordinary close (the ⋮ still
 * gets focus back).
 *
 * What it sees: focus events in a Chromium page against the shipped `dist/`
 * build. What it cannot see: what a screen reader announces, or any engine
 * other than Chromium.
 */

const SHEET_NAME = "Book";

/** Starts recording the accessible name of every element that gains focus. */
async function recordFocusMoves(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __focusMoves: string[] };
    w.__focusMoves = [];
    document.addEventListener(
      "focusin",
      (e) => {
        const el = e.target as HTMLElement;
        w.__focusMoves.push(el.getAttribute("aria-label") ?? el.tagName);
      },
      true
    );
  });
}

function focusMoves(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __focusMoves: string[] }).__focusMoves
  );
}

async function createBook(page: Page) {
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(page.getByRole("button", { name: "Create book" })).toHaveCount(
    0
  );
}

test("closing the book sheet over its delete ask: one focus move, to the row", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page);
  const more = page.getByRole("button", { name: /^More actions for / });
  await more.click();
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toBeVisible();
  await page.getByRole("button", { name: "Delete book" }).click();
  await expect(page.getByRole("group", { name: /^Delete / })).toBeVisible();

  await recordFocusMoves(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toHaveCount(0);
  // A second move could land after the first, so a single read after a fixed
  // sleep proves nothing. Sample twice inside the retry and require the
  // sequence to be one move AND unchanged between the samples.
  await expect(async () => {
    const first = await focusMoves(page);
    await page.waitForTimeout(400);
    const second = await focusMoves(page);
    expect(first).toEqual([expect.stringMatching(/, 0 chapters, expanded$/)]);
    expect(second).toEqual(first);
  }).toPass();

  const label = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? null
  );
  expect(label).toMatch(/, 0 chapters, expanded$/);
});

test("one page, two closes: after closing over the delete ask, a normal close still returns focus to the ⋮", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page);
  const more = page.getByRole("button", { name: /^More actions for / });
  await more.click();
  await page.getByRole("button", { name: "Delete book" }).click();
  await expect(page.getByRole("group", { name: /^Delete / })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toHaveCount(0);

  // A stuck `deleteAskOwnsFocus` flag would suppress this second restore.
  await more.click();
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toBeVisible();
  await recordFocusMoves(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await focusMoves(page)).toEqual([
    expect.stringMatching(/^More actions for /),
  ]);
});

test("closing the book sheet with no delete ask: focus returns to the ⋮", async ({
  page,
}) => {
  await page.goto("/");
  await createBook(page);
  const more = page.getByRole("button", { name: /^More actions for / });
  await more.click();
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toBeVisible();

  await recordFocusMoves(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: SHEET_NAME })).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await focusMoves(page)).toEqual([
    expect.stringMatching(/^More actions for /),
  ]);
});
