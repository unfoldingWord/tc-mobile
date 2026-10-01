import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Drag down to close, and the one ✕, on a new-look (O4) half-screen sheet at
 * phone width, against the shipped `dist/` build (#1268).
 *
 * The requirements owner's decision on #1268: "1. Yes, it should work as
 * drag down to close. 2. Can we use a standard close button (some form of
 * X)?" The Books screen's ≡ menu is the sheet used here because it needs no
 * seeded book: it is a tile sheet like the book, chapter, segment and
 * recorder menus, and every one of them is the same `<Menu>` with the same
 * grip (`tests/sheet-close-o4.test.ts` pins that per caller).
 *
 * This is the part jsdom cannot show: that the grip is laid out where a
 * finger lands, that the cascade lets the sheet follow the pointer, and
 * that a short drag puts it back. Playwright's mouse drives the pointer
 * events here; a touch screen's own gesture handling (and `touch-action`)
 * is only exercised on a phone.
 */

test.use({ viewport: { width: 360, height: 740 } });

/** Opt into the O4 look before the app boots (`lib/design.ts`'s key). */
async function optIntoO4(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tc-mobile.design", "o4");
  });
}

async function openMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Press on the grip's centre, move down by `dy` in steps, release. */
async function dragGrip(page: Page, menu: Locator, dy: number) {
  const box = await menu.locator(".menu-grip").boundingBox();
  expect(box, "the grip is not laid out").not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 12 });
  return async () => page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await optIntoO4(page);
  await page.goto("/");
});

test("the sheet closes on ✕, top right, inside the screen", async ({
  page,
}) => {
  const menu = await openMenu(page);
  const close = menu.getByRole("button", { name: "Close menu" });
  const panel = await menu.boundingBox();
  const box = await close.boundingBox();
  expect(panel && box).toBeTruthy();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(box!.y).toBeLessThan(panel!.y + 80);
  expect(box!.x).toBeGreaterThan(panel!.x + panel!.width / 2);
  await close.click();
  await expect(menu).toHaveCount(0);
});

test("dragging the grip down closes the sheet", async ({ page }) => {
  const menu = await openMenu(page);
  const release = await dragGrip(page, menu, 200);
  // It follows the finger before the release.
  const moved = await menu.evaluate(
    (el) => new DOMMatrix(getComputedStyle(el).transform).m42
  );
  expect(moved).toBeGreaterThan(150);
  await release();
  await expect(menu).toHaveCount(0);
  // Focus goes back where the ✕ sends it: the ≡ that opened the menu.
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

test("a short drag springs the sheet back and leaves it open", async ({
  page,
}) => {
  const menu = await openMenu(page);
  const before = await menu.boundingBox();
  const release = await dragGrip(page, menu, 20);
  await release();
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => (await menu.boundingBox())?.y)
    .toBeCloseTo(before!.y, 0);
});
