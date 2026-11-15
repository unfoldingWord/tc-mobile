import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The tpi table: Tok Pisin, the Melanesian creole used across Papua New
 * Guinea, drafted by AI under the decisions on #1458 (Q1 and Q3, "Use AI to
 * draft, we'll revise as-needed") and following `docs/i18n/glossary.md`. It is
 * the fourth level-3 language in the app (#357, the DRI's pick on 2026-11-05,
 * "Tok Pisin (tpi)"). AI DRAFT, AWAITING NATIVE-SPEAKER REVIEW: no Tok Pisin
 * reader has checked the meaning.
 *
 * Register: plain, widely understood Tok Pisin rather than any one town's
 * speech. Buttons and labels are the short transitive verb ("Rekodim",
 * "Serim", "Rausim"); sentences that speak to the person use "yu". Words a
 * phone already shows in English are kept as loans in Tok Pisin spelling where
 * the glossary says so (rekod, maikrofon, fon, app, seting, laisens). Tile
 * captions are kept to a word or two, because a caption has a length budget;
 * where the glossary's term is longer ("Stat gen long rekod", row 11; "Long
 * dispela app", row 27), the caption takes its first words and the longer
 * term is used where the English says the whole phrase. Digits are 0 to 9
 * (R19).
 *
 * The microphone steps name the phone's own menus (Settings, Apps,
 * Permissions, Privacy & Security, Microphone) in English. Assumption, not
 * checked on a device: no phone menu in Tok Pisin is known to the drafter, so
 * the person reads those names in English on the phone itself.
 *
 * Plurals: Tok Pisin has one CLDR plural category, `other`
 * (`Intl.PluralRules("tpi")` reports only that one), so every count entry
 * carries only that form. A noun is not inflected for number; "ol" marks a
 * plural where no number is given, and a numeral needs no "ol" ("2 sapta").
 * Wording that means exactly one ("wanpela sapta") rides the `"=1"` arm.
 *
 * Least-certain cells (AI draft; unconfirmed until a Tok Pisin reader signs
 * off), so a reviewer can start with them:
 * - `tileErase`, `eraseConfirm`, `eraseSegment`, `rerecord` and the other
 *   Reset wording ("Stat gen", glossary row 11): it must mean "clear this
 *   recording, keep the segment", and "stat gen" (start again) may read as
 *   restarting the app; the glossary marks the row least certain.
 * - `tileAbout`, `aboutOpen`, `aboutTitle` ("Long app", glossary row 27,
 *   shortened): the glossary marks the row least certain, and the shortened
 *   caption may read as a fragment.
 * - `pauseSegment`, `pauseChapter`, `eraseConfirmPreviewPause`,
 *   `resumeChapter`: the glossary's Pause is "Wet" (wait); the named entries
 *   say "Stopim liklik" (stop for a while) because "Wet" takes no object.
 *   Either may read wrongly.
 * - `recorderDialog` ("Masin rekod"): no settled word for a recorder app
 *   is known to the drafter.
 * - The cover colours: Tok Pisin names few colours, so most cells are loans
 *   or descriptions ("Blugrin", "Grinpela bus", "Retpela graun") that a reader
 *   may not recognise as colour names.
 * - `coverColourRust` ("Ros"): also the ordinary word for the flower, while
 *   `coverColourRose` is "Pinkpela"; a reader should check that "Ros" reads
 *   as rust and not as rose.
 * - The licence names (`licenceNameCcBySa`, `licenceNameCcBy`,
 *   `licenceNameCc0`): legal terms with no established Tok Pisin rendering.
 * - `settingsNormalizeOnFinished`, `settingsCompressOnFinished`: sound terms
 *   ("strong bilong nois", "daunim") with no established technical wording.
 * - `zoomAtWhole`, `zoomAtQuarter`, `selectionStartHandle`,
 *   `selectionEndHandle`, `liveWaveform`, `vuMeterLabel`: editing words the
 *   drafter has no attested Tok Pisin for, so they are descriptions.
 * - `shareAllIncomplete` ("i go insait hap tasol", went in only in part):
 *   must mean "only in part", not "complete chapters were not included"
 *   (#1897).
 * - `shareBookMissingAndPartial`'s partial clause ("Long ... sapta i stap
 *   insait, {n} hap i no inap i go insait"): the chapters are in the share,
 *   the segments are not; a reader should confirm it reads as one claim.
 * - `loadFailedBody`: it mirrors the English, which asks for "Traim gen"
 *   first and offers reset from the list only "if it still won't open"
 *   (#1933), so it names "stat gen", the Reset word; a reader should confirm
 *   that does not contradict "i stap gut", and that "Sapos yu no inap opim
 *   yet" reads as "if it still won't open" rather than "before you open it".
 * - `captureStoppedSilent` (#1986): "harim tasol nogat nois" (heard only no
 *   sound) stands for "heard only silence", and "i stap gut" (as in
 *   `loadFailedBody`) for "is saved"; a reader should confirm both.
 *
 * Entries that only arrange other entries (`trail`, `sentences`, the filename
 * builders) reuse the English logic through the merged table, so the licence
 * tag and byte budget live in one place. The tester-only phone check stays
 * English by decision (`english-only.ts`) and is not in this file.
 */
export const table: Partial<Strings> & ThisType<Strings> = {
  trail: (...parts: readonly string[]): string => parts.join(" > "),
  sentences: (...parts: readonly string[]): string => parts.join(" "),

  // Books screen
  newBook: "Nupela buk",
  menuOpen: "Opim menu",
  menuTitle: "Menu",
  menuClose: "Pasim menu",
  settingsOpen: "Ol seting",
  settingsTitle: "Ol seting",
  templatesOpen: "Ol templet",
  templatesTitle: "Ol templet",
  templateLicenceLabel: (licence: string): string => `Laisens: ${licence}`,
  loadingTemplates: "Wok long opim ol templet.",
  settingsChapterNumbers: "Oltaim soim namba bilong sapta",
  settingsNormalizeOnFinished:
    "Mekim strong bilong nois i wankain taim em i pinis",
  settingsCompressOnFinished: "Daunim ol nois i strong tumas taim em i pinis",
  booksEmpty: "Statim namba wan buk bilong yu",
  booksEmptyTeach: "Wanpela buk i holim ol sapta yu rekodim.",
  loadingBooks: "Wok long opim ol buk bilong yu.",
  tryAgain: "Traim gen",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? { other: "{name}, {n} sapta, i op" }
        : { other: "{name}, {n} sapta, i pas" }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Putim sapta long ${bookName}`,
  openChapter: (heading: string): string => `Opim ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Buk ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Sapta ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Go long buk ${book}`,
  goToChapter: (heading: string): string => `Go long ${heading}`,

  // Naming
  renameBook: "Senisim nem bilong buk",
  renameChapter: "Senisim nem bilong sapta",
  renameSegment: "Senisim nem bilong hap",
  bookNameField: "Nem bilong buk",
  chapterNameField: "Nem bilong sapta",
  segmentNameField: "Nem bilong hap",
  saveName: "Sevim nem",
  newBookTitle: "Givim nem long nupela buk bilong yu",
  newBookClose: "Pasim na no wokim buk",
  createBook: "Wokim buk",
  newChapterTitle: "Givim nem long nupela sapta bilong yu",
  newChapterClose: "Pasim na no wokim sapta",
  createChapter: "Wokim sapta",
  savingName: "Wok long sevim…",
  creatingBook: "Wok long wokim buk bilong yu…",

  // Segments screen
  backToBooks: "Go bek long ol buk",
  addSegment: "Putim hap",
  updating: "Wok long senisim sapta.",
  staleChapter: "Dispela sapta i no stap moa. Go bek long ol buk.",
  loadingChapter: "Wok long opim sapta.",
  segmentsEmpty: "Putim namba wan hap",
  segmentsEmptyTeach:
    "Wanpela hap em i liklik hap bilong sapta: rekodim, pleim, na rekodim gen.",
  playSegment: (n: number): string => `Pleim hap ${n}`,
  pauseSegment: (n: number): string => `Stopim liklik hap ${n}`,
  openRecorderSegment: (n: number): string =>
    `Opim masin rekod bilong hap ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Stretim hap ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Stretim hap ${this.segmentHeading(n, label)}, i pinis`;
  },
  openSegment(n: number, label: string | null): string {
    return `Opim hap ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Ples insait long hap ${n}`,
  markFinished: (n: number): string => `Makim hap ${n} i pinis`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Nem i no sev. Traim gen.",

  // Recorder sheet
  recorderDialog: "Masin rekod",
  useLightTheme: "Senis long skrin i lait, bilong san i strong",
  useDarkTheme: "Senis long skrin i tudak, bilong ples i no gat lait",
  tileEdit: "Stretim",
  tileFinished: "Pinis",
  tileStop: "Stopim",
  tileRename: "Senisim nem",
  tileErase: "Stat gen",
  tileDelete: "Rausim",
  tileShare: "Serim",
  tileAbout: "Long app",
  closeRecorder: "Pasim masin rekod",
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
  record: "Rekodim",
  stop: "Stopim rekod",
  zoomAtWhole: "Yu lukim olgeta. Lukim klostu wanpela hap long 4.",
  zoomAtQuarter: "Yu lukim klostu wanpela hap long 4. Lukim olgeta.",
  micOffTitle: "Maikrofon i of",
  micRetry: "Traim gen",
  micBack: "Go bek",
  micStepsLabel: "Ol rot bilong onim maikrofon",
  micStepOpenSettings: "Opim Settings long fon bilong yu",
  micStepAndroidApp: "Presim Apps, na tC Mobile, na Permissions",
  micStepIosApp: "Presim Privacy & Security, na Microphone",
  micStepIosAppOn: "Onim tC Mobile",
  micStepMicOn: "Onim Microphone",
  micStepComeBack: "Kam bek hia na presim Traim gen",
  finishedWriteFailed: "I no inap sevim mak bilong pinis.",
  recorderSaving: "Wok long sevim…",
  takeCapWarning: (n: number): string =>
    plural(n, { other: "{n} minit i stap" }),
  loadFailedTitle: "I no inap opim dispela rekod",
  loadFailedBody:
    "Rekod bilong yu i stap gut. Traim gen. Sapos yu no inap opim yet, yu ken stat gen long en long lis.",
  loadRetry: "Traim gen",
  loadBack: "Go bek",
  loadRetrying: "Wok long opim rekod bilong yu…",
  takeRecoverTitle: "Dispela rekod i no sev yet",
  takeRecoverBody:
    "Rekod bilong yu i stap yet. Traim gen, o serim long lukautim gut.",
  takeRecoverRetry: "Traim gen",
  takeRecoverRetrying: "Wok long sevim rekod bilong yu…",
  takeRecoverShare: "Serim rekod",
  takeRecoverSharing: "Wok long redim rekod…",
  takeShareUnavailable: "I no inap serim long dispela fon.",
  takeShareFailed: "I no inap serim rekod. Traim gen.",
  takeRetryFailed: "I no inap sevim rekod. Traim gen.",
  takeRecoverShared: "Rekod i go pinis.",
  takeRecoverDone: "Pinis",
  takeRecoverDiscard: "Rausim dispela rekod",
  takeRecoverDiscardArmed: "Presim gen long rausim dispela rekod olgeta",
  takeRecoverDiscardHint: "Presim gen long rausim.",
  playbackFailed: "I no inap pleim dispela rekod.",
  micNoDevice: "I no gat maikrofon long dispela fon.",
  micSiteBlocked:
    "Rekod i pas long dispela app. Orait long maikrofon long ol seting bilong sait long brausa, na traim gen.",
  micOsBlocked:
    "Fon bilong yu i no larim app i yusim maikrofon. Lukim maikrofon long ol seting bilong fon, na traim gen.",
  micPrompt:
    "App i mas yusim maikrofon long rekod. Orait long en taim em i askim, o sapos yu orait pinis, lukim ol seting bilong fon.",
  micStartFailed: "I no inap statim rekod.",
  recordingUnsupported: "Dispela fon i no inap rekodim nois.",
  playRecording: "Pleim rekod",
  stopPlayback: "Stopim ple",
  enterEdit: "Stretim rekod",
  leaveEdit: "Stopim stretim",
  editingMarker: "Wok long stretim",
  cut: "Katim hap yu makim",
  auditionSelection: "Pleim hap yu makim",
  auditionFromLine: "Pleim kirap long lain",
  paste: "Putim long lain",
  undo: "Tanim bek",
  redo: "Mekim gen",
  nothingToUndo: "I no gat samting long tanim bek.",
  nothingToRedo: "I no gat samting long mekim gen.",
  recorderMenuTitle: "Moa",
  recorderMenuOpen: "Moa wok",
  selectionStartHandle: "Kirap bilong hap yu makim",
  selectionEndHandle: "Pinis bilong hap yu makim",
  selectionHandleTime: (n: number): string => plural(n, { other: "{n} sekon" }),
  editFailed: "I no inap mekim dispela senis. Traim makim liklik hap tasol.",
  clearFailed: "I no inap stat gen long nois. Traim gen.",
  captureSilence: "I no gat nois i rekod. Traim gen.",
  captureUndecodable: "Dispela fon i no inap ritim rekod.",
  captureUnfinished: "I no inap pinisim dispela rekod.",
  captureStoppedSilent:
    "Rekod i stop, long wanem maikrofon i harim tasol nogat nois. Samting yu rekodim i stap gut.",
  blockedByTake:
    'Presim "Pasim menu", na "Pasim masin rekod", long sevim rekod.',
  micStarting: "Maikrofon i wok long kirap yet.",
  nothingRecorded: "I no gat rekod yet.",
  nothingStored: "I no gat samting i sev long stat gen.",
  liveWaveform: "Piksa bilong nois i rekod nau",
  vuMeterLabel: "Strong bilong rekod",
  vuMeterUnavailable: "I no inap soim strong long dispela fon",
  eraseSegment: "Stat gen long hap na kirap nupela",
  rerecord: "Stat gen na rekodim gen",
  segmentMenu: (n: number): string => `Moa wok bilong hap ${n}`,
  chapterRowMenu: (n: number): string => `Moa wok bilong sapta ${n}`,
  reorderLifted: (n: number): string => `Wok long muvim hap ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Hap ${from} i kamap hap ${to} nau.`,
  reorderStayed: (n: number): string => `Hap ${n} i stap long ples bilong en.`,
  chapterReorderLifted: (n: number): string => `Wok long muvim sapta ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Sapta ${from} i kamap sapta ${to} nau.`,
  chapterReorderStayed: (n: number): string =>
    `Sapta ${n} i stap long ples bilong en.`,
  bookReorderLifted: (heading: string): string => `Wok long muvim ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} i stap long namba ${to} ples nau.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} i stap long ples bilong en.`,
  moveUp: "Muvim i go antap",
  moveDown: "Muvim i go daun",

  alreadyFirst: "Em i namba wan pinis",
  alreadyLast: "Em i las pinis",
  eraseConfirmTitle: "Stat gen long hap na kirap nupela",
  eraseConfirm: "Stat gen long rekod",
  eraseCancel: "Lusim",
  recordAgainConfirm: "Rekodim gen",
  recordAgainKeep: "Holim",
  eraseFailed: "I no inap stat gen long rekod. Traim gen.",
  eraseConfirmPreviewPlay: "Pleim samting bai lus",
  eraseConfirmPreviewPause: "Wet",
  discardClip: "Tromoi nois yu katim",
  discardClipConfirmTitle: "Tromoi nois yu katim?",
  discardClipConfirm: "Tromoi",
  deleteBook: "Rausim buk",
  deleteBookConfirmTitle: (book: string): string =>
    `Rausim ${book} wantaim olgeta samting insait?`,
  keepBook: "Holim buk",
  deleteBookYes: "Yes, rausim buk",
  deleteBookFailed: "I no inap rausim dispela buk. Traim gen.",
  deleteSegment: "Rausim hap",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Rausim hap ${ordinal}?`,
  deleteSegmentConfirm: "Rausim",
  deleteSegmentFailed: "I no inap rausim dispela hap. Traim gen.",
  chapterMenuOpen: "Moa wok bilong dispela sapta",
  chapterMenuTitle: "Sapta",

  // Sharing
  shareChapter: "Serim sapta",
  shareChapterUnconfirmed:
    "Serim sapta. Las taim yu traim, em i no klia: presim long traim gen.",
  shareSend: "Serim nau",
  sharePreparing: "Wok long redim sapta long serim.",
  shareHandingOver: "Wok long opim rot bilong serim long fon.",
  sharePreparingLabel: "Wok long redim long serim",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, { other: `{n} long ${all} i go` }),
  shareSent: "I go pinis long rot bilong serim long fon.",
  shareDismissed: "Rot bilong serim i pas bipo samting i go.",
  shareUnproven:
    "Rot bilong serim i pas. Dispela fon i no inap save sapos em i go moa.",
  shareNothing: "Rekodim wanpela hap pastaim, bihain serim dispela sapta.",
  shareFailed: "I no inap serim dispela sapta. Traim gen.",
  shareMissing: (n: number): string =>
    plural(n, { other: "{n} hap i no inap i go insait." }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Moa wok bilong ${book}`,
  bookMenuTitle: "Buk",
  shareBook: "Serim buk",
  shareBookUnconfirmed:
    "Serim buk. Las taim yu traim, em i no klia: presim long traim gen.",
  shareBookPreparing: "Wok long redim buk long serim.",
  exportProject: "Salim projek i go ausait",
  tileExport: "Salim ausait",
  exportProjectPreparing: "Wok long redim projek long salim ausait.",
  exportProjectWebPointer:
    "Salim ausait i wok long app yu putim long fon. Opim app long salim dispela projek.",
  languageAskTitle: "Tok ples bilong dispela buk",
  languageAskLead:
    "Ol rekod i stap long wanem tok ples? Yu makim wanpela taim tasol, na olgeta taim yu salim dispela buk ausait, em i yusim.",
  languageSearch: "Painim tok ples",
  languageSearchHint: "Nem o kod",
  languageLoading: "Wok long opim ol tok ples.",
  languageLoadFailed: "I no inap opim ol tok ples.",
  languageNoMatch: "I no gat tok ples i stret. Traim narapela nem o kod.",
  languageNarrow: "Raitim moa long lukim ol narapela tok ples.",
  languageCount: (n: number): string =>
    plural(n, { other: "{n} tok ples i stret." }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      other: `{n} tok ples i stret. Soim namba wan ${shown}. Raitim moa long painim stret.`,
    }),
  languageSaving: "Wok long sevim tok ples.",
  languageAskCancel: "Lusim",
  licenceAskTitle: "Laisens bilong dispela buk",
  licenceAskLead:
    "Husat i ken serim ol dispela rekod? Yu makim wanpela taim tasol long dispela buk.",
  licenceAllRightsReserved: "Olgeta rait i stap long man i kamapim",
  licenceSaving: "Wok long sevim laisens.",
  licenceAskContinue: "Serim",
  licenceAskCancel: "Lusim",
  licenceTileLabel: "Senisim laisens",
  tileLicence: "Laisens",
  tileTemplates: "Ol templet",
  licenceAskSave: "Sevim",
  licenceAskSaveLead:
    "Husat i ken serim ol dispela rekod? Yu ken senisim gen bihain.",
  licenceNameCcBySa: "Creative Commons Kolim Nem-Serim Wankain 4.0",
  licenceNameCcBy: "Creative Commons Kolim Nem 4.0",
  licenceNameCc0: "Creative Commons Zero 1.0, bilong olgeta manmeri",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "projek",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Rekodim wanpela hap pastaim, bihain serim dispela buk.",
  shareBookFailed: "I no inap serim dispela buk. Traim gen.",
  shareBookFailedWeb:
    "I no inap serim dispela buk. Yu ken serim buk long app tC Mobile tasol.",
  shareBookMissing: (n: number): string =>
    plural(n, { other: "{n} sapta i no inap i go insait." }),
  shareBookPartial(n: number): string {
    return this.shareMissing(n);
  },
  shareBookMissingAndPartial(
    chapters: number,
    segments: number,
    partialChapters: number
  ): string {
    const scope = Math.max(partialChapters, 1);
    const bySegments = (from: string): string =>
      plural(segments, {
        other: `Long ${from}, {n} hap i no inap i go insait.`,
      }).replaceAll("{chapters}", () => String(scope));
    // "wanpela sapta" is for exactly one chapter, so it rides the `"=1"` arm.
    // The chapters "i stap insait" (are in the share); only the segments
    // "i no inap i go insait", so the sentence makes one claim (#1930 r1).
    const partial = plural(scope, {
      "=1": bySegments("wanpela sapta i stap insait"),
      other: bySegments("{chapters} sapta i stap insait"),
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "I no inap redim dispela long serim. Traim gen; sapos em i kamap gen, statim app gen.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Buk",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Ol senis bilong yu i no sev" : "Dispela rekod i no sev",
  saveFailedSaving: "Wok long sevim",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Rekod yu stretim i stap yet."
        : `Rekod yu stretim bilong hap ${ordinal} i stap yet.`
      : ordinal === null
        ? "Rekod bilong yu i stap yet."
        : `Rekod bilong hap ${ordinal} i stap yet.`,
  saveFailedRetry: "Traim sevim gen",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Presim gen long tromoi ol dispela senis"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Tromoi ol dispela senis"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly ? "Presim gen long tromoi." : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Ol senis bilong yu i mas kisim nupela app."
      : "Dispela rekod i mas kisim nupela app.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Dispela buk i no stap moa. I no inap sevim ol senis bilong yu."
      : "Dispela buk i no stap moa. I no inap sevim dispela rekod.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "I no inap sevim ol senis bilong yu."
      : "I no inap sevim dispela rekod.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Dispela app i no inap sevim ol. Sapos yu statim app gen, ol bai lus, tasol em i wanpela rot tasol long kisim nupela app."
      : "Dispela app i no inap sevim. Sapos yu statim app gen, rekod bai lus, tasol em i wanpela rot tasol long kisim nupela app.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Narapela app i rausim dispela buk pinis. Tromoi ol senis em i wanpela rot tasol."
      : "Narapela app i rausim dispela buk pinis. Rausim dispela rekod long lusim.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Dispela skrin tasol i holim ol senis bilong yu. No ken pasim app."
      : "Dispela skrin tasol i holim wok bilong yu i no sev. No ken pasim app.",
  saveFailedAttempts: (attempts: number): string =>
    `Hamas taim yu traim: ${attempts}`,
  appFailed: "Samting i no orait.",
  appReload: "Statim app gen",
  appReloadTeach: "App bai stat gen.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Presim gen long stat gen, na dispela rekod na nois yu katim bai lus"
          : "Presim gen long stat gen, na dispela rekod bai lus";
      case "changes":
        return alsoCutAudio
          ? "Presim gen long stat gen, na ol dispela senis na nois yu katim bai lus"
          : "Presim gen long stat gen, na ol dispela senis bai lus";
      case "cutAudio":
        return "Presim gen long stat gen, na nois yu katim bai lus";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Presim gen, na dispela rekod na nois yu katim bai lus."
          : "Presim gen, na dispela rekod bai lus.";
      case "changes":
        return alsoCutAudio
          ? "Presim gen, na ol dispela senis na nois yu katim bai lus."
          : "Presim gen, na ol dispela senis bai lus.";
      case "cutAudio":
        return "Presim gen, na nois yu katim bai lus.";
    }
  },
  appReloading: "Wok long stat gen…",
  appReloadHeld: "Dispela hevi i no sev yet. Salim, o traim gen.",
  encoderFailing:
    "Dispela fon i no inap mekim ol rekod i liklik. Nogat samting i lus; statim app gen inap helpim.",

  // Storage and sharing everything
  storageNotPersisted:
    "Sapos ples long fon i laik pulap, fon inap rausim ol rekod yu mekim hia. Serim wok bilong yu taim yu inap.",
  storageLow:
    "Ples long dispela fon i laik pulap. Makim ol hap i pinis long kisim moa ples, o serim wok bilong yu na bihain rausim.",
  storageCritical:
    "Ples long dispela fon i klostu pulap, na ol nupela rekod inap i no sev. Makim ol hap i pinis, o serim wok bilong yu na bihain rausim.",
  storageShareSoon: "Serim wok bilong yu kwik",
  shareAll: "Serim wok bilong yu",
  shareAllUnconfirmed:
    "Serim wok bilong yu. Las taim yu traim, em i no klia: presim long traim gen.",
  shareAllPreparing: "Wok long redim wok bilong yu long serim.",
  shareAllNothing: "Rekodim wanpela hap pastaim, bihain serim wok bilong yu.",
  shareAllFailed: "I no inap serim wok bilong yu. Traim gen.",
  shareAllFailedWeb:
    "I no inap serim wok bilong yu. Yusim app tC Mobile long serim.",
  shareAllStorage:
    "Dispela fon i no gat inap ples long redim wok bilong yu. Makim ol hap i pinis, na traim gen.",
  shareAllMissing: (n: number): string =>
    plural(n, { other: "{n} buk i no inap i go insait." }),
  shareAllIncomplete: (n: number): string =>
    plural(n, { other: "{n} sapta i go insait hap tasol." }),
  shareAllFilename: "Wok bilong mi.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Narapela app olsem i op.",
  dbBlockedTeach: "Pasim narapela long go het.",
  dbOutOfDate: "Dispela app i olpela.",
  dbOutOfDateTeach: "Statim gen long yusim nupela app.",

  // About and licences
  aboutOpen: "Long app na ol laisens",
  aboutTitle: "Long app na ol laisens",
  aboutBlurb:
    "App i fri na open source. Olgeta samting yu rekodim i stap long dispela fon.",
  aboutAppLicense: "Dispela app i stap aninit long laisens MIT.",
  aboutSourceOffer:
    "Sos kod bilong dispela app i op long olgeta. Sos kod bilong dispela app:",
  aboutVisitAppSource: "Opim sos kod bilong dispela app long GitHub",
  aboutPrivacy: "Dispela app i lukautim data bilong yu olsem:",
  aboutPrivacyLink: "Lo bilong praivesi",
  aboutVisitPrivacy: "Opim lo bilong praivesi",
  aboutThirdParty: "Ol hap open source",
  aboutTexts: "Tok bilong ol laisens",
  aboutQrCaption: "Skanim long kisim app",
  aboutContent: "Ol samting i stap insait",
  aboutLanguageCodes: "Kod bilong tok ples: ISO 639-3, long iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Ritim ${name}`,
  aboutBack: "Go bek long lis",
  aboutTextLoading: "Wok long opim tok bilong laisens.",
  aboutTextFailed: "I no inap opim tok bilong laisens.",
  aboutVisitSource: (name: string): string => `Opim pes bilong projek ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Opim sos kod bilong ${name} i stap wantaim dispela app`,
  aboutVisitLicense: (name: string): string => `Opim laisens bilong ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, { other: "{n} hevi i rait i stap" }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, { other: "Opim menu. {n} hevi i rait i stap." }),
  failuresTeach:
    "Salim dispela long man o meri i save helpim yu sapos samting i no wok.",
  shareFailureLog: "Salim ripot bilong hevi",
  shareFailureLogUnconfirmed:
    "Salim ripot bilong hevi. Las taim yu traim, em i no klia: presim long traim gen.",
  shareFailureLogPreparing: "Wok long redim ripot bilong hevi.",
  shareFailureLogNothing: "I no gat samting long salim nau.",
  shareFailureLogFailed: "I no inap salim ripot bilong hevi. Traim gen.",
  shareFailureLogRestart:
    "I no inap yusim dispela app moa. Statim app gen long yusim nupela app.",
  clearFailureLog: "Klinim ripot bilong hevi",
  clearFailureLogConfirmTitle: "Klinim ripot bilong hevi?",
  clearFailureLogConfirm: "Klinim",
  loadFailed: "I no inap opim. Traim gen.",
  saveFailed: "I no inap sevim. Traim gen.",
  noRoom: "I no gat ples moa long dispela fon.",
  bookNameTaken: "Narapela buk i gat dispela nem. Raitim narapela nem.",
  stopToEdit: "Stopim rekod long stretim.",
  stopToErase: "Stopim rekod long stat gen.",

  // Cover colours and chapter playback
  coverColourLabel: "Kala bilong kava",
  coverColourAmber: "Yelopela",
  coverColourTeal: "Blugrin",
  coverColourPlum: "Popel",
  coverColourForest: "Grinpela bus",
  coverColourBrick: "Retpela graun",
  coverColourSlate: "Gre",
  coverColourRose: "Pinkpela",
  coverColourOlive: "Grinpela yelo",
  coverColourRust: "Ros",
  coverColourCocoa: "Kakao",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, yu makim` : name,
  playChapter: (heading: string): string => `Pleim ${heading}`,
  pauseChapter: (heading: string): string => `Stopim liklik ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Pleim gen ${heading}, em i stop long ${percent} pesen`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} i no ple. Presim long traim gen`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} i no gat rekod long pleim`,
  chapterPlayStarted: (heading: string): string => `Wok long pleim ${heading}`,
  chapterPlayPaused: (heading: string): string => `${heading} i stop liklik`,
  chapterPlayFinished: (heading: string): string => `${heading} i pinis`,
};
