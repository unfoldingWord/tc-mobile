import { existsSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

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
      if (width === 390) {
        // The two widths reach Edit from the two states a take can be in since
        // #614. 320px enters edit mode from a LIVE take, which `commitTake`
        // commits on the way in (#134). 390px ends the take first: the tap that
        // used to be Pause now commits it in place, so the control comes back
        // as Record and the toolbar Edit below opens over audio that is already
        // on the waveform. Both must land the frame at the same slot, which is
        // what this case is about.
        await page
          .getByRole("button", { name: "Stop recording", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Record", exact: true })
        ).toBeVisible();
      }
      const toggle = page
        .locator(".recorder-toolbar")
        .getByRole("button", { name: "Edit recording", exact: true });
      const before = await toggle.boundingBox();
      expect(before).not.toBeNull();
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
      const firstCutLength = await expectUsableFrame();
      expect(firstCutLength).toBeLessThan(originalLength);
      await page
        .getByRole("button", { name: "Cut the selection", exact: true })
        .click();
      const secondCutLength = await expectUsableFrame();
      expect(secondCutLength).toBeLessThan(firstCutLength);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      expect(await expectUsableFrame()).toBe(firstCutLength);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      expect(await expectUsableFrame()).toBe(secondCutLength);
      await page
        .getByRole("button", { name: "Paste at the line", exact: true })
        .click();
      expect(await expectUsableFrame()).toBe(firstCutLength);
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
        await expect(endHandle).toHaveAttribute(
          "aria-valuenow",
          String(firstCutLength)
        );
        await page
          .getByRole("button", { name: "Cut the selection", exact: true })
          .click();
        await expect(startHandle).toHaveCount(0);
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect(await expectUsableFrame()).toBe(firstCutLength);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        await expect(startHandle).toHaveCount(0);
        await page
          .getByRole("button", { name: "Paste at the line", exact: true })
          .click();
        expect(await expectUsableFrame()).toBe(firstCutLength);
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
