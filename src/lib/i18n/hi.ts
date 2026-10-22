import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The hi table: Hindi in Devanagari, drafted by AI under the decisions on
 * #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No Hindi reader has checked the meaning (#1628).
 *
 * Register: buttons and labels are the polite imperative a Hindi phone's own
 * menus use ("रिकॉर्ड करें", "साझा करें"); a notice about what could not
 * happen is the impersonal "... नहीं हो सका", which blames no one. A chapter
 * is "अध्याय", the word Hindi Bibles use (glossary row 2), a book is
 * "पुस्तक" and a segment "खंड". Words a Hindi phone already borrows from
 * English are written in Devanagari ("रिकॉर्ड", "माइक्रोफ़ोन", "ज़ूम", "मेनू",
 * "ऐप"); the only Latin kept is what the glossary keeps: "tC Mobile", "MIT",
 * the file extensions and the licence tags in a file name, and "GitHub".
 * Digits are 0 to 9 (R19), never Devanagari digits.
 *
 * Agreement: a Hindi verb agrees with the noun it is about, so each sentence
 * is built around the noun it names ("रिकॉर्डिंग सहेजी नहीं जा सकी", "खंड
 * हटाया नहीं जा सका"). Where a slot holds free text (a book or chapter
 * heading), the sentence is built so no word has to agree with it: the heading
 * is followed by "को" or "की जगह", which leave the verb in its default form.
 * Hindi selects the CLDR categories `one` and `other`, and 0 and 1 both select
 * `one`; the nouns here do not change with the count, so a count entry changes
 * only the verb ("किया जा सका" / "किए जा सके").
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
  newBook: "नई पुस्तक",
  menuOpen: "मेनू खोलें",
  menuTitle: "मेनू",
  menuClose: "मेनू बंद करें",
  settingsOpen: "सेटिंग",
  settingsTitle: "सेटिंग",
  settingsChapterNumbers: "अध्याय संख्या हमेशा दिखाएँ",
  booksEmpty: "अपनी पहली पुस्तक शुरू करें",
  booksEmptyTeach: "पुस्तक में वे अध्याय होते हैं जो आप रिकॉर्ड करते हैं।",
  loadingBooks: "आपकी पुस्तकें लोड हो रही हैं।",
  tryAgain: "फिर से कोशिश करें",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} अध्याय, सूची खुली है",
            other: "{name}, {n} अध्याय, सूची खुली है",
          }
        : {
            one: "{name}, {n} अध्याय, सूची बंद है",
            other: "{name}, {n} अध्याय, सूची बंद है",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `${bookName} में अध्याय जोड़ें`,
  openChapter: (heading: string): string => `${heading} खोलें`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ??
    (number === null ? "" : `पुस्तक ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `अध्याय ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `पुस्तक ${book} पर जाएँ`,
  goToChapter: (heading: string): string => `${heading} पर जाएँ`,

  // Naming
  renameBook: "पुस्तक का नाम बदलें",
  renameChapter: "अध्याय का नाम बदलें",
  renameSegment: "खंड का नाम बदलें",
  bookNameField: "पुस्तक का नाम",
  chapterNameField: "अध्याय का नाम",
  segmentNameField: "खंड का नाम",
  saveName: "नाम सहेजें",
  newBookTitle: "अपनी नई पुस्तक का नाम रखें",
  newBookClose: "पुस्तक बनाए बिना बंद करें",
  createBook: "पुस्तक बनाएँ",
  newChapterTitle: "अपने नए अध्याय का नाम रखें",
  newChapterClose: "अध्याय बनाए बिना बंद करें",
  createChapter: "अध्याय बनाएँ",
  savingName: "सहेजा जा रहा है…",
  creatingBook: "आपकी पुस्तक बनाई जा रही है…",

  // Segments screen
  backToBooks: "पुस्तकों पर वापस जाएँ",
  addSegment: "खंड जोड़ें",
  updating: "अध्याय अपडेट हो रहा है।",
  staleChapter: "यह अध्याय अब उपलब्ध नहीं है। पुस्तकों पर वापस जाएँ।",
  loadingChapter: "अध्याय लोड हो रहा है।",
  segmentsEmpty: "पहला खंड जोड़ें",
  segmentsEmptyTeach:
    "खंड अध्याय का एक अंश है — उसे रिकॉर्ड करें, चलाकर सुनें, फिर चाहें तो दोबारा रिकॉर्ड करें।",
  playSegment: (n: number): string => `खंड ${n} चलाएँ`,
  pauseSegment: (n: number): string => `खंड ${n} को विराम दें`,
  openRecorderSegment: (n: number): string => `खंड ${n} के लिए रिकॉर्डर खोलें`,
  editSegment(n: number, label: string | null): string {
    return `खंड ${this.segmentHeading(n, label)} संपादित करें`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `खंड ${this.segmentHeading(n, label)} संपादित करें, पूर्ण`;
  },
  openSegment(n: number, label: string | null): string {
    return `खंड ${this.segmentHeading(n, label)} खोलें`;
  },
  scrubSegment: (n: number): string => `खंड ${n} में स्थान`,
  markFinished: (n: number): string => `खंड ${n} को पूर्ण चिह्नित करें`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "नाम सहेजा नहीं गया। फिर से कोशिश करें।",

  // Recorder sheet
  recorderDialog: "रिकॉर्डर",
  useLightTheme: "हल्की स्क्रीन पर जाएँ, तेज़ धूप के लिए",
  useDarkTheme: "गहरी स्क्रीन पर जाएँ, कम रोशनी के लिए",
  tileEdit: "संपादित करें",
  tileFinished: "पूर्ण",
  tileStop: "रोकें",
  tileRename: "नाम बदलें",
  tileErase: "रीसेट",
  tileDelete: "हटाएँ",
  tileShare: "साझा करें",
  tileAbout: "जानकारी",
  closeRecorder: "रिकॉर्डर बंद करें",
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
  record: "रिकॉर्ड करें",
  stop: "रिकॉर्डिंग रोकें",
  zoomAtWhole: "ज़ूम आउट है। एक चौथाई तक ज़ूम इन करें।",
  zoomAtQuarter: "एक चौथाई तक ज़ूम इन है। ज़ूम आउट करें।",
  micOffTitle: "माइक्रोफ़ोन बंद है",
  micRetry: "फिर से कोशिश करें",
  micBack: "वापस जाएँ",
  micStepsLabel: "माइक्रोफ़ोन चालू करने के चरण",
  micStepOpenSettings: "अपने फ़ोन में सेटिंग खोलें",
  micStepAndroidApp: "ऐप्स पर टैप करें, फिर tC Mobile, फिर अनुमतियाँ",
  micStepIosApp: "गोपनीयता और सुरक्षा पर टैप करें, फिर माइक्रोफ़ोन",
  micStepIosAppOn: "tC Mobile चालू करें",
  micStepMicOn: "माइक्रोफ़ोन चालू करें",
  micStepComeBack: "यहाँ वापस आएँ और फिर से कोशिश करें पर टैप करें",
  finishedWriteFailed: "पूर्ण का निशान सहेजा नहीं जा सका।",
  recorderSaving: "सहेजा जा रहा है…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "{n} मिनट बचा है",
      other: "{n} मिनट बचे हैं",
    }),
  loadFailedTitle: "यह रिकॉर्डिंग खुल नहीं सकी",
  loadFailedBody:
    "आपकी रिकॉर्डिंग सुरक्षित है। फिर से कोशिश करें, या वापस जाकर सूची से इसे रीसेट करें।",
  loadRetry: "फिर से कोशिश करें",
  loadBack: "वापस जाएँ",
  loadRetrying: "आपकी रिकॉर्डिंग खोली जा रही है…",
  takeRecoverTitle: "यह रिकॉर्डिंग अभी सहेजी नहीं जा सकी",
  takeRecoverBody:
    "आपकी रिकॉर्डिंग अभी यहीं है। फिर से कोशिश करें, या उसे सुरक्षित रखने के लिए साझा करें।",
  takeRecoverRetry: "फिर से कोशिश करें",
  takeRecoverRetrying: "आपकी रिकॉर्डिंग सहेजी जा रही है…",
  takeRecoverShare: "रिकॉर्डिंग साझा करें",
  takeRecoverSharing: "रिकॉर्डिंग तैयार की जा रही है…",
  takeShareUnavailable: "इस डिवाइस पर साझा करना उपलब्ध नहीं है।",
  takeShareFailed: "रिकॉर्डिंग साझा नहीं हो सकी। फिर से कोशिश करें।",
  takeRetryFailed: "रिकॉर्डिंग सहेजी नहीं जा सकी। फिर से कोशिश करें।",
  takeRecoverShared: "रिकॉर्डिंग साझा हो गई।",
  takeRecoverDone: "पूर्ण",
  takeRecoverDiscard: "यह रिकॉर्डिंग हटाएँ",
  takeRecoverDiscardArmed:
    "इस रिकॉर्डिंग को हमेशा के लिए हटाने हेतु दोबारा टैप करें",
  takeRecoverDiscardHint: "हटाने के लिए दोबारा टैप करें।",
  playbackFailed: "यह रिकॉर्डिंग चलाई नहीं जा सकी।",
  micNoDevice: "इस डिवाइस पर कोई माइक्रोफ़ोन नहीं मिला।",
  micSiteBlocked:
    "इस ऐप के लिए रिकॉर्डिंग रोकी गई है। अपने ब्राउज़र की साइट सेटिंग में माइक्रोफ़ोन की अनुमति दें, उसके बाद फिर से कोशिश करें।",
  micOsBlocked:
    "आपका डिवाइस ऐप को माइक्रोफ़ोन इस्तेमाल करने नहीं दे रहा। अपने डिवाइस की सेटिंग में माइक्रोफ़ोन की पहुँच जाँचें, उसके बाद फिर से कोशिश करें।",
  micPrompt:
    "रिकॉर्ड करने के लिए माइक्रोफ़ोन की अनुमति चाहिए। पूछे जाने पर अनुमति दें — या अगर पहले दे चुके हैं, तो अपने डिवाइस की सेटिंग जाँचें।",
  micStartFailed: "रिकॉर्डिंग शुरू नहीं हो सकी।",
  recordingUnsupported: "यह डिवाइस ऑडियो रिकॉर्ड नहीं कर सकता।",
  playRecording: "रिकॉर्डिंग चलाएँ",
  stopPlayback: "चलाना रोकें",
  enterEdit: "रिकॉर्डिंग संपादित करें",
  leaveEdit: "संपादन बंद करें",
  editingMarker: "संपादन हो रहा है",
  cut: "चयन काटें",
  auditionSelection: "चयन चलाएँ",
  auditionFromLine: "रेखा से चलाएँ",
  paste: "रेखा पर चिपकाएँ",
  undo: "पूर्ववत करें",
  redo: "फिर से करें",
  nothingToUndo: "पूर्ववत करने के लिए कुछ नहीं है।",
  nothingToRedo: "फिर से करने के लिए कुछ नहीं है।",
  recorderMenuTitle: "और",
  recorderMenuOpen: "और विकल्प",
  selectionStartHandle: "चयन की शुरुआत",
  selectionEndHandle: "चयन का अंत",
  editFailed: "वह बदलाव लागू नहीं हो सका। छोटा चयन आज़माएँ।",
  clearFailed: "ऑडियो रीसेट नहीं हो सका। फिर से कोशिश करें।",
  captureSilence: "कोई आवाज़ रिकॉर्ड नहीं हुई। फिर से कोशिश करें।",
  captureUndecodable: "इस डिवाइस पर रिकॉर्डिंग पढ़ी नहीं जा सकी।",
  captureUnfinished: "यह रिकॉर्डिंग पूरी नहीं हो सकी।",
  blockedByTake:
    'रिकॉर्डिंग सहेजने के लिए "मेनू बंद करें", फिर "रिकॉर्डर बंद करें" चुनें।',
  micStarting: "माइक्रोफ़ोन अभी चालू हो रहा है।",
  nothingRecorded: "अभी तक कुछ रिकॉर्ड नहीं हुआ।",
  nothingStored: "रीसेट करने के लिए कुछ सहेजा नहीं है।",
  liveWaveform: "चल रही रिकॉर्डिंग की तरंग",
  vuMeterLabel: "रिकॉर्डिंग का स्तर",
  vuMeterUnavailable: "इस डिवाइस पर स्तर मीटर उपलब्ध नहीं है",
  eraseSegment: "खंड रीसेट करें और फिर से शुरू करें",
  rerecord: "रीसेट करें और फिर से रिकॉर्ड करें",
  segmentMenu: (n: number): string => `खंड ${n} के लिए और विकल्प`,
  reorderLifted: (n: number): string => `खंड ${n} को ले जाया जा रहा है।`,
  reorderMoved: (from: number, to: number): string =>
    `खंड ${from} अब खंड ${to} है।`,
  reorderStayed: (n: number): string => `खंड ${n} अपनी जगह पर ही रहा।`,
  chapterReorderLifted: (n: number): string =>
    `अध्याय ${n} को ले जाया जा रहा है।`,
  chapterReorderMoved: (n: number, to: number): string =>
    `अध्याय ${n} स्थान ${to} पर चला गया।`,
  chapterReorderStayed: (n: number): string =>
    `अध्याय ${n} अपनी जगह पर ही रहा।`,
  bookReorderLifted: (heading: string): string => `ले जाना: ${heading}`,
  bookReorderMoved: (heading: string, to: number): string =>
    `शेल्फ़ पर ${heading} की जगह अब ${to} है।`,
  bookReorderStayed: (heading: string): string =>
    `शेल्फ़ पर ${heading} की जगह नहीं बदली।`,
  eraseConfirmTitle: "खंड रीसेट करें और फिर से शुरू करें",
  eraseConfirm: "रिकॉर्डिंग रीसेट करें",
  eraseCancel: "रद्द करें",
  recordAgainConfirm: "फिर से रिकॉर्ड करें",
  recordAgainKeep: "इसे रखें",
  eraseFailed: "रिकॉर्डिंग रीसेट नहीं हो सकी। फिर से कोशिश करें।",
  eraseConfirmPreviewPlay: "जो खो जाएगा उसे चलाएँ",
  eraseConfirmPreviewPause: "विराम",
  discardClip: "कटा हुआ ऑडियो फेंक दें",
  discardClipConfirmTitle: "कटा हुआ ऑडियो फेंक दें?",
  discardClipConfirm: "फेंक दें",
  deleteBook: "पुस्तक हटाएँ",
  deleteBookConfirmTitle: (book: string): string =>
    `${book} और उसके अंदर सब कुछ हटाएँ?`,
  keepBook: "पुस्तक न हटाएँ",
  deleteBookYes: "हाँ, पुस्तक हटाएँ",
  deleteBookFailed: "यह पुस्तक हटाई नहीं जा सकी। फिर से कोशिश करें।",
  deleteSegment: "खंड हटाएँ",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `खंड ${ordinal} हटाएँ?`,
  deleteSegmentConfirm: "हटाएँ",
  deleteSegmentFailed: "यह खंड हटाया नहीं जा सका। फिर से कोशिश करें।",
  chapterMenuOpen: "इस अध्याय के लिए और विकल्प",
  chapterMenuTitle: "अध्याय",

  // Sharing
  shareChapter: "अध्याय साझा करें",
  shareChapterUnconfirmed:
    "अध्याय साझा करें। पिछला प्रयास पुष्ट नहीं हुआ — फिर से कोशिश करने के लिए टैप करें।",
  shareSend: "अभी साझा करें",
  sharePreparing: "साझा करने के लिए अध्याय तैयार किया जा रहा है।",
  shareHandingOver: "फ़ोन की साझा करने की सूची खोली जा रही है।",
  sharePreparingLabel: "साझा करने की तैयारी",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `${all} में से {n} भेजा जा रहा है`,
      other: `${all} में से {n} भेजे जा रहे हैं`,
    }),
  shareSent: "फ़ोन की साझा करने की सूची को सौंप दिया गया।",
  shareDismissed: "कुछ भी भेजे जाने से पहले साझा करने की सूची बंद हो गई।",
  shareUnproven:
    "साझा करने की सूची बंद हो गई। यह फ़ोन पुष्टि नहीं कर सकता कि आगे कुछ गया या नहीं।",
  shareNothing: "इस अध्याय को साझा करने से पहले एक खंड रिकॉर्ड करें।",
  shareFailed: "यह अध्याय साझा नहीं हो सका। फिर से कोशिश करें।",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "{n} खंड शामिल नहीं किया जा सका।",
      other: "{n} खंड शामिल नहीं किए जा सके।",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `${book} के लिए और विकल्प`,
  bookMenuTitle: "पुस्तक",
  shareBook: "पुस्तक साझा करें",
  shareBookUnconfirmed:
    "पुस्तक साझा करें। पिछला प्रयास पुष्ट नहीं हुआ — फिर से कोशिश करने के लिए टैप करें।",
  shareBookPreparing: "साझा करने के लिए पुस्तक तैयार की जा रही है।",
  exportProject: "प्रोजेक्ट निर्यात करें",
  tileExport: "निर्यात",
  exportProjectPreparing: "निर्यात के लिए प्रोजेक्ट तैयार किया जा रहा है।",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "इस पुस्तक को साझा करने से पहले एक खंड रिकॉर्ड करें।",
  shareBookFailed: "यह पुस्तक साझा नहीं हो सकी। फिर से कोशिश करें।",
  shareBookFailedWeb:
    "यह पुस्तक साझा नहीं हो सकी। पुस्तक साझा करना tC Mobile ऐप में काम करता है।",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "{n} अध्याय शामिल नहीं किया जा सका।",
      other: "{n} अध्याय शामिल नहीं किए जा सके।",
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
    const where = plural(scope, {
      "=1": "शामिल किए गए अध्याय के",
      one: "शामिल किए गए {n} अध्याय के",
      other: "शामिल किए गए {n} अध्यायों के",
    });
    const partial = plural(segments, {
      one: `${where} {n} खंड शामिल नहीं किया जा सका।`,
      other: `${where} {n} खंड शामिल नहीं किए जा सके।`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "इसे साझा करने के लिए तैयार नहीं किया जा सका। फिर से कोशिश करें — अगर यह बार-बार हो, तो ऐप फिर से शुरू करें।",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "पुस्तक",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "आपके बदलाव सहेजे नहीं गए" : "यह रिकॉर्डिंग सहेजी नहीं गई",
  saveFailedSaving: "सहेजा जा रहा है",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "आपकी संपादित रिकॉर्डिंग अभी यहीं है।"
        : `खंड ${ordinal} की आपकी संपादित रिकॉर्डिंग अभी यहीं है।`
      : ordinal === null
        ? "आपकी रिकॉर्डिंग अभी यहीं है।"
        : `खंड ${ordinal} की आपकी रिकॉर्डिंग अभी यहीं है।`,
  saveFailedRetry: "फिर से सहेजने की कोशिश करें",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "इन बदलावों को छोड़ने के लिए दोबारा टैप करें"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "इन बदलावों को छोड़ें"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "छोड़ने के लिए दोबारा टैप करें।"
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "आपके बदलावों के लिए ऐप का नया संस्करण चाहिए।"
      : "इस रिकॉर्डिंग के लिए ऐप का नया संस्करण चाहिए।",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "यह पुस्तक अब नहीं है। आपके बदलाव सहेजे नहीं जा सकते।"
      : "यह पुस्तक अब नहीं है। यह रिकॉर्डिंग सहेजी नहीं जा सकती।",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "आपके बदलाव सहेजे नहीं जा सके।"
      : "यह रिकॉर्डिंग सहेजी नहीं जा सकी।",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "ऐप की यह प्रति इन्हें सहेज नहीं सकती। फिर से शुरू करने पर ये खो जाएँगे, लेकिन नया संस्करण पाने का यही एकमात्र तरीका है।"
      : "ऐप की यह प्रति इसे सहेज नहीं सकती। फिर से शुरू करने पर यह खो जाएगी, लेकिन नया संस्करण पाने का यही एकमात्र तरीका है।",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "यह पुस्तक ऐप की दूसरी प्रति में हटा दी गई थी। बाहर निकलने का एकमात्र तरीका बदलाव छोड़ना है।"
      : "यह पुस्तक ऐप की दूसरी प्रति में हटा दी गई थी। बाहर निकलने के लिए इस रिकॉर्डिंग को हटाएँ।",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "इस स्क्रीन पर आपके बदलावों की एकमात्र प्रति है। ऐप बंद न करें।"
      : "इस स्क्रीन पर आपके बिना सहेजे काम की एकमात्र प्रति है। ऐप बंद न करें।",
  saveFailedAttempts: (attempts: number): string => `प्रयास: ${attempts}`,
  appFailed: "कुछ गड़बड़ हो गई।",
  appReload: "ऐप फिर से शुरू करें",
  appReloadTeach: "ऐप दोबारा शुरू होगा।",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "ऐप फिर से शुरू करने और इस रिकॉर्डिंग व आपके काटे हुए ऑडियो को खोने के लिए दोबारा टैप करें"
          : "ऐप फिर से शुरू करने और इस रिकॉर्डिंग को खोने के लिए दोबारा टैप करें";
      case "changes":
        return alsoCutAudio
          ? "ऐप फिर से शुरू करने और इन बदलावों व आपके काटे हुए ऑडियो को खोने के लिए दोबारा टैप करें"
          : "ऐप फिर से शुरू करने और इन बदलावों को खोने के लिए दोबारा टैप करें";
      case "cutAudio":
        return "ऐप फिर से शुरू करने और आपके काटे हुए ऑडियो को खोने के लिए दोबारा टैप करें";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "दोबारा टैप करें, और यह रिकॉर्डिंग और आपका काटा हुआ ऑडियो चले जाएँगे।"
          : "दोबारा टैप करें, और यह रिकॉर्डिंग चली जाएगी।";
      case "changes":
        return alsoCutAudio
          ? "दोबारा टैप करें, और ये बदलाव और आपका काटा हुआ ऑडियो चले जाएँगे।"
          : "दोबारा टैप करें, और ये बदलाव चले जाएँगे।";
      case "cutAudio":
        return "दोबारा टैप करें, और आपका काटा हुआ ऑडियो चला जाएगा।";
    }
  },
  appReloading: "फिर से शुरू हो रहा है…",
  appReloadHeld:
    "यह समस्या अभी सहेजी नहीं जा सकी। इसे भेजें, या फिर से कोशिश करें।",
  encoderFailing:
    "यह फ़ोन रिकॉर्डिंग को छोटा नहीं कर सका। कुछ भी खोया नहीं है — ऐप फिर से शुरू करने से मदद मिल सकती है।",

  // Storage and sharing everything
  storageNotPersisted:
    "जगह कम होने पर यह फ़ोन यहाँ आपकी रिकॉर्ड की हुई चीज़ें मिटा सकता है। जब हो सके, अपना काम साझा करें।",
  storageLow:
    "इस फ़ोन में जगह कम हो रही है। जगह बनाने के लिए खंडों को पूर्ण चिह्नित करें, या अपना काम साझा करके उसे हटा दें।",
  storageCritical:
    "इस फ़ोन में जगह लगभग खत्म हो गई है, और नई रिकॉर्डिंग शायद सहेजी न जा सकें। खंडों को पूर्ण चिह्नित करें, या अपना काम साझा करके उसे हटा दें।",
  storageShareSoon: "अपना काम जल्दी साझा करें",
  shareAll: "अपना काम साझा करें",
  shareAllUnconfirmed:
    "अपना काम साझा करें। पिछला प्रयास पुष्ट नहीं हुआ — फिर से कोशिश करने के लिए टैप करें।",
  shareAllPreparing: "साझा करने के लिए आपका काम तैयार किया जा रहा है।",
  shareAllNothing: "अपना काम साझा करने से पहले एक खंड रिकॉर्ड करें।",
  shareAllFailed: "आपका काम साझा नहीं हो सका। फिर से कोशिश करें।",
  shareAllFailedWeb:
    "आपका काम साझा नहीं हो सका। इसे साझा करने के लिए tC Mobile ऐप इस्तेमाल करें।",
  shareAllStorage:
    "इस फ़ोन में आपका काम तैयार करने की जगह नहीं है। खंडों को पूर्ण चिह्नित करें, उसके बाद फिर से कोशिश करें।",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "{n} पुस्तक शामिल नहीं की जा सकी।",
      other: "{n} पुस्तकें शामिल नहीं की जा सकीं।",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "{n} अध्याय पूरा शामिल नहीं किया जा सका।",
      other: "{n} अध्याय पूरे शामिल नहीं किए जा सके।",
    }),
  shareAllFilename: "मेरा काम.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "इस ऐप की दूसरी प्रति खुली है।",
  dbBlockedTeach: "आगे बढ़ने के लिए दूसरी प्रति बंद करें।",
  dbOutOfDate: "यह प्रति पुरानी हो चुकी है।",
  dbOutOfDateTeach: "नया संस्करण इस्तेमाल करने के लिए फिर से शुरू करें।",

  // About and licences
  aboutOpen: "ऐप के बारे में और लाइसेंस",
  aboutTitle: "ऐप के बारे में और लाइसेंस",
  aboutBlurb:
    "एक मुफ़्त और ओपन-सोर्स ऐप। आप जो कुछ रिकॉर्ड करते हैं, वह इसी फ़ोन में रहता है।",
  aboutAppLicense: "यह ऐप MIT लाइसेंस के अंतर्गत उपलब्ध है।",
  aboutSourceOffer: "इस ऐप का स्रोत कोड सार्वजनिक है। इस संस्करण का स्रोत:",
  aboutVisitAppSource: "इस संस्करण का स्रोत GitHub पर खोलें",
  aboutPrivacy: "यह ऐप आपके डेटा को कैसे संभालता है:",
  aboutPrivacyLink: "गोपनीयता नीति",
  aboutVisitPrivacy: "गोपनीयता नीति खोलें",
  aboutThirdParty: "ओपन-सोर्स घटक",
  aboutTexts: "लाइसेंस के पाठ",
  aboutContent: "शामिल सामग्री",
  aboutLanguageCodes: "भाषा कोड: ISO 639-3, iso639-3.sil.org से।",
  aboutReadText: (name: string): string => `${name} पढ़ें`,
  aboutBack: "सूची पर वापस जाएँ",
  aboutTextLoading: "लाइसेंस का पाठ लोड हो रहा है।",
  aboutTextFailed: "लाइसेंस का पाठ लोड नहीं हो सका।",
  aboutVisitSource: (name: string): string => `${name} का प्रोजेक्ट पेज खोलें`,
  aboutVisitKeptSource: (name: string): string =>
    `इस संस्करण के साथ रखा गया ${name} का स्रोत खोलें`,
  aboutVisitLicense: (name: string): string => `${name} का लाइसेंस खोलें`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} समस्या दर्ज हुई",
      other: "{n} समस्याएँ दर्ज हुईं",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "मेनू खोलें। {n} समस्या दर्ज हुई।",
      other: "मेनू खोलें। {n} समस्याएँ दर्ज हुईं।",
    }),
  failuresTeach: "अगर कुछ ठीक से काम न कर रहा हो, तो इसे अपने सहायक को भेजें।",
  shareFailureLog: "समस्या रिपोर्ट भेजें",
  shareFailureLogUnconfirmed:
    "समस्या रिपोर्ट भेजें। पिछला प्रयास पुष्ट नहीं हुआ — फिर से कोशिश करने के लिए टैप करें।",
  shareFailureLogPreparing: "समस्या रिपोर्ट तैयार की जा रही है।",
  shareFailureLogNothing: "अभी भेजने के लिए कुछ नहीं है।",
  shareFailureLogFailed: "समस्या रिपोर्ट भेजी नहीं जा सकी। फिर से कोशिश करें।",
  shareFailureLogRestart:
    "इस प्रति का अब उपयोग नहीं हो सकता। नया संस्करण पाने के लिए ऐप फिर से शुरू करें।",
  clearFailureLog: "समस्या रिपोर्ट साफ़ करें",
  clearFailureLogConfirmTitle: "समस्या रिपोर्ट साफ़ करें?",
  clearFailureLogConfirm: "साफ़ करें",
  loadFailed: "लोड नहीं हो सका। फिर से कोशिश करें।",
  saveFailed: "सहेजा नहीं जा सका। फिर से कोशिश करें।",
  noRoom: "इस फ़ोन में अब जगह नहीं बची।",
  bookNameTaken: "इस नाम की एक और किताब पहले से है। कोई अलग नाम लिखें।",
  stopToEdit: "संपादित करने के लिए रिकॉर्डिंग रोकें।",
  stopToErase: "रीसेट करने के लिए रिकॉर्डिंग रोकें।",

  // Cover colours and chapter playback
  coverColourLabel: "कवर का रंग",
  coverColourAmber: "अंबर",
  coverColourTeal: "हरा-नीला",
  coverColourPlum: "बैंगनी",
  coverColourForest: "जंगली हरा",
  coverColourBrick: "ईंट-लाल",
  coverColourSlate: "स्लेटी",
  coverColourRose: "गुलाबी",
  coverColourOlive: "जैतूनी",
  coverColourRust: "जंग",
  coverColourCocoa: "कोको",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, चुना हुआ` : name,
  playChapter: (heading: string): string => `${heading} चलाएँ`,
  pauseChapter: (heading: string): string => `${heading} को विराम दें`,
  resumeChapter: (heading: string, percent: number): string =>
    `${heading} जारी रखें, ${percent} प्रतिशत पर रुका हुआ`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading}: चलाने के लिए कुछ रिकॉर्ड नहीं है`,
};
