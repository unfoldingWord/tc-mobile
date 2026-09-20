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
 * What case (d) witnesses about the #168 double-Back guard is EXACTLY this: two
 * rapid Close taps in one task issue exactly ONE `window.history.back()` (the
 * second `goBack` is refused by the any-outstanding guard), asserted by wrapping
 * and counting the calls — a deterministic, mutation-unique observable. The
 * end-of-traversal index (rest at Segments depth 1) is a landing check, not that
 * witness: dropping the guard only reddens the index when Chromium coalesces the
 * two same-task traversals, whereas the call count reddens on every run (George
 * R1 P2-1).
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

/**
 * The monotonic index the adapter stamps on the current history entry.
 *
 * MONOTONIC, not a depth: `pushHistoryEntry` stamps from `++nextIndex`, which
 * is only ever reset by the mount adopt (invariant 9 / Amendment B). Every
 * push in a page's life takes a number, including a floor entry armed and
 * released for a Books overlay (Amendment G, #452 PR3), so the value at a
 * given screen depends on what the run did to get there. The cases below
 * therefore compare it against what THIS run observed rather than against a
 * literal — which is also what they always meant: `navDirection` reads these
 * relatively, never absolutely.
 */
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

test("(a) Back from Segments returns to Books (stays on the app's own document — tab floor, see header)", async ({
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
  // Still the app's own document. NB in a headless tab entry 0 is the floor
  // (see header), so this URL half cannot fail whatever the adapter does — the
  // Books-visible assertion above is the load-bearing one; the literal
  // "does not exit the app" a phone gesture triggers is a device item.
  await expect(page).toHaveURL(/\/$/);
});

test("(b) Back from the recorder closes the sheet and lands on Segments (idle path; whether close() ran is not observed — no microphone)", async ({
  page,
}) => {
  await seedToRecorder(page);
  await page.goBack();

  // The sheet is gone and the Segments screen underneath it is back — NOT
  // Books. What the spec observes is the sheet-close and the landing; it does
  // NOT distinguish the commit path (requestClose → re-arm → transitionInFlight
  // → the consuming back()) from a bare sheet-close — both end at index 1 with
  // no available DOM/index observable between them (mutation: bypassing
  // requestClose leaves this case green). That the commit path itself ran is a
  // device item (see header).
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

test("(c) after a reload at depth, the adapter adopts the resumed index into BOTH refs: the next push stamps resumed+1, Back returns to the resumed depth, and the shelf Back stays in the app (Amendment B, George R3 P2)", async ({
  page,
}) => {
  await seedToSegments(page);
  // At Segments the top history entry carries the index its own push stamped.
  // Captured rather than written as a literal — see `navIndex`'s docblock: the
  // seed opens the New Book dialog on the way, whose floor entry (Amendment G,
  // #452 PR3) takes a number of its own before being released. What this case
  // is about is the RELATIONS below, every one of which is preserved exactly.
  const atSegments = await navIndex(page);
  expect(atSegments).toBeGreaterThan(0);

  await page.reload();

  // Amendment B: the mount effect ADOPTS the entry already there into both refs
  // instead of `replaceState`-ing it back to 0. Without the fix the mount would
  // rewrite this entry's index to 0, so this value is the direct signal that the
  // adopt happened.
  expect(await navIndex(page)).toBe(atSegments);
  // A reload always shows Books (no session restore of the open chapter — a
  // disclosed, pre-existing simplification), so the shelf is what renders.
  await expect(newBookCta(page)).toBeVisible();

  // The LOAD-BEARING half of Amendment B (George R3 P2): the mount effect must
  // adopt `resumed` into BOTH `navIndex` and `nextIndex`, because
  // `pushHistoryEntry` stamps the next entry from `++nextIndex.current` ALONE.
  // Open a chapter again — the first protective push AFTER the reload — and its
  // entry must carry resumed + 1. With only `navIndex` adopted (the mis-wire
  // this asserts against), `nextIndex` is still at its `useRef(0)` default, so
  // `++nextIndex` stamps 1 here instead — F3 one push later, and this assertion
  // goes red. A reload collapses the shelf's per-session expand state, so
  // re-expand the book before its chapter is reachable.
  await page
    .getByRole("button", { name: "Book 001, 1 chapter, collapsed" })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
  expect(await navIndex(page)).toBe((atSegments ?? 0) + 1);

  // Back returns to the resumed depth: it lands on the adopted Segments-depth
  // entry, which on this reloaded tree shows Books (React reset). Under the
  // mis-wire the stamp above would have been lower than the adopted baseline,
  // so this same Back would read as "same" and be swallowed — the translator
  // stuck on Segments.
  await page.goBack();
  expect(await navIndex(page)).toBe(atSegments);
  await expect(newBookCta(page)).toBeVisible();

  // One more Back is absorbed at the Books root (`exit-app` is a no-op on the
  // shelf, which pushed no entry) — the app stays put and shows Books; it does
  // not misroute as a phantom Forward.
  await page.goBack();
  await expect(newBookCta(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("(d) a rapid double Back from the recorder issues exactly one history.back() — the second is refused (#168 guard) — and rests at Segments depth", async ({
  page,
}) => {
  await seedToRecorder(page);
  // The recorder's protective entry, one level above Segments'. Captured, not a
  // literal — see `navIndex`'s docblock.
  const atRecorder = await navIndex(page);
  expect(atRecorder).toBeGreaterThan(0);

  // Both taps of the recorder's own Back in ONE task, before any `popstate`
  // lands — the double-tap the #168 any-outstanding guard exists for. The
  // recorder's on-screen Back is one `goBack` (`onRequestBack`, the single Back
  // path #168), which issues `window.history.back()` synchronously (or, when the
  // guard refuses, nothing). So the first tap sets the guard and issues exactly
  // one `history.back()`; the second is REFUSED — only ONE traversal is ever
  // outstanding.
  //
  // The UNIQUE, MUTATION-DETERMINISTIC witness of that guard is the COUNT of
  // `history.back()` calls the two taps issue, wrapped and captured here BEFORE
  // any `popstate` lands and before the commit-close consume-back() fires — not
  // the end index below. Delete `if (!begun.ok) return` in `use-nav-stack.ts`'s
  // `goBack` and both taps issue `history.back()` in the same task, so this count
  // is 2, on EVERY run, independent of whether Chromium coalesces the two
  // traversals. (The end-index assertion further down is a landing check, not
  // the mutation kill: its red state depends on the browser coalescing the two
  // same-task traversals into one 2→0 jump, which reproduces on repeated runs
  // rather than on every single one — George R1 P2-1. The count assertion
  // removes that dependence.)
  const backCalls = await page.evaluate(() => {
    const original = window.history.back.bind(window.history);
    let calls = 0;
    // Transparent wrapper: it still performs the real traversal (so the
    // sheet-close-and-land below is unaffected), it only tallies the calls.
    window.history.back = () => {
      calls += 1;
      original();
    };
    const back = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close recorder"]'
    );
    back?.click();
    back?.click();
    return calls;
  });
  // Two Close taps, exactly ONE traversal issued: the second `goBack` was
  // refused by the any-outstanding guard (`beginBack`). This is the assertion
  // that goes red — deterministically, every run — when the guard is dropped.
  expect(backCalls).toBe(1);

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
  // Landing check (see the note above — this is NOT the mutation-unique kill):
  // exactly one level was traversed, so the app rests at Segments depth with
  // the shelf entry still below it — not walked to the root.
  expect(await navIndex(page)).toBe((atRecorder ?? 0) - 1);
});

/**
 * ── #452 PR3: Books' overlays are Back layers (#374) ──────────────────────
 *
 * Books is the app's FLOOR: it pushes no entry of its own, so before this PR a
 * Back on the shelf had nothing to consume and the document simply left. That
 * was measured, not assumed, on the pre-PR3 build: with the hamburger menu
 * open, `history.length` was 2 (`about:blank` + the app), `history.state` was
 * `{tc:true,index:0}` — the app's own top entry, with no entry of the app's
 * BELOW it — and `page.goBack()` navigated the document to `about:blank` with
 * NO `popstate` fired. So registering a Layer alone could not have helped: the
 * layer stack is consulted from the `popstate` handler, and there was no
 * `popstate`.
 *
 * Hence the floor entry (Amendment G, `lib/nav/layer-stack.ts`'s
 * `floorEntryForLayerChange`): while — and only while — the FLOOR screen's
 * layer stack is non-empty, the adapter holds exactly ONE protective entry,
 * whatever number of overlays are stacked on it. These cases drive that
 * arm → absorb → release cycle through the real UI.
 *
 * In a headless tab "the app is gone" is observable as the document leaving for
 * `about:blank`, which is what cases (e) and (h) assert on the final Back. On a
 * phone the same gesture backgrounds/closes the installed PWA — that half stays
 * a T2 device item, exactly as this file's header already says for (a).
 *
 * NOT covered here, and not claimed: the `busy()` REFUSAL. Every Books
 * `busy()` is a write-in-flight window (a create, a rename, a delete, an
 * encode) with no deterministic way to hold it open from Playwright; driving
 * it would need a fault-injection seam this build does not ship. Those rows
 * are review + device only — see the PR body's "what is not covered".
 */

/** The Books global (hamburger) menu panel. */
function globalMenu(page: Page) {
  return page.getByRole("dialog", { name: "Menu" });
}

test("(e) with the Books hamburger menu open, Back dismisses the menu and stays on the shelf; the floor entry is released, so the NEXT Back leaves (#374)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(newBookCta(page)).toBeVisible();
  // The shelf holds no entry of its own: the floor.
  expect(await navIndex(page)).toBe(0);

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(globalMenu(page)).toBeVisible();
  // Opening the first layer on the floor armed ONE protective entry (Amendment
  // G). Without it the Back below is a document navigation, not a `popstate`.
  // "Above the floor" is the property — the stamp itself is monotonic, see
  // `navIndex`.
  expect(await navIndex(page)).toBeGreaterThan(0);

  // Count the app's OWN history calls across the dismissal. Dismissing the
  // shelf's last overlay must settle on the entry the `popstate` just landed
  // on and touch nothing: no re-arm, and so no `history.back()` to undo one.
  //
  // This is the mutation-unique witness for `rearmAfterLayerBack`'s floor row
  // (`lib/nav/layer-stack.ts`), and it is here because the END STATE is not
  // one: forcing that row to `true` leaves the shelf identical, since the
  // adapter's own `popLayer` releases the spurious entry immediately after.
  // What it does leave behind is a self-caused traversal for a second,
  // genuine Back to race — and `pushState: 0, back: 0` is what says there is
  // none. Same shape as case (d)'s call count, for the same reason.
  await page.evaluate(() => {
    const w = window as unknown as { __nav: { push: number; back: number } };
    w.__nav = { push: 0, back: 0 };
    const push = window.history.pushState.bind(window.history);
    const back = window.history.back.bind(window.history);
    // Transparent wrappers: they still perform the real operation, so the
    // dismissal below behaves exactly as it does unwrapped.
    window.history.pushState = (...args: Parameters<History["pushState"]>) => {
      w.__nav.push += 1;
      push(...args);
    };
    window.history.back = () => {
      w.__nav.back += 1;
      back();
    };
  });

  await page.goBack();

  // The menu is gone and the shelf is still here — the app did not leave.
  await expect(globalMenu(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __nav: { push: number; back: number } }).__nav
    )
  ).toEqual({ push: 0, back: 0 });
  await expect(newBookCta(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  // The dismissal emptied the stack, so the entry the `popstate` consumed is
  // NOT re-armed: the shelf is back at the floor. This is the assertion that
  // guards #494 item 3's trap — a layer left registered (or an entry left
  // armed) after its dismissal would hold Back at this depth forever.
  expect(await navIndex(page)).toBe(0);

  // And with nothing armed, Back at the shelf leaves the app exactly as it did
  // before this PR — the floor entry did not buy the user an extra Back.
  await page.goBack();
  await expect(page).toHaveURL("about:blank");
});

test("(f) with the New Book dialog open, Back dismisses it and creates nothing", async ({
  page,
}) => {
  await page.goto("/");
  // Empty shelf: the only "New book" is the empty-state CTA.
  await newBookCta(page).click();
  await expect(
    page.getByRole("dialog", { name: "Name your new book" })
  ).toBeVisible();
  expect(await navIndex(page)).toBeGreaterThan(0);

  await page.goBack();

  await expect(
    page.getByRole("dialog", { name: "Name your new book" })
  ).toHaveCount(0);
  // Back mirrors Cancel: nothing was created, so the shelf is still empty and
  // its invite is what comes back. (Whether Back should instead KEEP a
  // typed-but-unsubmitted name is #452 open question 6, for the requirements
  // owner — unchanged here.)
  await expect(newBookCta(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^More actions for/ })
  ).toHaveCount(0);
  expect(await navIndex(page)).toBe(0);
});

test("(g) closing an overlay by its own control releases the floor entry too — Back afterwards leaves the app, not an extra level", async ({
  page,
}) => {
  await page.goto("/");
  await expect(newBookCta(page)).toBeVisible();

  // Open and close the menu three times through its own Close control. Each
  // open arms the floor entry and each close releases it, so the shelf must
  // still be at the floor — an arm that is never released would stack up one
  // dead level per open, and leaving the app would cost four Backs.
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(globalMenu(page)).toBeVisible();
    expect(await navIndex(page)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(globalMenu(page)).toHaveCount(0);
    // Back AT the floor: the release landed on the floor entry itself, whose
    // index is 0. A missing release would leave the shelf above it instead.
    expect(await navIndex(page)).toBe(0);
  }

  await page.goBack();
  await expect(page).toHaveURL("about:blank");
});

test("(h) with a book's ≡ menu open, Back dismisses the menu and leaves the shelf and the book standing", async ({
  page,
}) => {
  await page.goto("/");
  await newBookCta(page).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(
    page.getByRole("button", { name: /^More actions for/ })
  ).toBeVisible();
  // The create closed its own dialog, so the shelf is back at the floor.
  expect(await navIndex(page)).toBe(0);

  await page.getByRole("button", { name: /^More actions for/ }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  expect(await navIndex(page)).toBeGreaterThan(0);

  await page.goBack();

  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  // The book is untouched — Back dismissed the menu, it did not delete, rename
  // or leave.
  await expect(
    page.getByRole("button", { name: /^More actions for/ })
  ).toBeVisible();
  expect(await navIndex(page)).toBe(0);
  await expect(page).toHaveURL(/\/$/);
});
