import { expect, test } from "@playwright/test";

// Shipped-build computed styles cover the real cascade, including Tailwind and
// inline overrides. Chromium cannot verify the iOS callout; that is issue #564.
test("selection stays scoped to recorder and panels, with editable names", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toHaveCSS("user-select", "none");
  await expect(page.locator("#root")).not.toHaveCSS("user-select", "none");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^More actions for/ }).click();
  await expect(page.locator(".menu-panel")).toHaveCSS("user-select", "none");
  await page.getByRole("button", { name: "Rename book" }).click();
  await expect(page.locator(".name-input")).toHaveCSS("user-select", "text");
  await page.locator(".name-input").fill("Selection check");
  await expect(page.locator(".name-input")).toHaveValue("Selection check");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Delete book", exact: true }).click();
  await expect(page.locator(".confirm-panel")).toHaveCSS("user-select", "none");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expect(page.locator(".recorder-sheet")).toHaveCSS(
    "user-select",
    "none"
  );
  await expect(page.locator(".recorder-sheet header span").first()).toHaveCSS(
    "user-select",
    "none"
  );
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.locator(".menu-panel")).toHaveCSS("user-select", "none");
});
