import { expect, test, type Page } from "@playwright/test";

/**
 * The system-Back model's browser-only half (#452 PR2, `hooks/use-nav-stack.ts`),
 * against the SHIPPED `dist/` build.
 *
 * The Node suite covers the pure decisions the adapter composes (`popAction`,
 * `navDirection`, `screenFor`, `resumeNavIndex`, `beginBack` /
 * `settleOutstanding`, `routeBackToLayer`) and the ESLint history boundary. What
 * it structurally cannot cover — this repo runs Vitest in the Node environment
 * with no jsdom/renderer (AGENTS.md) — is the adapter's DOM wiring itself: the
 * single `popstate` listener, the mount-adopt effect (Amendment B), the
 * protective `history.pushState`/`history.back()` on each transition, and the
 * commit-close path. Those are what this spec drives, in real Chromium, by
 * walking the real Books → Segments → Recorder tree and pressing the browser's
 * own Back.
 *
 * NOT covered here, and not claimed:
 *   - No device: iOS Safari and Android WebView produce their own `popstate`
 *     timing and their own standalone-PWA "Back exits the app" semantics, which
 *     a headless desktop Chromium tab does not have (a tab has nowhere to exit
 *     TO — the first history entry is the floor). So "does not exit the app" is
 *     asserted here as "stays on the expected in-app screen", the observable a
 *     tab CAN show; the literal app-teardown a phone gesture triggers is a T2
 *     device item.
 *   - No microphone. The recorder sheet is opened and commit-closed with nothing
 *     recorded (its idle-close path), which is all the Back routing needs; the
 *     capture/save path is device work, like every other audio boundary here.
 *   - The ms-window commit-close RACE (a `requestClose` resolving before an
 *     outstanding go-back's `popstate` lands) is not reproducible from Playwright
 *     — its exact end state stays a device item (see `use-nav-stack.ts`).
 */

/** The Books "New book" corner/CTA — the only text layer this UI has. */
function newBookCta(page: Page) {
  return page.getByRole("button", { name: "New book" });
}

/** The monotonic depth index the adapter stamps on the current history entry. */
function navIndex(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () => (window.history.state as { index?: number } | null)?.index
  );
}

/**
 * Seed one book with one chapter and land on that chapter's Segments screen.
 * Driven through the real UI (the shipped build exposes no seeding harness), so
 * it also exercises that Books does NOT push a history entry — only opening a
 * chapter does.
 */
async function seedToSegments(page: Page) {
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
async function seedToRecorder(page: Page) {
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

test("(a) Back from Segments returns to Books and does not leave the app", async ({
  page,
}) => {
  await seedToSegments(page);
  // Opening the chapter pushed one entry; the browser Back consumes it and the
  // adapter routes `to-books` rather than letting the tab walk out of the app.
  await page.goBack();

  // Books is showing again — its "New book" corner is only on the Books screen —
  // and the chapter's Segments header is gone.
  await expect(newBookCta(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );
  // Still the app's own document, not a blank navigation past the shelf.
  await expect(page).toHaveURL(/\/$/);
});

test("(b) Back from the recorder commit-closes it and lands on Segments", async ({
  page,
}) => {
  await seedToRecorder(page);
  await page.goBack();

  // The sheet is gone (commit-close ran its idle path and exited) and the
  // Segments screen underneath it is back — NOT Books.
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
});

test("(c) after a reload at depth, the adapter adopts the resumed index and Back stays in the app (Amendment B)", async ({
  page,
}) => {
  await seedToSegments(page);
  // At Segments the top history entry carries the pushed index 1.
  expect(await navIndex(page)).toBe(1);

  await page.reload();

  // Amendment B: the mount effect ADOPTS the entry already there (index 1) into
  // both refs instead of `replaceState`-ing it back to 0. Without the fix the
  // mount would rewrite this entry's index to 0, so this value is the direct
  // signal that the adopt happened.
  expect(await navIndex(page)).toBe(1);
  // A reload always shows Books (no session restore of the open chapter — a
  // disclosed, pre-existing simplification), so the shelf is what renders.
  await expect(newBookCta(page)).toBeVisible();

  // The first Back after the depth reload is absorbed at the Books root
  // (`exit-app` is a no-op on the shelf, which pushed no entry) — the app stays
  // put and shows Books; it does not misroute as a phantom Forward.
  await page.goBack();
  await expect(newBookCta(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("(d) a rapid double Back from the recorder does not escape the app (#168 guard)", async ({
  page,
}) => {
  await seedToRecorder(page);
  // The recorder's protective entry sits at depth 2.
  expect(await navIndex(page)).toBe(2);

  // Both taps of the recorder's own Back in ONE task, before any `popstate`
  // lands — the double-tap the #168 any-outstanding guard exists for. The
  // recorder's on-screen Back is one `goBack` (`onRequestBack`, the single Back
  // path #168), so the first sets the guard and issues one `history.back()` and
  // the second is REFUSED — only ONE traversal is ever outstanding. Drop the
  // guard and both `goBack`s issue `history.back()` in the same task; Chromium
  // coalesces two synchronous traversals into one multi-entry jump (the #493
  // browser-API coalescing hazard the any-outstanding rule exists to remove),
  // walking the app PAST Segments to the root before any re-arm can intervene.
  await page.evaluate(() => {
    const back = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close recorder"]'
    );
    back?.click();
    back?.click();
  });

  // The sheet closed and the chapter's Segments screen is showing — NOT Books
  // and not a torn-down app.
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
  await expect(newBookCta(page)).toHaveCount(0);
  // The depth signal is what the screen alone cannot show: exactly ONE level was
  // traversed, so the app rests at Segments depth (index 1) with the shelf entry
  // still below it — not walked down to the root (index 0) by a coalesced second
  // Back. This is the assertion that goes red when the any-outstanding guard is
  // dropped.
  expect(await navIndex(page)).toBe(1);
});
