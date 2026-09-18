import { expect, test } from "@playwright/test";

/**
 * The durable failure log's browser-only half (#205), against the SHIPPED
 * build.
 *
 * The Node suite covers the store's ring, the sink's serialisation, and the
 * text rendering. Four things it structurally cannot cover, because this repo
 * has no renderer in Vitest (`environment: "node"`, no jsdom — a dependency
 * this project has declined before), all of them the point of the feature:
 *
 *   1. A real `unhandledrejection` reaching the real funnel — the Node suite
 *      calls `reportFailure` directly.
 *   2. The marker appearing on the `≡` control, which is the whole
 *      state-in-place signal a non-reader gets.
 *   3. That the log SURVIVES A RELOAD. This is the entire reason the feature
 *      exists (`console.error` does not), and a fake-indexeddb assertion in a
 *      process that never reloads cannot say it.
 *   4. The panel's controls being reachable behind the menu's focus trap.
 *
 * Runs against `dist/`, not the harness build: this drives the real UI and
 * touches no `window.__e2e`, so it should assert the bundle that ships — the
 * same reasoning `service-worker-precache.spec.ts` documents.
 *
 * NOT covered here, and not claimed: the share handoff. `navigator.share` in
 * headless Chromium is either absent or non-interactive, so tapping "Send
 * problem report" cannot be driven to a real OS sheet. Tap 1 (read the log,
 * render the text, arm the File) IS exercised below; the sheet itself is
 * device work, like every other share in this app.
 */

/** The failure the app is made to report. A rejection nothing awaits. */
const FORCED = "e2e forced failure";

/** Make the page raise one real unhandled rejection. */
async function forceFailure(page: import("@playwright/test").Page) {
  await page.evaluate((message) => {
    void Promise.reject(new Error(message));
  }, FORCED);
}

/** The `≡` control, found by role — the only text layer this UI has. */
function menuControl(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /^Open menu/ });
}

/**
 * The alert badge on the `≡` control — the state-in-place signal a person who
 * cannot read actually gets.
 *
 * Located by class, not by role: it is `aria-hidden` on purpose (the count is
 * already in the button's accessible name, and a screen reader should hear it
 * once), so no accessibility query can reach it and the accessible-name
 * assertions elsewhere in this file say nothing about whether the glyph is
 * painted. That gap is real — a marker rendered unconditionally passed every
 * other case in this file.
 */
function marker(page: import("@playwright/test").Page) {
  return page.locator("header .control-hint");
}

/**
 * Every case starts from an empty log, and that is **asserted, not arranged**.
 *
 * There used to be a reset helper here. George's round-1 finding had two halves:
 * the first version of it used `deleteDatabase` and resolved on `onblocked`,
 * exactly the shape AGENTS.md bans (the app already holds a connection after
 * `goto("/")`, so the delete blocks, the handler reports success, and the
 * database is still there with the previous case's rows). That half was
 * confirmed and fixed. The LEAK half never reproduced: with the reset removed
 * entirely every case still passed, and a probe that deliberately left a row
 * behind read `0` rows in the next case, because Playwright gives each test a
 * fresh browser context and that isolates the origin's IndexedDB.
 *
 * So the corrected helper was kept as belt-and-braces — and a helper that
 * provably does nothing is the sprawl AGENTS.md forbids, not insurance. **It is
 * deleted** (DRI, 2026-09-17); the measurement is recorded on the PR.
 *
 * What carries the weight against a false pass is below, and always did.
 * `useFailureCount` starts at `0` and reads IndexedDB in an effect, so a case
 * that merely found "no marker" could be seeing the pre-effect state. Waiting
 * for the control to SETTLE on its quiet name is what distinguishes "read the
 * empty log" from "has not read yet" — and it fails loudly if a case ever does
 * start dirty, where the old reset passed quietly.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(menuControl(page)).toBeVisible();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
});

test("a quiet phone shows no marker and a menu with no Send control", async ({
  page,
}) => {
  // The other state of the gate. Without this, a marker rendered
  // unconditionally would pass every assertion below.
  //
  // NOT an "empty menu", which an earlier name called it (George R3 P3 on
  // #457): the global menu always holds the theme toggle (#171,
  // `books-screen.tsx`), so what a quiet phone shows is a menu WITHOUT the
  // failure-log Send control. That toggle is also where `Menu`'s open-edge
  // focus lands when `failureCount === 0` — it is the first actionable
  // control outside the header (`menu.tsx`). That landing is a consequence of
  // the menu's general rule, not a decision recorded anywhere this spec's
  // author could find; it is named here so a later case that opens the menu
  // and presses Enter knows it will flip the theme rather than reach the log.
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
  await menuControl(page).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toHaveCount(0);
});

test("a real unhandled rejection marks the ≡ control, live", async ({
  page,
}) => {
  await forceFailure(page);
  // No reload: the marker has to appear while the shelf is open, which is the
  // watcher path in `hooks/failure-log.ts`.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  // And the glyph with it — the half of this a non-reader depends on.
  await expect(marker(page)).toHaveCount(1);
  await expect(marker(page)).toBeVisible();
});

test("the log survives a reload — the reason the feature exists", async ({
  page,
}) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );

  await page.reload();

  // The count is read back from IndexedDB on mount, with nothing in memory
  // carried across. This is the assertion `console.error` could never satisfy.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
});

test("repeated failures count up rather than collapsing", async ({ page }) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  // A DISTINCT object each time, so the funnel's identity dedup does not apply
  // — two genuine failures are two rows.
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 2 problems recorded."
  );
});

test("the panel says so when the browser cannot share at all", async ({
  page,
}) => {
  // Headless desktop Chromium genuinely has no `navigator.share`, so this is
  // the real capability path, not a stub: `selectLogShareShape` reads
  // `unsupported` BEFORE the log is read and the panel shows its failure Notice.
  // Worth pinning here because a desktop browser is what a facilitator may well
  // open this on.
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  expect(await page.evaluate(() => typeof navigator.share)).not.toBe(
    "function"
  );

  await menuControl(page).click();
  await page.getByRole("button", { name: "Send problem report" }).click();

  await expect(
    page.getByText("Could not send the problem report. Try again.")
  ).toBeVisible();
  // The menu stays open with the reason in it, and the log is untouched.
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
});

test("tap 1 renders the log to a text File, tap 2 hands it over", async ({
  page,
}) => {
  // The ONE stub in this file, and what it does and does not replace:
  // `navigator.share` is the OS sheet, which no headless browser can present.
  // Everything up to it is the real thing — the IndexedDB read, the text
  // render, the `File` construction, `navigator.canShare`'s absence, the
  // two-gesture activation contract, and the panel's state machine. What the
  // stub cannot tell us is whether a real iOS or Android sheet accepts a
  // `text/plain` File; that is device work, like every other share here.
  await page.addInitScript(() => {
    const shared: { name: string; type: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    // An EXPLICIT yes for files. Required since round 2: absence of `canShare`
    // is no longer read as "files work", and headless Chromium on Linux does
    // not actually offer a file share — so without this stub the code correctly
    // falls back to text and this case would be testing the wrong branch.
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: { files?: File[] }) => data.files !== undefined,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        for (const file of data.files ?? []) {
          shared.push({
            name: file.name,
            type: file.type,
            text: await file.text(),
          });
        }
      },
    });
  });
  await page.reload();

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByText("1 problem recorded")).toBeVisible();

  // Tap 1 — read, render, arm. The control becomes the primary "Share now".
  await page.getByRole("button", { name: "Send problem report" }).click();
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  // Tap 2 — hand the File over. The flow closes the menu on a resolved share.
  await send.click();
  await expect(menu).toHaveCount(0);

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: unknown[] }).__shared
  );
  expect(shared).toHaveLength(1);
  const file = shared[0] as { name: string; type: string; text: string };
  expect(file.type).toBe("text/plain");
  expect(file.name).toMatch(/^tc-mobile-log-.+\.txt$/);
  // A colon is illegal in a filename on Windows, where these get read.
  expect(file.name).not.toContain(":");
  // The real entry, through the real funnel and the real store.
  expect(file.text).toContain("tc-mobile failure log");
  expect(file.text).toContain("entries: 1");
  expect(file.text).toContain("[unhandled-rejection]");
  expect(file.text).toContain(FORCED);
  // Never the string "undefined" where a field was absent.
  expect(file.text).not.toContain("undefined");
});

test("falls back to sharing TEXT when the platform refuses a text/plain file", async ({
  page,
}) => {
  // George #5, round 1: the log's one exit used to run on the File-only
  // `useShareFlow`, which sets `error: "failed"` when
  // `canShare({ files })` is false — a standing refusal no retry clears. iOS
  // has historically not accepted every type in a file share, so on the
  // platform this ships to first the log could have had no exit at all. This
  // stubs exactly that platform: files refused, text allowed.
  await page.addInitScript(() => {
    const shared: { kind: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      // Refuse any file share; allow text. The shape an iOS build can present.
      value: (data: { files?: File[]; text?: string }) =>
        data.files === undefined && typeof data.text === "string",
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; text?: string }) => {
        if (data.files !== undefined) {
          // What the real platform would do if we ignored its own canShare.
          throw new DOMException("not allowed", "NotAllowedError");
        }
        shared.push({ kind: "text", text: data.text ?? "" });
      },
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  // Tap 1 must ARM, not fail — this is the assertion the old flow could not
  // satisfy.
  await page.getByRole("button", { name: "Send problem report" }).click();
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  await send.click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);

  const shared = await page.evaluate(
    () =>
      (window as unknown as { __shared: { kind: string; text: string }[] })
        .__shared
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]?.kind).toBe("text");
  // The same content the file would have carried — the log genuinely left.
  expect(shared[0]?.text).toContain("tc-mobile failure log");
  expect(shared[0]?.text).toContain(FORCED);
});

test("says so when NEITHER a file nor text can be shared", async ({ page }) => {
  // The other side of the fallback: when the platform offers no shape at all,
  // the panel shows its failure rather than arming a button that cannot work.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();
  await page.getByRole("button", { name: "Send problem report" }).click();

  await expect(
    page.getByText("Could not send the problem report. Try again.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
});

test("a Web Share LEVEL 1 browser (no canShare) shares text, not a file", async ({
  page,
}) => {
  // Frank, round 2. `navigator.canShare` arrived with Web Share Level 2, which
  // is also what added file sharing — so a Level 1 browser has `share`, has no
  // `canShare`, and cannot take `{ files }` at all. Treating that absence as
  // "files work" armed the file branch on exactly those browsers and `send()`
  // then failed with no fallback left, which is the bug the fallback exists to
  // prevent, one layer down.
  await page.addInitScript(() => {
    const shared: { kind: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    // Level 1: delete canShare entirely.
    Reflect.deleteProperty(Navigator.prototype, "canShare");
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; text?: string }) => {
        if (data.files !== undefined) {
          throw new DOMException("files unsupported", "TypeError");
        }
        shared.push({ kind: "text", text: data.text ?? "" });
      },
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  expect(await page.evaluate(() => typeof navigator.canShare)).not.toBe(
    "function"
  );

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();
  await page.getByRole("button", { name: "Send problem report" }).click();
  await page.getByRole("button", { name: "Share now" }).click();

  const shared = await page.evaluate(
    () =>
      (window as unknown as { __shared: { kind: string; text: string }[] })
        .__shared
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]?.kind).toBe("text");
  expect(shared[0]?.text).toContain(FORCED);
});

test("the count recovers after a transient failed read, without a reload", async ({
  page,
}) => {
  // George P2-A, round 2. A failed count read was swallowed and never retried;
  // the shelf's own Try again does not re-run the hook's effect, and the panel
  // is gated on the count. So after a transient open failure (a second tab
  // holding an upgrade — `DatabaseBlockedError`, #221) a log that WAS on disk
  // stayed invisible and could never be sent.
  //
  // The sequencing is what makes this test the retry and not the write path:
  // the row is stored on THIS load, then the next load's first reads fail with
  // no write following, so only a retry can bring the count in.
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );

  // Refuse every IndexedDB open for the first few seconds of the next load,
  // then recover — a blocking copy going away.
  await page.addInitScript(() => {
    const realOpen = indexedDB.open.bind(indexedDB);
    const refuseUntil = Date.now() + 2500;
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (...args: Parameters<typeof realOpen>) => {
        if (Date.now() < refuseUntil) {
          throw new DOMException("another copy is open", "InvalidStateError");
        }
        return realOpen(...args);
      },
    });
  });
  await page.reload();

  // The row is on disk and no write will happen on this load, so the marker can
  // only appear if the failed read is retried.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded.",
    { timeout: 20_000 }
  );
  await expect(marker(page)).toHaveCount(1);
});

test("a SPENT retry ladder is revived by the shelf's Try again", async ({
  page,
}) => {
  // The other state of the gate above (George R1 P2, takeover). The ladder is
  // bounded — five retries, then it waits for the app to be backgrounded and
  // brought forward. But the recovery this screen OFFERS is a button, and the
  // blocked-database copy tells the user to close the other copy and THEN press
  // it: a sequence that can outlast the ladder and that ends with the user still
  // in the app. Before the fix the shelf came back and the log did not, because
  // the ≡ mark and the panel are both gated on the count.
  //
  // **This case waits the ladder out in real time, and that is deliberate.**
  // `MAX_COUNT_RETRIES` × `RETRY_BACKOFF_MS` is 1+2+4+8+16 s, so the give-up
  // happens ~31 s after the first failed read. Clamping `setTimeout` from an
  // init script was tried first and is not worth what it costs: it patches a
  // browser primitive out from under the code under test, and the first draft of
  // this case passed with the fix reverted because the clamp silently did not
  // take. Forty seconds once per CI run buys a case that asserts the shipped
  // timings on the shipped build, with nothing about the browser faked except
  // the database refusal itself.
  test.setTimeout(90_000);

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );

  await page.addInitScript(() => {
    const flags = window as unknown as { __refuseIdb?: boolean };
    flags.__refuseIdb = true;
    const realOpen = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: (...args: Parameters<typeof realOpen>) => {
        if (flags.__refuseIdb === true) {
          throw new DOMException("another copy is open", "InvalidStateError");
        }
        return realOpen(...args);
      },
    });
    // No log WRITE may succeed on this load, for the whole load, and this is the
    // difference between a test and a test-shaped thing. The shelf's own failed
    // read reports a failure, which the sink queues; once the database comes
    // back that write lands and `notifyWatchers` refreshes the count — bringing
    // the marker in with the ladder still spent and the fix reverted. The first
    // draft of this case passed exactly that way. Reads (`countFailures` is
    // `readonly`) are untouched, so the only thing left that can paint the
    // marker is the read path this case exists for.
    const realTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      stores: string | string[] | DOMStringList,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions
    ): IDBTransaction {
      const names =
        typeof stores === "string"
          ? [stores]
          : (Array.from(stores) as string[]);
      if (mode === "readwrite" && names.includes("failures")) {
        throw new DOMException(
          "no log writes in this case",
          "InvalidStateError"
        );
      }
      return realTransaction.call(this, stores, mode, options);
    };
  });
  await page.reload();

  // The shelf read failed too, so the screen offers its own recovery.
  const tryAgain = page.getByRole("button", { name: "Try again" });
  await expect(tryAgain).toBeVisible();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  // Outlast the ladder: 31 s of retries, every one of them refused, plus a
  // margin. This is the wait the `DatabaseBlockedError` copy invites — read the
  // Notice, find the other tab, close it, come back.
  await page.waitForTimeout(36_000);

  // Release the blocker WITHOUT touching the app, the way closing the other copy
  // does. Nothing brings the count in by itself now: the ladder is spent by
  // construction, no write can succeed to fire a watcher, and the app has not
  // been backgrounded.
  await page.evaluate(() => {
    (window as unknown as { __refuseIdb?: boolean }).__refuseIdb = false;
  });
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);

  // The one gesture the screen offers. The row was written on the PREVIOUS load
  // and no write can succeed on this one, so the marker can only appear if the
  // tap handed the count's ladder back.
  await tryAgain.click();

  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded.",
    { timeout: 10_000 }
  );
  await expect(marker(page)).toHaveCount(1);
});

test("a failure landing DURING tap 1 does not cancel it", async ({ page }) => {
  // George R5 P2-1. The drop used to fire on any non-idle status, and `prepare`
  // sets "preparing" BEFORE it awaits `readFailureLog()` — a read that sits on
  // the write lane by design, so that it covers whatever is queued ahead of it.
  // A write landing during that read therefore reset the flow mid-prepare:
  // `runId` moved, `prepare` took its `if (!current()) return` arm, and the
  // control went back to the quiet Send with no Notice — a tap that did nothing
  // and said nothing. On the crash screen the writer is usually the transcode
  // sweep, so every retry could be cancelled by the next segment's report.
  //
  // Cancelling a prepare was never the point: a read still in flight is not a
  // snapshot of anything yet. Only a READY payload can go stale.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.reload();

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  // The ordering here is the whole test, and it is deterministic rather than
  // timed. Both statements run in ONE task:
  //
  //   1. A synthetic `error` event. `install-failure-listeners.ts` listens on
  //      window, so its `reportFailure` runs SYNCHRONOUSLY and the append is on
  //      the lane before the next line executes. (A rejected promise would not
  //      do: `unhandledrejection` fires in a later task, which would put the
  //      write BEHIND the read and test nothing.)
  //   2. The tap. React's handler runs synchronously, so `prepare` reaches its
  //      first `await` — status is already "preparing" and the read is queued
  //      behind that append.
  //
  // The append then lands and moves the generation while the read is still in
  // flight. That is the exact window, hit by lane order and not by a sleep.
  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("landed during prepare"),
        message: "landed during prepare",
      })
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="Send problem report"]')
      ?.click();
  });

  // The prepare survived and armed. Under the old predicate this is the quiet
  // "Send problem report" again, with nothing said.
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  // And it armed the LATER log: the read is on the lane, so it saw the row that
  // landed during it, and the payload's stamp is that version — so it is not
  // dropped as stale the moment it becomes ready.
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByText("2 problems recorded")).toBeVisible();
  await expect(send).toBeVisible();
});

test("a failure landing between the two gestures drops the armed snapshot", async ({
  page,
}) => {
  // George P3-D, round 2. Tap 1 renders a SNAPSHOT of the log; the count beside
  // it is live. A failure arriving in that window left the Notice saying "2
  // problems recorded" while Share still held the one-entry file — the screen
  // and the file disagreeing about what is being sent, which a maintainer
  // cannot detect from the file alone.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  // Tap 1 arms a one-entry payload.
  await page.getByRole("button", { name: "Send problem report" }).click();
  await expect(page.getByRole("button", { name: "Share now" })).toBeVisible();

  // A second failure lands before tap 2.
  await forceFailure(page);

  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByText("2 problems recorded")).toBeVisible();
  // The stale payload is dropped: the primary Send is gone and the panel is
  // back to tap 1, so the next arm covers both entries.
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toBeVisible();
});

test("a failure REPORTED but not yet stored does not refuse tap 2", async ({
  page,
}) => {
  // The second state of the round-9 gate, and the case that corrected my own
  // account of Frank R8 P2. Read this before changing the check in `send`.
  //
  // Both statements below run in ONE task, the same deterministic interleaving
  // `a failure landing DURING tap 1` uses:
  //
  //   1. A synthetic `error` event. `install-failure-listeners.ts` listens on
  //      window, so `reportFailure` runs synchronously.
  //   2. Tap 2, whose React handler also runs synchronously.
  //
  // What I first assumed, and what is false: that step 1 moves the generation
  // before step 2 reads it. It does not. `reportFailure` only QUEUES the append
  // (`failure-log.ts` — `void enqueue(() => writeEntry(entry))`), and the
  // generation moves in `markLogWritten`, after IndexedDB has committed. So at
  // the instant of the tap the store still holds one row, the armed File is an
  // exact picture of it, and the screen still says "1 problem recorded".
  //
  // Sending is therefore CORRECT here, and refusing would be the bug: a queued
  // write is not a stale payload. On a phone mid-transcode-sweep there is almost
  // always a write in flight, so a check that keyed on "something is queued"
  // would make Send refusable at essentially any moment — turning the one exit
  // the log has into a control that fails for reasons the person cannot see.
  //
  // The window `send`'s synchronous check actually closes is the other one: the
  // write has LANDED and moved the generation, React has committed that render,
  // and the passive effect that drops the payload has not run yet. That ordering
  // is internal to React and cannot be forced from Playwright, so it is covered
  // by inspection plus the unit case pinning `getLogGeneration` current — said
  // plainly on the PR rather than implied by this file's existence.
  //
  // `__shared` records what actually left the app, because after the flow
  // settles the control reads the same in both directions.
  await page.addInitScript(() => {
    (window as unknown as { __shared: string[] }).__shared = [];
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string; files?: File[] }) => {
        const seen = (window as unknown as { __shared: string[] }).__shared;
        if (data.files) for (const file of data.files) seen.push(file.name);
        else seen.push("text");
      },
    });
  });
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  // Tap 1 arms a one-entry payload.
  await page.getByRole("button", { name: "Send problem report" }).click();
  await expect(page.getByRole("button", { name: "Share now" })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("landed with tap 2"),
        message: "landed with tap 2",
      })
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="Share now"]')
      ?.click();
  });

  // Settle on a state reached either way — the armed control goes away whether
  // the send was spent or refused. No sleep; this is an auto-retrying assertion,
  // and `navigator.share` is awaited before the status goes idle, so by the time
  // it passes anything that was going to leave has left.
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);

  // THE assertion: the report went out. One file, the one that was armed. A
  // `send` that refused here would leave this empty, which is what a check
  // keyed on anything looser than the landed generation would do.
  expect(
    await page.evaluate(
      () => (window as unknown as { __shared: string[] }).__shared
    )
  ).toHaveLength(1);

  // A completed send ends the flow, so the panel closes the menu (`onDone`).
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);

  // The second failure lands afterwards and the marker catches up. The sent file
  // is one entry short of what the log now holds, and that is not a defect — it
  // is what "sent a moment ago" means. Nothing on screen claims otherwise, and
  // the next tap covers both.
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 2 problems recorded."
  );
});

test("at the ring's limit a new failure STILL drops the armed snapshot", async ({
  page,
}) => {
  // George R3 P2-2, and the reason the panel watches a generation rather than
  // the count. `appendFailure` prunes the oldest row once the log holds 50, so
  // from the cap onward every further failure leaves `countFailures()` at
  // exactly 50. A panel keyed on the count would hold an armed File that is
  // missing the newest failure and still contains one that has been deleted,
  // with the Notice beside it agreeing with neither — the same mismatch the
  // armed-snapshot drop exists to close, at the one bound the store guarantees
  // will be reached on a phone that is having a bad day.
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await page.reload();

  // Fill to the cap with DISTINCT objects, so the funnel's identity dedup does
  // not collapse them into one row.
  await page.evaluate((limit) => {
    for (let i = 0; i < limit; i++) {
      void Promise.reject(new Error(`filler ${i}`));
    }
  }, 50);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 50 problems recorded.",
    { timeout: 20_000 }
  );

  await menuControl(page).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByText("50 problems recorded")).toBeVisible();

  // Tap 1 arms a File holding the 50 rows that exist right now.
  await page.getByRole("button", { name: "Send problem report" }).click();
  await expect(page.getByRole("button", { name: "Share now" })).toBeVisible();

  // The 51st failure. It appends and prunes: the rows change, the NUMBER does
  // not, and the Notice cannot show any difference.
  await forceFailure(page);
  await expect(menu.getByText("50 problems recorded")).toBeVisible();

  // The stale payload is dropped anyway. This is the assertion that a
  // count-keyed panel fails.
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toBeVisible();
});

test("a failure landing while the share sheet is open keeps the menu open", async ({
  page,
}) => {
  // George R2 P3-4. The armed-snapshot drop above covers the window BETWEEN the
  // two gestures. This is the window after tap 2: the OS chooser is already up
  // holding the old File and nothing in this app can recall it, so a failure
  // landing now is in the log and not in what was sent. Closing the menu on the
  // resolve would leave the person believing the newest problem went out.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    // The sheet stays up until the test says the person picked an app.
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          (window as unknown as { __closeSheet: () => void }).__closeSheet =
            resolve;
        }),
    });
  });
  await page.reload();

  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  const menu = page.getByRole("dialog", { name: "Menu" });
  await page.getByRole("button", { name: "Send problem report" }).click();
  const send = page.getByRole("button", { name: "Share now" });
  await expect(send).toBeVisible();

  // Tap 2. The chooser is now up, holding a one-entry file.
  await send.click();

  // A second failure lands while the person is still choosing an app.
  await forceFailure(page);
  await expect(menu.getByText("2 problems recorded")).toBeVisible();

  // They pick one; `navigator.share` resolves.
  await page.evaluate(() =>
    (window as unknown as { __closeSheet: () => void }).__closeSheet()
  );

  // The menu must stay open, back on tap 1, so one more arm covers the new row.
  await expect(menu).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Share now" })).toHaveCount(0);
  await expect(menu.getByText("2 problems recorded")).toBeVisible();
});

test("clear empties the log, and it stays empty across a reload", async ({
  page,
}) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();

  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeVisible();
  await page.getByRole("button", { name: "Clear problem report" }).click();

  // The bin arms a confirm rather than clearing (George R2 P3-3) — the same
  // dialog the segment Erase and the book Delete use.
  const confirm = page.getByRole("dialog", {
    name: "Clear the problem report?",
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Clear", exact: true }).click();

  // Clearing closes the menu with it rather than leaving an emptied panel over
  // two controls that now do nothing.
  await expect(confirm).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");

  // Cleared in the store, not just repainted.
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName("Open menu");
  await expect(marker(page)).toHaveCount(0);
});

// The other half of that gate. A confirm that only ever gets confirmed is not a
// confirm: the case it exists for is the mis-tap, and the log has to still be
// there afterwards — in the store, not only on screen. `clearFailures` has no
// undo and the report is the only copy of what went wrong that leaves the phone.
// This confirm is the first one in the app that opens OVER a live `Menu` rather
// than after closing it (the book Delete closes the menu first, which is right
// there because the row it targets is about to vanish; here a mis-tap has to
// return the person to the panel with an armed share intact). Two dialogs mean
// two window keydown listeners, so Escape has to stop at the top one.
test("Escape closes the clear confirm without tearing down the menu", async ({
  page,
}) => {
  await forceFailure(page);
  await menuControl(page).click();
  await page.getByRole("button", { name: "Clear problem report" }).click();

  const confirm = page.getByRole("dialog", {
    name: "Clear the problem report?",
  });
  await expect(confirm).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toBeVisible();
});

test("cancelling the clear confirm leaves the log on disk", async ({
  page,
}) => {
  await forceFailure(page);
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
  await menuControl(page).click();
  await page.getByRole("button", { name: "Clear problem report" }).click();

  const confirm = page.getByRole("dialog", {
    name: "Clear the problem report?",
  });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);

  // Still in the menu, still one problem, and the panel's controls still there.
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send problem report" })
  ).toBeVisible();

  // And still in IndexedDB, which is the assertion that would survive a version
  // of this that merely repainted.
  await page.reload();
  await expect(menuControl(page)).toHaveAccessibleName(
    "Open menu. 1 problem recorded."
  );
});
