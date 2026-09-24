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
 * `listBooks` sorts by `updatedAt` descending (`src/lib/storage/books.ts`),
 * so the most recently created (or renamed) book renders at the TOP of the
 * shelf, not the bottom — the helper below names the top row from the create
 * count rather than assuming "Book 001" is first, which it is not once a
 * second book exists.
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

/** `nextBookName`'s own zero-padded scheme (`src/lib/storage/books.ts`). */
function bookName(n: number): string {
  return `Book ${String(n).padStart(3, "0")}`;
}

/** Creates `count` books ("Book 001".."Book 0NN"). The Nth create is the one
 *  that ends up on top, since the shelf sorts newest-first. */
async function createBooks(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await page.getByRole("button", { name: "New book" }).click();
    await page.getByRole("button", { name: "Create book" }).click();
    await expect(page.getByRole("button", { name: "Create book" })).toHaveCount(
      0
    );
  }
}

/** Arms the Books delete confirm for `name`. */
async function armDeleteFor(page: Page, name: string) {
  await page.getByRole("button", { name: `More actions for ${name}` }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.getByRole("button", { name: "Delete book" }).click();
  await expect(
    page.getByRole("dialog", { name: new RegExp(`^Delete ${name}`) })
  ).toBeVisible();
}

test("wheel over the shelf: closed confirm vs. open Books delete confirm", async ({
  page,
}) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);
  const top = bookName(25);

  // The rest of this case means nothing on a shelf that does not actually
  // overflow its container.
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  // A point inside the shelf's own box, not a fixed viewport coordinate.
  const box = await list.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);

  // Unblocked state: the same wheel at the same point moves the shelf.
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);

  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await armDeleteFor(page, top);

  // Blocked state: the same wheel leaves `scrollTop` put for the whole window.
  const beforeAttempt = await list.evaluate((el) => el.scrollTop);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 2000);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(50);
    expect(await list.evaluate((el) => el.scrollTop)).toBe(beforeAttempt);
  }
});

test("cancelling the Books delete confirm for a row away from the top: shelf scroll after the focus hand-off", async ({
  page,
}) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);
  // The OLDEST book renders last, so a container reset to 0 cannot pass.
  const target = bookName(1);

  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  // Arming may auto-scroll the shelf; that happens before the measurement.
  await armDeleteFor(page, target);

  // A real pointer/touch gesture cannot reach the shelf while the confirm's
  // scrim is up (the case above) — so this stands in for "the shelf ended up
  // scrolled away from the armed row by the time Cancel runs" by whatever
  // means got it there. It is not a claim that a translator's own scrolling
  // is what does it.
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });

  // A DOM click: no Playwright actionability scroll ahead of the hand-off.
  await page
    .getByRole("button", { name: "Cancel" })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(
    page.getByRole("dialog", { name: new RegExp(`^Delete ${target}`) })
  ).toHaveCount(0);

  await expect
    .poll(() => focusedName(page))
    .toBe(`${target}, 0 chapters, expanded`);
  await expect
    .poll(() =>
      list.evaluate((el) => {
        const a = el.getBoundingClientRect();
        const b = document.activeElement!.getBoundingClientRect();
        return (
          el.scrollTop > 0 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1
        );
      })
    )
    .toBe(true);
});

test("a fresh book create: end state of the new top row", async ({ page }) => {
  await page.goto("/");
  await createBooks(page, 25);
  const list = shelf(page);

  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  // The new row lands at the TOP (newest-first). Scroll away from the top
  // first, so revealing it is an actual move, not a no-op at an
  // already-correct position.
  const beforeCreate = await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(beforeCreate).toBeGreaterThan(0);

  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();

  // This path plans its OWN scroll first (`pendingScroll`, `scrollIntoView`)
  // before the same bare-`.focus()` hand-off runs — the "split it" option
  // #800 names distinguishes this from the delete-confirm case above, where
  // no scroll is ever planned.
  const created = bookName(26);
  await expect
    .poll(() => focusedName(page))
    .toBe(`${created}, 0 chapters, expanded`);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
});
