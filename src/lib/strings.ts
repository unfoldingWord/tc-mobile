/**
 * Every visible and accessible string these screens show, in one flat table.
 *
 * On a screen built for people who may not read, the `aria-label` is not a
 * courtesy — it is the entire text layer a screen reader speaks and the only
 * place a future spoken-prompt layer can attach. Routing every string through
 * one record keeps that layer attachable and keeps wording out of the markup,
 * where it would otherwise be edited in a dozen places. This is a table, not a
 * provider: parameterised labels are small pure functions, nothing more.
 *
 * WHY IT LIVES IN `lib/` and not beside the components it mostly serves: the
 * onion rule runs one way, so `hooks/` cannot import from `components/`. While
 * this table sat in `components/`, every sentence a hook had to produce was
 * stranded as a literal beside the code that raised it — `use-recorder.ts` said
 * so in a comment this move deleted, "`hooks/` cannot reach the components'
 * string table". `lib/` is the one layer every other layer can reach, and the
 * table is pure data and pure functions, so it costs the DOM-free core nothing:
 * it compiles under `tsconfig.lib.json` with the rest of `lib/`. #169.
 *
 * WHICH sentences that is, today: `playbackFailed`, the five
 * `classifyMicRefusal` classes, and `recordingUnsupported`. Each one IS the
 * state its hook holds, on the far side of a `useState` that never crosses into
 * `lib/`, so there is no domain value to route and a code would be a union with
 * one consumer.
 *
 * The recorder's three CAPTURE failures took the other route and are not that
 * argument's evidence: #700 made them codes in `lib/audio/capture-failure.ts`,
 * worded at the screen by `components/capture-failure-copy.ts`, because
 * `lib/takes/close-plan.ts` already reasons about that value. AGENTS.md states
 * which route to reach for. An earlier draft of this paragraph cited those
 * three — "typed out a second time further down the same file" — as the reason
 * this table moved; that was true before #700 and is not the case this move
 * rests on now.
 */
import { licenceTag } from "@/lib/export/licence-tag";
import { plural } from "@/lib/plural";
import { filenameSafe } from "@/lib/utils";
import type { LicenceId } from "@/types/template";

/** What an armed restart destroys, named: `restartArmed` and `restartGone`. */
export type RestartSubject = "recording" | "changes" | "cutAudio";

/**
 * An entry that reuses another entry calls it through `this`:
 * `chapterHeading` falls back to `this.chapterName`, `shareBookPartial`
 * returns `this.shareMissing`, and a few more reach `this.segmentHeading` or
 * `this.trail`. `tests/strings-self-reference.test.ts` pins which entries these
 * are, so a new one fails there and is sent back here. Byte-for-byte copies
 * drifted, and an alias cannot.
 *
 * An alias returns the other entry's output whole. It never builds a sentence
 * around it (#1483, `docs/i18n/glossary.md`). A sentence is written out whole
 * in its own entry, with a placeholder for each value that varies, because a
 * sentence built around "Chapter 3" or "{n} segments" keeps that phrase's
 * grammar where a language may need another case or order. The same test pins
 * the few that still sit inside other text: names, and one join of two whole
 * sentences, each with its reason.
 *
 * WHY `this` AND NOT `strings.<entry>` (#169, #1480). `strings` below is a
 * live binding that `installStrings` repoints at the active locale's table.
 * An entry that called `strings.chapterName` from inside a second locale's
 * table would format its embedded part from whichever table is installed, or
 * from this English one: a heading that is half English. A method called as
 * `strings.chapterHeading(...)` has `this` set to the table it was read from,
 * so each alias resolves within its own table and a copy of the table that
 * overrides `chapterName` changes every entry that embeds it.
 *
 * The cost is that these entries are methods, not arrows, and so must be
 * called through the table: `strings.chapterHeading(null, 3)`, never a
 * detached `const f = strings.chapterHeading`. The one entry shape that is
 * safe detached is an arrow that touches only its own arguments, which is
 * every other entry.
 *
 * The existing equality tests cannot see a wrong-table call.
 * `tests/breadcrumb.test.ts`'s `chapterHeading(null, n) === chapterName(n)`
 * stays green while the bug is live, because both sides resolve through the
 * same wrong table and agree. `tests/strings-locale-binding.test.ts` is the
 * different assertion: it installs a table whose `chapterName` is a sentinel
 * and requires every entry that embeds it to carry the sentinel.
 *
 * The English literal is written as a value, with no type annotation, so the
 * keys and signatures here are the one source of the shape; `Strings` is
 * derived from it with string literals widened, so a locale's table may hold
 * different words.
 */
export const stringsEn = {
  // The trail at the top of a screen: where you are, outermost first. The
  // separator is stated here and nowhere else (#169, #1481). Parts are whole
  // names, never clauses of a sentence. Nothing here handles a reading
  // direction: a right-to-left locale states its own separator in its table.
  trail(...parts: readonly string[]): string {
    return parts.join(" > ");
  },
  // Whole sentences set side by side: a notice that says what happened, then
  // what was left out. The separator is stated here and nowhere else (#1483),
  // so a locale that writes no spaces between sentences states its own. Parts
  // are whole sentences, never clauses.
  sentences(...parts: readonly string[]): string {
    return parts.join(" ");
  },
  // ── Books screen (B2) ────────────────────────────────────────────────────
  newBook: "New book",
  menuOpen: "Open menu",
  // The global menu's dialog name for a screen reader — never painted (#608):
  // that panel opens from a ≡ that stays a ≡, so the glyph is its only label.
  // Every OTHER menu passes its own `title` and still shows it.
  menuTitle: "Menu",
  menuClose: "Close menu",
  // Settings (#1575): the gear in the Books header, and the screen it opens.
  // The gear's name is the screen's title, so the heading a screen reader
  // announces is the word the control carried. The screen's Back reads
  // `backToBooks`. Theme rows reuse `useLightTheme` and `useDarkTheme`.
  settingsOpen: "Settings",
  settingsTitle: "Settings",
  templatesOpen: "Templates",
  templatesTitle: "Templates",
  templateLicenceLabel: (licence: string): string => `Licence: ${licence}`,
  // S12: the requirements owner's option. Off, a chapter shows its name when
  // it has one and its number when it does not. On, always the number.
  settingsChapterNumbers: "Always show chapter numbers",
  // #1433 (U6b): the switch for the loudness chain the Done transcode runs.
  // On when nothing is stored. The word is "done", as `markFinished` says (D17).
  settingsNormalizeOnFinished: "Even out the volume when done",
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
  // The whole row name in each form (#1483), and the book's name goes in
  // last: a name that happens to contain "{n}" stays as typed.
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} chapter, expanded",
            other: "{name}, {n} chapters, expanded",
          }
        : {
            one: "{name}, {n} chapter, collapsed",
            other: "{name}, {n} chapters, collapsed",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Add chapter to ${bookName}`,
  openChapter: (heading: string): string => `Open ${heading}`,
  /**
   * The book's display heading: the facilitator's own name when set (#264),
   * otherwise the placeholder rendered from the slot the store gave it (#169).
   * The chapter's rule below, one level up the tree — and for the same reason:
   * the placeholder is copy, so it is rendered here and never persisted, which
   * is what lets a second UI language rename the books already on a phone.
   *
   * Three digits, zero-padded, so a shelf of practice books sorts and scans as
   * a column rather than ragged text. Above 999 the number simply grows.
   *
   * `number` is nullable for the callers that may have no book at all: a
   * breadcrumb or share filename whose book was deleted under it says nothing
   * rather than naming a phantom "Book 000".
   */
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Book ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Chapter ${n}`,
  /**
   * The chapter's display heading: the facilitator's passage label when set
   * (#264), otherwise the default chapter name. One place both the Books row
   * and the Segments breadcrumb resolve the name, so they never diverge.
   *
   * It CALLS `chapterName` rather than spelling the default a second time, for
   * the reason `shareBookPartial` gives below:
   * the two were byte-for-byte copies, and a copy edit to one leaves the other
   * saying the old thing. No call of either can tell a copy from an alias —
   * they agree until the day they are meant to differ — so
   * `tests/breadcrumb.test.ts` counts the spellings in this file instead
   * (#169). The alias is also the one that breaks under per-locale tables,
   * and the pin that it equals `chapterName` does not see that break: see the
   * docblock above `strings`.
   */
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  /**
   * The Segments screen's header trail: which book, which chapter. Takes the
   * resolved heading rather than a name-or-number pair, so the one place that
   * decides what an unnamed chapter is called stays `chapterHeading`.
   */
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  /**
   * The spoken names of the new look's header crumbs that navigate (#1269):
   * the book crumb on the chapter screen, the chapter crumb on the recorder.
   * Each names the destination, and each holds the text the chip shows, so
   * the visible text sits inside the spoken name (WCAG 2.5.3). `chapter` is
   * the resolved heading (`chapterHeading`), the same text the chip shows.
   * The name is spoken, not drawn, so it carries no direction of its own; the
   * chip's text element carries `dir="auto"` (#1267).
   *
   * The chapter's is "Go to {heading}" (DRI pick on #1274), with no word
   * of its own: the heading already says "Chapter N" when the chapter has no
   * name, so "Go to chapter Chapter 1" said it twice. The book's keeps
   * "book", because a book name is a bare label that says nothing about
   * what it names.
   */
  goToBook: (book: string): string => `Go to book ${book}`,
  goToChapter: (heading: string): string => `Go to ${heading}`,

  // ── Naming (#264 rename, #314 New Book, #609 Add chapter) ────────────────
  // One naming field serves all three flows, so these strings are shared: the
  // rename reached from a ⋮ menu, the New Book dialog the corner + now opens,
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
  // The unrecorded row's microphone (#1217). Its tap opens the recorder at
  // rest; capture starts on the recorder's own Record (#602), so the name says
  // what the tap does rather than promising a recording.
  openRecorderSegment: (n: number): string => `Open recorder for segment ${n}`,
  // These three are the row's open control's accessible name, which REPLACES
  // its visible text, so they carry the same heading the row paints — label
  // included (#591, WCAG 2.5.3). Unlabelled, the heading is the bare ordinal.
  editSegment(n: number, label: string | null): string {
    return `Edit segment ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Edit segment ${this.segmentHeading(n, label)}, finished`;
  },
  openSegment(n: number, label: string | null): string {
    return `Open segment ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Position in segment ${n}`,
  // "done", not "finished" (D17, #949): the O4 tile's caption is the
  // workbench's "Done", and the label must hold the caption (label-in-name).
  // One string for both menus (segment row and recorder). It
  // does not flip to "not done": `aria-pressed` carries the state (#351).
  markFinished: (n: number): string => `Mark segment ${n} done`,
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
  // The O4 menu tiles' visible captions (#949, `o4-tile-menu.tsx`). Shown,
  // never announced: each tile's name is the label its current-look row
  // already had, and every caption is a word that label holds (label-in-name,
  // WCAG 2.5.3). Marking done says the workbench's "Done", and
  // `markFinished` says "done" to match (D17).
  tileEdit: "Edit",
  tileFinished: "Done",
  // The recorder menu's mid-take Stop tile (#369); its name is `stop`.
  tileStop: "Stop",
  tileRename: "Rename",
  // Reset removes a segment's audio and keeps the segment; Delete below
  // removes the segment. Key names keep "erase" (the code's word for the
  // operation). The tile's caption is "Reset", one word of `eraseSegment`
  // ("Reset segment and start over", #1220), so the visible caption stays a
  // word of the accessible name (WCAG 2.5.3, pinned by the label-in-name
  // tests); one icon for one action stays as #1119 picked.
  tileErase: "Reset",
  // The book menu's Delete tile (04); its name is `deleteBook`. Shared with
  // the chapter view's segment-menu Delete tile (#590/#1104) — its name is
  // `deleteSegment` — the same caption, on two different destructive tiles
  // in two different menus, rather than a second key holding the same word.
  tileDelete: "Delete",
  tileShare: "Share",
  // The app ≡ menu's About tile (#36, DRI ruling on PR #1019): its name is
  // `aboutOpen` ("About and licenses"), which already holds this word.
  tileAbout: "About",
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
  recorderBreadcrumb(
    book: string,
    chapter: string,
    segment: number,
    segmentLabel: string | null
  ): string {
    return this.trail(
      book,
      chapter,
      this.segmentHeading(segment, segmentLabel)
    );
  },
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
  zoomAtWhole: "Zoomed out. Zoom in to a quarter.",
  zoomAtQuarter: "Zoomed in to a quarter. Zoom out.",
  // The mic-denied title (D15, #948), from the O4 original.
  micOffTitle: "Microphone is off",
  micRetry: "Try again",
  micBack: "Go back",
  // The settings walk-through after the mic is refused a second time
  // (#1569). Each step leads with an icon in the panel; these are the words
  // beside it. The wording awaits the requirements owner.
  micStepsLabel: "Steps to turn the microphone on",
  micStepOpenSettings: "Open Settings on your phone",
  micStepAndroidApp: "Tap Apps, then tC Mobile, then Permissions",
  micStepIosApp: "Tap Privacy & Security, then Microphone",
  micStepIosAppOn: "Turn tC Mobile on",
  micStepMicOn: "Turn Microphone on",
  micStepComeBack: "Come back here and tap Try again",
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

  // ── Take-length warning (#1005, "Warn at 15, seal at 20") ────────────────
  // Rides inside the recorder's own elapsed-time readout once it tints to the
  // warn role, from 15:00 of a live take (`components/take-cap-marker.tsx`).
  // Parameterised, so it is outside `tests/strings-one-table.test.ts`'s
  // fixed-literal check the way `chapterName` and the other `(n) =>` entries
  // above are. The count goes through `plural` (#169) even though English
  // needs only the one form: the abbreviation does not vary by count here,
  // but the minute word does in other languages, and a table that can carry
  // `one`/`few`/`many` is what lets a second locale be data.
  takeCapWarning: (n: number): string => plural(n, { other: "{n} min left" }),

  // ── Recorder load failure (#137) ──────────────────────────────────────────
  // A finished segment's stored MP3 could not be decoded when the sheet opened
  // — most often a transient iOS "interrupted" AudioContext (#106), not a
  // corrupt clip. The sheet is a full panel, not a blank: the recording is
  // untouched, "Try again" resumes the context and re-decodes, and Back returns
  // to the Segments list, where the row's Reset (which does not decode) works.
  loadFailedTitle: "This recording could not be opened",
  loadFailedBody:
    "Your recording is safe. Try again, or go back to reset it from the list.",
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

  // ── What the recorder and the audio session raise (#169) ─────────────────
  // These sentences are read in `hooks/`, not in a component: they ride a
  // `playbackError`, or the recorder's own `error` state, up to whichever
  // surface is mounted. They were literals beside the code that raised them
  // until this table moved down into `lib/` (see the file header).
  //
  // The recorder's CAPTURE failures took the other route and are not here:
  // #700 made them codes (`lib/audio/capture-failure.ts`) that
  // `components/capture-failure-copy.ts` words out of the block further down,
  // because that value is a domain fact `lib/takes/close-plan.ts` also reasons
  // about. The ones below never leave the hook as data — they ARE the copy the
  // hook's state holds — so they read the table directly.

  // Playback could not sound: a decode that failed, or a take whose clip the
  // database no longer has. One sentence for both, because from where the
  // translator stands they are the same event — the tap made no sound.
  playbackFailed: "Could not play this recording.",
  // The honest sentence for each `classifyMicRefusal` class (#203). The
  // classifier itself stays UI-free; these are its words. Each names the one
  // place the translator (or the facilitator beside them) can act, because a
  // refusal the app cannot lift is only useful if it says who can.
  micNoDevice: "No microphone was found on this device.",
  micSiteBlocked:
    "Recording is blocked for this app. Allow the microphone in your browser's site settings, then try again.",
  micOsBlocked:
    "Your device is not letting the app use the microphone. Check microphone access in your device settings, then try again.",
  micPrompt:
    "Microphone access is needed to record. Allow it when asked — or if you already allowed it, check your device settings.",
  // The residual class: `getUserMedia` refused and said nothing usable about
  // why, so this claims nothing about the cause.
  micStartFailed: "Could not start recording.",
  // Not a refusal at all — `isRecordingSupported()` is false, so there is no
  // MediaRecorder to ask. Says the DEVICE rather than the app, and offers no
  // remedy, because none of the mic sentences above applies: nothing in
  // settings turns this on.
  recordingUnsupported: "This device cannot record audio.",

  // ── Recorder mode split (#89) ────────────────────────────────────────────
  // Play's two aria-labels. The glyph is `pause` while sounding (wireframe), but
  // the action is stop (D4), so the label says "Stop playing".
  playRecording: "Play recording",
  stopPlayback: "Stop playing",
  // The record-menu "Edit" row and the toolbar toggle in record mode (scissors)
  // — distinct from `editSegment(n)`, the Segments
  // list's per-row label.
  enterEdit: "Edit recording",
  // The edit toggle's name while editing, when it wears ✕ and a tap leaves
  // (#1252). Not "Done": that word keeps one meaning, mark finished.
  leaveEdit: "Stop editing",
  // The edit-mode marker inside the waveform's top right (D2, #1243): plain
  // text, not a control, so it is spoken as it reads.
  editingMarker: "Editing",

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
  // there (#621, the rule #608 set for `menuTitle`): the drawer's own
  // dismiss is a ⋮ (#1225), matching both controls that open it (the
  // record-mode header's and the edit toolbar's), so the glyph is its
  // only visible label. This string is shared with the per-row segment menu (`segment-row.tsx`),
  // which does not pass `hamburger` and still paints it as that menu's
  // visible heading — #589 owns that menu's affordances and has not
  // retitled it, so treat "never painted" as scoped to the recorder only.
  recorderMenuTitle: "More",
  recorderMenuOpen: "More actions",
  selectionStartHandle: "Selection start",
  selectionEndHandle: "Selection end",
  // A selection handle's spoken position (#1344), the slider's
  // `aria-valuetext`: seconds into the clip, to a tenth. `n` arrives already
  // rounded to a tenth, so the count in the phrase is the one that is said.
  // English is a proposal for the requirements owner (lib/plural.ts).
  selectionHandleTime: (n: number): string =>
    plural(n, { one: "{n} second", other: "{n} seconds" }),
  editFailed: "That edit could not be applied. Try a shorter selection.",
  clearFailed: "Could not reset the audio. Try again.",
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
  // Appended to a disabled ⋮-menu row's accessible name so the grey carries its
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
  // inside the ⋮ menu, where the recorder header — and so "Close recorder" —
  // is `inert` and the one live control on screen is the menu's own dismiss,
  // which since #621 wears a single glyph, the ✕ every sheet closes with
  // since #1268 (this menu opts into `hamburger`, `recorder-menu.tsx`), not a
  // back chevron. Describing the save control by its
  // looks here would still point at the dismiss, the exact collision the
  // round-1 `back` badge had (`menu-row-state.ts`, `rowHint`'s docblock);
  // #648 round 1 (George P2) caught the words repeating it.
  // `tests/menu-row-state.test.ts` pins this half: the hint never describes a
  // glyph, and separately pins that this menu's own dismiss is the one that
  // opts into `hamburger`.
  blockedByTake:
    'Use "Close menu", then "Close recorder", to save the recording.',
  // The `requesting` race: Record tapped, ⋮ opened before `getUserMedia`
  // resolves. No audio exists yet, so this must NOT promise a save — and must
  // not send anyone to a control that would abandon the in-flight start.
  micStarting: "The microphone is still starting.",
  nothingRecorded: "Nothing recorded yet.",
  nothingStored: "Nothing saved to reset.",

  // ── Live waveform (#120) ─────────────────────────────────────────────────
  liveWaveform: "Live recording waveform",

  // ── VU meter + Reset (erase) Segment (B6) ────────────────────────────────
  vuMeterLabel: "Recording level",
  vuMeterUnavailable: "Level meter unavailable on this device",
  // Reset: removes the recording, keeps the segment (#1119, DRI 2026-09-28).
  eraseSegment: "Reset segment and start over",
  // The record bar's row (#592): the same reset and the same confirm as the
  // menu row above, named for what the translator is doing — starting the
  // segment over — because the sheet stays open, ready for the next take.
  rerecord: "Reset and record again",
  segmentMenu: (n: number): string => `More actions for segment ${n}`,
  // Press-and-hold reorder on the Segments list (#953), spoken by
  // the list's live region: the row that was lifted, where it landed, or that
  // it went back. Segments renumber after a move (the DRI's "Renumber" pick),
  // so the landing is said as the segment's new number.
  reorderLifted: (n: number): string => `Moving segment ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Segment ${from} is now segment ${to}.`,
  reorderStayed: (n: number): string => `Segment ${n} stayed where it was.`,
  // The same three lines for a chapter on the Books screen (#953 PR2b). Said
  // by the chapter's number, which a move keeps (#1272, U2a), and then by the
  // position it landed in; a typed name such as "Mark 6" stays as it is (the
  // DRI's pick), so it would not say which chapter moved. Whole sentences (#1483): each says "chapter" in its own
  // words rather than wrapping `chapterName`'s.
  chapterReorderLifted: (n: number): string => `Moving chapter ${n}.`,
  chapterReorderMoved: (n: number, to: number): string =>
    `Chapter ${n} moved to place ${to}.`,
  chapterReorderStayed: (n: number): string =>
    `Chapter ${n} stayed where it was.`,
  // The same three lines for a book on the Books screen (#338). Said by the
  // book's heading (its name, or its placeholder), since a book has no number
  // that follows its place; the landing is its new place on the shelf, from 1.
  // Said as "position", never "number": "number" is the Book N placeholder (#1368).
  bookReorderLifted: (heading: string): string => `Moving ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} is now position ${to} on the shelf.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} stayed where it was.`,
  // Move up / Move down in the book and segment row menus (#1344, the DRI's
  // "Yes, menu Move up/down" pick): the tap path to reorder, for screen-reader
  // and motor users, beside press-and-hold. Each is the tile's whole name and
  // its caption too, so the caption is always a word of the name. A move is
  // then said by the same line a drop is (`reorderMoved`,
  // `bookReorderMoved`). The two hints are why a tile is greyed: Move up on
  // the first row, Move down on the last. English is a proposal for the
  // requirements owner.
  moveUp: "Move up",
  moveDown: "Move down",
  alreadyFirst: "Already first",
  alreadyLast: "Already last",
  eraseConfirmTitle: "Reset segment and start over",
  eraseConfirm: "Reset recording",
  // The safe action of the confirm dialog (`erase-confirm.tsx`). One string
  // for every flow it now serves — segment Reset, book Delete and segment
  // Delete (#590) — because it is the same control on the same surface
  // saying the same word.
  eraseCancel: "Cancel",
  // The record bar's bin confirm (O4 G5, #1028): the one tap that clears the
  // segment AND starts the next take, and the workbench's own "Keep it" for
  // the safe answer. The ⋮ menu's Reset keeps Reset / Cancel above.
  recordAgainConfirm: "Record again",
  recordAgainKeep: "Keep it",
  eraseFailed: "Could not reset the recording. Try again.",
  // The confirm's "Play what will be lost" row (#979 remainder, O4 "13"
  // only): the workbench's own copy, word for word, for the Play/Pause
  // transport beside the preview waveform.
  eraseConfirmPreviewPlay: "Play what will be lost",
  eraseConfirmPreviewPause: "Pause",
  // The clipboard's bin under the line (#862): throws away a cut that was
  // never pasted, behind the same confirm as the whole-take Reset. "Cut
  // audio", not "clipboard": the translator cut a piece of their recording,
  // and that piece is what is lost.
  discardClip: "Throw away the cut audio",
  discardClipConfirmTitle: "Throw away the cut audio?",
  discardClipConfirm: "Throw away",

  // ── Delete a book (#337) ─────────────────────────────────────────────────
  // The book sheet's Delete tile, and the ask behind it (#980).
  deleteBook: "Delete book",
  // Names the book, because this is the ask's accessible name and it is the
  // only thing that says WHICH shelf row is about to go. "everything
  // in it" is the honest scope: the chapters, the segments and every recording.
  deleteBookConfirmTitle: (book: string): string =>
    `Delete ${book} and everything in it?`,
  // The ask is inside the book sheet (#980, G6; #949 D16): the sheet's
  // actions swap for these two, under the book's cover and name. The
  // workbench's own labels, word for word — the DRI prefers the originals.
  keepBook: "Keep the book",
  deleteBookYes: "Yes, delete the book",
  // A destructive op that did NOT happen has to say so in its own words. The
  // store's own message — a quota or connection fault, since `deleteBook` never
  // throws on a missing book — is for a maintainer; this is the line a screen
  // reader speaks to a translator. Mirrors `eraseFailed` (#80).
  deleteBookFailed: "Could not delete this book. Try again.",

  // ── Delete a segment (#590) ────────────────────────────────────────────────
  // The chapter view's segment-row menu tile/row that deletes the segment
  // itself, not only its audio (reverses G4, `docs/design/pivot-plan.md`'s
  // Gate 1, for this one entry) — behind the same confirm component Reset and
  // book Delete use, mounted a second time on the chapter view
  // (`segments-screen.tsx` keeps a separate `EraseConfirm` for it).
  //
  // #590/#1080 first shipped this in the RECORDER's ⋮ menu; #1104 (the
  // requirements owner's 2026-09-26 decision) moved it here instead: "the
  // menu inside the segment editor (recorder) shows Erase only. Delete
  // (removing the whole segment) belongs to the chapter view." The strings
  // below are unchanged by that move — only their call site is.
  //
  // No O4 workbench wording exists for this exact tile: D20
  // (`docs/design/o4-design-system.md`) draws "Remove this segment" for
  // #997's narrower, empty-only action (deferred by the DRI past the
  // training build), not this one. This reuses the erase/delete strings'
  // own pattern instead — the exact wording is a residual for the DRI to
  // confirm, not a workbench transcription.
  deleteSegment: "Delete segment",
  // Caption is the shared `tileDelete` above, not a second key — same word,
  // same tone (destructive), just a different tile.
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Delete segment ${ordinal}?`,
  deleteSegmentConfirm: "Delete",
  // `eraseCancel`'s own comment already says Reset and book Delete share one
  // dialog and one word; this is the third flow on it.
  deleteSegmentFailed: "Could not delete this segment. Try again.",

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
  // The O4 share circle (#947). D22: the core is a progress bar with this
  // label, chapter and book alike. D21: the numbered chips above it are one
  // image with this label — how many of the items go out, of all of them.
  // The verb agrees with `out`, so the choice goes through `plural` rather
  // than a fixed "go" (#169).
  sharePreparingLabel: "Preparing to share",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `{n} of ${all} goes out`,
      other: `{n} of ${all} go out`,
    }),
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
  // Each form is the whole sentence (#1483).
  shareMissing: (n: number): string =>
    plural(n, {
      one: "{n} segment could not be included.",
      other: "{n} segments could not be included.",
    }),
  // The book name is free text since #264, so sanitise it into the filename —
  // a `/` in "Mark/Luke" would otherwise split a zip entry into a folder (G3).
  // The chapter's own name (#264) is free text too and is sanitised the same
  // way (#1218). No name, or one with nothing left once sanitised, falls back
  // to the default through `chapterName`, the one place that spells it.
  // The chapter's number comes first ("03 Jonah runs", the requirements
  // owner's R18 pick on #1233), zero-padded to the digits of the book's
  // highest chapter number and never fewer than two, so a book's files sort
  // in chapter order even past 99 (the coordinator's call on #1516); its bytes
  // come out of the chapter label's budget.
  shareFilename(
    book: string,
    chapter: number,
    chapterName: string | null = null,
    highest: number = chapter,
    licence: LicenceId | null = null
  ): string {
    const width = Math.max(2, String(Math.max(chapter, highest)).length);
    // ASCII digits and a space, so its length is its UTF-8 byte count.
    const number = `${String(chapter).padStart(width, "0")} `;
    // The licence tag (#1566) sits before the extension and is ASCII too; its
    // bytes come out of the chapter label's budget, so the name still fits.
    const tag = licenceTag(licence);
    const reserved = number.length + tag.length;
    const label = filenameSafe(chapterName ?? "", reserved);
    return `${filenameSafe(book)} - ${number}${
      label === "" ? filenameSafe(this.chapterName(chapter), reserved) : label
    }${tag}.mp3`;
  },

  // Share Book — the book-level ⋮ menu and its zip-of-chapter-MP3s share. Names
  // each book so AT users can tell one shelf row's menu from the next.
  bookMenuOpen: (book: string): string => `More actions for ${book}`,
  bookMenuTitle: "Book",
  shareBook: "Share book",
  // See `shareChapterUnconfirmed`'s own comment — the book-menu equivalent.
  shareBookUnconfirmed:
    "Share book. The last attempt wasn't confirmed — tap to try again.",
  shareBookPreparing: "Preparing the book to share.",
  // Export project (#1457): the Scripture Bundle of one book, in the book's
  // ⋮ menu below Share book. The caption must be a word the label holds.
  exportProject: "Export project",
  tileExport: "Export",
  exportProjectPreparing: "Preparing the project to export.",
  // ADR 0014 point 8 (amended 2026-10-22, #1627): `<book> - <word>.zip`, where
  // the word follows the app's language the way Share Book's chapter names do
  // (`chapterName`), so it differs from Share Book's `<book>.zip`. Sanitised
  // like shareBookFilename. The book name from the Bible Passages dataset is
  // not built yet (the rest of #1627).
  exportProjectSuffix: "project",
  exportProjectFilename(book: string): string {
    const word = filenameSafe(this.exportProjectSuffix) || "project";
    const suffix = ` - ${word}.zip`;
    const label =
      filenameSafe(book, new TextEncoder().encode(suffix).length) ||
      this.shareNameFallback;
    return `${label}${suffix}`;
  },
  // The language ask on a book's first Export project (#1492, ADR 0017).
  languageAskTitle: "Language of this book",
  languageAskLead:
    "What language are the recordings in? You choose once, and every export of this book uses it.",
  languageSearch: "Search languages",
  languageSearchHint: "Name or code",
  languageLoading: "Loading the languages.",
  languageLoadFailed: "Could not load the languages.",
  languageNoMatch: "No language matches. Try another name or code.",
  languageNarrow: "Type more to see other languages.",
  // The language search's spoken result count (#1344, #1492): a polite status
  // line, said once the search settles. English is a proposal for the
  // requirements owner. Each form is a whole phrase (lib/plural.ts).
  languageCount: (n: number): string =>
    plural(n, { one: "{n} language matches.", other: "{n} languages match." }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      other: `{n} languages match. Showing the first ${shown}. Type more to narrow your search.`,
    }),
  languageSaving: "Saving the language.",
  languageAskCancel: "Cancel",
  licenceAskTitle: "Licence of this book",
  licenceAskLead:
    "Who may share these recordings? You choose once for this book.",
  licenceAllRightsReserved: "All rights reserved",
  licenceSaving: "Saving the licence.",
  licenceAskContinue: "Share",
  licenceAskCancel: "Cancel",
  // The book menu's Licence tile (#1455, "change it later"). English is a
  // proposal for the requirements owner. The tile's name holds its caption
  // (label-in-name); the Templates tile gets its own caption key here too, so
  // a language can shorten it without renaming the tile (#1655).
  licenceTileLabel: "Change licence",
  tileLicence: "Licence",
  tileTemplates: "Templates",
  licenceAskSave: "Save",
  licenceAskSaveLead:
    "Who may share these recordings? You can change this again later.",
  // Each licence radio's spoken name (#1344, #1455): the full title, then the
  // short label the row shows, so the name still holds the visible text. The
  // file-name tag and the ID3 text keep the short label. English is a proposal
  // for the requirements owner (inference: the standard Creative Commons
  // titles are what they would choose).
  licenceNameCcBySa: "Creative Commons Attribution-ShareAlike 4.0",
  licenceNameCcBy: "Creative Commons Attribution 4.0",
  licenceNameCc0: "Creative Commons Zero 1.0, public domain",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  shareBookNothing: "Record a segment before sharing this book.",
  shareBookFailed: "Could not share this book. Try again.",
  // The web build's version (#272). Chromium source indicates Android Chrome
  // refuses a zip inside `share()`, after the encode, so trying again would
  // not help there; the app's native share sheet takes it. Not
  // device-confirmed. Other browsers can still be retried from the same menu
  // item, so no "try again" is promised.
  shareBookFailedWeb:
    "Could not share this book. Sharing a book works in the tC Mobile app.",
  // `missing` counts whole chapters left out of the zip — a chapter with no
  // resolvable audio at all.
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "{n} chapter could not be included.",
      other: "{n} chapters could not be included.",
    }),
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
  shareBookPartial(n: number): string {
    return this.shareMissing(n);
  },
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
  // The two halves of this sentence are counted differently on purpose, and
  // that split is the load-bearing part.
  //
  // The SEGMENT noun goes through `plural` like every other count-varying
  // string in this table (#169) — a CLDR category, not an English `n === 1`.
  //
  // The CHAPTER scope counts `partialChapters`, the producer's count of
  // DISTINCT included chapters, and also goes through `plural` — but its
  // singular "an included chapter" is NOT keyed off `one`. CLDR's `one` is not
  // "exactly 1": Russian selects it for 21, 31, 101. Keying that wording off a
  // plural category would let a second locale assert one chapter about
  // twenty-one of them, which is the #400/#423 bug in a new place. The wording
  // is a claim that the count IS exactly one, so it rides `plural`'s explicit
  // `"=1"` arm (ICU's `=1`, matched on the number, not the category). The `one`
  // form is the counted "{n} included chapter", which stays true at 21. A
  // locale needing `few`/`many` adds those keys and changes no code.
  //
  // An earlier draft of this paragraph said the clause was "NOT `plural`'s
  // `one` form" and described a `segments === 1` case. That case is gone —
  // `5860fb6` routed the segment noun through `plural` and the chapter scope
  // already keyed off `partialChapters` (#446) — so the sentence described
  // code that is not here (Frank, round 4). Rewritten rather than patched,
  // because the warning it carried is still right and worth keeping; only its
  // account of the code was false.
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
  //
  // The chapter clause goes through `plural`, not an English `> 1` ternary
  // (#169), with the exact-1 arm described above. The count is floored at 1 because a
  // segment gap sits in at least one included chapter: the caller passes
  // `partialChapters ?? 0` from an optional field (`share-error-copy.ts`), and
  // a missing count must still read "an included chapter", as the ternary
  // did, rather than claim "0 included chapters" about a gap that exists.
  //
  // The second sentence is written out whole for each pair of counts (#1483),
  // rather than as two count phrases spliced into one frame: the chapter
  // scope picks the row, the segment count picks the form within it, and
  // `{chapters}` holds the chapter count where a form names it. The two whole
  // sentences are joined by `sentences`, which owns the separator (#1483).
  shareBookMissingAndPartial(
    chapters: number,
    segments: number,
    partialChapters: number
  ): string {
    const scope = Math.max(partialChapters, 1);
    const bySegments = (one: string, other: string): string =>
      plural(segments, { one, other }).replaceAll("{chapters}", () =>
        String(scope)
      );
    const partial = plural(scope, {
      "=1": bySegments(
        "{n} segment of an included chapter could not be included.",
        "{n} segments of an included chapter could not be included."
      ),
      one: bySegments(
        "{n} segment of {chapters} included chapter could not be included.",
        "{n} segments of {chapters} included chapter could not be included."
      ),
      other: bySegments(
        "{n} segment of {chapters} included chapters could not be included.",
        "{n} segments of {chapters} included chapters could not be included."
      ),
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  // The encoder went silent mid-share and was restarted (#166). Chapter and book
  // alike: the cause is the phone, not what was being shared. Try again is still
  // the first thing to do — the encoder was restarted — and the restart hint is
  // here because the Books shelf that carries it is not on screen while a
  // chapter is open (George R2 P3-2).
  shareEncoderStopped:
    "Could not prepare this to share. Try again — if it keeps happening, restart the app.",
  // Sanitised like shareFilename: the book name is the .zip File name and must
  // not carry a path separator or a reserved character (G3).
  // A Creative Commons licence adds its tag before the extension (#1566); its
  // bytes are reserved from the book label.
  shareBookFilename(book: string, licence: LicenceId | null = null): string {
    const tag = licenceTag(licence);
    const label = filenameSafe(book, tag.length) || this.shareNameFallback;
    return `${label}${tag}.zip`;
  },
  // What a book is called in a share filename or folder when its name
  // sanitises to nothing ("///"), so no file is ".zip" and no folder is "".
  shareNameFallback: "Book",

  // ── The save that failed (#38) ───────────────────────────────────────────
  // The text layer of the screen that stands between a failed save and losing
  // the recording. Its two paths — a fresh recording, or the edited buffer of
  // one — are a PARAMETER rather than two blocks of keys, because on the edit
  // path the previously stored recording is untouched on disk and a line that
  // said "recording" would misname what a discard destroys.
  //
  // The headline, the safety line and the attempt count are here too (#169),
  // below. `components/recovery-copy.ts` still decides WHICH of them a failure
  // gets, and that choosing is what its tests are about; only the words moved.
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Your changes are not saved" : "This recording is not saved",
  // In place of the headline while a retry is in flight.
  saveFailedSaving: "Saving",
  // The one promise this screen makes, and the reason it can make it: the commit
  // is ONE transaction (#38), so a failed save left the take in the RAM slot
  // `useSaveTake` holds. Names the segment when the held take belongs to the
  // chapter on screen, and says nothing about it when it does not. Each arm is
  // a whole sentence rather than a subject spliced into one frame (#169): a
  // second locale may need the article, case or word order to change with
  // what is held, and a shared frame would force English's on it.
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Your edited recording is still here."
        : `Your edited recording of segment ${ordinal} is still here.`
      : ordinal === null
        ? "Your recording is still here."
        : `Your recording of segment ${ordinal} is still here.`,
  // NOT `tryAgain` and NOT `loadRetry`: this retries a WRITE, and on an
  // icon-only `Control` the label is the whole thing a screen reader speaks.
  saveFailedRetry: "Try saving again",
  // The two-tap discard, and the fainter line beneath it once armed. "for good"
  // only on the record path — there the held take is the only copy; on the edit
  // path the stored recording survives and only the edit goes.
  //
  // The record-path arms ARE the take-recovery panel's discard copy, read from
  // those keys rather than written out a second time (#805 item 1): both
  // confirms destroy the only copy of a recording, and `takeRecoverDiscard`'s
  // own comment says the two share one shape.
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Tap again to discard these changes"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Discard these changes"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Tap again to discard them."
      : this.takeRecoverDiscardHint;
  },
  // The headline for each failure kind but `quota`, which reads `noRoom`.
  // `recoveryTitle` in `components/recovery-copy.ts` says why each is worded
  // the way it is; a `downgrade` names what is needed, not what went wrong.
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Your changes need the new version of the app."
      : "This recording needs the new version of the app.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "This book is gone. Your changes cannot be saved."
      : "This book is gone. This recording cannot be saved.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Your changes could not be saved."
      : "This recording could not be saved.",
  // The safety line under Retry. `saveFailedOnlyCopy` is the one every failure
  // gets unless staying in the app cannot help; `recoverySafetyLine` holds the
  // two exceptions' reasons (#38, #441).
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "This copy of the app cannot save them. Restarting will lose them, but is the only way to get the new version."
      : "This copy of the app cannot save it. Restarting will lose it, but is the only way to get the new version.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "This book was deleted in another copy of the app. Discard is the only exit."
      : "This book was deleted in another copy of the app. Delete this recording to leave.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "This screen has the only copy of your changes. Don't close the app."
      : "This screen has the only copy of your unsaved work. Don't close the app.",
  // The faint count beside the safety line. `recoveryAttempts` decides when it
  // shows.
  saveFailedAttempts: (attempts: number): string => `Attempts: ${attempts}`,

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
  // A restart armed over audio only this screen holds: the label on the
  // second tap, then the line beside it. One whole sentence per loss (#169),
  // so a second locale translates each rather than a phrase glued into a
  // frame. `components/recovery-copy.ts` says which screen passes which, and
  // why the cut clause exists. `cutAudio` IS the cut phrase, so the flag adds
  // nothing to it.
  restartArmed: (subject: RestartSubject, alsoCutAudio: boolean): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Tap again to restart and lose this recording and the audio you cut"
          : "Tap again to restart and lose this recording";
      case "changes":
        return alsoCutAudio
          ? "Tap again to restart and lose these changes and the audio you cut"
          : "Tap again to restart and lose these changes";
      case "cutAudio":
        return "Tap again to restart and lose the audio you cut";
    }
  },
  restartGone: (subject: RestartSubject, alsoCutAudio: boolean): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Tap again and this recording and the audio you cut are gone."
          : "Tap again and this recording is gone.";
      case "changes":
        return alsoCutAudio
          ? "Tap again and these changes and the audio you cut are gone."
          : "Tap again and these changes are gone.";
      case "cutAudio":
        return "Tap again and the audio you cut is gone.";
    }
  },
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
  // (`storage-pressure-notice.ts`). Both lines name the pair
  // `pressure.ts`'s docblock names — mark segments Finished (ADR 0009's
  // transcode reclaims ~90%) or share the work and then remove it — not bare
  // "share", which does not reclaim anything on its own: `lib/export/
  // chapter.ts` decodes and re-encodes without deleting a single stored clip.
  //
  // **#843 item 1: `storageLow` gained the fallback clause `storageCritical`
  // already had.** George's finding: the gate both bands share,
  // `hasReclaimableAudio` (`recordedCount > 0`), stays true even when every
  // recorded segment on the shelf is already Finished (MP3, not PCM) — a real
  // state where "mark segments finished" recommends something already done.
  // `storagePressureNotice` only ever sees the marker, not the
  // finished/recorded split, so it cannot gate the clause on that state
  // (George: "not asking for another boolean"). The fix instead matches
  // `storageCritical`'s existing shape: state the fallback unconditionally,
  // so the sentence holds in every state this gate can actually show, the
  // same way `storageCritical`'s fallback already did before this change.
  storageLow:
    "This phone is running low on space. Mark segments finished to free up room, or share your work and then remove it.",
  storageCritical:
    "This phone is almost out of space, and new recordings may not save. Mark finished segments, or share your work and then remove it.",
  // The O4 storage banner's own line (state 17, #983), word for word from
  // the workbench. It leads; the band's line above follows it, because the
  // workbench speaks that reason through a speaker button this app does not
  // have yet (#952).
  storageShareSoon: "Share your work soon",

  // ── Share your work (#987, the O4 storage banner's button, #948 D14) ──────
  // Every book on the phone as one zip, one folder per book. The labels
  // follow Share Book's; the gap lines speak in the library's own units
  // (`LibraryShareGap`): whole books left out, and chapters inside included
  // books that did not ship whole.
  shareAll: "Share your work",
  shareAllUnconfirmed:
    "Share your work. The last attempt wasn't confirmed — tap to try again.",
  shareAllPreparing: "Preparing your work to share.",
  shareAllNothing: "Record a segment before sharing your work.",
  shareAllFailed: "Could not share your work. Try again.",
  // The web build's version (#1333), as `shareBookFailedWeb` is for the book
  // (#272): the library goes out as a zip too, which Chromium source
  // indicates Android Chrome refuses inside `share()`, after the encode, so
  // trying again would not help there. Not device-confirmed.
  shareAllFailedWeb:
    "Could not share your work. Use the tC Mobile app to share it.",
  // `roomForExport` said the phone has too little free space to build the
  // archive, checked before any encode. The way out is the one the storage
  // lines above already name: finished segments take much less room.
  shareAllStorage:
    "This phone does not have room to prepare your work. Mark finished segments, then try again.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "{n} book could not be included.",
      other: "{n} books could not be included.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "{n} chapter could not be included in full.",
      other: "{n} chapters could not be included in full.",
    }),
  shareAllFilename: "My work.zip",
  // Each book's folder inside the zip, sanitised like shareBookFilename.
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },

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

  // ── About & licenses (#36) ───────────────────────────────────────────────
  // The global-menu entry, and the panel it opens. lamejs is LGPL-3.0 (ADR
  // 0003); this surface is what makes its notice and licence text reachable on
  // the phone. A text screen by necessity — a legal notice has no wordless
  // form — so every link carries a full spoken label.
  aboutOpen: "About and licenses",
  aboutTitle: "About & licenses",
  aboutBlurb:
    "A free and open-source app. Everything you record stays on this phone.",
  aboutAppLicense: "This app is offered under the MIT licence.",
  // The LGPL/GPL written offer for the app's own Corresponding Source, on the
  // shipped copy itself (the README carries it too, but the installed PWA ships
  // no `*.md`). The repository went public 2026-09-13, so — per the DRI's
  // 2026-09-24 decision on #144 — the offer now links the public source for THIS
  // build's exact commit (a tree URL built from the full commit id,
  // `__BUILD_SHA_FULL__`, in `SourceOfferLink`), the §4(d)(0) mechanism ADR
  // 0003 records. Still no relink how-to on the shipped copy.
  aboutSourceOffer:
    "The source code for this app is public. This build's source:",
  // aria-label for the source link; the visible text is the repository path.
  aboutVisitAppSource: "Open this build's source on GitHub",
  // The privacy policy, linked in the app as well as in the store listings
  // (#1210; Apple guideline 5.1.1(i)). The visible text names the document;
  // the aria-label says what the link does.
  aboutPrivacy: "How this app handles your data:",
  aboutPrivacyLink: "Privacy policy",
  aboutVisitPrivacy: "Open the privacy policy",
  aboutThirdParty: "Open-source components",
  aboutTexts: "Licence texts",
  // The Android build's store QR (#1250): the visible caption under it, and the
  // image's accessible name.
  aboutQrCaption: "Scan to get the app",
  aboutContent: "Bundled content",
  // The ISO 639-3 terms of use ask that "attribution is given to
  // iso639-3.sil.org as the source of the codes" (ADR 0017).
  aboutLanguageCodes: "Language codes: ISO 639-3, from iso639-3.sil.org.",
  // The licence texts open in-drawer (no new tab), so their controls are
  // buttons: this is the spoken action, and the two states while it loads.
  aboutReadText: (name: string): string => `Read ${name}`,
  // While a licence text is open the Menu header goes back to the list rather
  // than closing, so it says so (George G1, round 3).
  aboutBack: "Back to the list",
  aboutTextLoading: "Loading the licence text.",
  aboutTextFailed: "Could not load the licence text.",
  // Spoken labels for the off-phone links (a project page, a CC deed), which
  // show terse visible text (a package name, a licence short-name).
  aboutVisitSource: (name: string): string => `Open the ${name} project page`,
  // The lamejs source is a copy kept in this app's own repository at this
  // build's commit (#36), not the upstream project page, so it says so.
  aboutVisitKeptSource: (name: string): string =>
    `Open the ${name} source kept with this build`,
  aboutVisitLicense: (name: string): string => `Open the ${name} licence`,

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
  // Whole sentences (#1483), not `failuresMarker` with a stop appended: a
  // language may word the count differently once it ends a sentence. The
  // English must still say what the marker says, so the panel and the
  // control it opens agree about the number; `tests/strings-plural.test.ts`
  // pins that equality for English.
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Open menu. {n} problem recorded.",
      other: "Open menu. {n} problems recorded.",
    }),
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
  // Behind the bin: the same two-tap confirm the segment Clear and the book
  // Delete use, not a second dialog (George R2 P3-3). Clearing is the one
  // irreversible write in this panel — the report is the only copy of what went
  // wrong that ever leaves the phone, and the bin sits directly under Share,
  // which is where the thumb already is.
  clearFailureLogConfirmTitle: "Clear the problem report?",
  clearFailureLogConfirm: "Clear",

  // ── Failure vocabulary (#172) ────────────────────────────────────────────
  // What `use-books.ts`, `use-chapter-segments.ts` and `use-erase-segment.ts`
  // map a caught failure KEY to, so a Books/Segments Notice never speaks a raw
  // browser exception string. Deliberately generic — a message worth wording
  // more specifically per site is a product decision for the requirements
  // owner, not one this table invents (see the PR's residual list).
  // `eraseFailed` already existed above and is reused rather than duplicated.
  loadFailed: "Could not load. Try again.",
  saveFailed: "Could not save. Try again.",
  // Repeats `recoveryTitle`'s quota sentence (`components/recovery-copy.ts`)
  // so the one condition a translator can act on reads the same everywhere a
  // write can hit it, not only on the take-save recovery screen.
  noRoom: "No room left on this phone.",
  // A book name another book already has (#1272, S13). Shown in the name
  // sheet itself; asks for another name rather than naming a fault.
  bookNameTaken: "Another book has this name. Type a different name.",

  // ── Record-bar Edit, blocked by a live take (#857 round 1, Frank P2) ─────
  // `barHint`'s own words for the `"uncommitted-take"` reason (`menu-row-
  // state.ts`) — distinct from `blockedByTake`, which sends a translator to
  // "Close menu", then "Close recorder": neither exists on the bar, and the
  // bar's own Stop, beside the toolbar Edit control, is the way out. Names
  // that control by its real accessible name while recording (`strings.stop`,
  // "Stop recording"), the same rule `blockedByTake` follows for the menu.
  // The wording itself is a coordinator assumption pending the requirements
  // owner's sign-off — see the #857 PR body.
  stopToEdit: "Stop recording to edit.",

  // ── Record-bar bin, blocked by a live take (#878, sibling of #857/#869) ──
  // `barHint`'s words for the bin's own `"uncommitted-take"` reason
  // (`menu-row-state.ts`) — #869 round 1 fixed the toolbar Edit control's
  // identical gap and left this one as a named residual, since it predates
  // #857's `hasTake` change and needed its own copy no one had reviewed.
  // Names the bar's own Stop control by its real accessible name
  // (`strings.stop`, "Stop recording"), the same rule `stopToEdit` follows.
  // The wording itself is a coordinator assumption pending the requirements
  // owner's sign-off — see the #878 PR body.
  stopToErase: "Stop recording to reset.",

  // ── Phone check (#1009) ──────────────────────────────────────────────────
  // A hidden tester screen, reached by five taps on the build stamp or by
  // `?check=phone`. Its words are for a tester filling in #974, not for a
  // translator, but they are screen copy all the same and so live here. They
  // are English on purpose (S11-tester-screens, #1483): every `phoneCheck*`
  // key is listed in `lib/i18n/english-only.ts`, which the coverage test pins
  // to this group, so a new key here must be added there too. The
  // REPORT it produces is engineering data and is worded in
  // `lib/phone-check/report.ts` instead — see that file's docblock.
  phoneCheckTitle: "Phone check",
  phoneCheckIntro:
    "Measures this phone for a tester report. Nothing runs until you tap Start, and it never touches your books or recordings.",
  phoneCheckStart: "Start",
  phoneCheckRunWaiting: "Waiting for a recording to finish converting.",
  phoneCheckRunStopping: "Stopping the last check.",
  phoneCheckRunDevice: "Reading device info.",
  phoneCheckRunEncode: "Encoding 5 minutes of test audio.",
  phoneCheckRunDsp: "Processing 1 minute of test audio, twice.",
  phoneCheckRunStorage: "Writing and reading 50 MB of test audio.",
  phoneCheckDone: "Done.",
  phoneCheckMemoryTitle: "Memory ceiling",
  phoneCheckMemoryWarning:
    "Run this last. It fills memory until the phone refuses, and the app may restart. If it does, open Phone check again to see how far it got.",
  phoneCheckMemoryStart: "Start memory test",
  phoneCheckMemoryStep: (mb: number) => `Trying ${mb} MB.`,
  phoneCheckReportLabel: "Report for #974",
  phoneCheckCopy: "Copy report",
  phoneCheckCopied: "Copied.",
  phoneCheckSelected: "Selected. Use your phone's Copy.",
  phoneCheckClose: "Close",
  phoneCheckFontTitle: "Script samples",
  phoneCheckFontIntro:
    "Each line is one script, tagged with its language so this phone picks its own font. Boxes, blanks or question marks mean this phone has no font for it. After each line in the report, write rendered or tofu.",
  phoneCheckDigitsTitle: "Digits",
  phoneCheckDigitsNote:
    "The same ten digits in three forms. These are fixed strings: they show which digit shapes this phone can draw, not what the app prints.",

  // ── Cover colour picker (#957, from #937 D7/D8) ──────────────────────────
  // The picker's group name, and one name per palette key
  // (`lib/cover-colour.ts`'s `CoverColourKey`) — the whole accessible text
  // layer for a screen built for people who may not read, so each swatch has
  // to carry a real word, not just a fill colour a screen reader cannot see.
  // Worded by `components/cover-colour-copy.ts`'s exhaustive switch, the same
  // split `capture-failure-copy.ts` uses: the KEY is a `lib/` value, the
  // WORDS live here.
  coverColourLabel: "Cover colour",
  coverColourAmber: "Amber",
  coverColourTeal: "Teal",
  coverColourPlum: "Plum",
  coverColourForest: "Forest",
  coverColourBrick: "Brick",
  coverColourSlate: "Slate",
  coverColourRose: "Rose",
  coverColourOlive: "Olive",
  coverColourRust: "Rust",
  coverColourCocoa: "Cocoa",
  // A swatch button's whole accessible name: the colour's name, plus its
  // selected state — the same "whole name, plus a trailing state word" shape
  // `bookRow` above uses for "expanded"/"collapsed". `aria-pressed` already
  // carries this machine-readably; the word is for the same reason `pressed`
  // is never inferred from a glyph alone (`Control`'s own `pressed` doc).
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, selected` : name,

  // The chapter row's play control (#1469). The name carries the state
  // because the control is not a toggle (no `aria-pressed`) and announces
  // nothing: a screen reader hears the next thing a tap does. Each is a whole
  // sentence with its slots, so a language that orders them differently
  // rewrites the entry rather than a call site. `percent` is a whole number.
  playChapter: (heading: string): string => `Play ${heading}`,
  pauseChapter: (heading: string): string => `Pause ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Resume ${heading}, paused at ${percent} percent`,
  // A failed play's whole name (#1344): it says the chapter did not play and
  // that a tap tries again, because the ring's failure colour is not spoken.
  // English is a proposal for the requirements owner.
  chapterPlayFailed: (heading: string): string =>
    `${heading} did not play. Tap to try again`,
  // The disabled control's whole name: it stays focusable, so the reason is
  // what it says.
  chapterNothingToPlay: (heading: string): string =>
    `${heading} has nothing recorded to play`,
} as const;

/**
 * The shape of a table: every key of the English one, with a fixed sentence
 * typed as `string` rather than as its English literal, so another language's
 * table is assignable. Function entries keep their signatures.
 */
export type Strings = {
  -readonly [K in keyof typeof stringsEn]: (typeof stringsEn)[K] extends string
    ? string
    : (typeof stringsEn)[K];
};

/**
 * The table the UI reads. A live ES binding: importers see the table that
 * `installStrings` last installed, not the one that existed when they were
 * evaluated. English until `installLocale` (`lib/i18n/locales.ts`) installs
 * the table the phone's language resolves to (ADR 0015).
 *
 * Read it at the point of use. A module-scope `const x = strings.name` would
 * freeze whichever table was installed when that module loaded.
 */
export let strings: Strings = stringsEn;

/** Point `strings` at `table`. Takes effect for every later read. */
export function installStrings(table: Strings): void {
  strings = table;
}
