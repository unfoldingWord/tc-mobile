import { existsSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { clickEditRecording, editRecordingButton } from "./recorder-fixtures";

// Shipped-build computed styles cover the real cascade, including Tailwind and
// inline overrides. Chromium cannot verify the iOS callout; that is issue #564.
async function expectSelectionSuppressed(root: Locator) {
  await expect(root).toBeVisible();
  await expect
    .poll(() =>
      root.evaluate((element) =>
        [element, ...element.querySelectorAll("*")]
          .filter((node) => getComputedStyle(node).userSelect !== "none")
          .map((node) => `${node.tagName}.${node.getAttribute("class") ?? ""}`)
      )
    )
    .toEqual([]);
}

test("selection stays scoped to recorder and panels, with editable names", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toHaveCSS("user-select", "none");
  await expect(page.locator("#root")).not.toHaveCSS("user-select", "none");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^More actions for/ }).click();
  await expectSelectionSuppressed(page.locator(".menu-panel"));
  await page.getByRole("button", { name: "Rename book" }).click();
  await expect(page.locator(".name-input")).toHaveCSS("user-select", "text");
  await page.locator(".name-input").fill("Selection check");
  await expect(page.locator(".name-input")).toHaveValue("Selection check");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete book", exact: true }).click();
  await expectSelectionSuppressed(page.locator(".confirm-panel"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  // Add chapter opens a naming prompt now (#609); Confirm alone accepts the
  // pre-filled "Chapter N" and is what actually writes the chapter.
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expectSelectionSuppressed(page.locator(".recorder-sheet"));
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await expectSelectionSuppressed(page.locator(".menu-panel"));
});

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

// #707: the first zoom-in from the seed fits the span to the quarter window
// edge to edge, and `.recorder-canvas` clips. Each handle's whole hit box must
// lie inside the canvas, while its stem stays on the stage edge.
test.describe("handle targets after a zoom fit", () => {
  for (const width of [320, 390]) {
    test(`both handle boxes lie inside the canvas after the first zoom (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/");
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Create book" }).click();
      await page.getByRole("button", { name: /^Add chapter to/ }).click();
      await page.getByRole("button", { name: "Create chapter" }).click();
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Record", exact: true })
      ).toBeVisible();
      // #846/#848/#825: wait for the real precondition (the commit, not the
      // Record button's label) before clicking — see recorder-fixtures.ts.
      await clickEditRecording(page);
      const startHandle = page.getByLabel("Selection start", { exact: true });
      const endHandle = page.getByLabel("Selection end", { exact: true });
      await expect(startHandle).toBeVisible();
      await page
        .getByRole("button", {
          name: "Zoomed to the whole segment. Zoom in to a quarter.",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Zoomed to the whole segment. Zoom in to a quarter.",
          exact: true,
        })
      ).toHaveCount(0);
      const stage = await page.locator(".recorder-canvas").boundingBox();
      expect(stage).not.toBeNull();
      for (const [edge, handle, stageX] of [
        ["start", startHandle, stage!.x],
        ["end", endHandle, stage!.x + stage!.width],
      ] as const) {
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(24);
        expect(box!.x).toBeGreaterThanOrEqual(stage!.x - 0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(
          stage!.x + stage!.width + 0.5
        );
        // The fit is what this case is about: the stem sits on the stage edge.
        const stem = await page
          .locator(`.selection-stem[data-edge="${edge}"]`)
          .boundingBox();
        expect(stem).not.toBeNull();
        expect(
          Math.abs(stem!.x + stem!.width / 2 - stageX)
        ).toBeLessThanOrEqual(2);
      }
      // A grab on the inner side of the clamped start box, then a 2px move,
      // moves the edge by about 2px, not to the finger (George R1 #1).
      const valueOf = async (h: typeof startHandle) =>
        Number(await h.getAttribute("aria-valuenow"));
      const s0 = await valueOf(startHandle);
      const perPx = ((await valueOf(endHandle)) - s0) / stage!.width;
      const hb = (await startHandle.boundingBox())!;
      const y = hb.y + hb.height / 2;
      await page.mouse.move(hb.x + hb.width - 2, y);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width, y);
      await page.mouse.up();
      expect(Math.abs((await valueOf(startHandle)) - s0)).toBeLessThanOrEqual(
        4 * perPx
      );
    });
  }
});

test.describe("edit mode toggle", () => {
  for (const width of [320, 390]) {
    test(`one tap commits a take and opens the frame at a stable slot (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/");
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Create book" }).click();
      await page.getByRole("button", { name: /^Add chapter to/ }).click();
      // Add chapter opens a naming prompt now (#609); Confirm alone accepts
      // the pre-filled "Chapter N" and is what actually writes the chapter.
      await page.getByRole("button", { name: "Create chapter" }).click();
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Stop recording", exact: true })
      ).toBeVisible();
      await page.waitForTimeout(1200);
      // #857 (Moto G tester report): the toolbar Edit control stays inert
      // while a take is live — asserted before Stop is tapped, at BOTH
      // widths, since the toolbar's own layout could plausibly diverge on
      // how it renders `aria-disabled` at a narrower breakpoint. While
      // disabled the accessible name carries the block reason
      // (`strings.stopToEdit`, round 1 of #857's review), which is why
      // `editRecordingButton` (`recorder-fixtures.ts`) matches by prefix,
      // not exact name.
      const liveToggle = editRecordingButton(page);
      await expect(liveToggle).toHaveAttribute("aria-disabled", "true");
      await expect(liveToggle).toHaveJSProperty("disabled", false);
      // Stop, then wait for the commit to land — "Record" reappearing pins
      // the post-Stop render (`recorder-fixtures.ts`'s own pattern: a
      // `not.toHaveAttribute("aria-busy", ...)` polled before that pin can
      // pass on the pre-Stop, not-yet-busy frame), and the `aria-busy` wait a
      // few lines down (`editRecordingButton`/`toggle`, reused from
      // `recorder-fixtures.ts` and now matched by PREFIX rather than exact
      // name — see that file's docblock) is what actually waits out
      // `commitTake`'s own async tail. #857 removed the one-tap live-take
      // entry #134 built — `commitTake("edit")` is no longer reachable from
      // either toolbar control (`menu-row-state.ts`'s `editRowReason`) — so
      // Stop-then-Edit is now the only path at EITHER width; the two widths
      // still differ on layout/breakpoint, which the frame-slot assertions
      // below are for.
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Record", exact: true })
      ).toBeVisible();
      const toggle = editRecordingButton(page);
      const before = await toggle.boundingBox();
      expect(before).not.toBeNull();
      // #846/#848/#825: wait for the real precondition before clicking. See
      // recorder-fixtures.ts.
      await expect(toggle).not.toHaveAttribute("aria-busy", "true");
      await toggle.click();
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      const selectedStart = Number(
        await page
          .getByLabel("Selection start", { exact: true })
          .getAttribute("aria-valuenow")
      );
      const selectedEnd = Number(
        await page
          .getByLabel("Selection end", { exact: true })
          .getAttribute("aria-valuenow")
      );
      expect(selectedEnd).toBeGreaterThan(selectedStart);
      // The forward seed (#554, tail rule C). The take just committed leaves
      // the line at the end of the audio, at whole zoom, so the span is the
      // last quarter of the buffer: its right edge at the end, its left edge
      // slid back by the span. A centred seed would open at 85%.
      const selectedMax = Number(
        await page
          .getByLabel("Selection end", { exact: true })
          .getAttribute("aria-valuemax")
      );
      expect(selectedEnd).toBe(selectedMax);
      expect(
        Math.abs(selectedStart - Math.round(selectedMax * 0.75))
      ).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("centerline-overlay")).toHaveCount(0);
      const after = await toggle.boundingBox();
      expect(after).not.toBeNull();
      expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
      expect(after!.width).toBe(before!.width);
      expect(after!.height).toBe(before!.height);
      await expect(toggle).toBeFocused();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toHaveCount(0);
      const returned = await toggle.boundingBox();
      expect(returned).not.toBeNull();
      expect(Math.abs(returned!.x - before!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(returned!.y - before!.y)).toBeLessThanOrEqual(1);
      // Pan the paused-capture case to a nonzero insertion point before entry.
      if (width === 390) {
        const canvas = page.locator(".recorder-canvas");
        const box = await canvas.boundingBox();
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box!.width * 0.25, y: 60 },
          targetPosition: { x: box!.width * 0.5, y: 60 },
        });
      }
      // The committed buffer opens a frame without another capture or second tap.
      await toggle.press("Enter");
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toBeVisible();
      const startHandle = page.getByLabel("Selection start", { exact: true });
      const endHandle = page.getByLabel("Selection end", { exact: true });
      const expectUsableFrame = async () => {
        await expect(startHandle).toBeVisible();
        await expect(endHandle).toBeVisible();
        const start = Number(await startHandle.getAttribute("aria-valuenow"));
        const end = Number(await endHandle.getAttribute("aria-valuenow"));
        expect(end).toBeGreaterThan(start);
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("button", { name: "Cut the selection", exact: true })
        ).toBeEnabled();
        return Number(await endHandle.getAttribute("aria-valuemax"));
      };
      // #613: a cut COLLAPSES the frame onto the centerline, which is then
      // the paste target — it does not reseed a new span the way undo, redo
      // and paste do. Since #835, dragging the waveform does not reseed one
      // either while the clipboard still holds the cut: the requirements
      // owner's decision on #835 (2026-09-24) is that a new selection is
      // available only once the clipboard is empty — today that means a
      // paste (#489 makes it one-shot). An undone cut and a redone paste
      // reopen the frame; an undone paste refills the clipboard and so
      // collapses it again (#925), as a redone cut does (#722).
      // Cutting twice in a row is therefore a paste in between, not a touch
      // on the waveform.
      const canvasBounds = async () =>
        (await page.locator(".recorder-canvas").boundingBox())!;
      const expectCollapsedOntoTheLine = async () => {
        await expect(startHandle).toHaveCount(0);
        await expect(endHandle).toHaveCount(0);
        // The scissors leaves with the frame — mounted only while there is a
        // span to cut — and the red line it was over comes back.
        await expect(
          page.getByRole("button", { name: "Cut the selection", exact: true })
        ).toHaveCount(0);
        await expect(page.getByTestId("centerline-overlay")).toHaveCount(1);
        // Still in edit mode: the collapse is a state inside it, not an exit.
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        // ...and the line is offering the paste the issue says it marks.
        await expect(
          page.getByRole("button", { name: "Paste at the line", exact: true })
        ).toBeVisible();
      };
      // #835: a drag on the waveform while the clipboard holds a cut must
      // leave the collapsed line exactly where it was — this is the reported
      // bug (drag left or right, lift, and the selection window used to come
      // back). `onPointerUp` still runs on the lift; `liftOutcome`'s
      // `reopenFrame` is what now stays false while `canPaste` is true.
      const dragStaysCollapsed = async () => {
        const canvas = page.locator(".recorder-canvas");
        const box = (await canvas.boundingBox())!;
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box.width * 0.7, y: 60 },
          targetPosition: { x: box.width * 0.3, y: 60 },
        });
        await expectCollapsedOntoTheLine();
      };

      // #613 review (jag3773 P3): the Cut row must reserve the WHOLE of what
      // the mounted button occupies — its 40px box AND the row's own 6px
      // padding-top — or the centred stage column recentres when the scissors
      // leaves and the canvas slides by half the deficit. Asserting the
      // reserved `min-height` token is not enough: that assertion passed while
      // the canvas still moved 3px. Compare the geometry itself.
      const canvasBeforeCut = await canvasBounds();

      const originalLength = await expectUsableFrame();
      if (width === 390) {
        await page
          .getByRole("button", {
            name: "Zoomed to the whole segment. Zoom in to a quarter.",
            exact: true,
          })
          .click();
      }
      await page
        .getByRole("button", { name: "Cut the selection", exact: true })
        .click();
      await expectCollapsedOntoTheLine();
      expect(await canvasBounds()).toEqual(canvasBeforeCut);
      // The #835 regression: dragging right after the cut must not restore
      // the selection window while this cut is still on the clipboard.
      await dragStaysCollapsed();
      expect(await canvasBounds()).toEqual(canvasBeforeCut);
      // #925, the requirements owner's report on v0.2.12: leaving edit mode
      // and entering it again with the cut still on the clipboard must open
      // on the red line and the paste button, not on a selection window.
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      await expectCollapsedOntoTheLine();
      // A second cut is reachable by pasting first (Tim's decision on #835)
      // — not, as it was before #835, by a touch on the waveform. The cut
      // and this paste are an exact round trip (paste re-inserts precisely
      // what cut removed), so the reopened frame is back at `originalLength`.
      await page
        .getByRole("button", { name: "Paste at the line", exact: true })
        .click();
      expect(await expectUsableFrame()).toBe(originalLength);
      // #925: undoing the paste puts the phrase back on the clipboard (#489),
      // so the stage collapses to the line again; redoing it empties the
      // clipboard and the frame is back.
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expectCollapsedOntoTheLine();
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      expect(await expectUsableFrame()).toBe(originalLength);
      await page
        .getByRole("button", { name: "Cut the selection", exact: true })
        .click();
      await expectCollapsedOntoTheLine();
      // Same #835 assertion after the second cut.
      await dragStaysCollapsed();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      expect(await expectUsableFrame()).toBe(originalLength);
      // A redone cut collapses onto the line like the live one (#722); undo
      // above still reopens the frame where the audio came back.
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expectCollapsedOntoTheLine();
      // #835: the redo-collapsed frame does not reopen on a drag either.
      await dragStaysCollapsed();
      await page
        .getByRole("button", { name: "Paste at the line", exact: true })
        .click();
      expect(await expectUsableFrame()).toBe(originalLength);
      if (width === 320) {
        // Center the whole buffer, then drag both handles to its boundaries.
        await toggle.click();
        const canvas = page.locator(".recorder-canvas");
        const box = await canvas.boundingBox();
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box!.width * 0.1, y: 60 },
          targetPosition: { x: box!.width * 0.6, y: 60 },
        });
        await toggle.click();
        for (const [handle, x] of [
          [startHandle, box!.x],
          [endHandle, box!.x + box!.width],
        ] as const) {
          const handleBox = await handle.boundingBox();
          await page.mouse.move(
            handleBox!.x + handleBox!.width / 2,
            handleBox!.y + handleBox!.height / 2
          );
          await page.mouse.down();
          await page.mouse.move(x, handleBox!.y + handleBox!.height / 2);
          await page.mouse.up();
        }
        await expect(startHandle).toHaveAttribute("aria-valuenow", "0");
        // The buffer is whole again after the round trip above, so dragging
        // the end handle to the canvas's right edge selects up to whatever
        // that current total (`aria-valuemax`) is — read fresh rather than
        // assumed, since #835 changed how this state was reached.
        const reenterLength = Number(
          await endHandle.getAttribute("aria-valuemax")
        );
        // #897: the buffer is whole again (comment above), so this read
        // should equal the segment's original length. Without this, the
        // handle assertion right below compares `aria-valuenow` to
        // `reenterLength` — a value read from the SAME attribute pair one
        // line earlier — so it would hold for any length the handle drag
        // reached, including a wrong one, and never fail.
        expect(reenterLength).toBe(originalLength);
        await expect(endHandle).toHaveAttribute(
          "aria-valuenow",
          String(reenterLength)
        );
        await page
          .getByRole("button", { name: "Cut the selection", exact: true })
          .click();
        await expect(startHandle).toHaveCount(0);
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect(await expectUsableFrame()).toBe(reenterLength);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        await expect(startHandle).toHaveCount(0);
        await page
          .getByRole("button", { name: "Paste at the line", exact: true })
          .click();
        expect(await expectUsableFrame()).toBe(reenterLength);
      }
      await page
        .getByRole("button", { name: "Done editing", exact: true })
        .click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toHaveCount(0);
    });
  }
});

// #370: at 320px with the frame open, `.recorder-toolbar.edit`'s old
// `justify-content: space-between; flex-wrap: wrap` packed five 40px quiet
// controls plus a 68px `primary`-variant Select onto one line and wrapped the
// sixth (the ≡) alone onto a second line, where `space-between` on a
// single-item line flushes it to main-start — landing the ≡ on the LEFT,
// under Play, instead of the trailing edge it had been reached for.
//
// Premise check against `origin/develop` (2026-09-23): STALE. #579 (merged
// 2026-09-21, "open selection with a stable edit toggle") rewrote this rule
// to `grid-template-columns: repeat(5, minmax(0, 1fr)) var(--c-control-md)`
// as a side effect of keeping the toggle in one stable slot — CSS Grid has
// no wrap analogue to `flex-wrap`, so the five `1fr` tracks shrink instead of
// wrapping, and the toggle keeps its own fixed trailing track regardless of
// viewport width. No CSS change was needed; this pins the now-correct layout
// against a regression.
test.describe("edit toolbar keeps the ≡ off the leading edge (#370)", () => {
  for (const width of [320, 360, 412]) {
    test(`≡ stays on one row, right of the tools, with the frame open and closed (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/");
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Create book" }).click();
      await page.getByRole("button", { name: /^Add chapter to/ }).click();
      await page.getByRole("button", { name: "Create chapter" }).click();
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Record", exact: true })
      ).toBeVisible();
      // #846/#848/#825: wait for the real precondition (the commit, not the
      // Record button's label) before clicking — see recorder-fixtures.ts.
      await clickEditRecording(page);
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toBeVisible();

      const toolbar = page.locator(".recorder-toolbar.edit");
      // `button.control` reaches the real button whether or not a control is
      // wrapped in `.control-hinted` (any control passed a `hint` prop, even
      // `null`, gets a wrapping span — `control.tsx`), so the count and order
      // below are the six controls, not their wrappers.
      const controls = toolbar.locator("button.control");

      const expectOneRowRightOfTheTools = async () => {
        await expect(controls).toHaveCount(6);
        const boxes: { x: number; y: number; right: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const box = await controls.nth(i).boundingBox();
          expect(box).not.toBeNull();
          boxes.push({ x: box!.x, y: box!.y, right: box!.x + box!.width });
        }
        // One row: nothing wrapped to a second line. This is the exact
        // failure #370 named — the ≡ (index 4) landing on a line of its own.
        // Tolerance is 3px, not 1: the trailing Select/Done slot (index 5) is
        // the 44px `--c-control-md` box against the other five 40px `quiet`
        // boxes, and `align-items: center` centres each within the shared
        // row height, so its top sits ~2px higher than theirs even on a
        // single row.
        const firstY = boxes[0]!.y;
        for (const b of boxes) {
          expect(Math.abs(b.y - firstY)).toBeLessThanOrEqual(3);
        }
        // Left-to-right in DOM order: the ≡ never jumps ahead of a tool that
        // comes after it in source order (the "lands on the left" failure).
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x);
        }
        // The ≡ (index 4) sits to the right of every other tool and
        // immediately precedes the trailing Select/Done slot (index 5) — the
        // trailing-edge position the issue says is worth protecting.
        expect(boxes[4]!.x).toBeGreaterThan(boxes[3]!.x);
        expect(boxes[4]!.right).toBeLessThanOrEqual(boxes[5]!.x + 0.5);
        // No horizontal scroll at this width (AGENTS.md: no horizontal page
        // scroll at phone width).
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth
        );
        expect(scrollWidth).toBeLessThanOrEqual(width);
      };

      // Frame open (the issue's named case).
      await expectOneRowRightOfTheTools();

      // Frame closed (the issue's "before closing" checklist: both states).
      // A cut collapses the frame onto the centerline without leaving edit
      // mode; #362's 40-vs-44 question is separate and untouched here.
      await page
        .getByRole("button", { name: "Cut the selection", exact: true })
        .click();
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toHaveCount(0);
      await expectOneRowRightOfTheTools();
    });
  }
});

// #659 (a Claude review of #638): at 0%/100% a handle's hit box sits flush
// against `.recorder-canvas`'s clipped edge (the #707 clamp), so whether its
// keyboard focus ring clips there too is not something a source read of
// `outline-offset: -2px` can answer — CSS resolves the ring's rendered
// bounds from the box's live geometry plus the offset and width, not from
// the declaration's sign alone. This reads all three from the shipped build
// and derives the ring's own edges, rather than trusting that a negative
// offset is automatically safe.
test.describe("selection handle focus ring at 0%/100% (#659)", () => {
  for (const width of [320, 390]) {
    test(`the focus ring never renders past the canvas edge (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/");
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Create book" }).click();
      await page.getByRole("button", { name: /^Add chapter to/ }).click();
      await page.getByRole("button", { name: "Create chapter" }).click();
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await page.waitForTimeout(1200);
      await page
        .getByRole("button", { name: "Stop recording", exact: true })
        .click();
      // #846/#848/#825: this spec never waited for "Record" to reappear
      // either — wait for the real precondition before clicking. See
      // recorder-fixtures.ts.
      await clickEditRecording(page);
      await page
        .getByRole("button", {
          name: "Zoomed to the whole segment. Zoom in to a quarter.",
          exact: true,
        })
        .click();
      const stage = await page.locator(".recorder-canvas").boundingBox();
      expect(stage).not.toBeNull();

      for (const label of ["Selection start", "Selection end"] as const) {
        const handle = page.getByLabel(label, { exact: true });
        await expect(handle).toBeVisible();
        // A real Tab, not `.focus()`: `:focus-visible` is a heuristic over
        // input history, and a script-driven focus does not satisfy it, so a
        // programmatic focus would silently skip the very rule under test.
        await page.evaluate(() => document.body.focus());
        let tabs = 0;
        while (tabs < 30) {
          await page.keyboard.press("Tab");
          if (await handle.evaluate((el) => el === document.activeElement)) {
            break;
          }
          tabs++;
        }
        await expect(handle).toBeFocused();
        expect(
          await handle.evaluate((el) => el.matches(":focus-visible"))
        ).toBe(true);
        const box = await handle.boundingBox();
        expect(box).not.toBeNull();
        const { outlineWidth, outlineOffset } = await handle.evaluate((el) => {
          const cs = getComputedStyle(el);
          return {
            outlineWidth: parseFloat(cs.outlineWidth),
            outlineOffset: parseFloat(cs.outlineOffset),
          };
        });
        // CSS Outline: the ring is drawn `outline-width` further from the
        // border edge than `outline-offset` places it — outward for a
        // positive offset, and inward (toward, then past, the edge) for a
        // negative one. This is the rendered ring's outer bound on each
        // side, derived rather than assumed.
        const ringLeft = box!.x - outlineOffset - outlineWidth;
        const ringRight = box!.x + box!.width + outlineOffset + outlineWidth;
        expect(
          ringLeft,
          `${label} ring's left edge vs the canvas`
        ).toBeGreaterThanOrEqual(stage!.x - 0.5);
        expect(
          ringRight,
          `${label} ring's right edge vs the canvas`
        ).toBeLessThanOrEqual(stage!.x + stage!.width + 0.5);
      }
    });
  }
});
