import { existsSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { clickEditRecording } from "./recorder-fixtures";

/**
 * File-wide, because Playwright allows `launchOptions` only at the top level:
 * the held-cut case at the foot of this file records through Chromium's fake
 * microphone (the same flags `recorder-selection.spec.ts` uses). The layout
 * cases above it neither record nor ask for the microphone, so the flags
 * change nothing they measure.
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
 * The new-look (O4) chapter-screen and recorder headers with the chapter's
 * NAME in the chapter crumb, against the shipped `dist/` build (#1230).
 *
 * The requirements owner's decision on #1230: the headers show the chapter's
 * name (typed, or the default "Chapter N"), elided with "…" when it is too
 * long for the chip. jsdom computes no boxes, so this is the layout half of
 * `tests/o4-header-crumbs.test.ts` (which name each header passes) and
 * `tests/o4-crumbs-chapter-name.test.ts` (the declarations). At each phone
 * width it checks that the crumbs stay inside the header and push no control
 * off the screen, that a long name elides instead of wrapping or overflowing,
 * and the sharing rule `o4/menus.css` states: the book and chapter crumbs get
 * equal text room, and a name that fits in less than its share keeps its
 * whole width and hands the rest to the other.
 */

/** Opt into the O4 look before the app boots (`lib/design.ts`'s key). */
async function optIntoO4(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("tc-mobile.design", "o4");
  });
}

async function createBook(page: Page, name: string) {
  await page.getByRole("button", { name: "New book" }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new book" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Book name" }).fill(name);
  await page.getByRole("button", { name: "Create book", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function createChapter(page: Page, name: string) {
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  const sheet = page.getByRole("dialog", { name: "Name your new chapter" });
  await expect(sheet).toBeVisible();
  await page.getByRole("textbox", { name: "Chapter name" }).fill(name);
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
}

interface Crumb {
  text: string;
  /** The text box's own width, the room the crumb gave its text. */
  room: number;
  /** The text's full width, had it not been cut. */
  natural: number;
  elided: boolean;
  /** The text's computed `direction`: from its content when it carries dir="auto". */
  direction: string;
}

interface Measured {
  viewport: number;
  pageScrollWidth: number;
  crumbs: Crumb[];
  crumbsRight: number;
  /** Every other button in the header: left and right edges. */
  controls: { left: number; right: number }[];
  /** The left edge of the first control after the crumbs. */
  nextLeft: number;
}

async function measure(head: Locator): Promise<Measured> {
  return head.evaluate((el) => {
    const row = el.querySelector(".o4-crumbs")!;
    const rowBox = row.getBoundingClientRect();
    const chips = [...row.querySelectorAll(".o4-crumb")];
    // The header's other controls: not the crumbs, which are buttons
    // themselves where they navigate (#1269).
    const buttons = [...el.querySelectorAll("button")].filter(
      (b) => !b.contains(row) && !row.contains(b)
    );
    const after = buttons.filter(
      (b) => b.getBoundingClientRect().left >= rowBox.left
    );
    return {
      viewport: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      crumbs: chips.map((crumb) => {
        const text = crumb.querySelector("span")!;
        return {
          text: text.textContent ?? "",
          room: text.getBoundingClientRect().width,
          natural: text.scrollWidth,
          elided: text.scrollWidth > text.clientWidth,
          direction: getComputedStyle(text).direction,
        };
      }),
      crumbsRight: Math.max(
        ...chips.map((c) => c.getBoundingClientRect().right)
      ),
      controls: buttons.map((b) => {
        const box = b.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
      nextLeft: Math.min(...after.map((b) => b.getBoundingClientRect().left)),
    };
  });
}

/**
 * Nothing leaves the screen, the crumbs stop before the next control, and
 * the book and chapter crumbs follow the sharing rule.
 */
function expectFits(m: Measured) {
  expect(m.pageScrollWidth).toBeLessThanOrEqual(m.viewport);
  for (const c of m.controls) {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.right).toBeLessThanOrEqual(m.viewport + 0.5);
  }
  expect(m.crumbsRight).toBeLessThanOrEqual(m.nextLeft + 0.5);

  const book = m.crumbs[0]!;
  const chapter = m.crumbs[1]!;
  // A crumb is never cut below an equal share: two cut crumbs have the same
  // room, and a cut crumb beside a whole one has at least the whole one's.
  const pairs: [Crumb, Crumb][] = [
    [book, chapter],
    [chapter, book],
  ];
  for (const [cut, other] of pairs) {
    if (!cut.elided) continue;
    if (other.elided) expect(Math.abs(other.room - cut.room)).toBeLessThan(1.5);
    else expect(cut.room).toBeGreaterThanOrEqual(other.room - 1.5);
  }
  // So a crumb whose text fits in the room the other was given is never cut.
  if (chapter.natural <= book.room - 1) expect(chapter.elided).toBe(false);
  if (book.natural <= chapter.room - 1) expect(book.elided).toBe(false);
}

const LONG_BOOK = "The Gospel According to Saint Matthew";
const LONG_CHAPTER = "The parable of the sower and the seed";

interface MenuHead {
  crumbs: { text: string; elided: boolean }[];
  /** The screen-reader-only line naming the place. */
  place: string;
  /** Every crumb ends inside the panel, and the page does not scroll sideways. */
  fits: boolean;
}

/** Opens a menu by its opener's name, reads its sheet head, and closes it. */
async function menuHead(page: Page, opener: string): Promise<MenuHead> {
  await page.getByRole("button", { name: opener, exact: true }).click();
  const panel = page.locator(".menu-panel");
  await expect(panel.locator(".o4-sheet-head")).toBeVisible();
  const head = await panel.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const chips = [...el.querySelectorAll(".o4-sheet-head .o4-crumb")];
    return {
      crumbs: chips.map((crumb) => {
        const text = crumb.querySelector("span")!;
        return {
          text: text.textContent ?? "",
          elided: text.scrollWidth > text.clientWidth,
        };
      }),
      place: el.querySelector(".o4-sheet-place")?.textContent ?? "",
      fits:
        chips.every(
          (c) => c.getBoundingClientRect().right <= box.right + 0.5
        ) && document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  return head;
}

/** A menu's head names the book and chapter exactly as its header does. */
function expectMenuMatches(menu: MenuHead, header: Measured, place: string) {
  expect(menu.fits).toBe(true);
  expect(menu.crumbs.slice(0, 2).map((c) => c.text)).toEqual(
    header.crumbs.slice(0, 2).map((c) => c.text)
  );
  expect(menu.place).toBe(place);
  // A name longer than any phone's row elides here too, with the same "…".
  for (const crumb of menu.crumbs) {
    if (crumb.text === LONG_BOOK || crumb.text === LONG_CHAPTER) {
      expect(crumb.elided).toBe(true);
    }
  }
}

/**
 * Books -> the named chapter (with one segment, so the header's + shows, the
 * common case) -> that segment's recorder; measures both headers, and the
 * sheet heads of the chapter menu, the segment's row menu and the recorder's
 * ⋮ menu (the DRI's "Names in menus too" pick on #1263).
 */
async function walk(page: Page, width: number, book: string, chapter: string) {
  await page.setViewportSize({ width, height: 800 });
  await optIntoO4(page);
  await page.goto("/");
  await createBook(page, book);
  await createChapter(page, chapter);
  await page.getByRole("button", { name: `Open ${chapter}` }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Open recorder for segment 1" })
  ).toBeVisible();
  const segmentsHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Back to books" }),
  });
  // The book crumb is a button named for where it goes (#1269).
  await expect(
    segmentsHead.getByRole("button", { name: `Go to book ${book}` })
  ).toBeVisible();
  const segments = await measure(segmentsHead);
  expectMenuMatches(
    await menuHead(page, "More actions for this chapter"),
    segments,
    `${book} > ${chapter}`
  );
  expectMenuMatches(
    await menuHead(page, "More actions for segment 1"),
    segments,
    `${book} > ${chapter} > 1`
  );

  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
  const recorderHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Close recorder" }),
  });
  await expect(recorderHead).toBeVisible();
  const recorder = await measure(recorderHead);
  expectMenuMatches(
    await menuHead(page, "More actions"),
    recorder,
    `${book} > ${chapter} > 1`
  );
  return { segments, recorder };
}

for (const width of [320, 360, 412]) {
  test(`O4 headers at ${width}px: a long book and a long chapter name split the row and elide (#1230)`, async ({
    page,
  }) => {
    const { segments, recorder } = await walk(
      page,
      width,
      LONG_BOOK,
      LONG_CHAPTER
    );
    expectFits(segments);
    expect(segments.crumbs.map((c) => [c.text, c.elided])).toEqual([
      [LONG_BOOK, true],
      [LONG_CHAPTER, true],
    ]);
    expectFits(recorder);
    expect(recorder.crumbs.map((c) => [c.text, c.elided])).toEqual([
      [LONG_BOOK, true],
      [LONG_CHAPTER, true],
      ["1", false],
    ]);
  });

  test(`O4 headers at ${width}px: the default chapter name beside a long book name (#1230)`, async ({
    page,
  }) => {
    const { segments, recorder } = await walk(
      page,
      width,
      LONG_BOOK,
      "Chapter 1"
    );
    expectFits(segments);
    expect(segments.crumbs.map((c) => c.text)).toEqual([
      LONG_BOOK,
      "Chapter 1",
    ]);
    expectFits(recorder);
    expect(recorder.crumbs.map((c) => c.text)).toEqual([
      LONG_BOOK,
      "Chapter 1",
      "1",
    ]);
  });

  test(`O4 headers at ${width}px: a long chapter name beside a short book name (#1230)`, async ({
    page,
  }) => {
    const { segments, recorder } = await walk(page, width, "Job", LONG_CHAPTER);
    expectFits(segments);
    expectFits(recorder);
    // The short name is whole in both headers; the long one takes the rest.
    expect(segments.crumbs.map((c) => [c.text, c.elided])).toEqual([
      ["Job", false],
      [LONG_CHAPTER, true],
    ]);
    expect(recorder.crumbs.map((c) => [c.text, c.elided])).toEqual([
      ["Job", false],
      [LONG_CHAPTER, true],
      ["1", false],
    ]);
  });
}

// Right-to-left names (#1267), each long enough to be cut at 320px and ending
// in a period, as the tester's report did.
const RTL_BOOK = "ספר בראשית וסיפורי האבות הקדושים.";
const RTL_CHAPTER = "مثل الزارع والبذرة الطيبة في الحقل.";

for (const width of [320, 360, 412]) {
  test(`O4 headers at ${width}px: right-to-left names take their own direction, elide and still fit (#1267)`, async ({
    page,
  }) => {
    const { segments, recorder } = await walk(
      page,
      width,
      RTL_BOOK,
      RTL_CHAPTER
    );
    for (const header of [segments, recorder]) {
      expectFits(header);
      // The two name chips read right-to-left from their own text, and are
      // cut ("…") instead of overflowing; the segment number stays with the
      // app's direction.
      expect(header.crumbs.slice(0, 2).map((c) => c.direction)).toEqual([
        "rtl",
        "rtl",
      ]);
      expect(header.crumbs.slice(0, 2).map((c) => c.elided)).toEqual([
        true,
        true,
      ]);
    }
    expect(recorder.crumbs[2]!.direction).toBe("ltr");
  });
}

/**
 * #1269, the requirements owner: "Yes, make the header crumbs tappable for
 * navigation". Each crumb above the current screen lands where the header's
 * Back lands: the recorder's chapter crumb on that chapter's segment list,
 * the chapter screen's book crumb on the Books shelf. The layout tests above
 * run with those crumbs as buttons, so they are the fit check at 320, 360
 * and 412 px; this one taps them at 360 px.
 */
test("O4 headers at 360px: tapping a crumb above the current screen lands there (#1269)", async ({
  page,
}) => {
  const book = "Ruth";
  const chapter = "Naomi returns";
  await walk(page, 360, book, chapter);

  // The recorder is open on segment 1. Its segment crumb is the current
  // place; its chapter crumb goes to the chapter, and its book crumb to
  // Books (#1275) — both control-sized targets, 44px tall, though each
  // chip is drawn 40px.
  const recorderHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Close recorder" }),
  });
  await expect(recorderHead.locator('[aria-current="page"]')).toHaveText("1");
  const chapterCrumb = recorderHead.getByRole("button", {
    name: `Go to ${chapter}`,
    exact: true,
  });
  expect((await chapterCrumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const recorderBookCrumb = recorderHead.getByRole("button", {
    name: `Go to book ${book}`,
    exact: true,
  });
  expect(
    (await recorderBookCrumb.boundingBox())!.height
  ).toBeGreaterThanOrEqual(44);
  await chapterCrumb.click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  const segmentsHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Back to books" }),
  });
  await expect(segmentsHead.locator('[aria-current="page"]')).toHaveText(
    chapter
  );
  await expect(
    page.getByRole("button", { name: "Open recorder for segment 1" })
  ).toBeVisible();

  // The chapter screen's book crumb goes to Books.
  const bookCrumb = segmentsHead.getByRole("button", {
    name: `Go to book ${book}`,
    exact: true,
  });
  expect((await bookCrumb.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The chip is drawn by the button's ::before, with the same height and
  // fill as the plain chapter chip beside it; the button paints nothing.
  // Measured here rather than on the recorder header, whose every crumb
  // above the current one is now a button (#1275), so this is the header
  // with a plain chip to compare against.
  const drawn = await segmentsHead.evaluate((el) => {
    const link = el.querySelector("button.o4-crumb")!;
    const plain = el.querySelector("span.o4-crumb:not([data-state])")!;
    const chip = getComputedStyle(link, "::before");
    return {
      height: chip.height,
      fill: chip.backgroundColor,
      plainHeight: getComputedStyle(plain).height,
      plainFill: getComputedStyle(plain).backgroundColor,
      buttonFill: getComputedStyle(link).backgroundColor,
    };
  });
  expect(drawn.height).toBe(drawn.plainHeight);
  expect(drawn.height).toBe("40px");
  expect(drawn.fill).toBe(drawn.plainFill);
  expect(drawn.buttonFill).toBe("rgba(0, 0, 0, 0)");
  await bookCrumb.click();
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await expect(page.getByText(book, { exact: true })).toBeVisible();
});

/**
 * #1275: the recorder's book crumb goes to Books, two levels up, through the
 * nav adapter's `goBackToBooks` — the recorder's own commit-close for the
 * first level, then the Segments Back the adapter issues itself. The
 * landing is the Books shelf with the book standing, the history entry is
 * the run's root (the same one two Backs would reach), and the stack has
 * grown by nothing: one entry per level, no double pop. The chain's
 * decisions are pinned in `tests/nav-back-to-books.test.ts`; this is the
 * shipped build taking the tap. Idle path only — no microphone, so whether
 * `close()` sealed a take is not observed here (see
 * `e2e/back-navigation.spec.ts` case (b) for the same caveat).
 */
test("O4 headers at 360px: tapping the recorder's book crumb lands on Books in one gesture (#1275)", async ({
  page,
}) => {
  const book = "Ruth";
  const chapter = "Naomi returns";
  await walk(page, 360, book, chapter);

  const recorderHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Close recorder" }),
  });
  const bookCrumb = recorderHead.getByRole("button", {
    name: `Go to book ${book}`,
    exact: true,
  });
  await expect(bookCrumb).toBeEnabled();
  const before = await page.evaluate(() => ({
    length: window.history.length,
    index: (window.history.state as { index?: number } | null)?.index,
  }));
  await bookCrumb.click();

  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await expect(page.getByText(book, { exact: true })).toBeVisible();

  // The root entry: index 0 is what the mount adopt stamps on the app's
  // first entry (Amendment B), and every push above it is gone from under
  // the shelf. The length is unchanged: the close's re-arm replaced the
  // recorder's entry and both pops moved within the stack.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window.history.state as { index?: number } | null)?.index
      )
    )
    .toBe(0);
  expect(before.index).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.history.length)).toBe(before.length);
});

/**
 * #1275, George rounds 1 and 2 on #1300: the two-level Back stops at
 * Segments while the chapter clipboard holds a phrase, because the second
 * level's landing is `backToBooks`, which clears that clipboard (G3) — and
 * after a cut the close has saved, the clipboard is the phrase's only copy.
 * This records a real take through Chromium's fake microphone, cuts the
 * whole span (so the close clears the segment and the phrase lives on the
 * clipboard alone), taps the recorder's book crumb, and expects the chapter
 * screen with its history entry — not Books. The chapter screen's own book
 * crumb, a separate gesture on a screen where the paste was available, still
 * leaves. The pure half (the adapter's gate) is `tests/nav-back-to-books.test.ts`;
 * this is the real recorder, the real App clipboard and the real adapter
 * together, against the shipped build.
 */
test.describe("the recorder's book crumb over a held cut (#1275)", () => {
  test("stops at the chapter screen while the clipboard holds the cut, and the chapter screen's crumb still leaves", async ({
    page,
  }) => {
    const book = "Ruth";
    const chapter = "Naomi returns";
    await walk(page, 360, book, chapter);

    // A take, then a cut of its whole span: the clipboard holds the phrase
    // and the buffer is empty, so the close will clear the segment.
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Record", exact: true })
    ).toBeVisible();
    await clickEditRecording(page);
    const cut = page.getByRole("button", {
      name: "Cut the selection",
      exact: true,
    });
    await expect(cut).toBeEnabled();
    await cut.click();
    await expect(
      page.getByRole("button", { name: "Paste at the line", exact: true })
    ).toBeVisible();

    const recorderHead = page.locator("header").filter({
      has: page.getByRole("button", { name: "Close recorder" }),
    });
    const index = () =>
      page.evaluate(
        () => (window.history.state as { index?: number } | null)?.index
      );
    const atRecorder = (await index())!;
    await recorderHead
      .getByRole("button", { name: `Go to book ${book}`, exact: true })
      .click();

    // The sheet closed (the first level ran), and the gesture ended on the
    // chapter screen: Books' controls are absent, the chapter's entry is the
    // one the stack is on, and the phrase is still pasteable here.
    await expect(
      page.getByRole("button", { name: "Close recorder" })
    ).toHaveCount(0);
    const segmentsHead = page.locator("header").filter({
      has: page.getByRole("button", { name: "Back to books" }),
    });
    await expect(segmentsHead).toBeVisible();
    await expect(page.getByRole("button", { name: "New book" })).toHaveCount(0);
    await expect.poll(index).toBe(atRecorder - 1);

    // The chapter screen's book crumb is the translator's own gesture on the
    // screen where the paste was offered; it leaves as #1269 made it.
    await segmentsHead
      .getByRole("button", { name: `Go to book ${book}`, exact: true })
      .click();
    await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
    await expect(page.getByText(book, { exact: true })).toBeVisible();
  });
});

/**
 * #1275, George round 2 on #1300: a close that awaits a write (`saveEditedSegment`
 * in IndexedDB) resolves after that write, and in Chromium the consuming
 * landing was observed to run BEFORE React had committed the close — the
 * adapter's committed screen still read "recorder" there. The continuation
 * now waits for that commit instead of being dropped, so the crumb still
 * reaches Books. The edit here is a whole-span cut pasted straight back, so
 * the close has an edit to save and the clipboard is empty: nothing holds
 * the gesture at Segments, and only the deferred continuation can take it on.
 */
test("O4 headers at 360px: the recorder's book crumb reaches Books when the close has an edit to save (#1275)", async ({
  page,
}) => {
  const book = "Ruth";
  const chapter = "Naomi returns";
  await walk(page, 360, book, chapter);

  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await clickEditRecording(page);
  const cut = page.getByRole("button", {
    name: "Cut the selection",
    exact: true,
  });
  await expect(cut).toBeEnabled();
  await cut.click();
  const paste = page.getByRole("button", {
    name: "Paste at the line",
    exact: true,
  });
  await expect(paste).toBeVisible();
  await paste.click();
  await expect(paste).toHaveCount(0);

  const recorderHead = page.locator("header").filter({
    has: page.getByRole("button", { name: "Close recorder" }),
  });
  await recorderHead
    .getByRole("button", { name: `Go to book ${book}`, exact: true })
    .click();

  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to books" })).toHaveCount(
    0
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window.history.state as { index?: number } | null)?.index
      )
    )
    .toBe(0);
});
