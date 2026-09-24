import { describe, expect, it } from "vitest";

import {
  guidedRecordShown,
  guidedStep,
  type GuideView,
} from "@/components/guided-step";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow, SegmentRow } from "@/types/view";

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
  recordedCount: 0,
});

const segment = (n: number, hasClip = false): SegmentRow => ({
  segmentId: `segment-${n}` as SegmentRow["segmentId"],
  ordinal: n,
  label: null,
  hasClip,
  finished: false,
  clipId: null,
  peaks: null,
  durationMs: null,
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
  namingChapter: false,
  books: [],
  // Expanded by default, because that is the state a book is in the moment it
  // is created and the moment a chapter is added to it (`books-screen.tsx`
  // adds the id to the set on both). The collapsed branch is asked for by
  // name below.
  expandedBooks: new Set([bookId(1)]),
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

  it("with the chapter dialog open on the empty book, the guide leads into it", () => {
    // Same shape as step 2: the field arrives pre-filled with "Chapter N"
    // (#609), and the shelf is inert behind the dialog, so Add chapter
    // could not show a ring there anyway.
    expect(
      guidedStep(books({ books: [book(1)], namingChapter: true }))
    ).toEqual({ kind: "create-chapter" });
  });

  it("guides nothing in the chapter dialog once the book has a chapter", () => {
    expect(
      guidedStep(books({ books: [book(1, [chapter(1)])], namingChapter: true }))
    ).toBeNull();
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

  it("guides the book open when the chapter it wants is not rendered", () => {
    // The shelf is a remounting screen: coming Back from Segments, or
    // reloading, resets `expanded`, and a collapsed book renders no chapter
    // rows at all. Pointing at one would be pointing at nothing, so the step
    // before it — open the book — becomes the required action.
    const step = guidedStep(
      books({ books: [book(1, [chapter(1)])], expandedBooks: new Set() })
    );
    expect(step).toEqual({ kind: "expand-book", bookId: bookId(1) });
  });

  it("still guides Add chapter on a collapsed book — that + is on the row", () => {
    // The `+` lives on the book row beside the toggle, not inside the list the
    // toggle opens, so a collapsed book does not hide it and this step needs no
    // expansion.
    expect(
      guidedStep(books({ books: [book(1)], expandedBooks: new Set() }))
    ).toEqual({ kind: "add-chapter", bookId: bookId(1) });
  });

  it("stops on a collapsed book that has been worked in — the stop comes first", () => {
    // Terminal rule unchanged: expansion is about whether the TARGET is on
    // screen, and it is only asked once there is still a step to point at.
    expect(
      guidedStep(
        books({ books: [book(1, [chapter(1, 2)])], expandedBooks: new Set() })
      )
    ).toBeNull();
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
    // The wiring the screen does, in one place: its call sites read this one
    // answer, so two of them can only light up together if this function starts
    // returning something a kind comparison cannot tell apart.
    const states = [
      books({ loaded: false }),
      books(),
      books({ naming: true }),
      books({ books: [book(1)] }),
      books({ books: [book(1)], naming: true }),
      books({ books: [book(1)], namingChapter: true }),
      books({ books: [book(1, [chapter(1)])], namingChapter: true }),
      books({ books: [book(1, [chapter(1)])] }),
      books({ books: [book(1, [chapter(1)])], expandedBooks: new Set() }),
      books({ books: [book(1, [chapter(1, 2)])] }),
      books({ books: [book(1), book(2)] }),
    ];
    for (const state of states) {
      const step = guidedStep(state);
      const marks = [
        step?.kind === "new-book",
        step?.kind === "create-book",
        step?.kind === "add-chapter",
        step?.kind === "create-chapter",
        step?.kind === "expand-book",
        step?.kind === "open-chapter",
      ].filter(Boolean);
      expect(marks.length, JSON.stringify(state)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the Segments screen's link in the chain (#604)", () => {
  const segments = (
    loaded: boolean,
    rows: readonly SegmentRow[]
  ): GuideView => ({ screen: "segments", loaded, segments: rows });

  it("guides nothing while the chapter is still being read", () => {
    expect(guidedStep(segments(false, []))).toBeNull();
  });

  it("steps 5 and 6: an empty chapter guides Add segment", () => {
    expect(guidedStep(segments(true, []))).toEqual({ kind: "add-segment" });
  });

  it("hands the chain on to the row that opens the recorder", () => {
    // The hop the issue's own list skips: a segment exists, nothing has been
    // recorded into it, and the next required action is the row's red Record —
    // the only door to the recorder. Without this the guide goes dark exactly
    // where a first-time user has never been.
    expect(guidedStep(segments(true, [segment(1)]))).toEqual({
      kind: "open-segment",
      segmentId: segment(1).segmentId,
    });
  });

  it("names the FIRST segment with no take, not the last row added", () => {
    expect(guidedStep(segments(true, [segment(1), segment(2)]))).toEqual({
      kind: "open-segment",
      segmentId: segment(1).segmentId,
    });
  });

  it("stops once any segment has audio — the terminal rule, on this screen", () => {
    // `hasClip`, not `activeTakeId`: a dangling or undecodable clip reads as
    // never-recorded everywhere else in this screen (F3 in `types/view.ts`),
    // and the guide agrees with the row rather than with the database.
    expect(guidedStep(segments(true, [segment(1, true)]))).toBeNull();
    expect(
      guidedStep(segments(true, [segment(1, true), segment(2)]))
    ).toBeNull();
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
    // Before the first take is decoded and spliced, hasAudio remains false.
    expect(guidedStep(recorder(true, false))).toEqual({ kind: "record" });
  });

  it("stops once the segment has audio — the guide ends at the first recording", () => {
    // The terminal state. Re-opening a recorded segment is not the first run,
    // and the per-segment Finished switch is not a REQUIRED step, so nothing
    // downstream of the first take is marked.
    expect(guidedStep(recorder(true, true))).toBeNull();
  });
});

describe("the Record ring's own gate (#604 step 8)", () => {
  // The chain says WHICH control; this says whether the recorder is in a state
  // where showing the ring is honest. It is its own table because the two
  // answers come apart: the step stays `record` for the whole of a first take,
  // while the button underneath goes inert twice on the way — once while
  // `getUserMedia` is in flight, once while the take is being processed.
  const shown = (over: Partial<Parameters<typeof guidedRecordShown>[0]> = {}) =>
    guidedRecordShown({
      step: { kind: "record" },
      takeInFlight: false,
      isClosing: false,
      recordInert: false,
      ...over,
    });

  it("is off whenever the step is not Record", () => {
    expect(shown({ step: null })).toBe(false);
    expect(shown({ step: { kind: "add-segment" } })).toBe(false);
  });

  it("is on at idle, when the control is live", () => {
    expect(shown()).toBe(true);
  });

  it("STAYS on through the take, including the two states that inert the button", () => {
    // The defect this table exists for: `requesting` (permission in flight)
    // and `processing` (the take being sealed) both disable Record, so a gate
    // keyed on the button's own inertness blinked the ring off at the tap and
    // again at the end — step 8 says it stays.
    expect(shown({ takeInFlight: true, recordInert: true })).toBe(true);
  });

  it("is off while the sheet is closing — the one lasting reason", () => {
    expect(shown({ takeInFlight: true, isClosing: true })).toBe(false);
    expect(shown({ isClosing: true })).toBe(false);
  });

  it("is off for an idle control that is refusing taps", () => {
    // A sounding preview or a finger on the stage: no take is in flight, the
    // button will not answer, and pointing at it would be the guide asking for
    // something the app is declining.
    expect(shown({ recordInert: true })).toBe(false);
  });
});
