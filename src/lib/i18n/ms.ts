import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The ms table: Malay (standard Malaysian Malay), drafted by AI under the
 * decisions on #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed")
 * and following `docs/i18n/glossary.md`. It is the second level-3 language in
 * the app (#357, the DRI's pick on 2026-11-03, "Indonesian-adjacent: ms").
 * AI DRAFT, AWAITING NATIVE-SPEAKER REVIEW: no Malay reader has checked the
 * meaning.
 *
 * The Indonesian table (`id.ts`) was the shape and a reference for terms the
 * two languages share, but the words are Malaysian where the two differ:
 * "Tetapan" not "Pengaturan", "peranti" not "perangkat", "Ketik" not "Ketuk",
 * "Mulakan semula" not "Mulai ulang", "kebenaran" not "izin", "Padam" not
 * "Hapus", "Kongsi" not "Bagikan", "bab" not "pasal" (glossary row 2), and
 * the pronoun "anda" rather than "kamu".
 *
 * Register: buttons and labels are the bare verb the phone's own menus use
 * ("Rakam", "Kongsi"); sentences that speak to the person are plain and
 * polite, addressing the reader as "anda" where a pronoun is needed. The tile
 * caption Reset is the shorter "Set semula" (the glossary's "Tetapkan semula",
 * row 11, is over the caption's length budget; glossary section 5 lets a
 * caption shrink, and then that word is used wherever the English word
 * recurs). Digits are 0 to 9 (R19). Malay has one CLDR plural category,
 * `other`, so every count entry carries only that form and the noun is not
 * marked for number.
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
  newBook: "Buku baharu",
  menuOpen: "Buka menu",
  menuTitle: "Menu",
  menuClose: "Tutup menu",
  settingsOpen: "Tetapan",
  settingsTitle: "Tetapan",
  templatesOpen: "Templat",
  templatesTitle: "Templat",
  templateLicenceLabel: (licence: string): string => `Lesen: ${licence}`,
  loadingTemplates: "Memuatkan templat.",
  settingsChapterNumbers: "Sentiasa tunjukkan nombor bab",
  settingsNormalizeOnFinished: "Seimbangkan kelantangan apabila selesai",
  settingsCompressOnFinished: "Lembutkan bahagian yang kuat apabila selesai",
  booksEmpty: "Mulakan buku pertama anda",
  booksEmptyTeach: "Sebuah buku mengandungi bab yang anda rakam.",
  loadingBooks: "Memuatkan buku anda.",
  tryAgain: "Cuba lagi",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? { other: "{name}, {n} bab, terbuka" }
        : { other: "{name}, {n} bab, tertutup" }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Tambah bab pada ${bookName}`,
  openChapter: (heading: string): string => `Buka ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Buku ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Bab ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Pergi ke buku ${book}`,
  goToChapter: (heading: string): string => `Pergi ke ${heading}`,

  // Naming
  renameBook: "Namakan semula buku",
  renameChapter: "Namakan semula bab",
  renameSegment: "Namakan semula bahagian",
  bookNameField: "Nama buku",
  chapterNameField: "Nama bab",
  segmentNameField: "Nama bahagian",
  saveName: "Simpan nama",
  newBookTitle: "Namakan buku baharu anda",
  newBookClose: "Tutup tanpa membuat buku",
  createBook: "Buat buku",
  newChapterTitle: "Namakan bab baharu anda",
  newChapterClose: "Tutup tanpa membuat bab",
  createChapter: "Buat bab",
  savingName: "Menyimpan…",
  creatingBook: "Membuat buku anda…",

  // Segments screen
  backToBooks: "Kembali ke buku",
  addSegment: "Tambah bahagian",
  updating: "Mengemas kini bab.",
  staleChapter: "Bab ini tiada lagi. Kembali ke Buku.",
  loadingChapter: "Memuatkan bab.",
  segmentsEmpty: "Tambah bahagian pertama",
  segmentsEmptyTeach:
    "Satu bahagian ialah sebahagian daripada bab: rakam, main, kemudian rakam lagi.",
  playSegment: (n: number): string => `Main bahagian ${n}`,
  pauseSegment: (n: number): string => `Jeda bahagian ${n}`,
  openRecorderSegment: (n: number): string =>
    `Buka perakam untuk bahagian ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Sunting bahagian ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Sunting bahagian ${this.segmentHeading(n, label)}, selesai`;
  },
  openSegment(n: number, label: string | null): string {
    return `Buka bahagian ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Kedudukan dalam bahagian ${n}`,
  markFinished: (n: number): string => `Tandakan bahagian ${n} sebagai selesai`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Nama tidak disimpan. Cuba lagi.",

  // Recorder sheet
  recorderDialog: "Perakam",
  useLightTheme: "Tukar ke skrin cerah, untuk cahaya matahari",
  useDarkTheme: "Tukar ke skrin gelap, untuk tempat yang malap",
  tileEdit: "Sunting",
  tileFinished: "Selesai",
  tileStop: "Henti",
  tileRename: "Namakan semula",
  tileErase: "Set semula",
  tileDelete: "Padam",
  tileShare: "Kongsi",
  tileAbout: "Perihal",
  closeRecorder: "Tutup perakam",
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
  record: "Rakam",
  stop: "Henti rakaman",
  zoomAtWhole: "Zum keluar. Zum masuk ke suku.",
  zoomAtQuarter: "Zum masuk ke suku. Zum keluar.",
  micOffTitle: "Mikrofon dimatikan",
  micRetry: "Cuba lagi",
  micBack: "Kembali",
  micStepsLabel: "Langkah untuk menghidupkan mikrofon",
  micStepOpenSettings: "Buka Tetapan pada telefon anda",
  micStepAndroidApp: "Ketik Apl, kemudian tC Mobile, kemudian Kebenaran",
  micStepIosApp: "Ketik Privasi & Keselamatan, kemudian Mikrofon",
  micStepIosAppOn: "Hidupkan tC Mobile",
  micStepMicOn: "Hidupkan Mikrofon",
  micStepComeBack: "Kembali ke sini dan ketik Cuba lagi",
  finishedWriteFailed: "Tanda selesai tidak dapat disimpan.",
  recorderSaving: "Menyimpan…",
  takeCapWarning: (n: number): string =>
    plural(n, { other: "Tinggal {n} min" }),
  loadFailedTitle: "Rakaman ini tidak dapat dibuka",
  loadFailedBody:
    "Rakaman anda selamat. Cuba lagi, atau kembali untuk set semula daripada senarai.",
  loadRetry: "Cuba lagi",
  loadBack: "Kembali",
  loadRetrying: "Membuka rakaman anda…",
  takeRecoverTitle: "Rakaman ini belum disimpan",
  takeRecoverBody:
    "Rakaman anda masih ada di sini. Cuba lagi, atau kongsikannya supaya selamat.",
  takeRecoverRetry: "Cuba lagi",
  takeRecoverRetrying: "Menyimpan rakaman anda…",
  takeRecoverShare: "Kongsi rakaman",
  takeRecoverSharing: "Menyediakan rakaman…",
  takeShareUnavailable: "Perkongsian tidak tersedia pada peranti ini.",
  takeShareFailed: "Rakaman tidak dapat dikongsi. Cuba lagi.",
  takeRetryFailed: "Rakaman tidak dapat disimpan. Cuba lagi.",
  takeRecoverShared: "Rakaman telah dikongsi.",
  takeRecoverDone: "Selesai",
  takeRecoverDiscard: "Padam rakaman ini",
  takeRecoverDiscardArmed: "Ketik lagi untuk memadam rakaman ini selamanya",
  takeRecoverDiscardHint: "Ketik lagi untuk memadamnya.",
  playbackFailed: "Rakaman ini tidak dapat dimainkan.",
  micNoDevice: "Tiada mikrofon pada peranti ini.",
  micSiteBlocked:
    "Rakaman disekat untuk aplikasi ini. Benarkan mikrofon dalam tetapan laman pada pelayar, kemudian cuba lagi.",
  micOsBlocked:
    "Peranti anda tidak membenarkan aplikasi menggunakan mikrofon. Semak akses mikrofon dalam tetapan peranti, kemudian cuba lagi.",
  micPrompt:
    "Akses mikrofon diperlukan untuk merakam. Benarkan apabila diminta, atau jika sudah dibenarkan, semak tetapan peranti anda.",
  micStartFailed: "Rakaman tidak dapat dimulakan.",
  recordingUnsupported: "Peranti ini tidak dapat merakam bunyi.",
  playRecording: "Main rakaman",
  stopPlayback: "Henti main",
  enterEdit: "Sunting rakaman",
  leaveEdit: "Keluar daripada suntingan",
  editingMarker: "Menyunting",
  cut: "Potong pilihan",
  auditionSelection: "Main pilihan",
  auditionFromLine: "Main dari garisan",
  paste: "Tampal di garisan",
  undo: "Buat asal",
  redo: "Buat semula",
  nothingToUndo: "Tiada apa-apa untuk dibuat asal.",
  nothingToRedo: "Tiada apa-apa untuk dibuat semula.",
  recorderMenuTitle: "Lagi",
  recorderMenuOpen: "Tindakan lain",
  selectionStartHandle: "Permulaan pilihan",
  selectionEndHandle: "Penghujung pilihan",
  selectionHandleTime: (n: number): string => plural(n, { other: "{n} saat" }),
  editFailed:
    "Perubahan itu tidak dapat dibuat. Cuba pilihan yang lebih kecil.",
  clearFailed: "Bunyi tidak dapat diset semula. Cuba lagi.",
  captureSilence: "Tiada bunyi yang dirakam. Cuba lagi.",
  captureUndecodable: "Rakaman tidak dapat dibaca pada peranti ini.",
  captureUnfinished: "Rakaman ini tidak dapat diselesaikan.",
  blockedByTake:
    'Pilih "Tutup menu", kemudian "Tutup perakam" untuk menyimpan rakaman.',
  micStarting: "Mikrofon masih dihidupkan.",
  nothingRecorded: "Belum ada apa-apa yang dirakam.",
  nothingStored: "Tiada apa-apa yang disimpan untuk diset semula.",
  liveWaveform: "Gelombang bunyi rakaman secara langsung",
  vuMeterLabel: "Paras rakaman",
  vuMeterUnavailable: "Meter paras bunyi tidak tersedia pada peranti ini",
  eraseSegment: "Set semula bahagian dan mula semula",
  rerecord: "Set semula dan rakam lagi",
  segmentMenu: (n: number): string => `Tindakan lain untuk bahagian ${n}`,
  chapterRowMenu: (n: number): string => `Tindakan lain untuk bab ${n}`,
  reorderLifted: (n: number): string => `Memindahkan bahagian ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Bahagian ${from} kini menjadi bahagian ${to}.`,
  reorderStayed: (n: number): string => `Bahagian ${n} kekal di tempatnya.`,
  chapterReorderLifted: (n: number): string => `Memindahkan bab ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Bab ${from} kini menjadi bab ${to}.`,
  chapterReorderStayed: (n: number): string => `Bab ${n} kekal di tempatnya.`,
  bookReorderLifted: (heading: string): string => `Memindahkan ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} kini berada di kedudukan ${to} di rak.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} kekal di tempatnya.`,
  moveUp: "Naikkan",
  moveDown: "Turunkan",
  alreadyFirst: "Sudah paling atas",
  alreadyLast: "Sudah paling bawah",
  eraseConfirmTitle: "Set semula bahagian dan mula semula",
  eraseConfirm: "Set semula rakaman",
  eraseCancel: "Batal",
  recordAgainConfirm: "Rakam lagi",
  recordAgainKeep: "Kekalkan",
  eraseFailed: "Rakaman tidak dapat diset semula. Cuba lagi.",
  eraseConfirmPreviewPlay: "Main apa yang akan hilang",
  eraseConfirmPreviewPause: "Jeda",
  discardClip: "Buang bunyi yang dipotong",
  discardClipConfirmTitle: "Buang bunyi yang dipotong?",
  discardClipConfirm: "Buang",
  deleteBook: "Padam buku",
  deleteBookConfirmTitle: (book: string): string =>
    `Padam ${book} dan semua kandungannya?`,
  keepBook: "Kekalkan buku",
  deleteBookYes: "Ya, padam buku",
  deleteBookFailed: "Buku ini tidak dapat dipadam. Cuba lagi.",
  deleteSegment: "Padam bahagian",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Padam bahagian ${ordinal}?`,
  deleteSegmentConfirm: "Padam",
  deleteSegmentFailed: "Bahagian ini tidak dapat dipadam. Cuba lagi.",
  chapterMenuOpen: "Tindakan lain untuk bab ini",
  chapterMenuTitle: "Bab",

  // Sharing
  shareChapter: "Kongsi bab",
  shareChapterUnconfirmed:
    "Kongsi bab. Cubaan terakhir belum disahkan: ketik untuk cuba lagi.",
  shareSend: "Kongsi sekarang",
  sharePreparing: "Menyediakan bab untuk dikongsi.",
  shareHandingOver: "Membuka menu perkongsian telefon.",
  sharePreparingLabel: "Menyediakan untuk dikongsi",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, { other: `Mengongsi {n} daripada ${all}` }),
  shareSent: "Diserahkan kepada menu perkongsian telefon.",
  shareDismissed: "Menu perkongsian ditutup sebelum apa-apa dihantar.",
  shareUnproven:
    "Menu perkongsian ditutup. Telefon ini tidak dapat memastikan sama ada ia telah dihantar.",
  shareNothing: "Rakam satu bahagian sebelum mengongsi bab ini.",
  shareFailed: "Bab ini tidak dapat dikongsi. Cuba lagi.",
  shareMissing: (n: number): string =>
    plural(n, { other: "{n} bahagian tidak dapat disertakan." }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Tindakan lain untuk ${book}`,
  bookMenuTitle: "Buku",
  shareBook: "Kongsi buku",
  shareBookUnconfirmed:
    "Kongsi buku. Cubaan terakhir belum disahkan: ketik untuk cuba lagi.",
  shareBookPreparing: "Menyediakan buku untuk dikongsi.",
  exportProject: "Eksport projek",
  tileExport: "Eksport",
  exportProjectPreparing: "Menyediakan projek untuk dieksport.",
  exportProjectWebPointer:
    "Eksport berfungsi dalam aplikasi yang dipasang. Buka aplikasi untuk mengeksport projek ini.",
  languageAskTitle: "Bahasa buku ini",
  languageAskLead:
    "Rakaman ini dalam bahasa apa? Anda memilihnya sekali, dan setiap eksport buku ini menggunakannya.",
  languageSearch: "Cari bahasa",
  languageSearchHint: "Nama atau kod",
  languageLoading: "Memuatkan senarai bahasa.",
  languageLoadFailed: "Senarai bahasa tidak dapat dimuatkan.",
  languageNoMatch: "Tiada bahasa yang sepadan. Cuba nama atau kod lain.",
  languageNarrow: "Taip lagi untuk melihat bahasa lain.",
  languageCount: (n: number): string =>
    plural(n, { other: "{n} bahasa sepadan." }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      other: `{n} bahasa sepadan. Menunjukkan ${shown} yang pertama. Taip lagi untuk mengecilkan carian.`,
    }),
  languageSaving: "Menyimpan bahasa.",
  languageAskCancel: "Batal",
  licenceAskTitle: "Lesen buku ini",
  licenceAskLead:
    "Siapa yang boleh mengongsi rakaman ini? Anda memilih sekali untuk buku ini.",
  licenceAllRightsReserved: "Hak cipta terpelihara",
  licenceSaving: "Menyimpan lesen.",
  licenceAskContinue: "Kongsi",
  licenceAskCancel: "Batal",
  licenceTileLabel: "Tukar lesen",
  tileLicence: "Lesen",
  tileTemplates: "Templat",
  licenceAskSave: "Simpan",
  licenceAskSaveLead:
    "Siapa yang boleh mengongsi rakaman ini? Anda boleh menukarnya lagi kemudian.",
  licenceNameCcBySa: "Creative Commons Atribusi-PerkongsianSerupa 4.0",
  licenceNameCcBy: "Creative Commons Atribusi 4.0",
  licenceNameCc0: "Creative Commons Sifar 1.0, domain awam",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "projek",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Rakam satu bahagian sebelum mengongsi buku ini.",
  shareBookFailed: "Buku ini tidak dapat dikongsi. Cuba lagi.",
  shareBookFailedWeb:
    "Buku ini tidak dapat dikongsi. Perkongsian buku hanya boleh dibuat dalam aplikasi tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, { other: "{n} bab tidak dapat disertakan." }),
  shareBookPartial(n: number): string {
    return this.shareMissing(n);
  },
  shareBookMissingAndPartial(
    chapters: number,
    segments: number,
    partialChapters: number
  ): string {
    const scope = Math.max(partialChapters, 1);
    const partial = plural(segments, {
      other: `{n} bahagian dalam ${scope} bab yang disertakan tidak dapat dimasukkan.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Ini tidak dapat disediakan untuk dikongsi. Cuba lagi; jika ia berterusan, mulakan semula aplikasi.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Buku",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Perubahan anda tidak disimpan" : "Rakaman ini tidak disimpan",
  saveFailedSaving: "Menyimpan",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Rakaman yang anda sunting masih ada di sini."
        : `Rakaman bahagian ${ordinal} yang anda sunting masih ada di sini.`
      : ordinal === null
        ? "Rakaman anda masih ada di sini."
        : `Rakaman bahagian ${ordinal} masih ada di sini.`,
  saveFailedRetry: "Cuba simpan lagi",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Ketik lagi untuk membuang perubahan ini"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Buang perubahan ini"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Ketik lagi untuk membuangnya."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Perubahan anda memerlukan versi aplikasi yang baharu."
      : "Rakaman ini memerlukan versi aplikasi yang baharu.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Buku ini tiada lagi. Perubahan anda tidak dapat disimpan."
      : "Buku ini tiada lagi. Rakaman ini tidak dapat disimpan.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Perubahan anda tidak dapat disimpan."
      : "Rakaman ini tidak dapat disimpan.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Salinan aplikasi ini tidak dapat menyimpannya. Jika anda memulakan semula, perubahan itu hilang, tetapi hanya dengan cara itu anda mendapat versi baharu."
      : "Salinan aplikasi ini tidak dapat menyimpannya. Jika anda memulakan semula, rakaman itu hilang, tetapi hanya dengan cara itu anda mendapat versi baharu.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Buku ini dipadam dalam salinan aplikasi yang lain. Membuang perubahan ialah satu-satunya jalan keluar."
      : "Buku ini dipadam dalam salinan aplikasi yang lain. Padam rakaman ini untuk keluar.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Skrin ini memegang satu-satunya salinan perubahan anda. Jangan tutup aplikasi."
      : "Skrin ini memegang satu-satunya salinan kerja anda yang belum disimpan. Jangan tutup aplikasi.",
  saveFailedAttempts: (attempts: number): string => `Cubaan: ${attempts}`,
  appFailed: "Berlaku ralat.",
  appReload: "Mulakan semula aplikasi",
  appReloadTeach: "Aplikasi akan bermula semula.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Ketik lagi untuk memulakan semula dan kehilangan rakaman ini serta bunyi yang anda potong"
          : "Ketik lagi untuk memulakan semula dan kehilangan rakaman ini";
      case "changes":
        return alsoCutAudio
          ? "Ketik lagi untuk memulakan semula dan kehilangan perubahan ini serta bunyi yang anda potong"
          : "Ketik lagi untuk memulakan semula dan kehilangan perubahan ini";
      case "cutAudio":
        return "Ketik lagi untuk memulakan semula dan kehilangan bunyi yang anda potong";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Ketik lagi, dan rakaman ini serta bunyi yang anda potong akan hilang."
          : "Ketik lagi, dan rakaman ini akan hilang.";
      case "changes":
        return alsoCutAudio
          ? "Ketik lagi, dan perubahan ini serta bunyi yang anda potong akan hilang."
          : "Ketik lagi, dan perubahan ini akan hilang.";
      case "cutAudio":
        return "Ketik lagi, dan bunyi yang anda potong akan hilang.";
    }
  },
  appReloading: "Memulakan semula…",
  appReloadHeld: "Masalah ini belum disimpan. Hantarnya, atau cuba lagi.",
  encoderFailing:
    "Telefon ini tidak dapat mengecilkan rakaman. Tiada apa-apa yang hilang; memulakan semula aplikasi mungkin membantu.",

  // Storage and sharing everything
  storageNotPersisted:
    "Telefon ini mungkin memadam apa yang anda rakam di sini jika ruang hampir habis. Kongsi kerja anda bila-bila yang boleh.",
  storageLow:
    "Ruang pada telefon ini hampir habis. Tandakan bahagian sebagai selesai untuk mengosongkan ruang, atau kongsi kerja anda kemudian padamnya.",
  storageCritical:
    "Ruang pada telefon ini hampir penuh, dan rakaman baharu mungkin tidak disimpan. Tandakan bahagian sebagai selesai, atau kongsi kerja anda kemudian padamnya.",
  storageShareSoon: "Kongsi kerja anda segera",
  shareAll: "Kongsi kerja anda",
  shareAllUnconfirmed:
    "Kongsi kerja anda. Cubaan terakhir belum disahkan: ketik untuk cuba lagi.",
  shareAllPreparing: "Menyediakan kerja anda untuk dikongsi.",
  shareAllNothing: "Rakam satu bahagian sebelum mengongsi kerja anda.",
  shareAllFailed: "Kerja anda tidak dapat dikongsi. Cuba lagi.",
  shareAllFailedWeb:
    "Kerja anda tidak dapat dikongsi. Gunakan aplikasi tC Mobile untuk mengongsinya.",
  shareAllStorage:
    "Telefon ini tiada ruang untuk menyediakan kerja anda. Tandakan bahagian sebagai selesai, kemudian cuba lagi.",
  shareAllMissing: (n: number): string =>
    plural(n, { other: "{n} buku tidak dapat disertakan." }),
  shareAllIncomplete: (n: number): string =>
    plural(n, { other: "{n} bab lengkap tidak dapat disertakan." }),
  shareAllFilename: "Kerja saya.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Salinan lain aplikasi ini sedang dibuka.",
  dbBlockedTeach: "Tutup salinan yang lain untuk meneruskan.",
  dbOutOfDate: "Salinan ini sudah lapuk.",
  dbOutOfDateTeach: "Mulakan semula untuk menggunakan versi baharu.",

  // About and licences
  aboutOpen: "Perihal dan lesen",
  aboutTitle: "Perihal dan lesen",
  aboutBlurb:
    "Aplikasi percuma dan sumber terbuka. Semua yang anda rakam kekal pada telefon ini.",
  aboutAppLicense: "Aplikasi ini ditawarkan di bawah lesen MIT.",
  aboutSourceOffer:
    "Kod sumber aplikasi ini terbuka kepada umum. Kod sumber versi ini:",
  aboutVisitAppSource: "Buka kod sumber versi ini di GitHub",
  aboutPrivacy: "Cara aplikasi ini mengendalikan data anda:",
  aboutPrivacyLink: "Dasar privasi",
  aboutVisitPrivacy: "Buka dasar privasi",
  aboutThirdParty: "Komponen sumber terbuka",
  aboutTexts: "Teks lesen",
  aboutQrCaption: "Imbas untuk mendapatkan aplikasi",
  aboutContent: "Kandungan yang disertakan",
  aboutLanguageCodes: "Kod bahasa: ISO 639-3, daripada iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Baca ${name}`,
  aboutBack: "Kembali ke senarai",
  aboutTextLoading: "Memuatkan teks lesen.",
  aboutTextFailed: "Teks lesen tidak dapat dimuatkan.",
  aboutVisitSource: (name: string): string => `Buka halaman projek ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Buka kod sumber ${name} yang disertakan dalam versi ini`,
  aboutVisitLicense: (name: string): string => `Buka lesen ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, { other: "{n} masalah direkodkan" }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, { other: "Buka menu. {n} masalah direkodkan." }),
  failuresTeach:
    "Hantar ini kepada pembantu anda jika ada yang tidak berfungsi.",
  shareFailureLog: "Hantar laporan masalah",
  shareFailureLogUnconfirmed:
    "Hantar laporan masalah. Cubaan terakhir belum disahkan: ketik untuk cuba lagi.",
  shareFailureLogPreparing: "Menyediakan laporan masalah.",
  shareFailureLogNothing: "Tiada apa-apa untuk dihantar buat masa ini.",
  shareFailureLogFailed: "Laporan masalah tidak dapat dihantar. Cuba lagi.",
  shareFailureLogRestart:
    "Salinan ini tidak boleh digunakan lagi. Mulakan semula aplikasi untuk menggunakan versi baharu.",
  clearFailureLog: "Kosongkan laporan masalah",
  clearFailureLogConfirmTitle: "Kosongkan laporan masalah?",
  clearFailureLogConfirm: "Kosongkan",
  loadFailed: "Tidak dapat dimuatkan. Cuba lagi.",
  saveFailed: "Tidak dapat disimpan. Cuba lagi.",
  noRoom: "Tiada ruang lagi pada telefon ini.",
  bookNameTaken: "Buku lain menggunakan nama ini. Taip nama yang berbeza.",
  stopToEdit: "Hentikan rakaman untuk menyunting.",
  stopToErase: "Hentikan rakaman untuk set semula.",

  // Cover colours and chapter playback
  coverColourLabel: "Warna kulit",
  coverColourAmber: "Ambar",
  coverColourTeal: "Firus",
  coverColourPlum: "Ungu tua",
  coverColourForest: "Hijau hutan",
  coverColourBrick: "Bata",
  coverColourSlate: "Kelabu tua",
  coverColourRose: "Mawar",
  coverColourOlive: "Zaitun",
  coverColourRust: "Karat",
  coverColourCocoa: "Koko",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, dipilih` : name,
  playChapter: (heading: string): string => `Main ${heading}`,
  pauseChapter: (heading: string): string => `Jeda ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Sambung ${heading}, dijeda pada ${percent} peratus`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} tidak dimainkan. Ketik untuk cuba lagi`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} belum ada rakaman untuk dimainkan`,
  chapterPlayStarted: (heading: string): string => `Memainkan ${heading}`,
  chapterPlayPaused: (heading: string): string => `${heading} dijeda`,
  chapterPlayFinished: (heading: string): string => `${heading} selesai`,
};
