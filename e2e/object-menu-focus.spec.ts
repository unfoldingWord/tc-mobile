import { expect, test, type Page } from "@playwright/test";

/**
 * Closing a book, chapter or segment ≡ menu returns focus to the ⋮ that
 * opened it (#679), against the shipped `dist/` build. The restore lives at
 * each menu's own open/close edge: `books-screen.tsx`, `segments-screen.tsx`
 * and `segment-row.tsx`.
 *
 * Each case reads focus right after the close action with `expect.poll`, the
 * pattern `segment-rename.spec.ts`'s focus case uses for the same shape.
 * `expect.poll` absorbs scheduling jitter around the click or keypress. A red
 * run here does not by itself tell "never restores" from "restores late".
 *
 * No microphone, no recorded audio anywhere in this spec — every menu here
 * is reachable on a never-recorded book/chapter/segment.
 */

/** The accessible name of whatever holds focus, or "BODY" when nothing does. */
function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.tagName;
  });
}

/** One book, one chapter, one segment — landed on the Segments screen. */
async function seedToSegments(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: /^Open segment 1/ })
  ).toBeVisible();
}

test("the book ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  const opener = page.getByRole("button", {
    name: "More actions for Book 001",
  });
  await expect(opener).toBeVisible();

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for Book 001");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for Book 001");
});

test("the chapter ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for this chapter",
  });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect
    .poll(() => focusedName(page))
    .toBe("More actions for this chapter");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect
    .poll(() => focusedName(page))
    .toBe("More actions for this chapter");
});

test("the chapter ≡ menu's rename mode returns focus on Escape and after a save (#676)", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for this chapter",
  });

  // Escape from the rename field leaves rename mode, not the menu: the field
  // unmounts, so focus must be put on the Rename control it returns to, or it
  // falls to <body> behind the still-open modal (#676 item 1).
  await opener.click();
  await page.getByRole("button", { name: "Rename chapter" }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter name" })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Chapter" })).toBeVisible();
  await expect.poll(() => focusedName(page)).toBe("Rename chapter");

  // A save closes the whole menu; focus returns to the ⋮ that opened it.
  await page.getByRole("button", { name: "Rename chapter" }).click();
  await page.getByRole("textbox", { name: "Chapter name" }).fill("verses 3–4");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Chapter" })).toHaveCount(0);
  await expect
    .poll(() => focusedName(page))
    .toBe("More actions for this chapter");
});

test("the segment ≡ menu returns focus to its opener on Close and on Escape", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for segment 1",
  });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");

  await opener.click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");
});

/**
 * #799 item 1. The segment row's `openMenu` used to hand the system-Back
 * layer the BARE `closeMenu` (`segment-row.tsx`), never the `onMenuChromeClose`
 * wrapper Close/scrim/Escape already go through — so a hardware/gesture Back
 * left `document.activeElement` on `<body>` instead of the row's ⋮, the one
 * path #679's own repro (Close and Escape only) never exercised.
 *
 * `page.goBack()` is this repo's own idiom for a system Back against the
 * layer stack — see `e2e/back-navigation.spec.ts` cases (a)/(b): opening the
 * chapter (Segments) pushes one history entry, so this Back is consumed by
 * the row menu's `Layer.dismiss()` and rearmed, never reaching Segments'
 * own "to-books" routing (`use-nav-stack.ts`'s `rearmAfterLayerBack`) —
 * the dialog closing and the app staying on Segments is that rearm, not a
 * navigation this spec drives some other way.
 */
test("the segment ≡ menu returns focus to its opener on a system Back (#799 item 1)", async ({
  page,
}) => {
  await seedToSegments(page);
  const opener = page.getByRole("button", {
    name: "More actions for segment 1",
  });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for segment 1");
});

/**
 * #799 item 2. `books-screen.tsx` (~:850) keeps a SEPARATE `useFocusRestore`
 * slot for the share overlay (`focusRestore`) and for the book ≡ menu's own
 * opener (`menuFocusRestore`) — `segments-screen.tsx` (~:190) keeps the same
 * split for its chapter menu. The comment on `menuFocusRestore` names the
 * exact failure sharing one slot produced (Frank r1 P2 on #754): the share
 * effect would consume the ⋮ capture while the menu stayed open, so a later
 * Close/Escape found nothing left to restore.
 *
 * None of the three cases above ever runs a share, so that split is
 * unexercised by this suite today. This case drives one all the way through:
 * "Share book" on a book with NO chapters resolves to `exportBookZip`
 * returning `null` (`lib/export/book.ts`), which surfaces as the `"nothing"`
 * outcome (`share-progress.ts`) — the cheapest real cycle through the
 * `busy` -> `outcome` -> `hidden` state machine, needing no microphone and no
 * recorded audio.
 *
 * Headless Chromium exposes no `navigator.share` at all, and `share-flow.ts`'s
 * `prepare()` checks `selectShareRoute` BEFORE the busy modal ever opens
 * (`if (selectShareRoute(...) === "unsupported") { setError("failed"); return; }`)
 * — so without a stub the whole overlay is unreachable here (observed: tapping
 * "Share book" unstubbed never shows `.share-scrim` at all and settles straight
 * to a `"failed"` Notice in the menu). This case stubs `navigator.share` with a
 * function that is never called — the export is empty, so `prepare()` settles
 * to `"nothing"` before ever reaching the file/route write path the stub would
 * otherwise need to honour — purely to clear that capability gate so the real
 * reducer and the two restore effects under test actually run. No OS share
 * sheet is exercised anywhere in this case; it never taps "Share now".
 *
 * The two-hop assertion is what actually pins the split: after the outcome
 * is dismissed, focus must land back on the STILL-OPEN menu's own "Share
 * book" control (`focusRestore`'s slot, fallback `shareControlRef`) — NOT
 * on the ⋮ — and only once the whole menu then closes does focus reach the
 * ⋮ (`menuFocusRestore`'s slot). Asserting only the final hop would not
 * catch the two slots being collapsed into one: see the mutation this PR's
 * body records, where the first (premature) restore already lands on the ⋮
 * and the second finds an already-consumed slot, so the LAST focused name
 * still happens to read right.
 */
test("running share progress, then closing the book ≡ menu, restores focus in two hops (#799 item 2)", async ({
  page,
}) => {
  // Clears the `selectShareRoute` "unsupported" gate (see the docblock above)
  // so `prepare()` reaches the busy/outcome cycle instead of bailing before it.
  // Never invoked: the book is empty, so `prepare()` settles to `"nothing"`
  // before any code path would call this.
  await page.addInitScript(() => {
    Object.assign(navigator, {
      share: async () => {
        throw new Error("not reached — this spec never sends");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  const opener = page.getByRole("button", {
    name: "More actions for Book 001",
  });
  await expect(opener).toBeVisible();

  await opener.click();
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();

  const shareButton = page.getByRole("button", { name: "Share book" });
  await shareButton.click();

  // `data-outcome` mirrors the hook's own `progress` union exactly
  // (`share-progress.tsx`): "nothing" is reached only once the busy phase's
  // MIN_BUSY_MS floor has elapsed, so polling it (rather than a fixed wait)
  // is what makes this deterministic regardless of how fast the empty-book
  // export itself resolves.
  await expect(page.locator(".share-scrim")).toHaveAttribute(
    "data-outcome",
    "nothing"
  );
  // Not busy, so `share-progress.tsx`'s own capture-phase Escape calls
  // `onDismiss` — ending the outcome hold at once rather than waiting out
  // OUTCOME_HOLD_MS, and never reaching `<Menu>`'s own Escape handler (the
  // overlay's listener runs in the capture phase with `stopPropagation`).
  await page.keyboard.press("Escape");
  await expect(page.locator(".share-scrim")).toHaveCount(0);

  // First hop: focus returns to the panel's OWN "Share book" control — the
  // menu is still open (`status` stayed `"idle"` on the `"nothing"` branch,
  // so this is the same control, not a remount).
  await expect.poll(() => focusedName(page)).toBe("Share book");
  await expect(page.getByRole("dialog", { name: "Book" })).toBeVisible();

  // Second hop: closing the menu itself (now that no overlay owns the
  // screen, this Escape reaches `<Menu>`'s own handler) returns focus to
  // the ⋮ that opened it.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Book" })).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("More actions for Book 001");
});
