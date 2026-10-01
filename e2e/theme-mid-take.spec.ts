import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { seedToRecorder } from "./support/seed";
import { LIGHT_FLOOR, floorOf, resolved } from "./support/theme";

/**
 * Changing the theme WHILE a take is recording (#149).
 *
 * The case `theme-toggle.spec.ts` does not reach, raised as a nonblocking QA
 * suggestion on PR 623: its recorder case opens an idle, empty sheet, and the
 * condition #149 is about — the sun reaching the screen — arrives mid-capture.
 *
 * Its own file rather than a describe in that spec because the fake microphone
 * needs `test.use({ launchOptions })`, which forces a new worker and so is
 * rejected inside a describe group. `playwright.config.ts` lists it explicitly
 * in the `chromium-shipped-build` project, per that file's rule that a new spec
 * must fail to run visibly rather than silently join a catch-all.
 *
 * WHAT THIS IS REALLY GUARDING. Mounting `ThemeControl` inside the recorder
 * puts a `useSyncExternalStore` subscriber in a tree that is capturing audio,
 * and a toggle re-renders it. The PR's claim is that the blast radius stops
 * at the leaf (plus the canvases, which subscribe on their own account), and
 * until this case even that rested on reading the code. Here the take is
 * actually running when the theme flips.
 *
 * What that buys is narrow, and WHAT IS NOT ASSERTED below is the binding
 * statement of it: the recorder does not leave its recording state and the
 * take still commits. This case is NOT evidence that a toggle cannot disturb
 * a live take — it cannot see the stream at all.
 *
 * DRIVING A LIVE TAKE IS ESTABLISHED HERE, which the file header's "the
 * recorder cannot [be driven honestly]" predates:
 * `e2e/recorder-selection.spec.ts` records against
 * `--use-fake-device-for-media-stream` and asserts on the resulting take. The
 * same flags are scoped to this file (`test.use` at file scope below) —
 * there is no describe here, for the reason given above.
 *
 * WHAT IS ASSERTED. Five observables, and the wording stops where they do
 * (Frank round 9, #623). After the toggle: the transport still offers Stop,
 * the elapsed readout has ADVANCED past a sample taken at the tap, the
 * readout is the SAME TAKE's (#861: every value it took across the toggle,
 * read off the DOM rather than sampled, never went down, and it is still the
 * same element), the menu still offers the way back, and the take lands —
 * `aria-busy` clears and the erase row becomes actionable, so the reloaded
 * view found a clip.
 *
 * WHAT IS NOT ASSERTED, and why the obvious stronger sentence is absent.
 * This does NOT establish that audio capture continued after the toggle. The
 * elapsed readout is a wall clock — `use-recorder.ts`'s `startTick` sets it
 * from `performance.now()` on a 100 ms interval — so it keeps climbing
 * whether or not the media stream is still delivering, and this case waits
 * more than a second before toggling, so a take made only of pre-toggle
 * chunks still commits. An earlier draft of this docblock said the toggle
 * "neither cancelled nor stalled the capture"; the second half of that was
 * never observed here, and the sentence is removed rather than restated.
 * Nothing inspects the samples either: a fake device emits a synthetic tone,
 * so audio content is not a claim Chromium can settle. Both stay device
 * items (#245).
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

/**
 * The transport's elapsed readout, scoped to the recorder sheet (#861). A
 * document-global `.t-timer` fails closed under strict mode if a second one
 * appears, but the failure would then name the locator rather than the take.
 */
const timer = (page: Page) =>
  page
    .getByRole("dialog", { name: "Recorder", exact: true })
    .locator(".t-timer");

/**
 * A readout string, in seconds.
 *
 * The shape is pinned and a miss THROWS rather than returning `NaN` (George
 * round 1, #623). `split(":")` + `Number` turns any unexpected string into
 * `NaN`, and `NaN > n` is false forever — so a renamed class or a changed
 * format would have failed as a 5s poll timeout reading "expected > 3", which
 * is the diagnosis pointing at the recorder instead of at this helper. The
 * pattern is `formatDuration`'s own output (`src/lib/utils.ts`): minutes
 * zero-padded to two but not capped there, seconds always exactly two.
 */
const toSeconds = (raw: string) => {
  const text = raw.trim();
  const match = /^(\d{2,}):(\d{2})$/.exec(text);
  if (!match) {
    throw new Error(`elapsed readout is not MM:SS: ${JSON.stringify(text)}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
};

const elapsedSeconds = async (page: Page) =>
  toSeconds(await timer(page).innerText());

/** What `watchTake` leaves on `window` for `readTakeWatch` to collect. */
type TakeWatch = {
  node: Element;
  readings: string[];
  observer: MutationObserver;
  collect: (records: MutationRecord[]) => void;
};

/**
 * Start recording EVERY value the readout takes, in the page (#861).
 *
 * The question is take identity: is the take after the toggle the same one
 * that was running before it? A comparison against one sample cannot answer
 * it — a take that restarted at `00:00` and climbed back past the sample
 * satisfies "advanced" — and sampling from here on an interval can miss the
 * dip between two samples. So this does not sample. A `MutationObserver` on
 * the readout sees each change React writes to it, and `characterDataOldValue`
 * (plus the text of any replaced text node) keeps the value each change
 * overwrote, so a dip cannot hide inside one callback's batch of records.
 *
 * Two ways a restart can look, and each has its own witness in
 * `readTakeWatch`: a clock reset in place shows as a DECREASE in this
 * sequence, and a remounted readout leaves the node watched here detached, so
 * the sheet's readout is no longer the same element.
 */
const watchTake = (page: Page) =>
  timer(page).evaluate((node) => {
    const readings = [node.textContent ?? ""];
    const collect = (records: MutationRecord[]) => {
      for (const record of records) {
        if (record.type === "characterData" && record.oldValue !== null) {
          readings.push(record.oldValue);
        }
        for (const removed of record.removedNodes) {
          if (removed.nodeType === Node.TEXT_NODE) {
            readings.push(removed.textContent ?? "");
          }
        }
      }
      readings.push(node.textContent ?? "");
    };
    const observer = new MutationObserver(collect);
    observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
    const watch: TakeWatch = { node, readings, observer, collect };
    (window as unknown as { __takeWatch: TakeWatch }).__takeWatch = watch;
  });

/**
 * Stop the watch and return what it saw: every reading, in order, and whether
 * the sheet's readout is still the element the watch started on.
 */
const readTakeWatch = (page: Page) =>
  timer(page).evaluate((current) => {
    const watch = (window as unknown as { __takeWatch: TakeWatch }).__takeWatch;
    // The observer's callback may not have run for the last few changes yet;
    // `takeRecords` hands those over, and `collect` ends the list with the
    // current value.
    watch.collect(watch.observer.takeRecords());
    watch.observer.disconnect();
    return {
      readings: watch.readings,
      sameReadout: watch.node === current && watch.node.isConnected,
    };
  });

test("a mid-take toggle: Stop stays, the clock advances, the menu reverses, the take lands", async ({
  page,
}) => {
  await seedToRecorder(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Start capturing, and wait until the transport says a take is live.
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const stop = page.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();

  // Let the timer leave 0:00, so "advanced" below compares two real readings
  // rather than one reading against a clock that had not started.
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(0);

  // The `⋮` stays reachable mid-take on purpose, which is what makes the
  // toggle reachable here at all. The OPENER is gated on `!view`, the close
  // window, `denied` and a held take (`recorder.tsx`) — recording is not among
  // them — and the rows inside are gated one by one. So the menu being open
  // says nothing about any particular row: Edit is blocked while a take is
  // live, since #857 found the toolbar's `[ ]` twin openable mid-recording and
  // closed both. An earlier version of this comment gave #134's
  // commits-then-edits behaviour as the reason the menu opens; that behaviour
  // is gone, and it was never what kept the opener reachable.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "More", exact: true });
  await expect(menu).toBeVisible();

  // Sampled HERE, with the menu already up and the next action being the tap
  // itself — not before the menu opened (George round 3, #623). Opening the
  // menu takes real time, so a reading taken before it can cross a second
  // boundary on its own; "advanced" would then be satisfiable by the walk
  // rather than by anything the toggle did, and a CLOCK stall beginning at the
  // toggle could pass. (The clock is not the stream — see the docblock on what
  // this readout does and does not witness.) So the reading is taken on the
  // line before the tap and nothing is allowed between the two — the assertions
  // that follow (the repaint, the floor probe, Stop) sit AFTER the toggle, and
  // the time they take is time the clock is free to advance in. That is why
  // this proves the clock did not stall FROM the toggle onward, and not that
  // the toggle itself advanced it.
  //
  // The watch starts before that sample, so the sequence it records spans the
  // sample, the tap and everything after it up to `readTakeWatch`.
  await watchTake(page);
  const beforeToggle = await elapsedSeconds(page);
  await menu.getByRole("button", { name: /light screen/i }).click();

  // The screen repaints, in the shipped cascade, mid-capture.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);

  // The recorder is still in its recording state: the transport still offers
  // Stop, and the elapsed readout has moved past the reading taken at the tap.
  // A toggle that CANCELLED the take fails one of these two. A take that
  // RESTARTED passes both, since it climbs back past the sample, so the
  // checks after them are about identity (#861): the readout is still the
  // element the watch started on, and across the whole watched window it
  // never went down. It does not follow that audio is still arriving — that
  // readout is a wall clock, not a signal off the stream (see the docblock).
  await expect(stop).toBeVisible();
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(beforeToggle);
  const watched = await readTakeWatch(page);
  // Identity of the element first: a replaced readout stops reporting to the
  // watch, so every check after this one would be reading a dead node.
  expect(watched.sameReadout, "the readout was remounted").toBe(true);
  // The first and last readings are pushed whether or not the observer ever
  // fired; a third one exists only if it saw a change. Without this floor, an
  // observer that saw nothing would hand the order check below two readings
  // and a restart between them would pass.
  expect(watched.readings.length, "the watch saw no change").toBeGreaterThan(2);
  const seconds = watched.readings.map(toSeconds);
  // A restart can only show as a dip from a reading above `00:00`, so the
  // watch must have started off it. The wait before the menu opened put the
  // clock there; a clock back at `00:00` by the time the watch starts was
  // itself reset.
  expect(seconds[0], "the watch started at 00:00").toBeGreaterThan(0);
  expect(seconds, "the readout went down: a restarted clock").toEqual(
    [...seconds].sort((a, b) => a - b)
  );

  // The menu is still up and still offers the way back, so a wrong guess
  // costs one tap in the same place — mid-take as anywhere else.
  await expect(
    menu.getByRole("button", { name: /dark screen/i })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Finally, the take commits: since #614 the tap that ends a recording
  // commits it in place. Record COMING BACK is not that, and asserting only
  // that was this case's one weak link (Frank round 1, #623): the transport's
  // label is `recording ? stop : record`, so it reads Record the moment state
  // leaves `"recording"` and enters `"processing"` — with the write and the
  // view reload still in flight. `Control` gives a busy control `aria-busy`
  // and deliberately NOT the native `disabled` attribute (a busy control must
  // keep focus, #137), so `toBeVisible` and even `toBeEnabled` are both
  // satisfied during that window.
  //
  // So the commit is read off the two things only a LANDED take produces:
  // `aria-busy` gone from the transport, and "Clear and record again"
  // actionable. The bin is always drawn and is hinted-inert while there is
  // nothing to erase, so its hint clearing means `eraseRowReason` found a
  // stored clip in the RELOADED view — which is the persistence this case
  // claims, rather than the label flip that precedes it.
  await stop.click();
  const record = page.getByRole("button", { name: "Record", exact: true });
  await expect(record).toBeVisible();
  await expect(record).not.toHaveAttribute("aria-busy", "true");
  // Matched on the name PREFIX, because a hinted control appends its reason to
  // its accessible name — so the assertion below is about the inert state
  // itself and not about which wording the hint happens to carry.
  const rerecord = page.getByRole("button", {
    name: /^Clear and record again/,
  });
  await expect(rerecord).not.toHaveAttribute("aria-disabled", "true");
  // Still light after the commit — the theme outlived the take it spanned.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
