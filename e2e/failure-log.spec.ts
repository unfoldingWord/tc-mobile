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

/**
 * Reset the origin's log between cases by CLEARING every object store.
 *
 * Never `deleteDatabase` (George #3, round 1): AGENTS.md bans exactly the shape
 * this used to have — a delete that resolves on `onblocked`. After `goto("/")`
 * the app already holds a connection, so the delete blocks, `onblocked` fires,
 * a handler that resolves there reports success, and the database is still
 * there with the previous case's rows in it. `tests/support.ts` clears stores
 * for this reason and this is the browser-side twin of it.
 *
 * `indexedDB.open` with no version opens at whatever version is on disk, so it
 * runs no upgrade and blocks nobody.
 *
 * **What this does and does not buy, measured rather than assumed.** George's
 * finding had two halves. The mechanism half is confirmed: the old reset did not
 * do what its comment said. The LEAK half does not reproduce under this config —
 * with the reset removed entirely, all cases still pass, and a probe that left a
 * row behind on purpose read `0` rows in the next case, because Playwright gives
 * each test a fresh browser context and that isolates the origin's IndexedDB.
 * So this helper is belt-and-braces today, kept so the invariant survives a
 * config change (a shared context, `reuseExistingServer` with parallel workers)
 * rather than because a case leaks now. The part that actually carries weight
 * against a false pass is the ASSERTION below, which fails loudly if a case ever
 * does start dirty — where the old reset would have passed quietly.
 */
async function clearAllStores(page: import("@playwright/test").Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("tc-mobile");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const stores = Array.from(db.objectStoreNames);
          if (stores.length === 0) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(stores, "readwrite");
          for (const name of stores) tx.objectStore(name).clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      })
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Wait for the app to be up before clearing, so the store list is the real
  // v6 schema and not an empty database this reset just created.
  await expect(menuControl(page)).toBeVisible();
  await clearAllStores(page);
  await page.reload();
  // Assert the RESET took, rather than assuming it. `useFailureCount` starts at
  // 0 and reads IndexedDB in an effect, so a case that merely found "no marker"
  // could be seeing the pre-effect state; waiting for the control to settle on
  // its quiet name is what distinguishes "read the empty log" from "has not
  // read yet". Every case starts from this known state.
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
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

test("falls back to sharing TEXT when the platform refuses a text/plain file", async ({
  page,
}) => {
  // George #5, round 1: the log's one exit used to run on the File-only
  // `useShareFlow`, which sets `error: "failed"` when
  // `canShare({ files })` is false — a standing refusal no retry clears. iOS
  // has historically not accepted every type in a file share, so on the
  // platform this ships to first the log could have had no exit at all. This
  // stubs exactly that platform: files refused, text allowed.
  await page.addInitScript(() => {
    const shared: { kind: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      // Refuse any file share; allow text. The shape an iOS build can present.
      value: (data: { files?: File[]; text?: string }) =>
        data.files === undefined && typeof data.text === "string",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; text?: string }) => {
        if (data.files !== undefined) {
          // What the real platform would do if we ignored its own canShare.
          throw new DOMException("not allowed", "NotAllowedError");
        }
        shared.push({ kind: "text", text: data.text ?? "" });
      },
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  // Tap 1 must ARM, not fail — this is the assertion the old flow could not
  // satisfy.
  await page.getByRole("button", { name: "Send problem report" }).click();
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  await send.click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);

  const shared = await page.evaluate(
    () =>
      (window as unknown as { __shared: { kind: string; text: string }[] })
        .__shared
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]?.kind).toBe("text");
  // The same content the file would have carried — the log genuinely left.
  expect(shared[0]?.text).toContain("tc-mobile failure log");
  expect(shared[0]?.text).toContain(FORCED);
});

test("says so when NEITHER a file nor text can be shared", async ({ page }) => {
  // The other side of the fallback: when the platform offers no shape at all,
  // the panel shows its failure rather than arming a button that cannot work.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();
  await page.getByRole("button", { name: "Send problem report" }).click();

  await expect(
    page.getByText("Could not send the problem report. Try again.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
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
