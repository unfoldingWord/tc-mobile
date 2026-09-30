import { expect, test, type Locator, type Page } from "@playwright/test";

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
    const buttons = [...el.querySelectorAll("button")].filter(
      (b) => !b.contains(row)
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
  // The breadcrumb's spoken name names the chapter.
  await expect(
    segmentsHead.getByRole("button", { name: `${book} > ${chapter}` })
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
