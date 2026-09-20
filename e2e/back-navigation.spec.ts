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
 * push in a page's life takes a number, including a floor entry armed for a
 * Books overlay (Amendment G, #452 PR3) and then left standing after that
 * overlay closed, so the value at a given screen depends on what the run did
 * to get there. The cases below therefore compare it against what THIS run
 * observed rather than against a literal — which is also what they always
 * meant: `navDirection` reads these relatively, never absolutely.
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
  // #452 PR3) takes a number of its own before `enterScreen` re-stamps it for
  // Segments (case (i)). What this case is about is the RELATIONS below, every
  // one of which is preserved exactly.
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
 * `floorEntryForLayerChange`): once the FLOOR screen's layer stack goes
 * non-empty the adapter holds exactly ONE protective entry, whatever number of
 * overlays are stacked on it. Nothing hands that entry back — there is no
 * release, and `floorEntryForLayerChange`'s docblock has the two review
 * findings that is the answer to. It is CONSUMED instead, by whichever comes
 * first: a Back that `rearmAfterLayerBack` declines to re-arm (case (e)), or a
 * screen transition that re-stamps it (case (i)). Case (g) drives the third
 * path, an overlay closed by its own control, and pins both halves of what
 * that costs: the entry is bounded at one however often the overlay reopens,
 * and the price is one silent Back.
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

test("(e) with the Books hamburger menu open, Back dismisses the menu and stays on the shelf; that Back CONSUMED the floor entry and nothing re-arms it, so the NEXT Back leaves (#374)", async ({
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
  // A witness for `rearmAfterLayerBack`'s floor row (`lib/nav/layer-stack.ts`).
  // It is NOT the only one any more: with the release gone `popLayer` no longer
  // touches history at all, so forcing that row to `true` leaves a spurious entry
  // standing and the index assertion at the end of this case reddens too. Both
  // are kept because they say different things — the index says where the shelf
  // ENDED, the counts say the adapter issued no history call of its own to get
  // there. Same shape as case (d)'s call count, for the same reason.
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

test("(g) an overlay closed by its OWN control leaves the floor entry standing — but never more than one, however many times it is reopened (Amendment G)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(newBookCta(page)).toBeVisible();
  expect(await navIndex(page)).toBe(0);

  // Count the app's own history calls across the WHOLE loop below. There is no
  // release in this design (Frank R1 P2 and R2 P1 were both about a release
  // existing), so what has to be pinned is the bound: three opens, one entry.
  await page.evaluate(() => {
    const w = window as unknown as { __nav: { push: number; back: number } };
    w.__nav = { push: 0, back: 0 };
    const push = window.history.pushState.bind(window.history);
    const back = window.history.back.bind(window.history);
    window.history.pushState = (...args: Parameters<History["pushState"]>) => {
      w.__nav.push += 1;
      push(...args);
    };
    window.history.back = () => {
      w.__nav.back += 1;
      back();
    };
  });

  // Open and close the menu three times through its own Close control.
  let armed: number | undefined;
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(globalMenu(page)).toBeVisible();
    if (i === 0) {
      armed = await navIndex(page);
      expect(armed).toBeGreaterThan(0);
    } else {
      // Re-opening arms NOTHING: `floorEntryForLayerChange`'s `!armed` guard.
      // The stamp is the SAME entry, not a new one at a deeper level.
      expect(await navIndex(page)).toBe(armed);
    }
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(globalMenu(page)).toHaveCount(0);
    // The entry SURVIVES its overlay's own Close — this is the design, not a
    // leak. Nothing hands it back; it is consumed by whichever comes first, a
    // Back (below) or a screen transition (`enterScreen` re-stamps it, case
    // (i)).
    expect(await navIndex(page)).toBe(armed);
  }

  // The bound, and the mutation-unique witness for the `!armed` guard: drop it
  // and this reads 3.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __nav: { push: number; back: number } }).__nav
    )
  ).toEqual({ push: 1, back: 0 });

  // THE DISCLOSED COST. With no overlay open, this Back consumes the standing
  // entry and routes "exit-app", which is a no-op at the app's own root — so
  // the gesture does nothing the translator can see. It is one silent Back,
  // bounded at one, and it cannot be forwarded away (a `history.back()` at the
  // first entry is a spec no-op, so an installed PWA would not leave either).
  // See `floorEntryForLayerChange`'s docblock and the PR body's residual.
  await page.goBack();
  await expect(newBookCta(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await navIndex(page)).toBe(0);

  // And the second one leaves: the cost is exactly one Back, never a trap.
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
  // The create closed its own dialog, which does NOT hand the floor entry back
  // (case (g)) — so the shelf is still holding it here.
  const armed = await navIndex(page);
  expect(armed).toBeGreaterThan(0);

  await page.getByRole("button", { name: /^More actions for/ }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  // A second overlay on the same shelf reuses that entry rather than stacking.
  expect(await navIndex(page)).toBe(armed);

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

test("(i) a screen transition RE-STAMPS a standing floor entry instead of stacking on it — Segments is still one Back from Books, and two from leaving", async ({
  page,
}) => {
  // `seedToSegments` goes through the New Book dialog, so by the time it opens
  // the chapter the shelf IS holding a standing floor entry (case (g)). That
  // makes this the witness for `enterScreen`'s re-stamp branch: the entry
  // already sits at exactly the depth the Segments entry wants, so it is
  // replaced, not pushed past.
  await seedToSegments(page);
  const atSegments = await navIndex(page);
  expect(atSegments).toBeGreaterThan(0);

  // One Back to Books. (This much also passes if `enterScreen` pushed — the
  // landing would route "to-books" off the stale floor entry and LOOK
  // identical. The next assertion is the one that tells them apart.)
  await page.goBack();
  await expect(newBookCta(page)).toBeVisible();
  expect(await navIndex(page)).toBe(0);

  // The discriminator: from Books the very next Back leaves. Force
  // `enterScreen` to always `pushState` and the stale floor entry survives
  // underneath, so this Back is swallowed by it and the app needs a third —
  // the extra dead level the re-stamp exists to prevent.
  await page.goBack();
  await expect(page).toHaveURL("about:blank");
});

test("(j) after the standing entry is consumed, the NEXT overlay arms a fresh one — the shelf does not go unprotected (the `exit-app` flag clear)", async ({
  page,
}) => {
  // Reach the state case (g) ends in: the entry was armed by an overlay, left
  // standing when that overlay closed itself, then consumed by a Back that did
  // nothing visible.
  await page.goto("/");
  await expect(newBookCta(page)).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(globalMenu(page)).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(globalMenu(page)).toHaveCount(0);
  await page.goBack();
  await expect(newBookCta(page)).toBeVisible();
  expect(await navIndex(page)).toBe(0);

  // The entry is GONE, so `floorArmed` must have been cleared with it. This is
  // the witness for that clear (`use-nav-stack.ts`'s `"exit-app"` case): leave
  // the flag set and the open below arms nothing, because
  // `floorEntryForLayerChange` believes an entry is already standing.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(globalMenu(page)).toBeVisible();
  expect(await navIndex(page)).toBeGreaterThan(0);

  // And it is a real entry, not just a stamp: Back spends it on the menu
  // instead of walking out of the app. Under the mutant this Back leaves.
  await page.goBack();
  await expect(globalMenu(page)).toHaveCount(0);
  await expect(newBookCta(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await navIndex(page)).toBe(0);
});
