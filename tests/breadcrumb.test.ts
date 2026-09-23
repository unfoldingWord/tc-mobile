import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { strings } from "@/components/strings";
import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import {
  addChapter,
  addSegment,
  createBook,
  renameChapter,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * One breadcrumb, built in the table, and a chapter heading that does not
 * carry a second copy of the default name (#169).
 *
 * #169's fix shape asks for "no concatenation of translated fragments" and for
 * every visible string to live in the table. The trail a translator reads at
 * the top of the Segments screen and at the top of the recorder was neither:
 * the Segments screen assembled it in JSX with its own separator, the recorder
 * assembled a second one in the table with a different spelling of the same
 * separator, and `chapterHeading` typed out the default chapter name a second
 * time rather than calling `chapterName` — the duplicate-not-alias shape this
 * table has already been bitten by twice (`shareBookPartial`,
 * `menuOpenWithFailures`).
 *
 * The user-visible half of that last point is the one worth stating plainly:
 * the recorder's trail took a chapter NUMBER, so a chapter the facilitator had
 * renamed (#264) showed its label on the Segments screen and the default name
 * one tap deeper, on the surface a translator spends the session inside.
 *
 * WHY SOME ASSERTIONS READ SOURCE. A duplicate and an alias produce identical
 * output today, so no call of these functions can tell them apart — that is
 * what makes the duplicate survive. The only observation that separates them
 * is the text of the module, so the anti-duplicate and wiring checks below
 * read it, with comments stripped first: both files now name these functions
 * in prose in order to explain them, and a comment capturing a test that reads
 * its file whole is a defect this repo has already shipped once (#529 round 3,
 * AGENTS.md). Each source slice carries a non-emptiness floor for the same
 * reason.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = (rel: string): string =>
  stripComments(readFileSync(path.join(ROOT, rel), "utf8"));

/**
 * The same source with every run of whitespace collapsed to one space.
 *
 * For the one assertion below that reads a WINDOW of characters after a call.
 * Stripping a comment leaves its indentation behind as blank lines, so a
 * character window over the stripped text measures how much prose sat inside
 * the call rather than how much code — and it goes red when a comment grows,
 * which is not what it claims to catch. It did exactly that once here. The
 * tempting repair is a bigger number, which weakens the guard until it can no
 * longer tell an argument from a distant neighbour; collapsing first makes the
 * window mean what it says.
 */
const compactSource = (rel: string): string => source(rel).replace(/\s+/g, " ");

describe("the trail is built in one place", () => {
  it("joins a book and a chapter heading", () => {
    expect(strings.chapterBreadcrumb("Ruth", "Chapter 1")).toBe(
      "Ruth > Chapter 1"
    );
  });

  it("takes the chapter's HEADING, so a renamed chapter keeps its label", () => {
    // The defect: the recorder took a number and spelled the default name
    // itself, so this trail read "Ruth > Chapter 3 > 2" on a chapter the
    // facilitator had already renamed.
    expect(
      strings.recorderBreadcrumb(
        "Ruth",
        strings.chapterHeading("The Lost Sheep", 3),
        2,
        null
      )
    ).toBe("Ruth > The Lost Sheep > 2");
  });

  it("falls back to the default chapter name when nothing was typed", () => {
    expect(
      strings.recorderBreadcrumb(
        "Ruth",
        strings.chapterHeading(null, 3),
        2,
        null
      )
    ).toBe(`Ruth > ${strings.chapterName(3)} > 2`);
  });

  it("the two trails agree on the part they share", () => {
    // Two screens, one trail: the recorder's is the Segments screen's with the
    // segment appended, and nothing about the order or the separator is
    // decided twice.
    const chapter = strings.chapterBreadcrumb("Ruth", "Chapter 1");
    const segment = strings.recorderBreadcrumb("Ruth", "Chapter 1", 2, null);
    expect(segment.startsWith(chapter)).toBe(true);
  });

  it("passes a part containing the separator through, on both screens alike", () => {
    // Names are free text (#264/#314), so a facilitator can type the separator
    // into one. The trail does NOT escape or strip it: the parts go through as
    // typed, and a reader of "Ruth > Mark > Luke" cannot tell which `>` is the
    // trail's. That is a deliberate no-op rather than an oversight — silently
    // rewriting a name the facilitator chose is the worse of the two, and the
    // ambiguity is already reachable through the BOOK name, which has been
    // free text and joined into this trail on both screens all along.
    //
    // What this pins is the half that IS this change's business: the two
    // screens agree on the awkward input as well as the ordinary one, so the
    // recorder cannot start rendering a typed name differently from the
    // Segments header one tap up. Escaping either side would kill it.
    const heading = strings.chapterHeading("Mark > Luke", 3);
    const chapter = strings.chapterBreadcrumb("Ruth", heading);
    const segment = strings.recorderBreadcrumb("Ruth", heading, 2, null);

    expect(chapter).toBe("Ruth > Mark > Luke");
    expect(segment).toBe("Ruth > Mark > Luke > 2");
    expect(segment.startsWith(chapter)).toBe(true);
  });
});

describe("the default chapter name is written once", () => {
  it("chapterHeading falls back to chapterName rather than repeating it", () => {
    expect(strings.chapterHeading(null, 7)).toBe(strings.chapterName(7));
  });

  it("only one entry in the table spells the default name", () => {
    // The assertion above passes on a COPY too — that is exactly why the copy
    // survived. This is the one that does not: restore the duplicate and the
    // count goes to two.
    const table = source("src/components/strings.ts");
    expect(table.length, "no strings table to read").toBeGreaterThan(1000);
    expect(table.match(/`Chapter \$\{/g) ?? []).toHaveLength(1);
  });
});

describe("both screens read the table", () => {
  it("the Segments header calls the table instead of assembling JSX", () => {
    const screen = source("src/components/segments-screen.tsx");
    expect(screen.length, "no Segments screen to read").toBeGreaterThan(1000);
    expect(screen).toContain("strings.chapterBreadcrumb(");
    // The separator that used to live in the markup. It appears nowhere else
    // in `src/components`, so its absence here is the whole claim.
    expect(screen).not.toContain("&gt;");
  });

  it("the recorder header resolves the heading before it builds the trail", () => {
    const sheet = compactSource("src/components/recorder.tsx");
    expect(sheet.length, "no recorder to read").toBeGreaterThan(1000);
    // The index is what gets the floor, NOT the slice's length. `indexOf`
    // returns -1 when the call is absent and `slice(-1)` is the last character
    // of the file — length 1, so a length floor passes on a recorder that never
    // calls this at all (George, #698). A floor that cannot fail on the state
    // it names is the vacuous-assertion shape AGENTS.md keeps catching, and
    // this one was an instance of it.
    const at = sheet.indexOf("strings.recorderBreadcrumb(");
    expect(at, "recorderBreadcrumb is not called").toBeGreaterThanOrEqual(0);
    const call = sheet.slice(at, at + 200);
    // Inside this call's own arguments, not merely somewhere later in the file.
    expect(call).toContain("strings.chapterHeading(");
    // The segment half stays the entry's business (#591): the caller hands it
    // the raw label and `segmentHeading` inside the table resolves it, exactly
    // as `chapterHeading` resolves the chapter half out here.
    expect(call).toContain("view.segmentLabel");
  });
});

describe("the recorder's view carries the chapter's name", () => {
  beforeEach(async () => {
    // Clear every store rather than deleting the database: `deleteDatabase`
    // blocks while any connection is open (AGENTS.md).
    await closeDb();
    const db = await getDb();
    const stores = Array.from(db.objectStoreNames);
    const tx = db.transaction(stores, "readwrite");
    await Promise.all([
      ...stores.map((s) => tx.objectStore(s).clear()),
      tx.done,
    ]);
  });

  it("is null on a chapter nobody has renamed", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    const view = await loadRecorderSegmentView(segment.id);

    expect(view.chapterName).toBeNull();
    // The number is still carried: it is what the fallback name is built from.
    expect(view.chapterNumber).toBe(1);
  });

  it("is the facilitator's label once the chapter is renamed", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    await renameChapter(chapter.id, "The Lost Sheep");

    const view = await loadRecorderSegmentView(segment.id);

    expect(view.chapterName).toBe("The Lost Sheep");
    expect(strings.chapterHeading(view.chapterName, view.chapterNumber)).toBe(
      "The Lost Sheep"
    );
  });
});
