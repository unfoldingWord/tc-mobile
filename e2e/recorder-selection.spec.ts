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
