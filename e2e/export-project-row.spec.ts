import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

import { validateBundleMetadata } from "../tests/support/scripture-bundle-schema";
import { editRecordingButton } from "./recorder-fixtures";

/**
 * The "Export project" row in a book's menu (#1457), against the shipped
 * `dist/` build in headless desktop Chromium: it sits directly after Share
 * book in the menu's tiles, hands the sheet a zip named `<book> - project.zip`
 * read from the OPFS spool, and says "nothing to share" for a book with no
 * audio, as Share book does.
 *
 * `navigator.share` is stubbed (headless Chromium has none). Not covered: any
 * phone, the real share sheet, the Capacitor shell, and another app opening
 * the zip; those are device-only. Synthetic Chromium media, not a physical
 * microphone.
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
  readonly head: number[];
  /** The whole shared file, base64. */
  readonly base64: string;
  readonly spoolFiles: string[];
}

interface Ingredient {
  checksum: { md5: string };
  size: number;
}

/** Unzip the shared file and hold it to its own `metadata.json`. */
function expectBundleContent(file: Uint8Array): void {
  const entries = unzipSync(file);
  const names = Object.keys(entries);
  expect(names).toContain("metadata.json");
  const metadata = JSON.parse(
    new TextDecoder().decode(entries["metadata.json"])
  ) as { ingredients: Record<string, Ingredient> };
  expect(validateBundleMetadata(metadata)).toEqual([]);

  const listed = Object.keys(metadata.ingredients);
  // One recorded segment: its MP3 and project.json, no more.
  expect(listed.filter((n) => n.endsWith(".mp3"))).toHaveLength(1);
  expect(listed).toContain("ingredients/tc-mobile/project.json");
  // Every listed file is in the zip with its stated size and MD5, and the zip
  // holds nothing the metadata does not list (metadata.json describes the rest).
  expect([...names].sort()).toEqual([...listed, "metadata.json"].sort());
  for (const name of listed) {
    const bytes = entries[name];
    expect(bytes, name).toBeDefined();
    const entry = metadata.ingredients[name]!;
    expect(bytes!.length, `${name} size`).toBe(entry.size);
    expect(bytes!.length, `${name} is not empty`).toBeGreaterThan(0);
    expect(createHash("md5").update(bytes!).digest("hex"), `${name} md5`).toBe(
      entry.checksum.md5
    );
  }
}

async function newBook(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
}

/** A new book has no language, so its first export asks it (#1492). */
async function pickLanguage(page: Page): Promise<void> {
  await page
    .getByRole("searchbox", { name: "Search languages" })
    .fill("tok pisin");
  await page
    .getByRole("button", { name: "Tok Pisin, tpi", exact: true })
    .click();
}

async function recordOneSegment(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
}

test("Export project sits right after Share book and shares the project zip from the spool (#1457)", async ({
  page,
}, testInfo) => {
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
          head: [...bytes.slice(0, 4)],
          base64: btoa(
            Array.from(bytes, (b) => String.fromCharCode(b)).join("")
          ),
          spoolFiles,
        };
      },
    });
  }, SPOOL_DIR);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await newBook(page);
  await recordOneSegment(page);
  // The row's place: Share book, then Export project, in the one tile row,
  // inside a 360 px sheet, in light and in dark (the screenshots are for the
  // review record).
  const tiles = page
    .getByRole("dialog", { name: "Book", exact: true })
    .locator(".o4-tiles .o4-tile");
  for (const scheme of ["dark", "light"] as const) {
    await page.goto("/");
    await expect(page.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    if (scheme === "dark") {
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    } else {
      // The theme is a stored choice, not the OS setting; it lasts across
      // the reloads below.
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: /light screen/i })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: "More actions for Book 001" })
      .click();
    await expect(tiles.nth(0)).toHaveAccessibleName("Share book");
    await expect(tiles.nth(1)).toHaveAccessibleName("Export project");
    const widest = await tiles.evaluateAll((els) =>
      Math.max(...els.map((el) => el.getBoundingClientRect().right))
    );
    expect(widest).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: testInfo.outputPath(`book-menu-${scheme}-360.png`),
    });
  }

  // The bundle's audio is the stored MP3 once a segment is Finished, so mark
  // it done and wait for the app's own transcode (the real worker encoder)
  // to land before exporting.
  await page.goto("/");
  await page.getByRole("button", { name: "Book 001, 1 chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page
    .getByRole("button", { name: "More actions for segment 1" })
    .click();
  await page
    .getByRole("dialog", { name: "More" })
    .getByRole("button", { name: "Mark segment 1 done", exact: true })
    .click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string[]>((resolve, reject) => {
              const open = indexedDB.open("tc-mobile");
              open.onerror = () => reject(open.error);
              open.onsuccess = () => {
                const all = open.result
                  .transaction("clipMeta")
                  .objectStore("clipMeta")
                  .getAll();
                all.onsuccess = () => {
                  open.result.close();
                  resolve(
                    (all.result as { encoding: string }[]).map(
                      (c) => c.encoding
                    )
                  );
                };
                all.onerror = () => reject(all.error);
              };
            })
        ),
      { timeout: 20_000 }
    )
    .toEqual(["mp3"]);

  await page.goto("/");
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
  await page.getByRole("button", { name: "Export project" }).click();
  await pickLanguage(page);
  await page.getByRole("button", { name: "Share now" }).click();

  await expect
    .poll(() => page.evaluate(() => "__shared" in (window as object)))
    .toBe(true);
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: SharedFile }).__shared
  );
  expect(shared.name).toBe("Book 001 - project.zip");
  expect(shared.head).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(shared.spoolFiles).toHaveLength(1);
  expectBundleContent(Buffer.from(shared.base64, "base64"));

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

test("Export project on a book with no audio says there is nothing to share, in place (#1457)", async ({
  page,
}) => {
  // Headless Chromium has no Web Share; without a stub the flow refuses
  // before it builds anything, which is a different message.
  await page.addInitScript(() => {
    Object.assign(navigator, {
      canShare: () => true,
      share: async () => undefined,
    });
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await newBook(page);
  await page.getByRole("button", { name: "More actions for Book 001" }).click();
  await page.getByRole("button", { name: "Export project" }).click();
  await pickLanguage(page);
  await expect(
    page.getByText("Record a segment before sharing this book.")
  ).toBeVisible();
  // No send is armed: the Share tile is still Share book.
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
});
