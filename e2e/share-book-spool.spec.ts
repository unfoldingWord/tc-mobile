import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { editRecordingButton } from "./recorder-fixtures";

/**
 * Share Book's zip streams into an OPFS spool and is shared from there
 * (#1003, `hooks/archive-spool.ts`). The Node suite runs the spool against a
 * fake OPFS; this is the one place it meets a real one — headless desktop
 * Chromium, against the shipped `dist/` build.
 *
 * `navigator.share` is stubbed (headless Chromium has none, see
 * `object-menu-focus.spec.ts`). The stub reads the File it is handed and
 * lists the spool directory at that moment, so the case can say the share
 * was fed from a spool file on disk, and that the file is gone afterwards.
 *
 * Not covered: any phone, the Android System WebView or WKWebView inside the
 * Capacitor shell, the native staging route, and a book large enough to
 * matter for memory (#1002 is that device check). Synthetic Chromium media,
 * not a physical microphone.
 */
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

const SPOOL_DIR = "tc-mobile-share-spool";

interface SharedFile {
  readonly name: string;
  readonly size: number;
  readonly head: number[];
  readonly tail: number[];
  readonly spoolFiles: string[];
}

test("Share book hands the sheet a zip read from an OPFS spool, and removes the spool after (#1003)", async ({
  page,
}) => {
  await page.addInitScript((dir) => {
    const w = window as unknown as { __shared?: unknown };
    Object.assign(navigator, {
      canShare: () => true,
      share: async ({ files }: { files: File[] }) => {
        const file = files[0]!;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const root = await navigator.storage.getDirectory();
        const spool = await root.getDirectoryHandle(dir);
        const spoolFiles: string[] = [];
        for await (const name of (
          spool as unknown as { keys(): AsyncIterable<string> }
        ).keys())
          spoolFiles.push(name);
        w.__shared = {
          name: file.name,
          size: bytes.length,
          head: [...bytes.slice(0, 4)],
          tail: [...bytes.slice(-22, -18)],
          spoolFiles,
        };
      },
    });
  }, SPOOL_DIR);

  await page.setViewportSize({ width: 390, height: 740 });
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
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  // The take is committed once the toolbar's Edit control leaves its busy
  // state (`recorder-fixtures.ts` has the reasoning).
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );

  // Back on the shelf (a reload: the book is in IndexedDB).
  await page.goto("/");
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
  await page.getByRole("button", { name: "Share book" }).click();
  await page.getByRole("button", { name: "Share now" }).click();

  await expect
    .poll(() => page.evaluate(() => "__shared" in (window as object)))
    .toBe(true);
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: SharedFile }).__shared
  );

  expect(shared.name).toMatch(/\.zip$/);
  // "PK\x03\x04" opens the first entry; "PK\x05\x06" opens the end of the
  // central directory, 22 bytes from the end of an archive with no comment.
  expect(shared.head).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(shared.tail).toEqual([0x50, 0x4b, 0x05, 0x06]);
  // While the sheet had it, the zip was one spool file on disk.
  expect(shared.spoolFiles).toHaveLength(1);

  // Once the sheet resolved, the spool goes.
  await expect
    .poll(() =>
      page.evaluate(async (dir) => {
        const root = await navigator.storage.getDirectory();
        const spool = await root.getDirectoryHandle(dir);
        const names: string[] = [];
        for await (const name of (
          spool as unknown as { keys(): AsyncIterable<string> }
        ).keys())
          names.push(name);
        return names.length;
      }, SPOOL_DIR)
    )
    .toBe(0);
});
