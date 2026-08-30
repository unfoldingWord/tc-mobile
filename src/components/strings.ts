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
  booksEmpty: "Start your first book",
  booksEmptyTeach:
    "A book holds the chapters you record — and everything stays on this phone.",
  loadingBooks: "Loading your books.",
  tryAgain: "Try again",
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
  // Shown while the chapter list rebuilds after any change — a save landed, an
  // edit, a finished toggle, or an erase. Neutral on purpose: the recorder-path
  // erase reaches here too, where "Saving your recording." claimed a save that
  // never happened, and even after a real save the write is already done by the
  // time this shows — the list is recomputing peaks, not saving (#77).
  updating: "Updating the chapter.",
  loadingChapter: "Loading the chapter.",
  segmentsEmpty: "Add the first segment",
  segmentsEmptyTeach:
    "A segment is one passage of the chapter — record it, play it back, record it again.",
  playSegment: (n: number): string => `Play segment ${n}`,
  pauseSegment: (n: number): string => `Pause segment ${n}`,
  recordSegment: (n: number): string => `Record segment ${n}`,
  editSegment: (n: number): string => `Edit segment ${n}`,
  editSegmentFinished: (n: number): string => `Edit segment ${n}, finished`,
  openSegment: (n: number): string => `Open segment ${n}`,
  scrubSegment: (n: number): string => `Position in segment ${n}`,
  markFinished: (n: number): string => `Mark segment ${n} finished`,
  markUnfinished: (n: number): string => `Mark segment ${n} not finished`,

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
  finishedWriteFailed: "Could not save the finished mark.",

  // ── Recorder mode split (#89) ────────────────────────────────────────────
  // Play's two aria-labels. The glyph is `pause` while sounding (wireframe), but
  // the action is stop (D4), so the label says "Stop playing".
  playRecording: "Play recording",
  stopPlayback: "Stop playing",
  // The record-menu "Edit" row — distinct from `editSegment(n)`, the Segments
  // list's per-row label.
  enterEdit: "Edit recording",
  // The edit-menu row and the "Editing" pill's spoken action.
  doneEditing: "Done editing",
  // The pill's visible text — the mode marker for a sighted non-reader (D2).
  modepillEditing: "Editing",

  // ── Waveform editing (B5) ────────────────────────────────────────────────
  selectStart: "Select a span to edit",
  selectStop: "Close the selection",
  cut: "Cut the selection",
  paste: "Paste at the line",
  undo: "Undo",
  redo: "Redo",
  recorderMenuTitle: "More",
  recorderMenuOpen: "More actions",
  selectionStartHandle: "Selection start",
  selectionEndHandle: "Selection end",
  editFailed: "That edit could not be applied. Try a shorter selection.",
  clearFailed: "Could not clear the audio. Try again.",

  // ── VU meter + Erase Segment (B6) ────────────────────────────────────────
  vuMeterLabel: "Recording level",
  vuMeterUnavailable: "Level meter unavailable on this device",
  vuShow: "Show the level meter",
  vuHide: "Hide the level meter",
  eraseSegment: "Erase recording",
  segmentMenu: (n: number): string => `More actions for segment ${n}`,
  eraseConfirmTitle: "Erase this recording?",
  eraseConfirm: "Erase",
  eraseCancel: "Cancel",
  eraseFailed: "Could not erase the recording. Try again.",

  // ── Share (B7) ───────────────────────────────────────────────────────────
  chapterMenuOpen: "More actions for this chapter",
  chapterMenuTitle: "Chapter",
  shareChapter: "Share chapter",
  // Tap 2 of the two-gesture flow: the File is encoded and armed, this hands it
  // to the OS share sheet. A distinct, primary action so the tap is deliberate.
  shareSend: "Share now",
  sharePreparing: "Preparing the chapter to share.",
  shareNothing: "Record a segment before sharing this chapter.",
  shareFailed: "Could not share this chapter. Try again.",
  // Neutral on the cause: `missing` counts every segment whose audio did not
  // resolve — never-recorded, but also a dangling take or a half-missing clip —
  // so "no recording yet" would misdescribe a hole the translator never left.
  shareMissing: (n: number): string =>
    n === 1
      ? "1 segment could not be included."
      : `${n} segments could not be included.`,
  shareFilename: (book: string, chapter: number): string =>
    `${book} - Chapter ${chapter}.mp3`,

  // Share Book — the book-level ≡ menu and its zip-of-chapter-MP3s share. Names
  // each book so AT users can tell one shelf row's menu from the next.
  bookMenuOpen: (book: string): string => `More actions for ${book}`,
  bookMenuTitle: "Book",
  shareBook: "Share book",
  shareBookPreparing: "Preparing the book to share.",
  shareBookNothing: "Record a segment before sharing this book.",
  shareBookFailed: "Could not share this book. Try again.",
  // `missing` here counts whole chapters left out of the zip — a chapter with no
  // resolvable audio at all. A chapter that is merely partial still ships (its
  // own gaps are the chapter share's concern), so this speaks in chapters.
  shareBookMissing: (n: number): string =>
    n === 1
      ? "1 chapter could not be included."
      : `${n} chapters could not be included.`,
  shareBookFilename: (book: string): string => `${book}.zip`,
} as const;
