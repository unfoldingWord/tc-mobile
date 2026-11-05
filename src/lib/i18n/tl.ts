import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The tl table: Tagalog (standard Filipino as written for general readers),
 * drafted by AI under the decisions on #1458 (Q1 and Q3, "Use AI to draft,
 * we'll revise as-needed") and following `docs/i18n/glossary.md`. It is the
 * third level-3 language in the app (#357, the DRI's pick on 2026-11-04,
 * "Tagalog (tl) (Recommended)"). AI DRAFT, AWAITING NATIVE-SPEAKER REVIEW: no
 * Tagalog reader has checked the meaning.
 *
 * Least certain cells, for the native reader to check first:
 * - `tileRename` ("Bagong pangalan") literally means "new name"; it is
 *   shortened to fit the tile caption budget, while the glossary's "Palitan
 *   ang pangalan" is used elsewhere.
 * - `recorderDialog` ("Pang-record") is a loan-plus-prefix coined to avoid
 *   the English-equal word, and may not read as the name of a dialog.
 * - The licence names (`licenceNameCcBySa`, "Pagkilala-Parehong
 *   Pagbabahagi", and its siblings) are renderings of the Creative Commons
 *   terms; no source for an official Filipino wording is recorded.
 * - The cover colours, especially `coverColourSlate` ("Abuhin", grey),
 *   `coverColourAmber` ("Dilaw-kahel") and `coverColourTeal` ("Asul-berde"),
 *   where Tagalog has no settled single word for the shade.
 * - `settingsCompressOnFinished` ("Hinaan ang malalakas na bahagi kapag
 *   tapos na") is a plain-language paraphrase of compressing loud parts.
 * - `shareAllIncomplete` says the chapter was "not included in full"
 *   ("hindi naisama nang buo"); the first draft got this meaning wrong, so
 *   it is worth a second look.
 *
 * Register: buttons and labels are the short command a phone's own menus use
 * ("I-record", "Ibahagi"); sentences that speak to the person are plain and
 * polite. Words a Filipino phone already shows in English are kept as loans
 * where the glossary says so (recording, app, setting, browser, I-save,
 * I-play), written the way Filipino writes them, with a hyphen before the
 * root ("I-record"). Digits are 0 to 9 (R19).
 *
 * Plurals: Filipino has two CLDR categories, `one` and `other`, and `one` is
 * NOT "exactly one" (it selects 0 to 3, 5, 7, 8, 10 to 13 and so on, and not
 * 4, 6, 9, 14, 16, 19). The noun is not marked for number in Tagalog ("1
 * bahagi", "5 bahagi"), so each count entry carries the same whole phrase under
 * both `one` and `other`, which is what the coverage gate asks for. Wording
 * that means exactly one ("a chapter") rides the `"=1"` arm, as in `ru.ts`.
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
  newBook: "Bagong aklat",
  menuOpen: "Buksan ang menu",
  menuTitle: "Menu",
  menuClose: "Isara ang menu",
  settingsOpen: "Mga setting",
  settingsTitle: "Mga setting",
  templatesOpen: "Mga template",
  templatesTitle: "Mga template",
  templateLicenceLabel: (licence: string): string => `Lisensya: ${licence}`,
  loadingTemplates: "Nilo-load ang mga template.",
  settingsChapterNumbers: "Laging ipakita ang numero ng kabanata",
  settingsNormalizeOnFinished: "Pantayin ang lakas ng tunog kapag tapos na",
  settingsCompressOnFinished: "Hinaan ang malalakas na bahagi kapag tapos na",
  booksEmpty: "Simulan ang una mong aklat",
  booksEmptyTeach: "Ang aklat ay may mga kabanatang ire-record mo.",
  loadingBooks: "Nilo-load ang iyong mga aklat.",
  tryAgain: "Subukan muli",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} kabanata, nakabukas",
            other: "{name}, {n} kabanata, nakabukas",
          }
        : {
            one: "{name}, {n} kabanata, nakasara",
            other: "{name}, {n} kabanata, nakasara",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string =>
    `Magdagdag ng kabanata sa ${bookName}`,
  openChapter: (heading: string): string => `Buksan ang ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Aklat ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Kabanata ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Pumunta sa aklat na ${book}`,
  goToChapter: (heading: string): string => `Pumunta sa ${heading}`,

  // Naming
  renameBook: "Palitan ang pangalan ng aklat",
  renameChapter: "Palitan ang pangalan ng kabanata",
  renameSegment: "Palitan ang pangalan ng bahagi",
  bookNameField: "Pangalan ng aklat",
  chapterNameField: "Pangalan ng kabanata",
  segmentNameField: "Pangalan ng bahagi",
  saveName: "I-save ang pangalan",
  newBookTitle: "Pangalanan ang bago mong aklat",
  newBookClose: "Isara nang hindi gumagawa ng aklat",
  createBook: "Gumawa ng aklat",
  newChapterTitle: "Pangalanan ang bago mong kabanata",
  newChapterClose: "Isara nang hindi gumagawa ng kabanata",
  createChapter: "Gumawa ng kabanata",
  savingName: "Sine-save…",
  creatingBook: "Ginagawa ang iyong aklat…",

  // Segments screen
  backToBooks: "Bumalik sa mga aklat",
  addSegment: "Magdagdag ng bahagi",
  updating: "Ina-update ang kabanata.",
  staleChapter: "Wala na ang kabanatang ito. Bumalik sa Mga Aklat.",
  loadingChapter: "Nilo-load ang kabanata.",
  segmentsEmpty: "Idagdag ang unang bahagi",
  segmentsEmptyTeach:
    "Ang bahagi ay isang piraso ng kabanata: mag-record, mag-play, saka mag-record ulit.",
  playSegment: (n: number): string => `I-play ang bahagi ${n}`,
  pauseSegment: (n: number): string => `I-pause ang bahagi ${n}`,
  openRecorderSegment: (n: number): string =>
    `Buksan ang recorder para sa bahagi ${n}`,
  editSegment(n: number, label: string | null): string {
    return `I-edit ang bahagi ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `I-edit ang bahagi ${this.segmentHeading(n, label)}, tapos na`;
  },
  openSegment(n: number, label: string | null): string {
    return `Buksan ang bahagi ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Posisyon sa bahagi ${n}`,
  markFinished: (n: number): string => `Markahan na tapos na ang bahagi ${n}`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Hindi na-save ang pangalan. Subukan muli.",

  // Recorder sheet
  recorderDialog: "Pang-record",
  useLightTheme: "Lumipat sa maliwanag na screen, para sa sikat ng araw",
  useDarkTheme: "Lumipat sa madilim na screen, para sa madilim na lugar",
  tileEdit: "I-edit",
  tileFinished: "Tapos na",
  tileStop: "Ihinto",
  tileRename: "Bagong pangalan",
  tileErase: "I-reset",
  tileDelete: "Burahin",
  tileShare: "Ibahagi",
  tileAbout: "Tungkol dito",
  closeRecorder: "Isara ang recorder",
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
  record: "I-record",
  stop: "Ihinto ang recording",
  zoomAtWhole: "I-zoom out. I-zoom in sa isang bahagi ng apat.",
  zoomAtQuarter: "I-zoom in sa isang bahagi ng apat. I-zoom out.",
  micOffTitle: "Nakapatay ang mikropono",
  micRetry: "Subukan muli",
  micBack: "Bumalik",
  micStepsLabel: "Mga hakbang para i-on ang mikropono",
  micStepOpenSettings: "Buksan ang Mga Setting ng iyong telepono",
  micStepAndroidApp: "I-tap ang Apps, saka tC Mobile, saka Permissions",
  micStepIosApp: "I-tap ang Privacy at Security, saka Mikropono",
  micStepIosAppOn: "I-on ang tC Mobile",
  micStepMicOn: "I-on ang Mikropono",
  micStepComeBack: "Bumalik dito at i-tap ang Subukan muli",
  finishedWriteFailed: "Hindi ma-save ang marka na tapos na.",
  recorderSaving: "Sine-save…",
  takeCapWarning: (n: number): string =>
    plural(n, { one: "{n} min na lang", other: "{n} min na lang" }),
  loadFailedTitle: "Hindi mabuksan ang recording na ito",
  loadFailedBody:
    "Ligtas ang recording mo. Subukan muli, o bumalik para i-reset ito mula sa listahan.",
  loadRetry: "Subukan muli",
  loadBack: "Bumalik",
  loadRetrying: "Binubuksan ang iyong recording…",
  takeRecoverTitle: "Hindi pa na-save ang recording na ito",
  takeRecoverBody:
    "Nandito pa ang recording mo. Subukan muli, o ibahagi ito para maging ligtas.",
  takeRecoverRetry: "Subukan muli",
  takeRecoverRetrying: "Sine-save ang iyong recording…",
  takeRecoverShare: "Ibahagi ang recording",
  takeRecoverSharing: "Inihahanda ang recording…",
  takeShareUnavailable: "Hindi available ang pagbabahagi sa device na ito.",
  takeShareFailed: "Hindi naibahagi ang recording. Subukan muli.",
  takeRetryFailed: "Hindi na-save ang recording. Subukan muli.",
  takeRecoverShared: "Naibahagi na ang recording.",
  takeRecoverDone: "Tapos na",
  takeRecoverDiscard: "Burahin ang recording na ito",
  takeRecoverDiscardArmed:
    "I-tap ulit para burahin nang tuluyan ang recording na ito",
  takeRecoverDiscardHint: "I-tap ulit para burahin ito.",
  playbackFailed: "Hindi ma-play ang recording na ito.",
  micNoDevice: "Walang mikropono sa device na ito.",
  micSiteBlocked:
    "Naka-block ang pag-record sa app na ito. Payagan ang mikropono sa mga setting ng site sa browser, saka subukan muli.",
  micOsBlocked:
    "Hindi pinapayagan ng device mo ang app na gumamit ng mikropono. Tingnan ang access sa mikropono sa mga setting ng device, saka subukan muli.",
  micPrompt:
    "Kailangan ang access sa mikropono para mag-record. Payagan ito kapag tinanong, o kung napayagan na, tingnan ang mga setting ng device mo.",
  micStartFailed: "Hindi masimulan ang pag-record.",
  recordingUnsupported: "Hindi makapag-record ng tunog ang device na ito.",
  playRecording: "I-play ang recording",
  stopPlayback: "Ihinto ang pag-play",
  enterEdit: "I-edit ang recording",
  leaveEdit: "Lumabas sa pag-edit",
  editingMarker: "Ine-edit",
  cut: "Putulin ang napili",
  auditionSelection: "I-play ang napili",
  auditionFromLine: "I-play mula sa guhit",
  paste: "I-paste sa guhit",
  undo: "Ibalik",
  redo: "Ulitin",
  nothingToUndo: "Walang maibabalik.",
  nothingToRedo: "Walang uulitin.",
  recorderMenuTitle: "Iba pa",
  recorderMenuOpen: "Iba pang gawain",
  selectionStartHandle: "Simula ng napili",
  selectionEndHandle: "Dulo ng napili",
  selectionHandleTime: (n: number): string =>
    plural(n, { one: "{n} segundo", other: "{n} segundo" }),
  editFailed:
    "Hindi magawa ang pagbabagong iyon. Subukan ang mas maliit na napili.",
  clearFailed: "Hindi na-reset ang tunog. Subukan muli.",
  captureSilence: "Walang tunog na na-record. Subukan muli.",
  captureUndecodable: "Hindi mabasa ang recording sa device na ito.",
  captureUnfinished: "Hindi matapos ang recording na ito.",
  blockedByTake:
    'Piliin ang "Isara ang menu", saka "Isara ang recorder" para ma-save ang recording.',
  micStarting: "Ino-on pa ang mikropono.",
  nothingRecorded: "Wala pang na-record.",
  nothingStored: "Walang naka-save na ire-reset.",
  liveWaveform: "Live na waveform ng recording",
  vuMeterLabel: "Lakas ng recording",
  vuMeterUnavailable: "Hindi available ang sukat ng lakas sa device na ito",
  eraseSegment: "I-reset ang bahagi at magsimula ulit",
  rerecord: "I-reset at mag-record ulit",
  segmentMenu: (n: number): string => `Iba pang gawain para sa bahagi ${n}`,
  chapterRowMenu: (n: number): string =>
    `Iba pang gawain para sa kabanata ${n}`,
  reorderLifted: (n: number): string => `Inililipat ang bahagi ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Ang bahagi ${from} ay bahagi ${to} na ngayon.`,
  reorderStayed: (n: number): string => `Nanatili ang bahagi ${n} sa puwesto.`,
  chapterReorderLifted: (n: number): string => `Inililipat ang kabanata ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Ang kabanata ${from} ay kabanata ${to} na ngayon.`,
  chapterReorderStayed: (n: number): string =>
    `Nanatili ang kabanata ${n} sa puwesto.`,
  bookReorderLifted: (heading: string): string => `Inililipat ang ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `Ang ${heading} ay nasa posisyon ${to} na sa istante.`,
  bookReorderStayed: (heading: string): string =>
    `Nanatili ang ${heading} sa puwesto.`,
  moveUp: "Itaas",
  moveDown: "Ibaba",

  alreadyFirst: "Nasa pinakataas na",
  alreadyLast: "Nasa pinakababa na",
  eraseConfirmTitle: "I-reset ang bahagi at magsimula ulit",
  eraseConfirm: "I-reset ang recording",
  eraseCancel: "Kanselahin",
  recordAgainConfirm: "Mag-record ulit",
  recordAgainKeep: "Panatilihin",
  eraseFailed: "Hindi na-reset ang recording. Subukan muli.",
  eraseConfirmPreviewPlay: "I-play ang mawawala",
  eraseConfirmPreviewPause: "I-pause",
  discardClip: "Itapon ang tunog na pinutol",
  discardClipConfirmTitle: "Itapon ang tunog na pinutol?",
  discardClipConfirm: "Itapon",
  deleteBook: "Burahin ang aklat",
  deleteBookConfirmTitle: (book: string): string =>
    `Burahin ang ${book} at lahat ng laman nito?`,
  keepBook: "Panatilihin ang aklat",
  deleteBookYes: "Oo, burahin ang aklat",
  deleteBookFailed: "Hindi mabura ang aklat na ito. Subukan muli.",
  deleteSegment: "Burahin ang bahagi",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Burahin ang bahagi ${ordinal}?`,
  deleteSegmentConfirm: "Burahin",
  deleteSegmentFailed: "Hindi mabura ang bahaging ito. Subukan muli.",
  chapterMenuOpen: "Iba pang gawain para sa kabanatang ito",
  chapterMenuTitle: "Kabanata",

  // Sharing
  shareChapter: "Ibahagi ang kabanata",
  shareChapterUnconfirmed:
    "Ibahagi ang kabanata. Hindi pa nakumpirma ang huling subok: i-tap para subukan muli.",
  shareSend: "Ibahagi na ngayon",
  sharePreparing: "Inihahanda ang kabanata para ibahagi.",
  shareHandingOver: "Binubuksan ang share menu ng telepono.",
  sharePreparingLabel: "Inihahanda para ibahagi",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `Ibinabahagi ang {n} sa ${all}`,
      other: `Ibinabahagi ang {n} sa ${all}`,
    }),
  shareSent: "Naipasa sa share menu ng telepono.",
  shareDismissed: "Nagsara ang share menu bago may naipadala.",
  shareUnproven:
    "Nagsara ang share menu. Hindi masabi ng telepono na ito kung naipadala ito.",
  shareNothing: "Mag-record ng isang bahagi bago ibahagi ang kabanatang ito.",
  shareFailed: "Hindi maibahagi ang kabanatang ito. Subukan muli.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "{n} bahagi ang hindi naisama.",
      other: "{n} bahagi ang hindi naisama.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Iba pang gawain para sa ${book}`,
  bookMenuTitle: "Aklat",
  shareBook: "Ibahagi ang aklat",
  shareBookUnconfirmed:
    "Ibahagi ang aklat. Hindi pa nakumpirma ang huling subok: i-tap para subukan muli.",
  shareBookPreparing: "Inihahanda ang aklat para ibahagi.",
  exportProject: "I-export ang proyekto",
  tileExport: "I-export",
  exportProjectPreparing: "Inihahanda ang proyekto para i-export.",
  exportProjectWebPointer:
    "Gumagana ang export sa naka-install na app. Buksan ang app para i-export ang proyektong ito.",
  languageAskTitle: "Wika ng aklat na ito",
  languageAskLead:
    "Anong wika ang nasa mga recording na ito? Isang beses mo lang ito pipiliin, at gagamitin ito sa bawat export ng aklat na ito.",
  languageSearch: "Maghanap ng wika",
  languageSearchHint: "Pangalan o code",
  languageLoading: "Nilo-load ang listahan ng mga wika.",
  languageLoadFailed: "Hindi ma-load ang listahan ng mga wika.",
  languageNoMatch: "Walang katugmang wika. Subukan ang ibang pangalan o code.",
  languageNarrow: "Mag-type pa para makita ang iba pang wika.",
  languageCount: (n: number): string =>
    plural(n, { one: "{n} wika ang tugma.", other: "{n} wika ang tugma." }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      one: `{n} wika ang tugma. Ipinapakita ang unang ${shown}. Mag-type pa para paliitin ang paghahanap.`,
      other: `{n} wika ang tugma. Ipinapakita ang unang ${shown}. Mag-type pa para paliitin ang paghahanap.`,
    }),
  languageSaving: "Sine-save ang wika.",
  languageAskCancel: "Kanselahin",
  licenceAskTitle: "Lisensya ng aklat na ito",
  licenceAskLead:
    "Sino ang maaaring magbahagi ng mga recording na ito? Isang beses mo itong pipiliin para sa aklat na ito.",
  licenceAllRightsReserved: "Lahat ng karapatan ay nakalaan",
  licenceSaving: "Sine-save ang lisensya.",
  licenceAskContinue: "Ibahagi",
  licenceAskCancel: "Kanselahin",
  licenceTileLabel: "Palitan ang lisensya",
  tileLicence: "Lisensya",
  tileTemplates: "Mga template",
  licenceAskSave: "I-save",
  licenceAskSaveLead:
    "Sino ang maaaring magbahagi ng mga recording na ito? Maaari mo itong palitan ulit mamaya.",
  licenceNameCcBySa: "Creative Commons Pagkilala-Parehong Pagbabahagi 4.0",
  licenceNameCcBy: "Creative Commons Pagkilala 4.0",
  licenceNameCc0: "Creative Commons Zero 1.0, pampublikong dominyo",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "proyekto",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Mag-record ng isang bahagi bago ibahagi ang aklat na ito.",
  shareBookFailed: "Hindi maibahagi ang aklat na ito. Subukan muli.",
  shareBookFailedWeb:
    "Hindi maibahagi ang aklat na ito. Sa app na tC Mobile lang maibabahagi ang aklat.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "{n} kabanata ang hindi naisama.",
      other: "{n} kabanata ang hindi naisama.",
    }),
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
        one: `{n} bahagi ${from} ang hindi naisama.`,
        other: `{n} bahagi ${from} ang hindi naisama.`,
      }).replaceAll("{chapters}", () => String(scope));
    // "sa isang kasamang kabanata" is for exactly one chapter, so it rides the
    // `"=1"` arm: CLDR's `one` also covers 2, 3, 5 and 7.
    const partial = plural(scope, {
      "=1": bySegments("sa isang kasamang kabanata"),
      one: bySegments("sa {chapters} kasamang kabanata"),
      other: bySegments("sa {chapters} kasamang kabanata"),
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Hindi ito maihanda para ibahagi. Subukan muli; kung patuloy itong mangyari, i-restart ang app.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Aklat",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly
      ? "Hindi na-save ang mga pagbabago mo"
      : "Hindi na-save ang recording na ito",
  saveFailedSaving: "Sine-save",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Nandito pa ang recording na ine-edit mo."
        : `Nandito pa ang recording ng bahagi ${ordinal} na ine-edit mo.`
      : ordinal === null
        ? "Nandito pa ang recording mo."
        : `Nandito pa ang recording ng bahagi ${ordinal}.`,
  saveFailedRetry: "Subukang i-save muli",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "I-tap ulit para itapon ang mga pagbabagong ito"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Itapon ang mga pagbabagong ito"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "I-tap ulit para itapon ang mga ito."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Kailangan ng mga pagbabago mo ng mas bagong bersyon ng app."
      : "Kailangan ng recording na ito ng mas bagong bersyon ng app.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Wala na ang aklat na ito. Hindi ma-save ang mga pagbabago mo."
      : "Wala na ang aklat na ito. Hindi ma-save ang recording na ito.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Hindi ma-save ang mga pagbabago mo."
      : "Hindi ma-save ang recording na ito.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Hindi ito ma-save ng kopyang ito ng app. Kapag nag-restart ka, mawawala ang mga pagbabago, pero iyon lang ang paraan para makuha ang bagong bersyon."
      : "Hindi ito ma-save ng kopyang ito ng app. Kapag nag-restart ka, mawawala ang recording, pero iyon lang ang paraan para makuha ang bagong bersyon.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Nabura ang aklat na ito sa ibang kopya ng app. Ang pagtatapon ng mga pagbabago ang tanging paraan palabas."
      : "Nabura ang aklat na ito sa ibang kopya ng app. Burahin ang recording na ito para makalabas.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Hawak ng screen na ito ang nag-iisang kopya ng mga pagbabago mo. Huwag isara ang app."
      : "Hawak ng screen na ito ang nag-iisang kopya ng hindi pa na-save mong gawa. Huwag isara ang app.",
  saveFailedAttempts: (attempts: number): string => `Mga subok: ${attempts}`,
  appFailed: "May nangyaring problema.",
  appReload: "I-restart ang app",
  appReloadTeach: "Magre-restart ang app.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "I-tap ulit para mag-restart at mawala ang recording na ito at ang tunog na pinutol mo"
          : "I-tap ulit para mag-restart at mawala ang recording na ito";
      case "changes":
        return alsoCutAudio
          ? "I-tap ulit para mag-restart at mawala ang mga pagbabagong ito at ang tunog na pinutol mo"
          : "I-tap ulit para mag-restart at mawala ang mga pagbabagong ito";
      case "cutAudio":
        return "I-tap ulit para mag-restart at mawala ang tunog na pinutol mo";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "I-tap ulit, at mawawala ang recording na ito at ang tunog na pinutol mo."
          : "I-tap ulit, at mawawala ang recording na ito.";
      case "changes":
        return alsoCutAudio
          ? "I-tap ulit, at mawawala ang mga pagbabagong ito at ang tunog na pinutol mo."
          : "I-tap ulit, at mawawala ang mga pagbabagong ito.";
      case "cutAudio":
        return "I-tap ulit, at mawawala ang tunog na pinutol mo.";
    }
  },
  appReloading: "Nagre-restart…",
  appReloadHeld:
    "Hindi pa na-save ang problemang ito. Ipadala ito, o subukan muli.",
  encoderFailing:
    "Hindi mapaliit ng telepono na ito ang mga recording. Walang nawala; makakatulong ang pag-restart ng app.",

  // Storage and sharing everything
  storageNotPersisted:
    "Maaaring burahin ng telepono na ito ang na-record mo rito kapag halos puno na ang espasyo. Ibahagi ang gawa mo kapag kaya mo.",
  storageLow:
    "Halos puno na ang espasyo ng telepono na ito. Markahan na tapos na ang mga bahagi para lumuwag ang espasyo, o ibahagi ang gawa mo at saka ito burahin.",
  storageCritical:
    "Halos puno na ang espasyo ng telepono na ito, at maaaring hindi ma-save ang mga bagong recording. Markahan na tapos na ang mga bahagi, o ibahagi ang gawa mo at saka ito burahin.",
  storageShareSoon: "Ibahagi agad ang gawa mo",
  shareAll: "Ibahagi ang gawa mo",
  shareAllUnconfirmed:
    "Ibahagi ang gawa mo. Hindi pa nakumpirma ang huling subok: i-tap para subukan muli.",
  shareAllPreparing: "Inihahanda ang gawa mo para ibahagi.",
  shareAllNothing: "Mag-record ng isang bahagi bago ibahagi ang gawa mo.",
  shareAllFailed: "Hindi maibahagi ang gawa mo. Subukan muli.",
  shareAllFailedWeb:
    "Hindi maibahagi ang gawa mo. Gamitin ang app na tC Mobile para ibahagi ito.",
  shareAllStorage:
    "Walang sapat na espasyo ang telepono na ito para ihanda ang gawa mo. Markahan na tapos na ang mga bahagi, saka subukan muli.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "{n} aklat ang hindi naisama.",
      other: "{n} aklat ang hindi naisama.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "{n} kabanata ang hindi naisama nang buo.",
      other: "{n} kabanata ang hindi naisama nang buo.",
    }),
  shareAllFilename: "Aking gawa.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "May ibang kopya ng app na ito na nakabukas.",
  dbBlockedTeach: "Isara ang kabilang kopya para magpatuloy.",
  dbOutOfDate: "Luma na ang kopyang ito.",
  dbOutOfDateTeach: "I-restart para magamit ang bagong bersyon.",

  // About and licences
  aboutOpen: "Tungkol dito at mga lisensya",
  aboutTitle: "Tungkol dito at mga lisensya",
  aboutBlurb:
    "Libre at open source na app. Lahat ng ni-record mo ay nananatili sa telepono na ito.",
  aboutAppLicense: "Inaalok ang app na ito sa ilalim ng lisensyang MIT.",
  aboutSourceOffer:
    "Hayag sa publiko ang source code ng app na ito. Ang source code ng bersyong ito:",
  aboutVisitAppSource: "Buksan ang source code ng bersyong ito sa GitHub",
  aboutPrivacy: "Paano hinahawakan ng app na ito ang iyong data:",
  aboutPrivacyLink: "Patakaran sa privacy",
  aboutVisitPrivacy: "Buksan ang patakaran sa privacy",
  aboutThirdParty: "Mga open source na bahagi",
  aboutTexts: "Teksto ng mga lisensya",
  aboutQrCaption: "I-scan para makuha ang app",
  aboutContent: "Kasamang nilalaman",
  aboutLanguageCodes: "Mga code ng wika: ISO 639-3, mula sa iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Basahin ang ${name}`,
  aboutBack: "Bumalik sa listahan",
  aboutTextLoading: "Nilo-load ang teksto ng lisensya.",
  aboutTextFailed: "Hindi ma-load ang teksto ng lisensya.",
  aboutVisitSource: (name: string): string =>
    `Buksan ang pahina ng proyektong ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Buksan ang source code ng ${name} na kasama sa bersyong ito`,
  aboutVisitLicense: (name: string): string => `Buksan ang lisensya ng ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} problema ang naitala",
      other: "{n} problema ang naitala",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Buksan ang menu. {n} problema ang naitala.",
      other: "Buksan ang menu. {n} problema ang naitala.",
    }),
  failuresTeach: "Ipadala ito sa tumutulong sa iyo kung may hindi gumagana.",
  shareFailureLog: "Ipadala ang ulat ng problema",
  shareFailureLogUnconfirmed:
    "Ipadala ang ulat ng problema. Hindi pa nakumpirma ang huling subok: i-tap para subukan muli.",
  shareFailureLogPreparing: "Inihahanda ang ulat ng problema.",
  shareFailureLogNothing: "Walang maipapadala sa ngayon.",
  shareFailureLogFailed: "Hindi maipadala ang ulat ng problema. Subukan muli.",
  shareFailureLogRestart:
    "Hindi na magagamit ang kopyang ito. I-restart ang app para magamit ang bagong bersyon.",
  clearFailureLog: "Burahin ang ulat ng problema",
  clearFailureLogConfirmTitle: "Burahin ang ulat ng problema?",
  clearFailureLogConfirm: "Burahin",
  loadFailed: "Hindi ma-load. Subukan muli.",
  saveFailed: "Hindi ma-save. Subukan muli.",
  noRoom: "Wala nang espasyo sa telepono na ito.",
  bookNameTaken:
    "May ibang aklat na gumagamit ng pangalang ito. Mag-type ng ibang pangalan.",
  stopToEdit: "Ihinto ang pag-record para mag-edit.",
  stopToErase: "Ihinto ang pag-record para mag-reset.",

  // Cover colours and chapter playback
  coverColourLabel: "Kulay ng pabalat",
  coverColourAmber: "Dilaw-kahel",
  coverColourTeal: "Asul-berde",
  coverColourPlum: "Ube",
  coverColourForest: "Berdeng gubat",
  coverColourBrick: "Ladrilyo",
  coverColourSlate: "Abuhin",
  coverColourRose: "Rosas",
  coverColourOlive: "Olibo",
  coverColourRust: "Kalawang",
  coverColourCocoa: "Kakaw",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, napili` : name,
  playChapter: (heading: string): string => `I-play ang ${heading}`,
  pauseChapter: (heading: string): string => `I-pause ang ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Ituloy ang ${heading}, naka-pause sa ${percent} porsyento`,
  chapterPlayFailed: (heading: string): string =>
    `Hindi na-play ang ${heading}. I-tap para subukan muli`,
  chapterNothingToPlay: (heading: string): string =>
    `Wala pang recording na ime-play ang ${heading}`,
  chapterPlayStarted: (heading: string): string => `Pine-play ang ${heading}`,
  chapterPlayPaused: (heading: string): string => `Naka-pause ang ${heading}`,
  chapterPlayFinished: (heading: string): string => `Tapos na ang ${heading}`,
};
