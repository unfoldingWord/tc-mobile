import { expect, test, type Page } from "@playwright/test";

/**
 * The guided highlight, actually moving — in a real browser, against the real
 * build (#604).
 *
 * WHY THE NODE SUITE IS NOT ENOUGH. `tests/guided-step.test.ts` proves the
 * decision and `tests/guided-ring.test.ts` proves the class and the stylesheet,
 * but both are blind to the two things that make this feature work or not: that
 * the ring is one mark on screen at a time as a person walks the chain, and
 * that the rule reaches the element at all. The cascade is the failure mode
 * #171 was: a complete, correct block that nothing could select. So this drives
 * the shipped `dist/` build and reads computed styles.
 *
 * WHAT IT DOES NOT PROVE. It never records — there is no microphone here — so
 * the ring STAYING on Record through a take (#604's step 8) is not observed;
 * `tests/guided-step.test.ts` pins that from the input the recorder feeds in,
 * and the on-device half is still owed (#245). Nothing here says the ring is
 * legible on a phone in daylight, or that its weight is right: that is a
 * judgement a person makes looking at a screen.
 */

/**
 * Every element the person can actually SEE a ring on, with the shadow that
 * draws it.
 *
 * The class is not the claim — the paint is. A screen that has gone inert
 * behind a scrim keeps rendering the mark it last painted, and the stylesheet
 * is what takes it away; counting `.is-guided` would have called that two
 * marks on screen. (It did: this spec is what found it.)
 */
function rings(page: Page): Promise<{ label: string; shadow: string }[]> {
  return page.locator(".is-guided").evaluateAll((els) =>
    els
      .map((el) => ({
        label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
        shadow: getComputedStyle(el).boxShadow,
      }))
      .filter((r) => r.shadow !== "none")
  );
}

/** The accessible names of everything visibly ringed, in document order. */
const guided = async (page: Page): Promise<string[]> =>
  (await rings(page)).map((r) => r.label);

/** The one visible ring's shadow — fails loudly if there is not exactly one. */
async function ringOf(page: Page): Promise<string> {
  const found = await rings(page);
  expect(found, "expected exactly one visible guide ring").toHaveLength(1);
  return found[0]!.shadow;
}

test("the ring moves through the chain and marks exactly one control at a time", async ({
  page,
}) => {
  await page.goto("/");

  // Step 1 — an empty shelf. The header + is hidden here, so the invite's own
  // CTA is the only create control on the screen.
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  expect(await guided(page)).toEqual(["New book"]);
  // The cascade half: the rule reached the element, in the accent, inside the
  // control's own box.
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).toContain("inset");

  // Step 2 — into the naming dialog, onto its commit control. The field is
  // pre-filled, so Confirm alone is the next required action (#314).
  await page.getByRole("button", { name: "New book" }).click();
  await expect(
    page.getByRole("dialog", { name: "Name your new book" })
  ).toBeVisible();
  expect(await guided(page)).toEqual(["Create book"]);

  // Step 3 — the book exists and is empty: its Add chapter. And the two header
  // controls the issue names must NOT be wearing the accent now.
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(
    page.getByRole("button", { name: /^Add chapter to/ })
  ).toBeVisible();
  expect(await guided(page)).toEqual([
    await page
      .getByRole("button", { name: /^Add chapter to/ })
      .getAttribute("aria-label"),
  ]);
  await expect(page.getByRole("button", { name: "New book" })).not.toHaveClass(
    /is-guided/
  );
  await expect(page.getByRole("button", { name: "Open menu" })).not.toHaveClass(
    /is-guided/
  );

  // Step 4 — a chapter exists: the row that opens it.
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toBeVisible();
  expect(await guided(page)).toEqual(["Open Chapter 1"]);

  // Steps 5 and 6 — an empty chapter: Add segment.
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
  expect(await guided(page)).toEqual(["Add segment"]);

  // The hop the issue's list skips: a segment exists with nothing recorded into
  // it, and the row's own red Record is the only door to the recorder. Drawn
  // OUTSIDE the red, which is the stylesheet's one exception — keyed on the
  // variant, so it covers this control and the recorder's alike.
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
  expect(await guided(page)).toEqual(["Record segment 1"]);
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).not.toContain("inset");

  // Step 7 — the recorder over a segment with no audio: Record.
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  expect(await guided(page)).toEqual(["Record"]);
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).not.toContain("inset");
});

test("the shelf stops once its book has been worked in, and the mark is on the row instead", async ({
  page,
}) => {
  // The half of the terminal rule reachable without a microphone: a chapter
  // that HOLDS segments is past the shelf's step, so the chapter row that was
  // marked two steps ago is plain again and the only mark left is on the
  // Segments screen. The other half — a segment that HAS a take, where the
  // guide ends outright — needs a recording, so it is pinned from the input
  // in `tests/guided-step.test.ts` (`hasClip`, `hasAudio`) and not here.
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();

  // A chapter with a segment and no audio in it marks the row's Record, and
  // nothing else — one mark, not a list of them.
  expect(await guided(page)).toEqual(["Record segment 1"]);

  // Back on the shelf, nothing is marked — including the row that was guided
  // one step ago. The shelf comes back collapsed (its expanded set is screen
  // state and the screen remounted), so the row is expanded again first:
  // "nothing is guided" must be a row that is on screen and plain, not a row
  // that is absent.
  await page.getByRole("button", { name: "Back to books" }).click();
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  expect(await guided(page)).toEqual([]);
  await page
    .getByRole("button", { name: /^Book .*, 1 chapter, collapsed$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toBeVisible();
  expect(await guided(page)).toEqual([]);
});
