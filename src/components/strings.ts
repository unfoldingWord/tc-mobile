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
import { plural } from "@/lib/plural";
import { filenameSafe } from "@/lib/utils";

/**
 * The verb every "did not make it into what's being shared" sentence uses.
 * `shareMissing`, `shareBookMissing`, and `shareBookMissingAndPartial`'s own
 * two extra clauses all end here, so a future tightening of the wording
 * lands in one place. Before this, the combined Notice's clauses were typed
 * out separately from `shareMissing` — the alias `shareBookPartial` added
 * (George #423 round 2) protected the partial-only Notice, but not the one
 * Notice the book menu actually shows when both gaps exist, which a verb
 * edit to `shareMissing` alone would silently miss (George #423 round 3
 * P3-2).
 */
function couldNotBeIncluded(subject: string): string {
  return `${subject} could not be included.`;
}

/**
 * The trail at the top of a screen: where you are, outermost first.
 *
 * The separator is stated here and nowhere else. It used to be stated twice —
 * once as an HTML entity inside the Segments header's JSX and once as a
 * character in the recorder's own entry — which is two chances to answer one
 * question, and the markup copy was a visible string living outside this table
 * at all (#169).
 *
 * Joining parts is the ONE composition this table does, and what makes it
 * allowed under #169 is that the parts are not translated fragments of a
 * sentence: each is a whole name (a book, a chapter heading) or a number. A
 * sentence assembled from clauses is what #169 rules out, and it stays ruled
 * out — `shareBookMissingAndPartial` writes each of its arms as a whole
 * sentence for exactly that reason.
 *
 * NOTHING HERE HANDLES RIGHT-TO-LEFT, and an earlier draft of this docblock
 * implied otherwise (George, #698). `>` is not a mirrored glyph, no locale in
 * this repo reads right-to-left yet, and no test asserts a direction — so a
 * separator hard-coded here is a fact about the shipped English UI, not a
 * property that survives translation. Whoever lands `strings[locale]` owns
 * that question; this function is not evidence it is answered.
 */
function trail(...parts: readonly string[]): string {
  return parts.join(" > ");
}

export const strings = {
  // ── Books screen (B2) ────────────────────────────────────────────────────
  newBook: "New book",
  menuOpen: "Open menu",
  // The global menu's dialog name for a screen reader — never painted (#608):
  // that panel opens from a ≡ that stays a ≡, so the glyph is its only label.
  // Every OTHER menu passes its own `title` and still shows it.
  menuTitle: "Menu",
  menuClose: "Close menu",
  booksEmpty: "Start your first book",
  // #406 item 3 (George round 2 residual, then George round 1 on #423 P2):
  // an earlier fix hedged this line with "unless space runs low" instead of
  // removing the durability claim, but the empty shelf shows with NONE of
  // `storageMarker`'s three gates checked — not native, `persisted === false`,
  // `hasContent` (`lib/storage/persistence.ts`, `showEmpty` at
  // `books-screen.tsx` never consults any of them). `hasContent` going false
  // retracts the eviction *warning*, not a persistence *promise* — "`false`
  // from a stale read is not evidence about a shelf that no longer has
  // anything on it" (`persistence.ts`). So an un-gated durability line here
  // would warn on the training APK's first launch (native storage is not
  // evicted this way), assert a false warning on an origin that already
  // granted `persist()` and deleted its last book, and claim an answer this
  // repo deliberately stays silent on when `navigator.storage` is absent
  // (iOS Safari). Vocabulary only, no durability claim — matches
  // `segmentsEmptyTeach` below, which never mentions durability either.
  // "Space runs low" stays solely on `storageNotPersisted`, which has all
  // three gates.
  booksEmptyTeach: "A book holds the chapters you record.",
  loadingBooks: "Loading your books.",
  tryAgain: "Try again",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    `${name}, ${plural(chapters, {
      one: "{n} chapter",
      other: "{n} chapters",
    })}, ${expanded ? "expanded" : "collapsed"}`,
  addChapter: (bookName: string): string => `Add chapter to ${bookName}`,
  openChapter: (heading: string): string => `Open ${heading}`,
  chapterName: (n: number): string => `Chapter ${n}`,
  /**
   * The chapter's display heading: the facilitator's passage label when set
   * (#264), otherwise the default chapter name. One place both the Books row
   * and the Segments breadcrumb resolve the name, so they never diverge.
   *
   * It CALLS `chapterName` rather than spelling the default a second time, for
   * the reason `shareBookPartial` and `menuOpenWithFailures` both give below:
   * the two were byte-for-byte copies, and a copy edit to one leaves the other
   * saying the old thing. No call of either can tell a copy from an alias —
   * they agree until the day they are meant to differ — so
   * `tests/breadcrumb.test.ts` counts the spellings in this file instead
   * (#169).
   */
  chapterHeading: (name: string | null, n: number): string =>
    name ?? strings.chapterName(n),
  /**
   * The Segments screen's header trail: which book, which chapter. Takes the
   * resolved heading rather than a name-or-number pair, so the one place that
   * decides what an unnamed chapter is called stays `chapterHeading`.
   */
  chapterBreadcrumb: (book: string, chapter: string): string =>
    trail(book, chapter),

  // ── Naming (#264 rename, #314 New Book, #609 Add chapter) ────────────────
  // One naming field serves all three flows, so these strings are shared: the
  // rename reached from a ≡ menu, the New Book dialog the corner + now opens,
  // and the Add-chapter prompt a book row's + opens.
  renameBook: "Rename book",
  renameChapter: "Rename chapter",
  renameSegment: "Rename segment",
  // The inline text field's accessible name (the whole text layer of the input)
  // and its placeholder.
  bookNameField: "Book name",
  chapterNameField: "Chapter name",
  segmentNameField: "Segment name",
  // The check control that commits the typed name on a RENAME.
  saveName: "Save name",
  // The New Book dialog's heading, and so its accessible name (#314). It says
  // what the field is for, because the field arrives pre-filled and the one
  // thing a non-reader has to understand is that the filled-in text is already
  // a usable answer.
  newBookTitle: "Name your new book",
  // The New Book dialog's dismiss control. NOT `menuClose` ("Close menu"): this
  // panel is a naming dialog, and the one thing its exit has to say is that
  // leaving here creates nothing.
  newBookClose: "Close without creating a book",
  // The same check control, on the New Book dialog. NOT `saveName`: nothing is
  // being saved back onto an existing book here — this activation is what
  // creates it, and the spoken label is the only thing that says so.
  createBook: "Create book",
  // The Add-chapter prompt (#609), the chapter parallel of the three New Book
  // strings above and worded for the same reason: the field arrives pre-filled
  // with "Chapter N", so the heading has to say that the filled-in text is
  // already a usable answer, the dismiss has to say that leaving creates
  // nothing, and the check has to say that this activation is what makes the
  // chapter. `chapterNameField` above is the field's own label, shared with
  // Rename. The busy relabel is `savingName`, shared with both.
  newChapterTitle: "Name your new chapter",
  newChapterClose: "Close without creating a chapter",
  createChapter: "Create chapter",
  // Shown in place of `saveName`/`createChapter` while the write is in flight
  // (#383) — the same in-place busy relabel `loadRetrying`/`takeRecoverRetrying`
  // already do, so a screen reader focused on Confirm does not read it as idle
  // for the whole write. NOT New Book any more (#395 item 2): that caller has
  // its own busy string below, because "Saving…" implies something already
  // existed to save back onto — exactly what `createBook`'s own comment above
  // was written to avoid, and the generic relabel here quietly reintroduced.
  savingName: "Saving…",
  // The New Book dialog's OWN busy relabel (#395 item 2) — used for both its
  // Confirm control's label and its own in-panel busy Notice, so a screen
  // reader on either hears that a book is being MADE, not saved.
  creatingBook: "Creating your book…",

  // ── Segments screen (B3) ─────────────────────────────────────────────────
  backToBooks: "Back to books",
  addSegment: "Add segment",
  // Shown while the chapter list rebuilds after any change — a save landed, an
  // edit, a finished toggle, or an erase. Neutral on purpose: the recorder-path
  // erase reaches here too, where "Saving your recording." claimed a save that
  // never happened, and even after a real save the write is already done by the
  // time this shows — the list is recomputing peaks, not saving (#77).
  updating: "Updating the chapter.",
  staleChapter: "This chapter is no longer available. Go back to Books.",
  loadingChapter: "Loading the chapter.",
  segmentsEmpty: "Add the first segment",
  segmentsEmptyTeach:
    "A segment is one passage of the chapter — record it, play it back, record it again.",
  playSegment: (n: number): string => `Play segment ${n}`,
  pauseSegment: (n: number): string => `Pause segment ${n}`,
  recordSegment: (n: number): string => `Record segment ${n}`,
  // These three are the row's open control's accessible name, which REPLACES
  // its visible text, so they carry the same heading the row paints — label
  // included (#591, WCAG 2.5.3). Unlabelled, the heading is the bare ordinal.
  editSegment: (n: number, label: string | null): string =>
    `Edit segment ${strings.segmentHeading(n, label)}`,
  editSegmentFinished: (n: number, label: string | null): string =>
    `Edit segment ${strings.segmentHeading(n, label)}, finished`,
  openSegment: (n: number, label: string | null): string =>
    `Open segment ${strings.segmentHeading(n, label)}`,
  scrubSegment: (n: number): string => `Position in segment ${n}`,
  markFinished: (n: number): string => `Mark segment ${n} finished`,
  markUnfinished: (n: number): string => `Mark segment ${n} not finished`,
  /**
   * The segment's display heading (#591): the ordinal, then the facilitator's
   * label when set — "3 · verses 3–4". The ordinal always stays, because it is
   * the one handle a translator who cannot read the label still has. One place
   * both the Segments row and the recorder breadcrumb resolve it.
   */
  segmentHeading: (n: number, label: string | null): string =>
    // `== null`, not `=== null`: a row whose upgrade stamp was skipped reads
    // back with no `label` key at all, and must paint the ordinal alone rather
    // than "3 · undefined".
    label == null ? `${n}` : `${n} · ${label}`,
  // A segment rename that did not land. Shown inside the row's menu, where the
  // field stays up for another try — the screen's own Notice is behind the
  // scrim. Plain words, never the store's exception text (#172).
  renameSegmentFailed: "The name was not saved. Try again.",

  // ── Recorder sheet (B4) ──────────────────────────────────────────────────
  // The recorder sheet's own accessible name (#198). It matched no name at all
  // before: `role="dialog" aria-modal="true"` with nothing to announce, on the
  // one surface a translator spends the whole session inside. Deliberately the
  // noun of `closeRecorder` above rather than an invented title, so AT says
  // "Recorder, dialog" and its dismiss says "Close recorder" — the same rule
  // `blockedByTake` below already follows: name the control, do not invent.
  // NOT the breadcrumb: that is empty until the segment loads, and a name that
  // is sometimes absent is the gap this closes.
  recorderDialog: "Recorder",
  // The theme toggle (#171). Names the DESTINATION, not the current state: a
  // control labelled "Dark theme" while the screen is dark tells a
  // screen-reader user what they already have. These are what AT reads; the
  // sun/moon glyph is what a non-reader sees, and #249's recognition check at
  // the training is where that glyph is tested rather than assumed.
  useLightTheme: "Switch to the light screen, for bright sunlight",
  useDarkTheme: "Switch to the dark screen, for low light",
  closeRecorder: "Close recorder",
  /**
   * The recorder sheet's header trail — the Segments one with the segment
   * appended, built from the same `trail`, so the order and the separator are
   * not decided a second time one screen deeper.
   *
   * It takes the chapter's resolved HEADING, not its number. Taking the number
   * meant this trail spelled the default name itself, so a chapter the
   * facilitator had renamed (#264) showed the label on the Segments screen and
   * the default one tap deeper — on the surface a translator spends the whole
   * session inside. Resolving the heading is the caller's job because only the
   * caller knows whether a name was stored (#169).
   *
   * The segment part goes through `segmentHeading` for the same reason, from
   * the other side of this merge (#591): each part of the trail is resolved by
   * the one entry that owns it, and this function decides only the order and
   * the separator. Neither a chapter's name nor a segment's label is spelled
   * out here.
   */
  recorderBreadcrumb: (
    book: string,
    chapter: string,
    segment: number,
    segmentLabel: string | null
  ): string =>
    trail(book, chapter, strings.segmentHeading(segment, segmentLabel)),
  record: "Record",
  // The second tap on the record control ENDS the take and commits it in place
  // (#614). It was "Pause"/"Resume" while a take could be suspended and
  // continued; that state is gone, so the name says what the tap now does.
  stop: "Stop recording",
  // The zoom toggle's two names (#91). Each says the STATE first and the ACTION
  // second, because the first external tester read the old glyph as the state
  // and the old labels ("Zoom: whole segment" / "Zoom: quarter view") named only
  // a destination — which could be read either way too. The button also carries
  // `aria-pressed`, so a screen reader gets the state twice; that redundancy is
  // deliberate on a control a sighted, literate tester still misread.
  //
  // They name the MAGNIFICATION, never what is on screen. "Whole segment in
  // view" was the first draft and is false whenever the clip is panned — which
  // includes the sheet's own opening state, where the pan rests at the end and
  // the window is [0.5L, 1.5L] (the append view `viewportWindow`'s own test
  // pins). Zoom and pan are independent, so no label on this button can honestly
  // promise an extent (Frank + George, round 1 — both lenses, independently).
  zoomAtWhole: "Zoomed to the whole segment. Zoom in to a quarter.",
  zoomAtQuarter: "Zoomed to a quarter. Zoom out to the whole segment.",
  micNeededTitle: "Microphone access is needed to record",
  micRetry: "Try again",
  micBack: "Go back",
  finishedWriteFailed: "Could not save the finished mark.",
  // The recorder's commit-window status (#39): a take is committing — stop →
  // decode → the IndexedDB write, spanned by `isClosing`, not just the
  // `processing` state.
  //
  // It had a second line, `recorderInterrupted`, for a #59 interruption's
  // frozen take: 'Recording finished. Tap the back arrow at the top ("Close
  // recorder") to save it.' #614 made that false — an interruption ends the
  // take and the sheet commits it in place, with nothing asked of the
  // translator — so the line is gone rather than reworded. Its #620 rule
  // survives it and is stated on `blockedByTake` below, which still names a
  // control: say what the control LOOKS LIKE as well as what AT calls it, since
  // an icon-only `Control`'s accessible name is not a word anyone can see.
  recorderSaving: "Saving…",

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

  // ── Recorder save-decode failure (#165) ───────────────────────────────────
  // After Stop the captured audio could not be decoded — most often a transient
  // iOS "interrupted" AudioContext (#106), not corrupt bytes. The take exists
  // ONLY as the held container bytes, so this panel never offers a plain
  // discard: Try again re-decodes on a fresh gesture (resuming the context), and
  // Share hands the raw bytes to the OS so the recording leaves the phone in some
  // form rather than none. "yet" because a retry commonly succeeds.
  takeRecoverTitle: "This recording could not be saved yet",
  takeRecoverBody:
    "Your recording is still here. Try again, or share it to keep it safe.",
  takeRecoverRetry: "Try again",
  // Shown in place of the Try again label and as a busy Notice while a re-decode
  // is in flight — the same in-place busy shape as `loadRetrying` (#137 G2).
  takeRecoverRetrying: "Saving your recording…",
  takeRecoverShare: "Share the recording",
  // The Share control's accessible name AND the busy Notice beneath it while the
  // recording is written out for the OS share sheet — both, because `Control` is
  // icon-only and its label never paints (George R6 P2). On the native route the
  // chooser does not open in the tap — the file goes to the app cache first — so
  // the panel has to say it is working, or the translator reads a live panel as a
  // dead button (#336). Same in-place busy shape as `takeRecoverRetrying`.
  takeRecoverSharing: "Getting the recording ready…",
  // The share sheet is missing or refused these bytes.
  takeShareUnavailable: "Sharing is not available on this device.",
  takeShareFailed: "Could not share the recording. Try again.",
  // A re-decode failed AGAIN (kept under Try again, not the Share slot — George
  // R1 G6). A thrown save on a recovered take reads here too, distinct from a
  // share failure: the recording is still held, so this says "save", not "share".
  takeRetryFailed: "Could not save the recording. Try again.",
  // The held bytes went to the OS share sheet. Shown once a share succeeds, with
  // the Done exit — the recording is off the phone, so leaving loses nothing.
  takeRecoverShared: "Recording shared.",
  takeRecoverDone: "Done",
  // The two-tap discard on the recovery panel (George R1 G1 / Frank F2): the
  // panel is otherwise a dead end when the decode never succeeds. Same armed
  // second-tap shape as the SaveFailed screen — a stray tap never deletes.
  takeRecoverDiscard: "Delete this recording",
  takeRecoverDiscardArmed: "Tap again to delete this recording for good",
  takeRecoverDiscardHint: "Tap again to delete it.",

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
  cut: "Cut the selection",
  // Play's name says WHICH audio the tap will sound, because that changes with
  // the line and the picked span. `auditionPlan`'s `source` chooses between
  // these three, so the spoken name and the samples heard come from one
  // decision: "selection" → below, "line" → below, "whole" → `playRecording`.
  //
  // Both toolbars use the map (George R2 P2). It arrived with the edit-mode
  // audition (#284), but since #317 record-mode Play also starts from the line,
  // and a control that sounds the tail while announcing "Play recording" lies to
  // the one channel — a screen reader — that cannot see where the line is.
  // "selection" is unreachable from the record bar: the plan only reads a span
  // in edit mode.
  auditionSelection: "Play the selection",
  auditionFromLine: "Play from the line",
  paste: "Paste at the line",
  undo: "Undo",
  redo: "Redo",
  // Why the two history arrows are grey, appended to their accessible names
  // while they are (#91, via `edit-control-state.ts`). A grey icon-only control
  // with no reason reads as a broken one — the #135 finding — and these two are
  // grey the longest of any edit control.
  //
  // PRESENT TENSE, describing the current end of the edit stack and nothing
  // else. Round 1 said "No edits to undo yet." and "Nothing has been undone.";
  // both are claims about the session's PAST, while `canUndo`/`canRedo` are
  // only `cursor > 0` and `cursor < ops.length`. George round 1 showed the gap
  // is reachable in three taps: cut, undo — Undo now greys and "no edits yet"
  // is false — then redo, and Redo greys while "has been undone" is false.
  // `tests/edit-control-state.test.ts` bans the tense so this cannot drift back.
  //
  // Pure statements of STATE: no control is named and no gesture is described.
  // Each way out follows from the state itself, so there is nothing to point at
  // — and pointing is where cue copy has gone wrong here before
  // (`menu-row-state.ts`'s `rowHint`, and #648 round 1).
  //
  // The shortest statement of the rule, from the bench fix this merges with:
  // an edit undone back to the start, or an undo redone to the tip, reaches
  // the SAME cursor as a fresh session — so the words may state only where the
  // cursor is, never what has or has not happened.
  nothingToUndo: "Nothing to undo.",
  nothingToRedo: "Nothing to redo.",
  // The recorder drawer's dialog name for a screen reader — never painted
  // there (#621, the rule #608 set for `menuTitle`): the recorder drawer
  // opens from a ≡ that stays a ≡, so the glyph is its only visible label.
  // This string is shared with the per-row segment menu (`segment-row.tsx`),
  // which does not pass `hamburger` and still paints it as that menu's
  // visible heading — #589 owns that menu's affordances and has not
  // retitled it, so treat "never painted" as scoped to the recorder only.
  recorderMenuTitle: "More",
  recorderMenuOpen: "More actions",
  selectionStartHandle: "Selection start",
  selectionEndHandle: "Selection end",
  editFailed: "That edit could not be applied. Try a shorter selection.",
  clearFailed: "Could not clear the audio. Try again.",
  // ── Why a capture produced no take (#169) ────────────────────────────────
  // One sentence per `CaptureFailure` code; `capture-failure-copy.ts` picks
  // which. These words used to be minted inside `hooks/use-recorder.ts` and
  // `hooks/use-audio-session.ts` — the latter typing "could not finish" out a
  // second time, with nothing tying the two copies together. The codes are now
  // minted in `lib/audio/`, which never sees a sentence, and that separation is
  // what lets a second UI language be a change to this table rather than an
  // edit inside the recorder hook.
  //
  // Only this one asks for a retry, because it is the only one where retrying
  // is what helps: the capture reached the decoder and decoded to nothing.
  captureSilence: "No sound was recorded. Try again.",
  // A failed decode, NOT silence — and deliberately not a second "try again".
  // Where this reaches a screen the bytes are held and the recovery panel is
  // up, so the retry is already there as its own control
  // (`strings.takeRecoverRetry`); an instruction here would compete with it.
  // An earlier draft grouped this key with the one above under "the two that
  // name proven silence … tell the translator to try again", which is true of
  // neither half for this key (George R5).
  captureUndecodable: "Recording could not be decoded on this device.",
  // The third must NOT say "no sound": the engine failed to hand the capture
  // over (a flush that threw, #485; a `stopRecording` that rejected, #480), so
  // the translator may well have spoken, and the silence sentence would blame
  // them for it. It stays a statement rather than an instruction — what the
  // sheet offers next after this code is `planClose`'s `stay`, which leaves the
  // recorder open with this Notice in place, not a named remedy.
  captureUnfinished: "Could not finish this recording.",
  // ── Disabled-row reasons (#135) ──────────────────────────────────────────
  // Appended to a disabled ≡-menu row's accessible name so the grey carries its
  // cause. Derived from the row's own gate in `menu-row-state.ts`, never set by
  // hand. Short and literal.
  // Names both steps in the order the overlay allows — while this menu is open
  // the sheet's control is behind the scrim (and, at idle, behind its `inert`
  // too), so it is out of reach until the menu closes. Mid-take the SHEET is no
  // longer inert (#75), but the HEADER — and so header Back — stays inert under
  // any overlay regardless of `takeActive` (George R2 P2), so Back is not
  // reachable to AT at all while this menu is up. The two steps this cue names
  // are still the way to save: close the menu, then close the recorder. The
  // order is what matters, and it is unchanged. Named by the accessible names
  // those two controls
  // actually carry (`menuClose`, `closeRecorder`). An earlier draft said "tap
  // Back", which matches NO control in the product: a screen-reader user hunting
  // for "Back" finds nothing, and the one live control dismisses the menu
  // (George, round 2). If `closeRecorder` is ever renamed, these move with it.
  // This one names the controls by name ONLY and does not describe their
  // glyphs the way the body notices do (#620): it is spoken
  // inside the ≡ menu, where the recorder header — and so "Close recorder" —
  // is `inert` and the one live control on screen is the menu's own dismiss,
  // which since #621 wears the ≡ glyph (this menu opts into `hamburger`,
  // `recorder.tsx`), not a back chevron. Describing the save control by its
  // looks here would still point at the dismiss, the exact collision the
  // round-1 `back` badge had (`menu-row-state.ts`, `rowHint`'s docblock);
  // #648 round 1 (George P2) caught the words repeating it.
  // `tests/menu-row-state.test.ts` pins this half: the hint never describes a
  // glyph, and separately pins that this menu's own dismiss is the one that
  // opts into `hamburger`.
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
  eraseSegment: "Erase recording",
  // The record bar's bin (#592): the same erase and the same confirm as the
  // menu row above, named for what the translator is doing — starting the
  // segment over — because the sheet stays open, ready for the next take.
  rerecord: "Erase and record again",
  segmentMenu: (n: number): string => `More actions for segment ${n}`,
  eraseConfirmTitle: "Erase this recording?",
  eraseConfirm: "Erase",
  // The safe action of the shared confirm dialog (`erase-confirm.tsx`). One
  // string for both flows it now serves — segment Erase and book Delete —
  // because it is the same control on the same surface saying the same word.
  eraseCancel: "Cancel",
  eraseFailed: "Could not erase the recording. Try again.",

  // ── Delete a book (#337) ─────────────────────────────────────────────────
  // The book ≡-menu row, and the two-tap confirm behind it — the same dialog
  // the segment Erase uses, not a second one.
  deleteBook: "Delete book",
  // Names the book, because this dialog's title is also its accessible name and
  // it is the only thing that says WHICH shelf row is about to go. "everything
  // in it" is the honest scope: the chapters, the segments and every recording.
  deleteBookConfirmTitle: (book: string): string =>
    `Delete ${book} and everything in it?`,
  deleteBookConfirm: "Delete",
  // A destructive op that did NOT happen has to say so in its own words. The
  // store's own message — a quota or connection fault, since `deleteBook` never
  // throws on a missing book — is for a maintainer; this is the line a screen
  // reader speaks to a translator. Mirrors `eraseFailed` (#80).
  deleteBookFailed: "Could not delete this book. Try again.",

  // ── Share (B7) ───────────────────────────────────────────────────────────
  chapterMenuOpen: "More actions for this chapter",
  chapterMenuTitle: "Chapter",
  shareChapter: "Share chapter",
  // The idle Share control's own label once `sendUnconfirmed` is true (George
  // r2 P2-2, #491) — state-in-place, read together with the control's own
  // changed icon (`control-affordance.ts`). Never "sent"/"delivered"/"failed"
  // (same rule `shareUnproven` follows): the control is enabled, a second tap
  // starts a genuine new attempt, and this label is what tells that attempt
  // apart from a first one, not a verdict on the last one.
  shareChapterUnconfirmed:
    "Share chapter. The last attempt wasn't confirmed — tap to try again.",
  // Tap 2 of the two-gesture flow: the File is encoded and armed, this hands it
  // to the OS share sheet. A distinct, primary action so the tap is deliberate.
  shareSend: "Share now",
  sharePreparing: "Preparing the chapter to share.",
  // The share modal's text (#491) — SECONDARY, under a glyph that is the
  // signal; none of these three is what a non-reader is expected to act on.
  // Chapter and book alike: the sheet is the phone's, not the chapter's.
  //
  // `shareSent` says HANDED TO THE SHEET and stops there. A resolved share
  // proves the bytes reached the OS sheet, not that any app received them —
  // some targets drop the file while `share` still resolves (the R-B7 note in
  // `hooks/share-flow.ts`), and on Android native the plugin can resolve a
  // Back after the activity stopped (`resolveProvesDelivery`). So never
  // "sent", "delivered", "shared to", or an app's name; a test pins that.
  shareHandingOver: "Opening the phone's share sheet.",
  shareSent: "Handed to the phone's share sheet.",
  shareDismissed: "The share sheet was closed before anything went out.",
  // The native Android plugin can resolve on a Back after the chooser's
  // activity merely stopped — the same resolve a genuine hand-off produces
  // (`resolveProvesDelivery`, `hooks/share-target.ts`). Neither `shareSent`
  // (an unbacked success tick) nor `shareDismissed` (claims nothing went,
  // which this cannot know) is honest here — a third, deliberately uncertain
  // line, never "sent"/"delivered"/"shared to"/an app's name, same as the two
  // above (Frank a446708 P2, #491).
  shareUnproven:
    "The share sheet closed. This phone can't confirm it went further.",
  shareNothing: "Record a segment before sharing this chapter.",
  shareFailed: "Could not share this chapter. Try again.",
  // Neutral on the cause: `missing` counts every segment whose audio did not
  // resolve — never-recorded, but also a dangling take or a half-missing clip —
  // so "no recording yet" would misdescribe a hole the translator never left.
  shareMissing: (n: number): string =>
    couldNotBeIncluded(
      plural(n, { one: "{n} segment", other: "{n} segments" })
    ),
  // The book name is free text since #264, so sanitise it into the filename —
  // a `/` in "Mark/Luke" would otherwise split a zip entry into a folder (G3).
  // The chapter is an ordinal, always safe.
  shareFilename: (book: string, chapter: number): string =>
    `${filenameSafe(book)} - Chapter ${chapter}.mp3`,

  // Share Book — the book-level ≡ menu and its zip-of-chapter-MP3s share. Names
  // each book so AT users can tell one shelf row's menu from the next.
  bookMenuOpen: (book: string): string => `More actions for ${book}`,
  bookMenuTitle: "Book",
  shareBook: "Share book",
  // See `shareChapterUnconfirmed`'s own comment — the book-menu equivalent.
  shareBookUnconfirmed:
    "Share book. The last attempt wasn't confirmed — tap to try again.",
  shareBookPreparing: "Preparing the book to share.",
  shareBookNothing: "Record a segment before sharing this book.",
  shareBookFailed: "Could not share this book. Try again.",
  // `missing` counts whole chapters left out of the zip — a chapter with no
  // resolvable audio at all.
  shareBookMissing: (n: number): string =>
    couldNotBeIncluded(
      plural(n, { one: "{n} chapter", other: "{n} chapters" })
    ),
  // A chapter that IS included can still be partial — one or more of its own
  // segments had no resolvable audio (`exportChapterMp3`'s own `missing`,
  // rolled up across every included chapter, #116). Distinct from
  // `shareBookMissing`, which speaks in whole chapters; this speaks only in
  // segments. `n` is `partialSegments`, a SUM across every included chapter's
  // own `missing` (`src/lib/export/book.ts`), not a count of chapters —
  // `gatherChapterPcm` can return `missing > 1` for a single chapter — so no
  // chapter-grain wording is tied to `n` here (#400, George #398 P3). A first
  // attempt kept "chapters" as a supposedly uncounted noun, but Frank (diff
  // review, #423) caught that bare "chapters" still reads as "more than one"
  // even with exactly one included chapter — the same defect this fix exists
  // to remove.
  //
  // An alias of `shareMissing`, not a second copy of its wording: George
  // round 2 (#423) named the byte-for-byte duplicate as drift-prone — a later
  // edit to one could tighten the segment-grain phrasing and forget the
  // other, and only `shareBookPartial` was pinned. One wording, one function.
  shareBookPartial: (n: number): string => strings.shareMissing(n),
  // Both gaps can occur in the same book (a whole chapter missing AND a
  // segment missing from one that shipped). The screen surfaces ONE Notice for
  // the book grain, so this combines rather than stacking two.
  //
  // `exportBookZip` counts a chapter toward at most one of `missing` and
  // `partialSegments` (`src/lib/export/book.ts`) — a chapter never contributes
  // to both. Plainly concatenating `shareBookMissing` and `shareBookPartial`
  // verbatim used to carry that invariant because the old `shareBookPartial`
  // named its own chapter's scope; once it became the `shareMissing` twin
  // (#400, this file above), the two sentences read identically shaped and a
  // reader could take "1 chapter could not be included. 1 segment could not
  // be included." as one gap double-counted, or as an unrelated,
  // under-counted hole (George #423 round 1 P3).
  //
  // One missing segment is always exactly one chapter, so the
  // `segments === 1` case can safely name that chapter's scope without
  // misstating a count.
  //
  // That is why this branch is NOT `plural`'s `one` form, although every other
  // count-varying string in this table now is (#169). CLDR's `one` category is
  // not "exactly 1" — Russian selects it for 21, 31, 101 — so moving this
  // clause into a forms table would let a second locale assert "an included
  // chapter", singular, about twenty-one segments spread across an unknown
  // number of them, which is the #400/#423 bug in a new place. The branch here
  // is a claim about the count being exactly one, not an agreement with it; a
  // locale that needs `few`/`many` inside the else branch should add the table
  // there and leave this exactly-one branch as a branch.
  //
  // George round 2 caught that the first attempt at that
  // clause ("...was left out of a chapter that shipped") used maintainer
  // vocabulary that collides with two unchanged contracts: "shipped" reads as
  // past-tense send while the share menu is only `ready` (Share now — `hooks/
  // share-flow.ts` — has not been tapped), and "was left out" implies a
  // deliberate omit, against `shareMissing`'s own cause-neutrality comment
  // (the count also includes a dangling take or a half-missing clip, never a
  // choice). The fix keeps the chapter-scope disambiguation but uses the
  // table's own verb, "could not be included".
  //
  // `segments > 1` names the chapter scope from `partialChapters` — how many
  // DISTINCT included chapters hold those segments, counted by the producer
  // (`exportBookZip`, #446) — never from `segments`. `segments` is a SUM, so
  // pluralizing or counting "chapter" off it is the #400/#423 bug: one
  // chapter with two gaps and two chapters with one gap each both reach
  // here as `segments === 2`. With the producer's count in hand, one chapter
  // reads "of an included chapter" (the n===1 clause's own locator) and
  // several read "of N included chapters", so a facilitator helping a
  // translator knows how many chapters to go back to. "included" keeps the
  // locator George #423 round 3 required: the segments sit in chapters that
  // are in the zip, not in the one(s) the first sentence says were not.
  shareBookMissingAndPartial: (
    chapters: number,
    segments: number,
    partialChapters: number
  ): string =>
    `${strings.shareBookMissing(chapters)} ${couldNotBeIncluded(
      `${segments === 1 ? "1 segment" : `${segments} segments`} of ${
        partialChapters > 1
          ? `${partialChapters} included chapters`
          : "an included chapter"
      }`
    )}`,
  // The encoder went silent mid-share and was restarted (#166). Chapter and book
  // alike: the cause is the phone, not what was being shared. Try again is still
  // the first thing to do — the encoder was restarted — and the restart hint is
  // here because the Books shelf that carries it is not on screen while a
  // chapter is open (George R2 P3-2).
  shareEncoderStopped:
    "Could not prepare this to share. Try again — if it keeps happening, restart the app.",
  // Sanitised like shareFilename: the book name is the .zip File name and must
  // not carry a path separator or a reserved character (G3).
  shareBookFilename: (book: string): string => `${filenameSafe(book)}.zip`,

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
  // the glyph alone. It does NOT claim the in-progress work survived: a render
  // crash unmounts `App` and `leave()` abandons an uncommitted take, so a
  // "everything you saved is still here" line would over-promise (George, r2).
  appReloadTeach: "The app will start again.",
  // In place of `appReload` while Restart waits for the crash row to finish
  // being written, and as the busy Notice under it — the same in-place relabel
  // `loadRetrying` and `takeRecoverRetrying` use (#137 G2). The wait is real on
  // a device whose first open is also the v6 upgrade, and an unlabelled wait on
  // the only recovery control this screen has is a button that looks dead.
  appReloading: "Restarting…",
  // Restart declined to reload, because the record of this crash was refused by
  // storage and a reload would destroy it (George R5 P2-2). It has to SAY so:
  // a control that goes back to idle having done nothing is the "tap did
  // nothing, said nothing" shape this round is removing elsewhere. It names the
  // action that still works — Send is on this screen and reads the same
  // database, so it will usually fail too, but the facilitator is the person
  // who can act on "this phone cannot write right now" and the runbook's paper
  // sheet is the fallback. No cause text: a stack-shaped string in a language
  // the reader may not speak is worse than nothing (#172).
  appReloadHeld: "This problem could not be saved yet. Send it, or try again.",

  // ── The encoder has stopped working (#166) ───────────────────────────────
  // Shown once on the shelf when `encoderHealth()` reads `failing` — one stall,
  // or `ENCODER_FAILURE_THRESHOLD` ordinary encode failures in a row. "Make
  // recordings smaller" is what the encoder does in BOTH of the jobs that use
  // it: the Finished transcode that buys back storage (D3, #12) and the MP3 a
  // Share hands to the phone. Both stop together, and both are invisible from
  // where the translator stands unless this says so.
  //
  // It says plainly that nothing is lost, because nothing is — a failed
  // transcode keeps its PCM — and names the one thing that sometimes helps. No
  // cause text, no error string, no word from the encoder's own vocabulary
  // (#172).
  encoderFailing:
    "This phone could not make recordings smaller. Nothing is lost — restarting the app may help.",

  // ── Storage durability (#12) ─────────────────────────────────────────────
  // State-in-place on the Books screen: the browser has NOT promised to keep
  // this origin's storage, so anything recorded here can be evicted when the
  // device runs low on space — and there is no restore path. Shown only when
  // `persisted()` answered false AND the shelf holds a book AND the app is not
  // the native shell (`lib/storage/persistence.ts`); an absent API is unknown,
  // and unknown says nothing. Says the one thing the translator can act on
  // rather than the mechanism, and says "may" twice over: whether eviction
  // happens on their device is not known, and — George round 1 P3-4, #214 —
  // "any book exists" (the trigger) is not "a recording exists" yet, so the
  // copy speaks about what recording here risks rather than asserting
  // recordings already sitting at risk.
  storageNotPersisted:
    "This phone may delete what you record here if space runs low. Share your work when you can.",

  // ── Storage pressure (#247) ──────────────────────────────────────────────
  // State-in-place on the Books screen, alongside `storageNotPersisted`:
  // `navigator.storage.estimate()` says this ORIGIN is running low, which is a
  // different risk from durability above — the browser has not evicted
  // anything, the device is simply filling up. No byte count or percentage in
  // either line: the estimate is coarse and per-origin
  // (`lib/storage/pressure.ts`), so a number here would be a precision the
  // reading does not support.
  //
  // **DRI decision (Seth, 2026-09-24), replacing the original wording.** The
  // original copy said "here" rather than naming the phone, and "when you
  // can" / "now" for urgency — deliberately, to avoid overclaiming a
  // per-device condition from a per-origin reading (Frank P2-1 / George
  // P2-1, #542; `pressure.ts`'s docblock still explains that risk: the OS can
  // hand this origin a comfortable quota while the disk is nearly full, or
  // the reverse). The DRI judged that hedge too vague to act on: it does not
  // say what device is at risk or what happens if nothing is done. The new
  // copy names the phone and, for the critical band, states the concrete
  // consequence — new recordings may not save — which is also why
  // `storageCritical` now renders in the `alert` tone rather than `info`
  // (`storage-pressure-notice.ts`). Both lines still name the pair
  // `pressure.ts`'s docblock names — mark segments Finished (ADR 0009's
  // transcode reclaims ~90%) or share the work and then remove it — not bare
  // "share", which does not reclaim anything on its own: `lib/export/
  // chapter.ts` decodes and re-encodes without deleting a single stored clip.
  storageLow:
    "This phone is running low on space. Mark the segments you're done with as finished — they take much less room.",
  storageCritical:
    "This phone is almost out of space, and new recordings may not save. Mark finished segments, or share your work and then remove it.",

  // ── The database is unreachable (#221) ───────────────────────────────────
  // Two full-screen states, one in each copy of the app, when a newer copy
  // upgrades the database. The mark on the panel carries the meaning; these
  // lines support it, and are the whole text layer a screen reader speaks.
  // Both offer the same exit, `appReload` above — restarting is what picks up
  // the newer build, and on the blocked side it is what re-tries the open.
  dbBlocked: "Another copy of this app is open.",
  // Closing the other copy is the WHOLE action. This panel takes itself down
  // when that happens — the open that was blocked comes through and the storage
  // layer says so (`onUnblocked`) — so asking for a restart as well would be
  // asking for a step that is not needed, which a non-reader treating the two
  // lines as one action would do anyway (George R2 P3). "Restart" belongs on
  // `dbOutOfDateTeach` below, where it genuinely is the only exit.
  dbBlockedTeach: "Close the other one to carry on.",
  dbOutOfDate: "This copy is out of date.",
  dbOutOfDateTeach: "Restart to use the new version.",

  // ── Failure log (#205) ───────────────────────────────────────────────────
  // The durable destination for reported failures, reachable from the global
  // menu on Books. None of this is copy a non-reader depends on — the marker on
  // the ≡ control and the alert glyph carry the state — but the accessible name
  // is the whole text layer for AT, so it says what happened and how many.
  //
  // "Problem report" throughout, never "error log": the person tapping this is
  // a facilitator sending something to a maintainer, and the noun has to name
  // the thing they are sending, not the file format it happens to be.
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} problem recorded",
      other: "{n} problems recorded",
    }),
  // Replaces the plain "Open menu" name while the log is non-empty, so the one
  // control that leads to the report announces that it does.
  //
  // Reads `failuresMarker` rather than spelling the phrase out again (#169).
  // The two used to be byte-identical, so a later edit to one would have left
  // the panel and the control it opens saying different things about the same
  // number — and a count phrase is now a plural TABLE, which is a worse thing
  // to keep two copies of than a sentence was.
  menuOpenWithFailures: (n: number): string =>
    `Open menu. ${strings.failuresMarker(n)}.`,
  // Said in the menu, above the two actions. Deliberately not "the app
  // crashed": most entries are a single failed write the translator never saw,
  // and alarming a person about work that is still on the phone is its own harm.
  failuresTeach: "Send this to your helper if something is not working.",
  shareFailureLog: "Send problem report",
  // See `shareChapterUnconfirmed`'s own comment (`control-affordance.ts`
  // wiring) — the failure-log-panel equivalent (Frank at `238820a` P2, #491):
  // the idle Send control's own label once `sendUnconfirmed` is true.
  shareFailureLogUnconfirmed:
    "Send problem report. The last attempt wasn't confirmed — tap to try again.",
  shareFailureLogPreparing: "Preparing the problem report.",
  // The log emptied between the render that offered Share and the tap.
  shareFailureLogNothing: "There is nothing to send now.",
  shareFailureLogFailed: "Could not send the problem report. Try again.",
  shareFailureLogRestart:
    "Cannot use this copy any more. Restart the app to use the new version.",
  clearFailureLog: "Clear problem report",
  // Behind the bin: the same two-tap confirm the segment Erase and the book
  // Delete use, not a second dialog (George R2 P3-3). Clearing is the one
  // irreversible write in this panel — the report is the only copy of what went
  // wrong that ever leaves the phone, and the bin sits directly under Share,
  // which is where the thumb already is.
  clearFailureLogConfirmTitle: "Clear the problem report?",
  clearFailureLogConfirm: "Clear",
} as const;
