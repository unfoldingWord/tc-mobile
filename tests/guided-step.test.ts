import { describe, expect, it } from "vitest";

import { guidedStep, type GuideView } from "@/components/guided-step";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * The guided chain (#604), as a table.
 *
 * ONE accent marks the next required action, and it MOVES: a first-time
 * facilitator at the training follows the workflow without being told what to
 * tap. The property that makes it wayfinding rather than decoration is that it
 * never lingers — every state below names at most one target, and a state where
 * the work has started names none.
 *
 * This is the whole decision. The screens ask this function and paint a class;
 * nothing else in the app decides where the ring goes, which is why the
 * stopping condition can be read in one place.
 */
const bookId = (n: number) => `book-${n}` as BookId;
const chapterId = (n: number) => `chapter-${n}` as ChapterId;

const chapter = (n: number, totalCount = 0): ChapterRow => ({
  chapterId: chapterId(n),
  number: n,
  name: null,
  finishedCount: 0,
  totalCount,
});

const book = (n: number, chapters: readonly ChapterRow[] = []): BookCard => ({
  bookId: bookId(n),
  name: `Book ${n}`,
  chapters,
});

const books = (
  view: Partial<Extract<GuideView, { screen: "books" }>> = {}
): GuideView => ({
  screen: "books",
  loaded: true,
  naming: false,
  books: [],
  ...view,
});

describe("the Books screen's link in the chain (#604)", () => {
  it("guides nothing while the shelf is still being read", () => {
    // An empty shelf and an unread one look the same in `books`, and the empty
    // one is the loudest step in the chain — so a ring on New Book during the
    // first read would flash on every launch, including the ones that have
    // books.
    expect(guidedStep(books({ loaded: false }))).toBeNull();
  });

  it("step 1: an empty shelf guides New Book", () => {
    expect(guidedStep(books())).toEqual({ kind: "new-book" });
  });

  it("step 2: with the naming dialog open, the guide leads into it", () => {
    // The field arrives pre-filled with the placeholder (#314), so Confirm
    // alone is a complete create — the field is optional and the commit is the
    // next REQUIRED action, which is what this marks.
    expect(guidedStep(books({ naming: true }))).toEqual({
      kind: "create-book",
    });
  });

  it("step 3: a book with no chapters guides that book's Add chapter", () => {
    expect(guidedStep(books({ books: [book(1)] }))).toEqual({
      kind: "add-chapter",
      bookId: bookId(1),
    });
  });

  it("step 4: once a chapter exists the guide moves to the first chapter row", () => {
    // MOVES — the `+` that was the target one tap ago must not still be wearing
    // the accent, which is the failure the issue names.
    const step = guidedStep(books({ books: [book(1, [chapter(1)])] }));
    expect(step).toEqual({ kind: "open-chapter", chapterId: chapterId(1) });
  });

  it("names the FIRST chapter, not whichever one is empty", () => {
    const step = guidedStep(
      books({ books: [book(1, [chapter(1), chapter(2)])] })
    );
    expect(step).toEqual({ kind: "open-chapter", chapterId: chapterId(1) });
  });

  it("stops once any chapter holds segments — the work has started", () => {
    // The shelf's view model carries segment COUNTS and no take information
    // (`types/view.ts`), and the guide adds no storage read of its own, so
    // "this book has been worked in" is the strongest honest reading available
    // here. It is the Books half of the terminal rule.
    expect(guidedStep(books({ books: [book(1, [chapter(1, 3)])] }))).toBeNull();
  });

  it("stops entirely once there is more than one book", () => {
    // The chain is first run → first recording. A second book is a person who
    // has already done this once.
    expect(guidedStep(books({ books: [book(1), book(2)] }))).toBeNull();
    expect(
      guidedStep(books({ books: [book(1), book(2)], naming: true }))
    ).toBeNull();
  });

  it("marks at most one control on the shelf, in every state it can be in", () => {
    // The wiring the screen does, in one place: four call sites read this one
    // answer, so two of them can only light up together if this function starts
    // returning something a kind comparison cannot tell apart.
    const states = [
      books({ loaded: false }),
      books(),
      books({ naming: true }),
      books({ books: [book(1)] }),
      books({ books: [book(1)], naming: true }),
      books({ books: [book(1, [chapter(1)])] }),
      books({ books: [book(1, [chapter(1, 2)])] }),
      books({ books: [book(1), book(2)] }),
    ];
    for (const state of states) {
      const step = guidedStep(state);
      const marks = [
        step?.kind === "new-book",
        step?.kind === "create-book",
        step?.kind === "add-chapter",
        step?.kind === "open-chapter",
      ].filter(Boolean);
      expect(marks.length, JSON.stringify(state)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the Segments screen's link in the chain (#604)", () => {
  const segments = (loaded: boolean, segmentCount: number): GuideView => ({
    screen: "segments",
    loaded,
    segmentCount,
  });

  it("guides nothing while the chapter is still being read", () => {
    expect(guidedStep(segments(false, 0))).toBeNull();
  });

  it("steps 5 and 6: an empty chapter guides Add segment", () => {
    expect(guidedStep(segments(true, 0))).toEqual({ kind: "add-segment" });
  });

  it("stops once a segment exists", () => {
    expect(guidedStep(segments(true, 1))).toBeNull();
  });
});

describe("the recorder's link in the chain (#604)", () => {
  const recorder = (loaded: boolean, hasAudio: boolean): GuideView => ({
    screen: "recorder",
    loaded,
    hasAudio,
  });

  it("guides nothing until the segment has loaded", () => {
    // Record is disabled until then (`recordDisabled`'s `hasView`), and a ring
    // on a dead control is worse than no ring.
    expect(guidedStep(recorder(false, false))).toBeNull();
  });

  it("steps 7 and 8: a segment with no audio guides Record, and keeps it there through the take", () => {
    // One input covers both steps because a take is spliced into the working
    // buffer only on close (Model A, commit-on-close — `recorder.tsx`'s
    // `onPlayButton` docblock), so `hasAudio` is still false while the take is
    // in flight and the ring does not blink out the moment Record is tapped.
    expect(guidedStep(recorder(true, false))).toEqual({ kind: "record" });
  });

  it("stops once the segment has audio — the guide ends at the first recording", () => {
    // The terminal state. Re-opening a recorded segment is not the first run,
    // and the per-segment Finished switch is not a REQUIRED step, so nothing
    // downstream of the first take is marked.
    expect(guidedStep(recorder(true, true))).toBeNull();
  });
});
