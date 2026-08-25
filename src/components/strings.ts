/**
 * Every visible and accessible string these screens show, in one flat table.
 *
 * On a screen built for people who may not read, the `aria-label` is not a
 * courtesy — it is the entire text layer a screen reader speaks and the only
 * place a future spoken-prompt layer can attach. Routing every string through
 * one record keeps that layer attachable and keeps wording out of the markup,
 * where it would otherwise be edited in a dozen places. This is a table, not a
 * provider: parameterised labels are small pure functions, nothing more.
 */
export const strings = {
  // ── Books screen (B2) ────────────────────────────────────────────────────
  newBook: "New book",
  menuOpen: "Open menu",
  menuTitle: "Menu",
  menuClose: "Close menu",
  booksEmpty: "No books yet",
  booksEmptyHint: "Tap the plus to start a book",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    `${name}, ${chapters} ${chapters === 1 ? "chapter" : "chapters"}, ${
      expanded ? "expanded" : "collapsed"
    }`,
  addChapter: (bookName: string): string => `Add chapter to ${bookName}`,
  openChapter: (n: number): string => `Open chapter ${n}`,
  chapterName: (n: number): string => `Chapter ${n}`,

  // ── Segments screen (B3) ─────────────────────────────────────────────────
  backToBooks: "Back to books",
  addSegment: "Add segment",
  saving: "Saving your recording.",
  segmentsEmptyHint: "Tap the plus to add a segment",
  playSegment: (n: number): string => `Play segment ${n}`,
  pauseSegment: (n: number): string => `Pause segment ${n}`,
  recordSegment: (n: number): string => `Record segment ${n}`,
  scrubSegment: (n: number): string => `Position in segment ${n}`,
  markFinished: (n: number): string => `Mark segment ${n} finished`,
  markUnfinished: (n: number): string => `Mark segment ${n} not finished`,
  segmentNoRecording: (n: number): string =>
    `Segment ${n} has no recording yet`,

  // ── Recorder sheet (B4) ──────────────────────────────────────────────────
  closeRecorder: "Close recorder",
  recorderBreadcrumb: (
    book: string,
    chapter: number,
    segment: number
  ): string => `${book} > ${strings.chapterName(chapter)} > ${segment}`,
  record: "Record",
  pause: "Pause",
  resume: "Resume",
  zoomWhole: "Zoom: whole segment",
  zoomQuarter: "Zoom: quarter view",
  micNeededTitle: "Microphone access is needed to record",
  micRetry: "Try again",
  micBack: "Go back",
} as const;
