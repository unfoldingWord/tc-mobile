import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * The programmatic recorder close against a Back that has not landed yet
 * (#763), on the shipped `dist/` build.
 *
 * `commitCloseRecorder` is the recorder's `onExit`. When no `popstate` is
 * behind it, it still owes the recorder's history entry. The failure exits are
 * that case: a failed save exits to `SaveFailed`, and erase has its own
 * failure exits. Each is an async continuation inside the sheet, so it can
 * resolve while a Back is still in flight. These cases drive the failed-save
 * exit: a real capture from Chromium's synthetic microphone, then a Stop whose
 * save is refused by an injected `IDBDatabase.transaction` failure.
 *
 * Each case makes the overlap itself. `history.back()` is wrapped so that the
 * call is logged and the real traversal is HELD until the test releases it.
 * That keeps a Back in flight across the Stop, a window that would otherwise
 * last about one task. So these cases pin a defensive invariant, not a
 * reproduced field failure. A real path reaches it when the exit's
 * continuation beats a pending `popstate`. One way is the Android hardware
 * Back: it is a `goBack` that no control disables.
 *
 * The witness is the ordered log of history calls made before the held
 * traversal is released. It must hold ONE `back()`, never a second one issued
 * under the first. After release, the resting index shows the stack is whole.
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

interface Probe {
  __log: string[];
  __release: () => boolean;
  __failWrites: boolean;
}

function navIndex(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () => (window.history.state as { index?: number } | null)?.index
  );
}

function historyLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Probe).__log);
}

/**
 * Refuse every read-write transaction once `__failWrites` is set, so the
 * sheet's save fails the way a full disk makes it fail.
 */
async function injectWriteFailure(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as Partial<Probe>;
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      if (probe.__failWrites === true && args[1] === "readwrite") {
        throw new DOMException("injected", "QuotaExceededError");
      }
      return real.apply(this, args);
    } as IDBDatabase["transaction"];
  });
}

/**
 * Log every history call and HOLD each `back()` until `__release()`, which
 * runs the oldest held one and reports whether there was one. A `popstate`
 * listener added here runs after the app's own (DOM Standard: listeners run in
 * the order they were added), so each `"pop"` follows whatever the app did at
 * that landing.
 */
async function holdTraversals(page: Page) {
  await page.evaluate(() => {
    const probe = window as unknown as Probe;
    const log: string[] = [];
    const held: (() => void)[] = [];
    probe.__log = log;
    probe.__release = () => {
      const next = held.shift();
      next?.();
      return next !== undefined;
    };
    const history = window.history;
    const back = history.back.bind(history);
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.back = () => {
      log.push("back");
      held.push(back);
    };
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      log.push("push");
      push(...args);
    };
    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      log.push("replace");
      replace(...args);
    };
    window.addEventListener("popstate", () => log.push("pop"));
  });
}

const pops = async (page: Page) =>
  (await historyLog(page)).filter((call) => call === "pop").length;

/** Release the held traversals one landing at a time until none is left. */
async function releaseAll(page: Page) {
  for (let i = 0; i < 5; i++) {
    const before = await pops(page);
    const released = await page.evaluate(() =>
      (window as unknown as Probe).__release()
    );
    if (!released) return;
    await expect.poll(() => pops(page)).toBe(before + 1);
  }
  throw new Error("more held traversals than any case issues");
}

async function seedToSegments(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
}

const stopRecording = (page: Page) =>
  page.getByRole("button", { name: "Stop recording", exact: true });

/** Start a capture in the open sheet and let the synthetic mic fill it. */
async function startCapture(page: Page) {
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(stopRecording(page)).toBeVisible();
  await page.waitForTimeout(1200);
}

/** Stop with every write refused: the save fails and the sheet exits. */
async function stopWithFailedSave(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Probe).__failWrites = true;
  });
  await stopRecording(page).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  await expect(page.getByText("No room left on this phone.")).toBeVisible();
}

test("(a) a failed-save exit while a goBack is in flight absorbs that Back's landing rather than issuing a second back() (#763)", async ({
  page,
}) => {
  await injectWriteFailure(page);
  await seedToSegments(page);
  await page.getByRole("button", { name: "Record segment 1" }).click();
  const atRecorder = await navIndex(page);
  expect(atRecorder).toBeGreaterThan(0);
  await startCapture(page);

  await holdTraversals(page);
  // The header Close is `goBack`: its `back()` is issued and held.
  await page.getByRole("button", { name: "Close recorder" }).click();
  expect(await historyLog(page)).toEqual(["back"]);

  await stopWithFailedSave(page);
  // The exit ran with that Back still in flight. That Back is already
  // consuming the recorder's entry, so nothing more is issued.
  expect(await historyLog(page)).toEqual(["back"]);

  await releaseAll(page);
  expect(await historyLog(page)).toEqual(["back", "pop"]);
  // One level, the recorder's, was consumed: the app rests at Segments depth.
  expect(await navIndex(page)).toBe((atRecorder ?? 0) - 1);
});

test("(c) a failed-save exit from a recorder whose entry is still deferred behind a Forward's cancel drops that entry rather than issuing a back() (#763)", async ({
  page,
}) => {
  await injectWriteFailure(page);
  await seedToSegments(page);
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  // Back from the recorder leaves its entry standing as a FORWARD entry
  // (back-navigation case (o)).
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  const atSegments = await navIndex(page);

  await holdTraversals(page);
  // At the Forward's landing, after the app has issued its cancelling back()
  // (held here), tap Record: its entry is deferred to the cancel's landing.
  await page.evaluate(() => {
    let tapped = false;
    window.addEventListener("popstate", () => {
      if (tapped) return;
      tapped = true;
      document
        .querySelector<HTMLButtonElement>('[aria-label="Record segment 1"]')
        ?.click();
      (window as unknown as Probe).__log.push("tapped");
    });
  });
  await page.goForward();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  expect(await historyLog(page)).toEqual(["back", "pop", "tapped"]);

  await startCapture(page);
  await stopWithFailedSave(page);
  // The recorder's entry was never written, so there is nothing to consume.
  expect(await historyLog(page)).toEqual(["back", "pop", "tapped"]);

  await releaseAll(page);
  // The cancel lands and replays nothing: no entry for the closed recorder.
  expect(await historyLog(page)).toEqual(["back", "pop", "tapped", "pop"]);
  expect(await navIndex(page)).toBe(atSegments);
});
