import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { editRecordingButton } from "./recorder-fixtures";

/**
 * The launch replay of a held take (#38), end to end in headless Chromium
 * against the shipped `dist/` build: a recording whose save did not land
 * leaves its pending row behind, the page goes away without the recovery
 * screen being used, and the next launch finishes the save quietly (the DRI's
 * pick on #1546, "Finish the save quietly"), exactly once.
 *
 * HOW THE SAVE IS KEPT FROM LANDING. The commit is one IndexedDB transaction
 * (`saveTake`), so a test cannot stop between "held" and "saved" by timing. An
 * init script instead makes a `put` on the `takes` store throw
 * `UnknownError` while `window.__failTakes` is set. The hold's own write
 * (`pendingTakes`) is untouched, so the row is on disk when the commit fails,
 * which is the state a kill leaves. The error is not a quota error: a quota
 * failure gives the row up on purpose. A new page has no flag, so its replay
 * commits normally.
 *
 * Written to pass for either base kind the hold writes (`inline` or `stored`):
 * the assertions read the row's own base and compare the result against it.
 *
 * Not covered: headless Chromium with a fake microphone is not a phone, and a
 * real process kill (a swipe-away in the middle of a save) is not run here.
 * That is a device row. The deleted-segment case removes the segment with a
 * direct IndexedDB write, because the app offers no gesture for deleting a
 * segment whose save has failed.
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

/** A pending row reduced to what the assertions compare (buffers as frame counts). */
interface Row {
  segmentId: string;
  baseKind: "inline" | "stored";
  /** Frames the base holds: the inline samples, or the stored clip's count. */
  baseFrames: number;
  recordedFrames: number;
}

/** The pending rows, buffers read as frame counts inside the page. */
function pendingRows(page: Page): Promise<Row[]> {
  return page.evaluate(
    () =>
      new Promise<Row[]>((resolve, reject) => {
        const open = indexedDB.open("tc-mobile");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db
            .transaction("pendingTakes")
            .objectStore("pendingTakes")
            .getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(
              (
                all.result as {
                  segmentId: string;
                  base:
                    | { kind: "inline"; samples: ArrayBuffer }
                    | { kind: "stored"; frameCount: number };
                  recorded: ArrayBuffer;
                }[]
              ).map((r) => ({
                segmentId: r.segmentId,
                baseKind: r.base.kind,
                baseFrames:
                  r.base.kind === "inline"
                    ? r.base.samples.byteLength / 2
                    : r.base.frameCount,
                recordedFrames: r.recorded.byteLength / 2,
              }))
            );
          };
        };
      })
  );
}

/** Every row of one object store, read straight from IndexedDB. */
function storeRows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("tc-mobile");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(name).objectStore(name).getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(all.result as T[]);
          };
        };
      }),
    store
  );
}

/** Make the commit's `takes` write fail in this page only. */
async function installFailureHook(page: Page) {
  await page.addInitScript(() => {
    for (const method of ["put", "add"] as const) {
      const real = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (
        this: IDBObjectStore,
        ...args: [unknown, IDBValidKey?]
      ) {
        if (
          this.name === "takes" &&
          (window as unknown as { __failTakes?: boolean }).__failTakes
        ) {
          throw new DOMException("injected", "UnknownError");
        }
        return real.apply(this, args as [unknown, IDBValidKey?]);
      } as typeof real;
    }
  });
}

async function openFirstSegment(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
}

async function recordAndStop(page: Page) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
}

/** The frame count of every clip, read from clipMeta. */
async function clipFrames(page: Page): Promise<number[]> {
  return (await storeRows<{ frameCount: number }>(page, "clipMeta")).map(
    (c) => c.frameCount
  );
}

/**
 * Record one segment whose commit fails, then leave: the held row is on disk,
 * no take is. `first` is a take saved normally beforehand, so the held one is
 * an append over existing audio (the base is then `stored` or `inline`).
 */
async function holdOneTake(page: Page, opts: { savedFirst: boolean }) {
  await installFailureHook(page);
  await openFirstSegment(page);
  if (opts.savedFirst) {
    await recordAndStop(page);
    await expect(editRecordingButton(page)).not.toHaveAttribute(
      "aria-busy",
      "true"
    );
    await expect.poll(() => storeRows(page, "takes")).toHaveLength(1);
    await page.getByRole("button", { name: "Close recorder" }).click();
    await page.getByRole("button", { name: "Edit segment 1" }).click();
  }
  await page.evaluate(() => {
    (window as unknown as { __failTakes: boolean }).__failTakes = true;
  });
  await recordAndStop(page);
  await expect.poll(() => pendingRows(page)).toHaveLength(1);
}

for (const savedFirst of [false, true]) {
  const what = savedFirst ? "an append over saved audio" : "a first recording";
  test(`${what} held at kill is saved on the next launch, once, with nothing shown (#38)`, async ({
    context,
  }, testInfo) => {
    const first = await context.newPage();
    await holdOneTake(first, { savedFirst });
    const [row] = await pendingRows(first);
    testInfo.annotations.push({ type: "base", description: row!.baseKind });
    const takesBefore = await storeRows(first, "takes");
    expect(takesBefore).toHaveLength(savedFirst ? 1 : 0);
    const clipsBefore = await clipFrames(first);
    // The page is gone, the recovery screen never used.
    await first.close();

    const second = await context.newPage();
    await installFailureHook(second);
    await second.goto("/");
    await expect(second.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    // Saved: the row ended, one take is the segment's, and its clip is the
    // base plus the recording.
    await expect
      .poll(() => storeRows(second, "pendingTakes"), { timeout: 15_000 })
      .toHaveLength(0);
    const takes = await storeRows<{ clipId: string }>(second, "takes");
    expect(takes).toHaveLength(1);
    const metas = await storeRows<{ id: string; frameCount: number }>(
      second,
      "clipMeta"
    );
    const saved = metas.find((m) => m.id === takes[0]!.clipId);
    expect(saved?.frameCount).toBe(row!.baseFrames + row!.recordedFrames);
    if (savedFirst) expect(saved!.frameCount).toBeGreaterThan(clipsBefore[0]!);
    // Nothing shown: the shelf, not the recovery screen.
    await expect(
      second.getByRole("button", { name: /^Book 001, / })
    ).toBeVisible();
    await expect(second.getByRole("alertdialog")).toHaveCount(0);

    // Once: another launch finds no row and writes no second take or clip.
    const clipCount = (await storeRows(second, "clipMeta")).length;
    await second.reload();
    await expect(second.locator("#launch-intro")).toBeHidden({
      timeout: 10_000,
    });
    await second.waitForTimeout(1500);
    expect(await storeRows(second, "pendingTakes")).toHaveLength(0);
    expect(await storeRows(second, "takes")).toHaveLength(1);
    expect(await storeRows(second, "clipMeta")).toHaveLength(clipCount);
  });
}

test("a held take whose segment was deleted meanwhile is dropped, not brought back (#38)", async ({
  context,
}) => {
  const first = await context.newPage();
  await holdOneTake(first, { savedFirst: false });
  const [row] = await pendingRows(first);
  await first.close();

  // Delete the segment with the app not running (a page with no app on it).
  const other = await context.newPage();
  await other.goto("/version.json");
  await other.evaluate(
    (segmentId) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tc-mobile");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("segments", "readwrite");
          tx.objectStore("segments").delete(segmentId);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    row!.segmentId
  );
  await other.close();

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(() => storeRows(second, "pendingTakes"), { timeout: 15_000 })
    .toHaveLength(0);
  expect(await storeRows(second, "segments")).toHaveLength(0);
  expect(await storeRows(second, "takes")).toHaveLength(0);
  expect(await storeRows(second, "clipMeta")).toHaveLength(0);
});
