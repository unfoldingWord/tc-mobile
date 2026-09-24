import { expect, test, type Page } from "@playwright/test";

/**
 * #800 step 1 — evidence only, no behaviour change to `src/`.
 *
 * #800 asks whether a focus hand-off's bare `.focus()` (no `preventScroll`)
 * actually moves the viewport on the engines this app ships to, before any
 * decision about passing `preventScroll`. `useScrollToNew` (the hook #800's
 * own text describes) does not exist on this tree yet — #652, which
 * introduces it, is still open — so the bare `.focus()` reveal #800 names
 * lives directly in `books-screen.tsx`'s pending-scroll/pending-focus effect
 * (~:532-585): `nodes.current.get(focusId)?.querySelector<HTMLElement>
 * ("button")?.focus()`, run once the Books delete confirm's `deleteTargetId`
 * goes back to `null`.
 *
 * Every case here PINS what Chromium observably does today against the
 * shipped `dist/` build. None of it is a decision about what SHOULD happen,
 * and none of it was run on a device — iOS Safari and the Android WebView
 * are unverified for all three cases, exactly as #800 itself says Chromium
 * was before this spec.
 */

/** The shelf's own scroll container (`books-screen.tsx`'s
 *  `<div className="flex-1 overflow-y-auto">`) — the only element with that
 *  class while the Books screen, and nothing else, is on screen. */
function shelf(page: Page) {
  return page.locator("div.overflow-y-auto").first();
}

/** The accessible name of whatever holds focus, or "BODY" when nothing does. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.tagName;
  });
}

/** Enough books ("Book 001".."Book 0NN") that the shelf overflows its
 *  container on a Desktop Chrome viewport — asserted, not assumed, by each
 *  test that calls this. */
async function createBooks(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole("button", { name: "New book" }).click();
    await page.getByRole("button", { name: "Create book" }).click();
    await expect(page.getByRole("button", { name: "Create book" })).toHaveCount(
      0
    );
  }
}

/** Arms the Books delete confirm for "Book 001", assuming it is on screen. */
async function armDeleteForBookOne(page: Page) {
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.getByRole("button", { name: "Delete book" }).click();
  await expect(
    page.getByRole("dialog", { name: /^Delete Book 001/ })
  ).toBeVisible();
}

test("a wheel scroll over the shelf while the Books delete confirm is up does not move it", async ({
  page,
}) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);

  // The rest of this case means nothing on a shelf that does not actually
  // overflow its container.
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await armDeleteForBookOne(page);

  const beforeAttempt = await list.evaluate((el) => el.scrollTop);
  // `.confirm-scrim` is `position: fixed; inset: 0` (3-components.css) at
  // z-index 90 — above the shelf everywhere in the viewport, not only over
  // the panel — so a wheel anywhere lands on the scrim, not the shelf,
  // regardless of the shelf's own `inert`.
  await page.mouse.move(20, 20);
  await page.mouse.wheel(0, 2000);
  await page.waitForTimeout(150);
  const afterAttempt = await list.evaluate((el) => el.scrollTop);

  expect(afterAttempt).toBe(beforeAttempt);
});

test("cancelling the Books delete confirm hands focus off with a bare .focus(), which drags the shelf back to the target row", async ({
  page,
}) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await armDeleteForBookOne(page);

  // A real pointer/touch gesture cannot reach the shelf while the confirm's
  // scrim is up (the case above) — so this stands in for "the shelf ended up
  // scrolled away from the armed row by the time Cancel runs" by whatever
  // means got it there. It is not a claim that a translator's own scrolling
  // is what does it.
  const scrolledAway = await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolledAway).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("dialog", { name: /^Delete Book 001/ })
  ).toHaveCount(0);

  await expect
    .poll(() => focusedName(page))
    .toBe("Book 001, 0 chapters, expanded");
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("a fresh book create scrolls the new row into view ahead of the same focus hand-off", async ({
  page,
}) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  const beforeCreate = await list.evaluate((el) => el.scrollTop);

  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();

  // This path plans its OWN scroll first (`pendingScroll`, `scrollIntoView`)
  // before the same bare-`.focus()` hand-off runs — the "split it" option
  // #800 names distinguishes this from the delete-confirm case above, where
  // no scroll is ever planned.
  await expect
    .poll(() => focusedName(page))
    .toBe("Book 026, 0 chapters, expanded");
  const afterCreate = await list.evaluate((el) => el.scrollTop);
  expect(afterCreate).toBeGreaterThan(beforeCreate);
});
