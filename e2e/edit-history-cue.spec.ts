import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * The grey Undo/Redo arrows carry their reason, and saying so does not move the
 * toolbar (#91).
 *
 * TWO things are observed here that no Node test can reach, and both were named
 * as unverified by a reviewer on #703:
 *
 *  1. **The cue is true at every stack position.** George round 1 found the
 *     first copy claimed the session's PAST ("No edits to undo yet.") while
 *     `canUndo`/`canRedo` only read the log's cursor, so the sentence went
 *     false after an undo. `tests/edit-control-state.test.ts` bans that tense in
 *     the string table; what it cannot do is drive a real edit stack. This walks
 *     four positions — empty, after a cut, after an undo, back at the tip —
 *     and reads the accessible name the browser actually computes at each.
 *  2. **The hinted wrapper does not disturb the grid.** `Control` wraps a
 *     hint-capable control in `.control-hinted`, which makes the SPAN the grid
 *     item rather than the button. The PR body argued from the stylesheet that
 *     `inline-grid; width: fit-content` keeps the same box in the same column;
 *     an argument is not an observation, and the QA review on #703 asked for
 *     exactly this check at 320px. Here the real cascade answers: each hinted
 *     wrapper is measured against the button inside it, within one render, and
 *     neither its position nor its size may differ.
 *
 * 320px because that is the narrowest width this repo supports and the one
 * where a 2px badge overflow into a 4px gap would show first.
 */

/** Record one take on a fresh segment and open edit mode over it. */
async function openEditMode(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  // Wait on the recorder's OWN elapsed clock, not a blind sleep (George round 4).
  // A fixed `waitForTimeout` is the only thing standing between this spec and an
  // uncuttable take: if the fake device ever yields a shorter buffer the test
  // fails for a reason that looks like the feature, and the obvious repair is to
  // lengthen the sleep. The timer is the signal the sheet already paints.
  await expect
    .poll(
      async () =>
        Number(
          ((await page.locator(".t-timer").textContent()) ?? "0:00").split(
            ":"
          )[1]
        ),
      { timeout: 10_000 }
    )
    .toBeGreaterThanOrEqual(2);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await page
    .locator(".recorder-toolbar")
    .getByRole("button", { name: "Edit recording", exact: true })
    .click();
  await expect(
    page.getByLabel("Selection start", { exact: true })
  ).toBeVisible();
}

/** Every control box in the edit toolbar, in DOM order. */
async function toolbarBoxes(page: Page) {
  return page.locator(".recorder-toolbar.edit button").evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { name: node.getAttribute("aria-label"), x, y, width, height };
    })
  );
}

test.use({
  permissions: ["microphone"],
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test.describe("edit-toolbar history cue (#91)", () => {
  test("the cue is true at every stack position, and never moves the toolbar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await openEditMode(page);

    const toolbar = page.locator(".recorder-toolbar.edit");
    const undoByName = () =>
      toolbar.getByRole("button", { name: /^Undo/, exact: false });
    const redoByName = () =>
      toolbar.getByRole("button", { name: /^Redo/, exact: false });

    // ── Position 1: empty stack. Both arrows grey, both explaining why. ──
    await expect(undoByName()).toHaveAttribute("aria-disabled", "true");
    await expect(redoByName()).toHaveAttribute("aria-disabled", "true");
    await expect(undoByName()).toHaveAccessibleName("Undo. Nothing to undo.");
    await expect(redoByName()).toHaveAccessibleName("Redo. Nothing to redo.");
    // …and NOT natively disabled (George round 4). `aria-disabled` alone does
    // not carry the claim this cue rests on: Playwright computes an accessible
    // name on a natively disabled button too, so asserting the name and the
    // aria attribute would both pass on a control Tab skips entirely — which is
    // the exact failure #135 round 2 found and `Control` exists to avoid.
    for (const arrow of [undoByName(), redoByName()]) {
      expect(await arrow.evaluate((el) => el.hasAttribute("disabled"))).toBe(
        false
      );
    }
    // The sighted half of the cue: #135 round 2 found the words alone were
    // invisible to the very tester who reported the defect.
    expect(await toolbar.locator(".control-hint").count()).toBe(2);

    // ── George round 4: the badge's OWN box, which nothing here measured. ──
    //
    // This file's header claims a 2px overflow into a 4px gap would show at
    // 320px. It would not have: `.control-hint` is `position: absolute` at
    // `right: -2px; bottom: -2px`, so it paints OUTSIDE its wrapper, and
    // `getBoundingClientRect` on the wrapper or the button does not include
    // overflow. Every assertion below this point could pass while the badge
    // painted over the neighbouring control. Measured rather than dropped,
    // because the claim is worth keeping if it is true.
    // The neighbour is found from the OWNING WRAPPER's right edge, never from
    // the badge's own left. Anchoring on the badge is what made the first
    // version of this check unfalsifiable: a badge overflowing far enough moves
    // its own `left` PAST the control it is painting over, so the "next"
    // control resolves to the one after that and the gap comes back positive.
    const badgeGaps = await toolbar.evaluate((tb) => {
      const controls = [...tb.querySelectorAll("button")].map((b) =>
        b.getBoundingClientRect()
      );
      return [...tb.querySelectorAll(".control-hint")].map((hint) => {
        const owner = hint.closest(".control-hinted")!.getBoundingClientRect();
        const next = controls
          .filter((c) => c.left >= owner.right)
          .sort((a, b) => a.left - b.left)[0];
        // `null`, never Infinity: a sentinel that satisfies `> 0` is how this
        // check would go back to passing while measuring nothing (George r6).
        return next ? next.left - hint.getBoundingClientRect().right : null;
      });
    });
    expect(badgeGaps).toHaveLength(2);
    for (const [i, gap] of badgeGaps.entries()) {
      // Finite FIRST. Both badges have a control to their right in this
      // toolbar; if a reorder ever removes it, that must fail here rather than
      // quietly measure nothing.
      expect(
        gap,
        `badge ${i} has no neighbour to measure against`
      ).not.toBeNull();
      expect(gap, `badge ${i} paints into the next control`).toBeGreaterThan(0);
    }

    const badged = await toolbarBoxes(page);
    expect(badged.length).toBeGreaterThanOrEqual(5);

    // ── Position 2: after a cut. Undo lives; Redo still has nothing. ──
    // Cut is not in this toolbar — it sits under the selection frame, in
    // `.recorder-cut` (mockup 4), so it is addressed from the page.
    await page
      .getByRole("button", { name: "Cut the selection", exact: true })
      .click();
    await expect(undoByName()).toHaveAccessibleName("Undo");
    await expect(undoByName()).not.toHaveAttribute("aria-disabled", "true");
    await expect(redoByName()).toHaveAccessibleName("Redo. Nothing to redo.");

    // ── The layout claim, observed rather than argued. ──
    //
    // Asserted WITHIN one render, not by comparing two states of the same
    // build: a wrapper rule that displaces every hinted control moves both
    // snapshots by the same amount, so a before/after comparison cannot see
    // the very breakage it would be written to catch. The evidence for that,
    // and the mutation it was established with, is on the PR:
    // https://github.com/unfoldingWord/tc-mobile/pull/703#issuecomment-5795672669
    //
    // So each hinted wrapper is measured against the button inside it. That is
    // the PR's actual claim — `inline-grid; width: fit-content` leaves the same
    // box in the same column — and it is false the moment the wrapper gains a
    // size or an offset of its own.
    const wrappers = await toolbar
      .locator(".control-hinted")
      .evaluateAll((spans) =>
        spans.map((span) => {
          const s = span.getBoundingClientRect();
          const b = span.querySelector("button")!.getBoundingClientRect();
          return { sx: s.x, sw: s.width, bx: b.x, bw: b.width };
        })
      );
    expect(wrappers.length).toBeGreaterThan(0);
    for (const [i, w] of wrappers.entries()) {
      expect(
        Math.abs(w.bx - w.sx),
        `wrapper ${i} displaces its button`
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(w.bw - w.sw),
        `wrapper ${i} is not its button's size`
      ).toBeLessThanOrEqual(0.5);
    }

    // And the badge appearing or clearing must not reflow the row either —
    // Undo has just lost its badge, so this is where a toggle-driven shift
    // would show. Complementary to the within-render check above, not a
    // substitute for it.
    const afterCut = await toolbarBoxes(page);
    expect(afterCut.length).toBe(badged.length);
    for (const [i, box] of afterCut.entries()) {
      const was = badged[i]!;
      expect(
        Math.abs(box.x - was.x),
        `control ${i} moved in x`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.y - was.y),
        `control ${i} moved in y`
      ).toBeLessThanOrEqual(1);
      expect(box.width, `control ${i} changed width`).toBe(was.width);
      expect(box.height, `control ${i} changed height`).toBe(was.height);
    }

    // ── Position 3: THE ROUND-1 DEFECT. Undo back to the bottom of a stack
    // that is NOT empty — an edit was made and then undone. The first copy
    // said "No edits to undo yet." here, which was false. ──
    await undoByName().click();
    await expect(undoByName()).toHaveAttribute("aria-disabled", "true");
    await expect(undoByName()).toHaveAccessibleName("Undo. Nothing to undo.");
    // Not natively disabled here either (George r6). This is the cell round 1
    // got wrong, so it earns the same lock the fresh stack gets above rather
    // than a name assertion a Tab-skipped control would also satisfy.
    expect(
      await undoByName().evaluate((el) => el.hasAttribute("disabled"))
    ).toBe(false);
    await expect(redoByName()).toHaveAccessibleName("Redo");
    await expect(redoByName()).not.toHaveAttribute("aria-disabled", "true");

    // ── Position 4: redone to the tip. An undo HAS happened, so round 1's
    // "Nothing has been undone." was false here too. ──
    await redoByName().click();
    await expect(redoByName()).toHaveAttribute("aria-disabled", "true");
    await expect(redoByName()).toHaveAccessibleName("Redo. Nothing to redo.");
    // Symmetry with the other two cued cells (George r7). Same `redoReason`
    // path, so this is test coverage rather than a second product hole — but
    // this is the tip position round 1 got wrong, and the fresh stack and
    // undo-to-start both reject the native attribute here.
    expect(
      await redoByName().evaluate((el) => el.hasAttribute("disabled"))
    ).toBe(false);
    await expect(undoByName()).toHaveAccessibleName("Undo");

    // And the columns are still where they started, after four stack moves.
    const settled = await toolbarBoxes(page);
    for (const [i, box] of settled.entries()) {
      const was = badged[i]!;
      expect(
        Math.abs(box.x - was.x),
        `control ${i} drifted in x`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(box.y - was.y),
        `control ${i} drifted in y`
      ).toBeLessThanOrEqual(1);
    }
  });
});
