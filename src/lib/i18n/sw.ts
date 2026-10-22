import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The sw table: Swahili, drafted by AI under the decisions on #1458 (Q1 and
 * Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No Swahili reader has checked the meaning (#1625).
 *
 * Register: buttons and labels are the bare imperative the phone's own menus
 * use ("Rekodi", "Shiriki"); sentences that speak to the person are plain and
 * polite ("Jaribu tena"), and a notice about what could not happen is the
 * impersonal negative past ("Haikuweza kuhifadhiwa"), which blames no one. A
 * chapter is "sura", the word Swahili Bibles use (glossary row 2); a book is
 * "kitabu" and a segment "kipande", whose plurals "vitabu" and "vipande" the
 * count entries below use. Digits are 0 to 9 (R19).
 *
 * Agreement: Swahili verbs, adjectives and possessives take the class of the
 * noun, so each sentence agrees with the noun it is about. The noun is named
 * in the sentence wherever it is known ("Kipande ... kimekamilika", "Rekodi
 * yako", "kitabu chako", "vitabu vyako"). Where the noun is a slot filled with
 * free text (a book or chapter heading), the sentence is built so no word has
 * to agree with it. Swahili selects the CLDR categories `one` and `other`, so
 * a count entry carries both; the noun and the verb take the plural class at
 * `other` and the singular class at `one`.
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
  newBook: "Kitabu kipya",
  menuOpen: "Fungua menyu",
  menuTitle: "Menyu",
  menuClose: "Funga menyu",
  booksEmpty: "Anza kitabu chako cha kwanza",
  booksEmptyTeach: "Kitabu kina sura unazorekodi.",
  loadingBooks: "Inapakia vitabu vyako.",
  tryAgain: "Jaribu tena",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, sura {n}, imefunguliwa",
            other: "{name}, sura {n}, imefunguliwa",
          }
        : {
            one: "{name}, sura {n}, imefungwa",
            other: "{name}, sura {n}, imefungwa",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Ongeza sura kwenye ${bookName}`,
  openChapter: (heading: string): string => `Fungua ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ??
    (number === null ? "" : `Kitabu ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Sura ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Nenda kwenye kitabu ${book}`,
  goToChapter: (heading: string): string => `Nenda kwenye ${heading}`,

  // Naming
  renameBook: "Badilisha jina la kitabu",
  renameChapter: "Badilisha jina la sura",
  renameSegment: "Badilisha jina la kipande",
  bookNameField: "Jina la kitabu",
  chapterNameField: "Jina la sura",
  segmentNameField: "Jina la kipande",
  saveName: "Hifadhi jina",
  newBookTitle: "Taja kitabu chako kipya",
  newBookClose: "Funga bila kuunda kitabu",
  createBook: "Unda kitabu",
  newChapterTitle: "Taja sura yako mpya",
  newChapterClose: "Funga bila kuunda sura",
  createChapter: "Unda sura",
  savingName: "Inahifadhi…",
  creatingBook: "Inaunda kitabu chako…",

  // Segments screen
  backToBooks: "Rudi kwenye vitabu",
  addSegment: "Ongeza kipande",
  updating: "Inasasisha sura.",
  staleChapter: "Sura hii haipatikani tena. Rudi kwenye Vitabu.",
  loadingChapter: "Inapakia sura.",
  segmentsEmpty: "Ongeza kipande chako cha kwanza",
  segmentsEmptyTeach:
    "Kipande ni sehemu moja ya sura: rekodi, cheza, kisha rekodi tena.",
  playSegment: (n: number): string => `Cheza kipande ${n}`,
  pauseSegment: (n: number): string => `Sitisha kipande ${n}`,
  openRecorderSegment: (n: number): string =>
    `Fungua kirekodi cha kipande ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Hariri kipande ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Hariri kipande ${this.segmentHeading(n, label)}, kimekamilika`;
  },
  openSegment(n: number, label: string | null): string {
    return `Fungua kipande ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Mahali katika kipande ${n}`,
  markFinished: (n: number): string =>
    `Weka alama kuwa kipande ${n} kimekamilika`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Jina halikuhifadhiwa. Jaribu tena.",

  // Recorder sheet
  recorderDialog: "Kirekodi",
  useLightTheme: "Badilisha kwenda skrini nyepesi, kwa mwanga wa jua",
  useDarkTheme:
    "Badilisha kwenda skrini nyeusi, kwa mahali penye mwanga hafifu",
  tileEdit: "Hariri",
  tileFinished: "Imekamilika",
  tileStop: "Acha",
  tileRename: "Badilisha jina",
  tileErase: "Weka upya",
  tileDelete: "Futa",
  tileShare: "Shiriki",
  tileAbout: "Kuhusu",
  tileLight: "Nyepesi",
  tileDark: "Nyeusi",
  closeRecorder: "Funga kirekodi",
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
  record: "Rekodi",
  stop: "Acha kurekodi",
  zoomAtWhole: "Mwonekano mpana. Kuza hadi robo.",
  zoomAtQuarter: "Imekuzwa hadi robo. Punguza.",
  micOffTitle: "Maikrofoni imezimwa",
  micRetry: "Jaribu tena",
  micBack: "Rudi",
  micStepsLabel: "Hatua za kuwasha maikrofoni",
  micStepOpenSettings: "Fungua Mipangilio kwenye simu yako",
  micStepAndroidApp: "Gusa Programu, kisha tC Mobile, kisha Ruhusa",
  micStepIosApp: "Gusa Faragha na Usalama, kisha Maikrofoni",
  micStepIosAppOn: "Washa tC Mobile",
  micStepMicOn: "Washa Maikrofoni",
  micStepComeBack: "Rudi hapa kisha uguse Jaribu tena",
  finishedWriteFailed: "Alama ya kukamilika haikuhifadhiwa.",
  recorderSaving: "Inahifadhi…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "Imebaki dakika {n}",
      other: "Zimebaki dakika {n}",
    }),
  loadFailedTitle: "Rekodi hii haikuweza kufunguliwa",
  loadFailedBody:
    "Rekodi yako iko salama. Jaribu tena, au rudi ili uiweke upya kutoka kwenye orodha.",
  loadRetry: "Jaribu tena",
  loadBack: "Rudi",
  loadRetrying: "Inafungua rekodi yako…",
  takeRecoverTitle: "Rekodi hii haijahifadhiwa",
  takeRecoverBody:
    "Rekodi yako bado iko hapa. Jaribu tena, au ishiriki ili iwe salama.",
  takeRecoverRetry: "Jaribu tena",
  takeRecoverRetrying: "Inahifadhi rekodi yako…",
  takeRecoverShare: "Shiriki rekodi",
  takeRecoverSharing: "Inaandaa rekodi…",
  takeShareUnavailable: "Kushiriki hakupatikani kwenye kifaa hiki.",
  takeShareFailed: "Rekodi haikuweza kushirikiwa. Jaribu tena.",
  takeRetryFailed: "Rekodi haikuweza kuhifadhiwa. Jaribu tena.",
  takeRecoverShared: "Rekodi imeshirikiwa.",
  takeRecoverDone: "Imekamilika",
  takeRecoverDiscard: "Futa rekodi hii",
  takeRecoverDiscardArmed: "Gusa tena ili kufuta rekodi hii milele",
  takeRecoverDiscardHint: "Gusa tena ili kuifuta.",
  playbackFailed: "Rekodi hii haikuweza kuchezwa.",
  micNoDevice: "Hakuna maikrofoni kwenye kifaa hiki.",
  micSiteBlocked:
    "Kurekodi kumezuiwa kwa programu hii. Ruhusu maikrofoni katika mipangilio ya tovuti ya kivinjari, kisha jaribu tena.",
  micOsBlocked:
    "Kifaa chako hakiruhusu programu kutumia maikrofoni. Angalia ufikiaji wa maikrofoni katika mipangilio ya kifaa, kisha jaribu tena.",
  micPrompt:
    "Maikrofoni inahitajika ili kurekodi. Ruhusu inapoombwa, au ikiwa tayari imeruhusiwa, angalia mipangilio ya kifaa chako.",
  micStartFailed: "Kurekodi hakukuweza kuanza.",
  recordingUnsupported: "Kifaa hiki hakiwezi kurekodi sauti.",
  playRecording: "Cheza rekodi",
  stopPlayback: "Acha kucheza",
  enterEdit: "Hariri rekodi",
  leaveEdit: "Toka kwenye kuhariri",
  editingMarker: "Inahariri",
  cut: "Kata uteuzi",
  auditionSelection: "Cheza uteuzi",
  auditionFromLine: "Cheza kuanzia kwenye mstari",
  paste: "Bandika kwenye mstari",
  undo: "Tendua",
  redo: "Rudia",
  nothingToUndo: "Hakuna cha kutendua.",
  nothingToRedo: "Hakuna cha kurudia.",
  recorderMenuTitle: "Zaidi",
  recorderMenuOpen: "Vitendo zaidi",
  selectionStartHandle: "Mwanzo wa uteuzi",
  selectionEndHandle: "Mwisho wa uteuzi",
  editFailed:
    "Mabadiliko hayo hayakuweza kutekelezwa. Jaribu uteuzi mdogo zaidi.",
  clearFailed: "Sauti haikuweza kuwekwa upya. Jaribu tena.",
  captureSilence: "Hakuna sauti iliyorekodiwa. Jaribu tena.",
  captureUndecodable: "Rekodi haikuweza kusomwa kwenye kifaa hiki.",
  captureUnfinished: "Rekodi hii haikuweza kukamilishwa.",
  blockedByTake:
    'Chagua "Funga menyu", kisha "Funga kirekodi" ili kuhifadhi rekodi.',
  micStarting: "Maikrofoni bado inaanza kuwaka.",
  nothingRecorded: "Bado hakuna kilichorekodiwa.",
  nothingStored: "Hakuna kilichohifadhiwa cha kuweka upya.",
  liveWaveform: "Mawimbi ya sauti ya rekodi inayoendelea",
  vuMeterLabel: "Kiwango cha kurekodi",
  vuMeterUnavailable:
    "Kipimo cha kiwango cha sauti hakipatikani kwenye kifaa hiki",
  eraseSegment: "Weka upya kipande na uanze tena",
  rerecord: "Weka upya na urekodi tena",
  segmentMenu: (n: number): string => `Vitendo zaidi vya kipande ${n}`,
  reorderLifted: (n: number): string => `Inahamisha kipande ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Kipande ${from} sasa ni kipande ${to}.`,
  reorderStayed: (n: number): string => `Kipande ${n} kilibaki mahali pake.`,
  chapterReorderLifted: (n: number): string => `Inahamisha sura ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Sura ${from} sasa ni sura ${to}.`,
  chapterReorderStayed: (n: number): string => `Sura ${n} ilibaki mahali pake.`,
  bookReorderLifted: (heading: string): string => `Inahamisha ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `Nafasi ya ${heading} kwenye rafu sasa ni ${to}.`,
  bookReorderStayed: (heading: string): string =>
    `Nafasi ya ${heading} kwenye rafu haikubadilika.`,
  eraseConfirmTitle: "Weka upya kipande na uanze tena",
  eraseConfirm: "Weka upya rekodi",
  eraseCancel: "Ghairi",
  recordAgainConfirm: "Rekodi tena",
  recordAgainKeep: "Iweke",
  eraseFailed: "Rekodi haikuweza kuwekwa upya. Jaribu tena.",
  eraseConfirmPreviewPlay: "Cheza kitakachopotea",
  eraseConfirmPreviewPause: "Sitisha",
  discardClip: "Tupa sauti iliyokatwa",
  discardClipConfirmTitle: "Tupa sauti iliyokatwa?",
  discardClipConfirm: "Tupa",
  deleteBook: "Futa kitabu",
  deleteBookConfirmTitle: (book: string): string =>
    `Futa ${book} na vyote vilivyomo?`,
  keepBook: "Usifute kitabu",
  deleteBookYes: "Ndiyo, futa kitabu",
  deleteBookFailed: "Kitabu hiki hakikuweza kufutwa. Jaribu tena.",
  deleteSegment: "Futa kipande",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Futa kipande ${ordinal}?`,
  deleteSegmentConfirm: "Futa",
  deleteSegmentFailed: "Kipande hiki hakikuweza kufutwa. Jaribu tena.",
  chapterMenuOpen: "Vitendo zaidi vya sura hii",
  chapterMenuTitle: "Sura",

  // Sharing
  shareChapter: "Shiriki sura",
  shareChapterUnconfirmed:
    "Shiriki sura. Jaribio la mwisho halikuthibitishwa: gusa ili ujaribu tena.",
  shareSend: "Shiriki sasa",
  sharePreparing: "Inaandaa sura ili ishirikiwe.",
  shareHandingOver: "Inafungua orodha ya kushiriki ya simu.",
  sharePreparingLabel: "Inaandaa kushiriki",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `Inashiriki {n} kati ya ${all}`,
      other: `Inashiriki {n} kati ya ${all}`,
    }),
  shareSent: "Imekabidhiwa orodha ya kushiriki ya simu.",
  shareDismissed: "Orodha ya kushiriki ilifungwa kabla ya chochote kutumwa.",
  shareUnproven:
    "Orodha ya kushiriki ilifungwa. Simu hii haiwezi kuthibitisha kama kuna kilichotumwa.",
  shareNothing: "Rekodi kipande kimoja kabla ya kushiriki sura hii.",
  shareFailed: "Sura hii haikuweza kushirikiwa. Jaribu tena.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "Kipande {n} hakikuweza kujumuishwa.",
      other: "Vipande {n} havikuweza kujumuishwa.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Vitendo zaidi vya ${book}`,
  bookMenuTitle: "Kitabu",
  shareBook: "Shiriki kitabu",
  shareBookUnconfirmed:
    "Shiriki kitabu. Jaribio la mwisho halikuthibitishwa: gusa ili ujaribu tena.",
  shareBookPreparing: "Inaandaa kitabu ili kishirikiwe.",
  // Export project (#1457). Carried here only because #1624 predates the
  // Swahili table; if #1624 lands its own copy first, that copy wins.
  exportProject: "Hamisha mradi",
  tileExport: "Hamisha",
  exportProjectPreparing: "Inaandaa mradi ili uhamishwe.",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  // The language ask (#1492).
  languageAskTitle: "Lugha ya kitabu hiki",
  languageAskLead:
    "Rekodi hizi ziko katika lugha gani? Unaichagua mara moja, na kila uhamishaji wa kitabu hiki unaitumia.",
  languageSearch: "Tafuta lugha",
  languageSearchHint: "Jina au msimbo",
  languageRow: (name: string, tag: string): string => `${name}, ${tag}`,
  languageLoading: "Inapakia lugha.",
  languageLoadFailed: "Lugha hazikuweza kupakiwa.",
  languageNoMatch: "Hakuna lugha inayolingana. Jaribu jina au msimbo mwingine.",
  languageNarrow: "Andika zaidi ili uone lugha nyingine.",
  languageSaving: "Inahifadhi lugha.",
  languageAskCancel: "Ghairi",
  shareBookNothing: "Rekodi kipande kimoja kabla ya kushiriki kitabu hiki.",
  shareBookFailed: "Kitabu hiki hakikuweza kushirikiwa. Jaribu tena.",
  shareBookFailedWeb:
    "Kitabu hiki hakikuweza kushirikiwa. Kushiriki kitabu kunawezekana tu kwenye programu ya tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "Sura {n} haikuweza kujumuishwa.",
      other: "Sura {n} hazikuweza kujumuishwa.",
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
      "=1": "sura iliyojumuishwa",
      one: "sura {n} iliyojumuishwa",
      other: "sura {n} zilizojumuishwa",
    });
    const partial = plural(segments, {
      one: `Kipande {n} cha ${where} hakikuweza kujumuishwa.`,
      other: `Vipande {n} vya ${where} havikuweza kujumuishwa.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Hiki hakikuweza kuandaliwa ili kishirikiwe. Jaribu tena; ikiendelea, anzisha upya programu.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Kitabu",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Mabadiliko yako hayajahifadhiwa" : "Rekodi hii haijahifadhiwa",
  saveFailedSaving: "Inahifadhi",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Rekodi uliyoihariri bado iko hapa."
        : `Rekodi ya kipande ${ordinal} uliyoihariri bado iko hapa.`
      : ordinal === null
        ? "Rekodi yako bado iko hapa."
        : `Rekodi ya kipande ${ordinal} bado iko hapa.`,
  saveFailedRetry: "Jaribu kuhifadhi tena",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Gusa tena ili kutupa mabadiliko haya"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Tupa mabadiliko haya"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly ? "Gusa tena ili kuyatupa." : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Mabadiliko yako yanahitaji toleo jipya la programu."
      : "Rekodi hii inahitaji toleo jipya la programu.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Kitabu hiki hakipo tena. Mabadiliko yako hayakuweza kuhifadhiwa."
      : "Kitabu hiki hakipo tena. Rekodi hii haikuweza kuhifadhiwa.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Mabadiliko yako hayakuweza kuhifadhiwa."
      : "Rekodi hii haikuweza kuhifadhiwa.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Nakala hii ya programu haiwezi kuyahifadhi. Ukianzisha upya, yatapotea, lakini hiyo ndiyo njia pekee ya kupata toleo jipya."
      : "Nakala hii ya programu haiwezi kuihifadhi. Ukianzisha upya, itapotea, lakini hiyo ndiyo njia pekee ya kupata toleo jipya.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Kitabu hiki kilifutwa kwenye nakala nyingine ya programu. Kutupa mabadiliko ndiyo njia pekee ya kutoka."
      : "Kitabu hiki kilifutwa kwenye nakala nyingine ya programu. Futa rekodi hii ili utoke.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Skrini hii ina nakala pekee ya mabadiliko yako. Usifunge programu."
      : "Skrini hii ina nakala pekee ya kazi yako ambayo haijahifadhiwa. Usifunge programu.",
  saveFailedAttempts: (attempts: number): string => `Majaribio: ${attempts}`,
  appFailed: "Kuna hitilafu.",
  appReload: "Anzisha upya programu",
  appReloadTeach: "Programu itaanza tena.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Gusa tena ili uanzishe upya na upoteze rekodi hii pamoja na sauti uliyoikata"
          : "Gusa tena ili uanzishe upya na upoteze rekodi hii";
      case "changes":
        return alsoCutAudio
          ? "Gusa tena ili uanzishe upya na upoteze mabadiliko haya pamoja na sauti uliyoikata"
          : "Gusa tena ili uanzishe upya na upoteze mabadiliko haya";
      case "cutAudio":
        return "Gusa tena ili uanzishe upya na upoteze sauti uliyoikata";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Gusa tena, na rekodi hii pamoja na sauti uliyoikata vitapotea."
          : "Gusa tena, na rekodi hii itapotea.";
      case "changes":
        return alsoCutAudio
          ? "Gusa tena, na mabadiliko haya pamoja na sauti uliyoikata vitapotea."
          : "Gusa tena, na mabadiliko haya yatapotea.";
      case "cutAudio":
        return "Gusa tena, na sauti uliyoikata itapotea.";
    }
  },
  appReloading: "Inaanzisha upya…",
  appReloadHeld: "Tatizo hili halijahifadhiwa. Litume, au jaribu tena.",
  encoderFailing:
    "Simu hii haiwezi kupunguza ukubwa wa rekodi. Hakuna kilichopotea; kuanzisha upya programu kunaweza kusaidia.",

  // Storage and sharing everything
  storageNotPersisted:
    "Simu hii inaweza kufuta ulichorekodi hapa ikiwa nafasi itapungua. Shiriki kazi yako unapoweza.",
  storageLow:
    "Nafasi kwenye simu hii inaisha. Weka alama kwamba vipande vimekamilika ili upate nafasi, au shiriki kazi yako kisha uiondoe.",
  storageCritical:
    "Nafasi kwenye simu hii imekaribia kuisha, na rekodi mpya huenda zisihifadhiwe. Weka alama kwamba vipande vimekamilika, au shiriki kazi yako kisha uiondoe.",
  storageShareSoon: "Shiriki kazi yako hivi karibuni",
  shareAll: "Shiriki kazi yako",
  shareAllUnconfirmed:
    "Shiriki kazi yako. Jaribio la mwisho halikuthibitishwa: gusa ili ujaribu tena.",
  shareAllPreparing: "Inaandaa kazi yako ili ishirikiwe.",
  shareAllNothing: "Rekodi kipande kimoja kabla ya kushiriki kazi yako.",
  shareAllFailed: "Kazi yako haikuweza kushirikiwa. Jaribu tena.",
  shareAllFailedWeb:
    "Kazi yako haikuweza kushirikiwa. Tumia programu ya tC Mobile kuishiriki.",
  shareAllStorage:
    "Simu hii haina nafasi ya kuandaa kazi yako. Weka alama kwamba vipande vimekamilika, kisha jaribu tena.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "Kitabu {n} hakikuweza kujumuishwa.",
      other: "Vitabu {n} havikuweza kujumuishwa.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "Sura {n} kamili haikuweza kujumuishwa.",
      other: "Sura {n} kamili hazikuweza kujumuishwa.",
    }),
  shareAllFilename: "Kazi yangu.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Nakala nyingine ya programu hii imefunguliwa.",
  dbBlockedTeach: "Funga nyingine ili uendelee.",
  dbOutOfDate: "Nakala hii imepitwa na wakati.",
  dbOutOfDateTeach: "Anzisha upya ili utumie toleo jipya.",

  // About and licences
  aboutOpen: "Kuhusu na leseni",
  aboutTitle: "Kuhusu na leseni",
  aboutBlurb:
    "Programu huru ya chanzo wazi. Kila unachorekodi kinabaki kwenye simu hii.",
  aboutAppLicense: "Programu hii inatolewa chini ya leseni ya MIT.",
  aboutSourceOffer:
    "Msimbo chanzo wa programu hii ni wa umma. Msimbo chanzo wa toleo hili:",
  aboutVisitAppSource: "Fungua msimbo chanzo wa toleo hili kwenye GitHub",
  aboutPrivacy: "Jinsi programu hii inavyoshughulikia data yako:",
  aboutPrivacyLink: "Sera ya faragha",
  aboutVisitPrivacy: "Fungua sera ya faragha",
  aboutThirdParty: "Vipengele vya chanzo wazi",
  aboutTexts: "Maandishi ya leseni",
  aboutContent: "Maudhui yaliyojumuishwa",
  aboutLanguageCodes: "Misimbo ya lugha: ISO 639-3, kutoka iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Soma ${name}`,
  aboutBack: "Rudi kwenye orodha",
  aboutTextLoading: "Inapakia maandishi ya leseni.",
  aboutTextFailed: "Maandishi ya leseni hayakuweza kupakiwa.",
  aboutVisitSource: (name: string): string =>
    `Fungua ukurasa wa mradi wa ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Fungua msimbo chanzo wa ${name} uliojumuishwa katika toleo hili`,
  aboutVisitLicense: (name: string): string => `Fungua leseni ya ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "Tatizo {n} limerekodiwa",
      other: "Matatizo {n} yamerekodiwa",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Fungua menyu. Tatizo {n} limerekodiwa.",
      other: "Fungua menyu. Matatizo {n} yamerekodiwa.",
    }),
  failuresTeach: "Tuma hii kwa msaidizi wako ikiwa kuna kitu hakifanyi kazi.",
  shareFailureLog: "Tuma ripoti ya tatizo",
  shareFailureLogUnconfirmed:
    "Tuma ripoti ya tatizo. Jaribio la mwisho halikuthibitishwa: gusa ili ujaribu tena.",
  shareFailureLogPreparing: "Inaandaa ripoti ya tatizo.",
  shareFailureLogNothing: "Hakuna cha kutuma kwa sasa.",
  shareFailureLogFailed: "Ripoti ya tatizo haikuweza kutumwa. Jaribu tena.",
  shareFailureLogRestart:
    "Nakala hii haiwezi kutumika tena. Anzisha upya programu ili utumie toleo jipya.",
  clearFailureLog: "Ondoa ripoti ya tatizo",
  clearFailureLogConfirmTitle: "Ondoa ripoti ya tatizo?",
  clearFailureLogConfirm: "Ondoa",
  loadFailed: "Haikuweza kupakiwa. Jaribu tena.",
  saveFailed: "Haikuweza kuhifadhiwa. Jaribu tena.",
  noRoom: "Hakuna nafasi tena kwenye simu hii.",
  stopToEdit: "Acha kurekodi ili uhariri.",
  stopToErase: "Acha kurekodi ili uweke upya.",

  // Cover colours and chapter playback
  coverColourLabel: "Rangi ya jalada",
  coverColourAmber: "Kaharabu",
  coverColourTeal: "Kijani-buluu",
  coverColourPlum: "Zambarau",
  coverColourForest: "Kijani msitu",
  coverColourBrick: "Matofali",
  coverColourSlate: "Kijivu",
  coverColourRose: "Waridi",
  coverColourOlive: "Zeituni",
  coverColourRust: "Kutu",
  coverColourCocoa: "Kakao",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, imechaguliwa` : name,
  playChapter: (heading: string): string => `Cheza ${heading}`,
  pauseChapter: (heading: string): string => `Sitisha ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Endelea na ${heading}, ulipositisha: asilimia ${percent}`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading}: hakuna rekodi ya kucheza`,
};
