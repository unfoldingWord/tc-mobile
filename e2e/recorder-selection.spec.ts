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
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      await page.getByRole("button", { name: "Record", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Pause", exact: true })
      ).toBeVisible();
      await page.waitForTimeout(1200);
      if (width === 390) {
        await page.getByRole("button", { name: "Pause", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Resume", exact: true })
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
      // The committed buffer opens a frame without another capture or second tap.
      await toggle.press("Enter");
      await expect(
        page.getByLabel("Selection start", { exact: true })
      ).toBeVisible();
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
