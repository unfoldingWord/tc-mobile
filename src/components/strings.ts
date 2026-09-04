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
  // The recorder's commit-window status (#39). "saving": a take is committing
  // (stop → decode → the IndexedDB write, spanned by `isClosing`, not just the
  // `processing` state). "interrupted": the mic was lost mid-take (#59) and the
  // frozen take is held in memory until the recorder is closed — so the copy
  // names the real control, "Close recorder" (nothing is named "Back"), the
  // same wording #139 rewrites `previewUnavailable` to.
  recorderSaving: "Saving…",
  recorderInterrupted: 'Recording finished. Use "Close recorder" to save it.',

  // ── Recorder load failure (#137) ──────────────────────────────────────────
  // A finished segment's stored MP3 could not be decoded when the sheet opened
  // — most often a transient iOS "interrupted" AudioContext (#106), not a
  // corrupt clip. The sheet is a full panel, not a blank: the recording is
  // untouched, "Try again" resumes the context and re-decodes, and Back returns
  // to the Segments list, where the row's Erase (which does not decode) works.
  loadFailedTitle: "This recording could not be opened",
  loadFailedBody:
    "Your recording is safe. Try again, or go back to erase it from the list.",
  loadRetry: "Try again",
  loadBack: "Go back",
  // Shown BENEATH the panel's two controls (both stay mounted) while a "Try
  // again" is in flight, so the tap has visible feedback (a slow decode is not
  // instant) and the panel does not flicker to the disabled sheet and back.
  // Try again relabels and goes busy in place rather than unmounting (#137 G2).
  loadRetrying: "Opening your recording…",

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
  // Same rule as `blockedByTake`: name the control, do not invent "Back".
  previewUnavailable:
    'Can\'t preview this yet. Use "Close recorder" to save it, then play it.',

  // ── Disabled-row reasons (#135) ──────────────────────────────────────────
  // Appended to a disabled ≡-menu row's accessible name so the grey carries its
  // cause. Derived from the row's own gate in `menu-row-state.ts`, never set by
  // hand. Short and literal, like `previewUnavailable`.
  // Names both steps in the order the overlay allows — while this menu is open
  // the recorder sheet is inert, so the sheet's control is out of reach until the
  // menu closes — and names them by the accessible names those two controls
  // actually carry (`menuClose`, `closeRecorder`). An earlier draft said "tap
  // Back", which matches NO control in the product: a screen-reader user hunting
  // for "Back" finds nothing, and the one live chevron dismisses the menu
  // (George, round 2). If `closeRecorder` is ever renamed, these move with it.
  blockedByTake:
    'Use "Close menu", then "Close recorder", to save the recording.',
  // The `requesting` race: Record tapped, ≡ opened before `getUserMedia`
  // resolves. No audio exists yet, so this must NOT promise a save — and must
  // not send anyone to a control that would abandon the in-flight start.
  micStarting: "The microphone is still starting.",
  nothingRecorded: "Nothing recorded yet.",
  nothingStored: "Nothing saved to erase.",

  // ── Live waveform (#120) ─────────────────────────────────────────────────
  liveWaveform: "Live recording waveform",

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

  // ── Root error boundary (#167) ───────────────────────────────────────────
  // The whole text layer of the crash screen. Says that something failed and
  // nothing more: the cause goes to the failure sink for a maintainer to read,
  // never to a translator. It is also the screen's accessible name.
  appFailed: "Something went wrong.",
  // The one action, named for what it actually does. NOT `tryAgain`: on the
  // Books shelf that label means "run the load that just failed again", and
  // here the button reloads the document — the app starts over from disk, and
  // anything that lived only in memory is already gone. A screen reader speaks
  // the label and nothing else, so the two must not share one.
  appReload: "Restart the app",
  // Said once, under the mark: what the button is about to do. No cause text —
  // a stack-shaped string in a language the reader may not speak is worse than
  // the glyph alone.
  appReloadTeach:
    "The app will start again. Everything you saved is still on this phone.",
} as const;
