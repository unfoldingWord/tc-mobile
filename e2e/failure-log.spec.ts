import { expect, test } from "@playwright/test";

/**
 * The durable failure log's browser-only half (#205), against the SHIPPED
 * build.
 *
 * The Node suite covers the store's ring, the sink's serialisation, and the
 * text rendering. Four things it structurally cannot cover, because this repo
 * has no renderer in Vitest (`environment: "node"`, no jsdom — a dependency
 * this project has declined before), all of them the point of the feature:
 *
 *   1. A real `unhandledrejection` reaching the real funnel — the Node suite
 *      calls `reportFailure` directly.
 *   2. The marker appearing on the `≡` control, which is the whole
 *      state-in-place signal a non-reader gets.
 *   3. That the log SURVIVES A RELOAD. This is the entire reason the feature
 *      exists (`console.error` does not), and a fake-indexeddb assertion in a
 *      process that never reloads cannot say it.
 *   4. The panel's controls being reachable behind the menu's focus trap.
 *
 * Runs against `dist/`, not the harness build: this drives the real UI and
 * touches no `window.__e2e`, so it should assert the bundle that ships — the
 * same reasoning `service-worker-precache.spec.ts` documents.
 *
 * NOT covered here, and not claimed: the share handoff. `navigator.share` in
 * headless Chromium is either absent or non-interactive, so tapping "Send
 * problem report" cannot be driven to a real OS sheet. Tap 1 (read the log,
 * render the text, arm the File) IS exercised below; the sheet itself is
 * device work, like every other share in this app.
 */

/** The failure the app is made to report. A rejection nothing awaits. */
const FORCED = "e2e forced failure";

/** Make the page raise one real unhandled rejection. */
async function forceFailure(page: import("@playwright/test").Page) {
  await page.evaluate((message) => {
    void Promise.reject(new Error(message));
  }, FORCED);
}

/** The `≡` control, found by role — the only text layer this UI has. */
function menuControl(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /^Open menu/ });
}

/**
 * The alert badge on the `≡` control — the state-in-place signal a person who
 * cannot read actually gets.
 *
 * Located by class, not by role: it is `aria-hidden` on purpose (the count is
 * already in the button's accessible name, and a screen reader should hear it
 * once), so no accessibility query can reach it and the accessible-name
 * assertions elsewhere in this file say nothing about whether the glyph is
 * painted. That gap is real — a marker rendered unconditionally passed every
 * other case in this file.
 */
function marker(page: import("@playwright/test").Page) {
  return page.locator("header .control-hint");
}

test.beforeEach(async ({ page }) => {
  // A fresh origin state per test: the log is durable, which is exactly what
  // would otherwise leak between cases.
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("tc-mobile");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      })
  );
  await page.reload();
  await expect(menuControl(page)).toBeVisible();
});

test("a quiet phone shows no marker and an empty menu", async ({ page }) => {
  // The other state of the gate. Without this, a marker rendered
  // unconditionally would pass every assertion below.
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
  await menuControl(page).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toHaveCount(0);
});

test("a real unhandled rejection marks the ≡ control, live", async ({
  page,
}) => {
  await forceFailure(page);
  // No reload: the marker has to appear while the shelf is open, which is the
  // watcher path in `hooks/failure-log.ts`.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  // And the glyph with it — the half of this a non-reader depends on.
  await expect(marker(page)).toHaveCount(1);
  await expect(marker(page)).toBeVisible();
});

test("the log survives a reload — the reason the feature exists", async ({
  page,
}) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );

  await page.reload();

  // The count is read back from IndexedDB on mount, with nothing in memory
  // carried across. This is the assertion `console.error` could never satisfy.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
});

test("repeated failures count up rather than collapsing", async ({ page }) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  // A DISTINCT object each time, so the funnel's identity dedup does not apply
  // — two genuine failures are two rows.
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 2 problems recorded."
  );
});

test("the panel says so when the browser cannot share at all", async ({
  page,
}) => {
  // Headless desktop Chromium genuinely has no `navigator.share`, so this is
  // the real capability path, not a stub: `useShareFlow` refuses BEFORE doing
  // the work and the panel shows its failure Notice. Worth pinning here because
  // a desktop browser is what a facilitator may well open this on.
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  expect(await page.evaluate(() => typeof navigator.share)).not.toBe(
    "function"
  );

  await menuControl(page).click();
  await page.getByRole("button", { name: "Send problem report" }).click();

  await expect(
    page.getByText("Could not send the problem report. Try again.")
  ).toBeVisible();
  // The menu stays open with the reason in it, and the log is untouched.
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
});

test("tap 1 renders the log to a text File, tap 2 hands it over", async ({
  page,
}) => {
  // The ONE stub in this file, and what it does and does not replace:
  // `navigator.share` is the OS sheet, which no headless browser can present.
  // Everything up to it is the real thing — the IndexedDB read, the text
  // render, the `File` construction, `navigator.canShare`'s absence, the
  // two-gesture activation contract, and the panel's state machine. What the
  // stub cannot tell us is whether a real iOS or Android sheet accepts a
  // `text/plain` File; that is device work, like every other share here.
  await page.addInitScript(() => {
    const shared: { name: string; type: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        for (const file of data.files ?? []) {
          shared.push({
            name: file.name,
            type: file.type,
            text: await file.text(),
          });
        }
      },
    });
  });
  await page.reload();

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByText("1 problem recorded")).toBeVisible();

  // Tap 1 — read, render, arm. The control becomes the primary "Share now".
  await page.getByRole("button", { name: "Send problem report" }).click();
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  // Tap 2 — hand the File over. The flow closes the menu on a resolved share.
  await send.click();
  await expect(menu).toHaveCount(0);

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: unknown[] }).__shared
  );
  expect(shared).toHaveLength(1);
  const file = shared[0] as { name: string; type: string; text: string };
  expect(file.type).toBe("text/plain");
  expect(file.name).toMatch(/^tc-mobile-log-.+\.txt$/);
  // A colon is illegal in a filename on Windows, where these get read.
  expect(file.name).not.toContain(":");
  // The real entry, through the real funnel and the real store.
  expect(file.text).toContain("tc-mobile failure log");
  expect(file.text).toContain("entries: 1");
  expect(file.text).toContain("[unhandled-rejection]");
  expect(file.text).toContain(FORCED);
  // Never the string "undefined" where a field was absent.
  expect(file.text).not.toContain("undefined");
});

test("clear empties the log, and it stays empty across a reload", async ({
  page,
}) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: "Clear problem report" }).click();

  // Clearing closes the menu with it rather than leaving an emptied panel over
  // two controls that now do nothing.
  await expect(menu).toHaveCount(0);
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  // Cleared in the store, not just repainted.
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
});
