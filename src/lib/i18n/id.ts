import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The id table: Indonesian, drafted by AI under the decisions on #1458 (Q1 and
 * Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No Indonesian reader has checked the meaning
 * (#1619).
 *
 * Register: buttons and labels are the bare or "me-" verb the phone's own
 * menus use ("Rekam", "Bagikan"); sentences that speak to the person are plain
 * and polite ("Coba lagi"), addressing the reader as "kamu" where a pronoun is
 * needed. A chapter is "pasal" (the word Indonesian Bibles use, glossary
 * row 2). Digits are 0 to 9 (R19). Indonesian has one CLDR plural category,
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
  newBook: "Buku baru",
  menuOpen: "Buka menu",
  menuTitle: "Menu",
  menuClose: "Tutup menu",
  booksEmpty: "Mulai buku pertamamu",
  booksEmptyTeach: "Satu buku berisi pasal-pasal yang kamu rekam.",
  loadingBooks: "Memuat bukumu.",
  tryAgain: "Coba lagi",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? { other: "{name}, {n} pasal, terbuka" }
        : { other: "{name}, {n} pasal, tertutup" }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Tambah pasal ke ${bookName}`,
  openChapter: (heading: string): string => `Buka ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Buku ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Pasal ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Buka buku ${book}`,
  goToChapter: (heading: string): string => `Buka ${heading}`,

  // Naming
  renameBook: "Ubah nama buku",
  renameChapter: "Ubah nama pasal",
  renameSegment: "Ubah nama segmen",
  bookNameField: "Nama buku",
  chapterNameField: "Nama pasal",
  segmentNameField: "Nama segmen",
  saveName: "Simpan nama",
  newBookTitle: "Beri nama buku barumu",
  newBookClose: "Tutup tanpa membuat buku",
  createBook: "Buat buku",
  newChapterTitle: "Beri nama pasal barumu",
  newChapterClose: "Tutup tanpa membuat pasal",
  createChapter: "Buat pasal",
  savingName: "Menyimpan…",
  creatingBook: "Membuat bukumu…",

  // Segments screen
  backToBooks: "Kembali ke buku",
  addSegment: "Tambah segmen",
  updating: "Memperbarui pasal.",
  staleChapter: "Pasal ini sudah tidak tersedia. Kembali ke Buku.",
  loadingChapter: "Memuat pasal.",
  segmentsEmpty: "Tambahkan segmen pertama",
  segmentsEmptyTeach:
    "Satu segmen adalah satu bagian pasal: rekam, putar, lalu rekam lagi.",
  playSegment: (n: number): string => `Putar segmen ${n}`,
  pauseSegment: (n: number): string => `Jeda segmen ${n}`,
  openRecorderSegment: (n: number): string => `Buka perekam untuk segmen ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Edit segmen ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Edit segmen ${this.segmentHeading(n, label)}, selesai`;
  },
  openSegment(n: number, label: string | null): string {
    return `Buka segmen ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Posisi di segmen ${n}`,
  markFinished: (n: number): string => `Tandai segmen ${n} sebagai selesai`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Nama tidak tersimpan. Coba lagi.",

  // Recorder sheet
  recorderDialog: "Perekam",
  useLightTheme: "Ganti ke layar terang, untuk cahaya matahari",
  useDarkTheme: "Ganti ke layar gelap, untuk tempat yang redup",
  tileEdit: "Edit",
  tileFinished: "Selesai",
  tileStop: "Berhenti",
  tileRename: "Ubah nama",
  tileErase: "Setel ulang",
  tileDelete: "Hapus",
  tileShare: "Bagikan",
  tileAbout: "Tentang",
  tileLight: "Terang",
  tileDark: "Gelap",
  closeRecorder: "Tutup perekam",
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
  record: "Rekam",
  stop: "Hentikan rekaman",
  zoomAtWhole: "Pembesaran: seluruh segmen. Perbesar ke seperempat.",
  zoomAtQuarter: "Pembesaran: seperempat. Perkecil ke seluruh segmen.",
  micOffTitle: "Mikrofon mati",
  micRetry: "Coba lagi",
  micBack: "Kembali",
  micStepsLabel: "Langkah menyalakan mikrofon",
  micStepOpenSettings: "Buka Pengaturan di ponselmu",
  micStepAndroidApp: "Ketuk Aplikasi, lalu tC Mobile, lalu Izin",
  micStepIosApp: "Ketuk Privasi & Keamanan, lalu Mikrofon",
  micStepIosAppOn: "Nyalakan tC Mobile",
  micStepMicOn: "Nyalakan Mikrofon",
  micStepComeBack: "Kembali ke sini dan ketuk Coba lagi",
  finishedWriteFailed: "Tanda selesai tidak dapat disimpan.",
  recorderSaving: "Menyimpan…",
  takeCapWarning: (n: number): string => plural(n, { other: "Sisa {n} mnt" }),
  loadFailedTitle: "Rekaman ini tidak dapat dibuka",
  loadFailedBody:
    "Rekamanmu aman. Coba lagi, atau kembali untuk menyetel ulang dari daftar.",
  loadRetry: "Coba lagi",
  loadBack: "Kembali",
  loadRetrying: "Membuka rekamanmu…",
  takeRecoverTitle: "Rekaman ini belum tersimpan",
  takeRecoverBody:
    "Rekamanmu masih ada di sini. Coba lagi, atau bagikan agar tetap aman.",
  takeRecoverRetry: "Coba lagi",
  takeRecoverRetrying: "Menyimpan rekamanmu…",
  takeRecoverShare: "Bagikan rekaman",
  takeRecoverSharing: "Menyiapkan rekaman…",
  takeShareUnavailable: "Berbagi tidak tersedia di perangkat ini.",
  takeShareFailed: "Rekaman tidak dapat dibagikan. Coba lagi.",
  takeRetryFailed: "Rekaman tidak dapat disimpan. Coba lagi.",
  takeRecoverShared: "Rekaman dibagikan.",
  takeRecoverDone: "Selesai",
  takeRecoverDiscard: "Hapus rekaman ini",
  takeRecoverDiscardArmed: "Ketuk lagi untuk menghapus rekaman ini selamanya",
  takeRecoverDiscardHint: "Ketuk lagi untuk menghapusnya.",
  playbackFailed: "Rekaman ini tidak dapat diputar.",
  micNoDevice: "Tidak ada mikrofon di perangkat ini.",
  micSiteBlocked:
    "Perekaman diblokir untuk aplikasi ini. Izinkan mikrofon di pengaturan situs pada peramban, lalu coba lagi.",
  micOsBlocked:
    "Perangkatmu tidak mengizinkan aplikasi memakai mikrofon. Periksa akses mikrofon di pengaturan perangkat, lalu coba lagi.",
  micPrompt:
    "Akses mikrofon diperlukan untuk merekam. Izinkan saat diminta, atau jika sudah diizinkan, periksa pengaturan perangkatmu.",
  micStartFailed: "Perekaman tidak dapat dimulai.",
  recordingUnsupported: "Perangkat ini tidak dapat merekam suara.",
  playRecording: "Putar rekaman",
  stopPlayback: "Hentikan pemutaran",
  enterEdit: "Edit rekaman",
  leaveEdit: "Keluar dari edit",
  editingMarker: "Mengedit",
  cut: "Potong pilihan",
  auditionSelection: "Putar pilihan",
  auditionFromLine: "Putar dari garis",
  paste: "Tempel di garis",
  undo: "Urungkan",
  redo: "Ulangi",
  nothingToUndo: "Tidak ada yang bisa diurungkan.",
  nothingToRedo: "Tidak ada yang bisa diulangi.",
  recorderMenuTitle: "Lainnya",
  recorderMenuOpen: "Tindakan lainnya",
  selectionStartHandle: "Awal pilihan",
  selectionEndHandle: "Akhir pilihan",
  editFailed:
    "Perubahan itu tidak dapat diterapkan. Coba pilihan yang lebih kecil.",
  clearFailed: "Suara tidak dapat disetel ulang. Coba lagi.",
  captureSilence: "Tidak ada suara yang terekam. Coba lagi.",
  captureUndecodable: "Rekaman tidak dapat dibaca di perangkat ini.",
  captureUnfinished: "Rekaman ini tidak dapat diselesaikan.",
  blockedByTake:
    'Pilih "Tutup menu", lalu "Tutup perekam" untuk menyimpan rekaman.',
  micStarting: "Mikrofon masih mulai menyala.",
  nothingRecorded: "Belum ada yang direkam.",
  nothingStored: "Tidak ada yang tersimpan untuk disetel ulang.",
  liveWaveform: "Gelombang suara rekaman langsung",
  vuMeterLabel: "Tingkat rekaman",
  vuMeterUnavailable: "Pengukur tingkat suara tidak tersedia di perangkat ini",
  eraseSegment: "Setel ulang segmen dan mulai lagi",
  rerecord: "Setel ulang dan rekam lagi",
  segmentMenu: (n: number): string => `Tindakan lainnya untuk segmen ${n}`,
  reorderLifted: (n: number): string => `Memindahkan segmen ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Segmen ${from} sekarang menjadi segmen ${to}.`,
  reorderStayed: (n: number): string => `Segmen ${n} tetap di tempatnya.`,
  chapterReorderLifted: (n: number): string => `Memindahkan pasal ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Pasal ${from} sekarang menjadi pasal ${to}.`,
  chapterReorderStayed: (n: number): string => `Pasal ${n} tetap di tempatnya.`,
  bookReorderLifted: (heading: string): string => `Memindahkan ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} sekarang berada di urutan ${to} di rak.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} tetap di tempatnya.`,
  eraseConfirmTitle: "Setel ulang segmen dan mulai lagi",
  eraseConfirm: "Setel ulang rekaman",
  eraseCancel: "Batal",
  recordAgainConfirm: "Rekam lagi",
  recordAgainKeep: "Pertahankan",
  eraseFailed: "Rekaman tidak dapat disetel ulang. Coba lagi.",
  eraseConfirmPreviewPlay: "Putar yang akan hilang",
  eraseConfirmPreviewPause: "Jeda",
  discardClip: "Buang suara yang dipotong",
  discardClipConfirmTitle: "Buang suara yang dipotong?",
  discardClipConfirm: "Buang",
  deleteBook: "Hapus buku",
  deleteBookConfirmTitle: (book: string): string =>
    `Hapus ${book} dan semua isinya?`,
  keepBook: "Pertahankan buku",
  deleteBookYes: "Ya, hapus buku",
  deleteBookFailed: "Buku ini tidak dapat dihapus. Coba lagi.",
  deleteSegment: "Hapus segmen",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Hapus segmen ${ordinal}?`,
  deleteSegmentConfirm: "Hapus",
  deleteSegmentFailed: "Segmen ini tidak dapat dihapus. Coba lagi.",
  chapterMenuOpen: "Tindakan lainnya untuk pasal ini",
  chapterMenuTitle: "Pasal",

  // Sharing
  shareChapter: "Bagikan pasal",
  shareChapterUnconfirmed:
    "Bagikan pasal. Percobaan terakhir belum terkonfirmasi: ketuk untuk mencoba lagi.",
  shareSend: "Bagikan sekarang",
  sharePreparing: "Menyiapkan pasal untuk dibagikan.",
  shareHandingOver: "Membuka menu berbagi di ponsel.",
  sharePreparingLabel: "Menyiapkan untuk dibagikan",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, { other: `Membagikan {n} dari ${all}` }),
  shareSent: "Diserahkan ke menu berbagi di ponsel.",
  shareDismissed: "Menu berbagi ditutup sebelum ada yang terkirim.",
  shareUnproven:
    "Menu berbagi ditutup. Ponsel ini tidak dapat memastikan apakah sudah terkirim.",
  shareNothing: "Rekam satu segmen sebelum membagikan pasal ini.",
  shareFailed: "Pasal ini tidak dapat dibagikan. Coba lagi.",
  shareMissing: (n: number): string =>
    plural(n, { other: "{n} segmen tidak dapat disertakan." }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Tindakan lainnya untuk ${book}`,
  bookMenuTitle: "Buku",
  shareBook: "Bagikan buku",
  shareBookUnconfirmed:
    "Bagikan buku. Percobaan terakhir belum terkonfirmasi: ketuk untuk mencoba lagi.",
  shareBookPreparing: "Menyiapkan buku untuk dibagikan.",
  exportProject: "Ekspor proyek",
  tileExport: "Ekspor",
  exportProjectPreparing: "Menyiapkan proyek untuk diekspor.",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Rekam satu segmen sebelum membagikan buku ini.",
  shareBookFailed: "Buku ini tidak dapat dibagikan. Coba lagi.",
  shareBookFailedWeb:
    "Buku ini tidak dapat dibagikan. Berbagi buku hanya bisa dilakukan di aplikasi tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, { other: "{n} pasal tidak dapat disertakan." }),
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
      other: `{n} segmen di ${scope} pasal yang disertakan tidak dapat dimasukkan.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Ini tidak dapat disiapkan untuk dibagikan. Coba lagi; jika terus terjadi, mulai ulang aplikasi.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Buku",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Perubahanmu tidak tersimpan" : "Rekaman ini tidak tersimpan",
  saveFailedSaving: "Menyimpan",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Rekaman yang kamu edit masih ada di sini."
        : `Rekaman segmen ${ordinal} yang kamu edit masih ada di sini.`
      : ordinal === null
        ? "Rekamanmu masih ada di sini."
        : `Rekaman segmen ${ordinal} masih ada di sini.`,
  saveFailedRetry: "Coba simpan lagi",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Ketuk lagi untuk membuang perubahan ini"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Buang perubahan ini"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Ketuk lagi untuk membuangnya."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Perubahanmu memerlukan versi aplikasi yang baru."
      : "Rekaman ini memerlukan versi aplikasi yang baru.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Buku ini sudah tidak ada. Perubahanmu tidak dapat disimpan."
      : "Buku ini sudah tidak ada. Rekaman ini tidak dapat disimpan.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Perubahanmu tidak dapat disimpan."
      : "Rekaman ini tidak dapat disimpan.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Salinan aplikasi ini tidak dapat menyimpannya. Jika kamu memulai ulang, perubahan itu hilang, tetapi hanya dengan cara itu kamu mendapat versi baru."
      : "Salinan aplikasi ini tidak dapat menyimpannya. Jika kamu memulai ulang, rekaman itu hilang, tetapi hanya dengan cara itu kamu mendapat versi baru.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Buku ini dihapus di salinan aplikasi yang lain. Membuang perubahan adalah satu-satunya jalan keluar."
      : "Buku ini dihapus di salinan aplikasi yang lain. Hapus rekaman ini untuk keluar.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Layar ini memegang satu-satunya salinan perubahanmu. Jangan tutup aplikasi."
      : "Layar ini memegang satu-satunya salinan pekerjaanmu yang belum tersimpan. Jangan tutup aplikasi.",
  saveFailedAttempts: (attempts: number): string => `Percobaan: ${attempts}`,
  appFailed: "Terjadi kesalahan.",
  appReload: "Mulai ulang aplikasi",
  appReloadTeach: "Aplikasi akan mulai lagi.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Ketuk lagi untuk memulai ulang dan kehilangan rekaman ini serta suara yang kamu potong"
          : "Ketuk lagi untuk memulai ulang dan kehilangan rekaman ini";
      case "changes":
        return alsoCutAudio
          ? "Ketuk lagi untuk memulai ulang dan kehilangan perubahan ini serta suara yang kamu potong"
          : "Ketuk lagi untuk memulai ulang dan kehilangan perubahan ini";
      case "cutAudio":
        return "Ketuk lagi untuk memulai ulang dan kehilangan suara yang kamu potong";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Ketuk lagi, dan rekaman ini serta suara yang kamu potong akan hilang."
          : "Ketuk lagi, dan rekaman ini akan hilang.";
      case "changes":
        return alsoCutAudio
          ? "Ketuk lagi, dan perubahan ini serta suara yang kamu potong akan hilang."
          : "Ketuk lagi, dan perubahan ini akan hilang.";
      case "cutAudio":
        return "Ketuk lagi, dan suara yang kamu potong akan hilang.";
    }
  },
  appReloading: "Memulai ulang…",
  appReloadHeld: "Masalah ini belum tersimpan. Kirim, atau coba lagi.",
  encoderFailing:
    "Ponsel ini tidak dapat memperkecil rekaman. Tidak ada yang hilang; memulai ulang aplikasi mungkin membantu.",

  // Storage and sharing everything
  storageNotPersisted:
    "Ponsel ini dapat menghapus yang kamu rekam di sini jika ruang habis. Bagikan pekerjaanmu kapan pun bisa.",
  storageLow:
    "Ruang di ponsel ini hampir habis. Tandai segmen sebagai selesai untuk mengosongkan ruang, atau bagikan pekerjaanmu lalu hapus.",
  storageCritical:
    "Ruang di ponsel ini hampir penuh, dan rekaman baru mungkin tidak tersimpan. Tandai segmen sebagai selesai, atau bagikan pekerjaanmu lalu hapus.",
  storageShareSoon: "Bagikan pekerjaanmu segera",
  shareAll: "Bagikan pekerjaanmu",
  shareAllUnconfirmed:
    "Bagikan pekerjaanmu. Percobaan terakhir belum terkonfirmasi: ketuk untuk mencoba lagi.",
  shareAllPreparing: "Menyiapkan pekerjaanmu untuk dibagikan.",
  shareAllNothing: "Rekam satu segmen sebelum membagikan pekerjaanmu.",
  shareAllFailed: "Pekerjaanmu tidak dapat dibagikan. Coba lagi.",
  shareAllFailedWeb:
    "Pekerjaanmu tidak dapat dibagikan. Gunakan aplikasi tC Mobile untuk membagikannya.",
  shareAllStorage:
    "Ponsel ini tidak punya ruang untuk menyiapkan pekerjaanmu. Tandai segmen sebagai selesai, lalu coba lagi.",
  shareAllMissing: (n: number): string =>
    plural(n, { other: "{n} buku tidak dapat disertakan." }),
  shareAllIncomplete: (n: number): string =>
    plural(n, { other: "{n} pasal lengkap tidak dapat disertakan." }),
  shareAllFilename: "Pekerjaanku.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Salinan aplikasi ini yang lain sedang terbuka.",
  dbBlockedTeach: "Tutup yang lain untuk melanjutkan.",
  dbOutOfDate: "Salinan ini sudah usang.",
  dbOutOfDateTeach: "Mulai ulang untuk memakai versi baru.",

  // About and licences
  aboutOpen: "Tentang dan lisensi",
  aboutTitle: "Tentang dan lisensi",
  aboutBlurb:
    "Aplikasi gratis dan sumber terbuka. Semua yang kamu rekam tersimpan di ponsel ini.",
  aboutAppLicense: "Aplikasi ini ditawarkan dengan lisensi MIT.",
  aboutSourceOffer:
    "Kode sumber aplikasi ini terbuka untuk umum. Kode sumber versi ini:",
  aboutVisitAppSource: "Buka kode sumber versi ini di GitHub",
  aboutPrivacy: "Cara aplikasi ini memperlakukan datamu:",
  aboutPrivacyLink: "Kebijakan privasi",
  aboutVisitPrivacy: "Buka kebijakan privasi",
  aboutThirdParty: "Komponen sumber terbuka",
  aboutTexts: "Teks lisensi",
  aboutContent: "Konten bawaan",
  aboutReadText: (name: string): string => `Baca ${name}`,
  aboutBack: "Kembali ke daftar",
  aboutTextLoading: "Memuat teks lisensi.",
  aboutTextFailed: "Teks lisensi tidak dapat dimuat.",
  aboutVisitSource: (name: string): string => `Buka halaman proyek ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Buka kode sumber ${name} yang disertakan dalam versi ini`,
  aboutVisitLicense: (name: string): string => `Buka lisensi ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, { other: "{n} masalah tercatat" }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, { other: "Buka menu. {n} masalah tercatat." }),
  failuresTeach: "Kirim ini ke pendampingmu jika ada yang tidak berfungsi.",
  shareFailureLog: "Kirim laporan masalah",
  shareFailureLogUnconfirmed:
    "Kirim laporan masalah. Percobaan terakhir belum terkonfirmasi: ketuk untuk mencoba lagi.",
  shareFailureLogPreparing: "Menyiapkan laporan masalah.",
  shareFailureLogNothing: "Tidak ada yang perlu dikirim saat ini.",
  shareFailureLogFailed: "Laporan masalah tidak dapat dikirim. Coba lagi.",
  shareFailureLogRestart:
    "Salinan ini tidak dapat dipakai lagi. Mulai ulang aplikasi untuk memakai versi baru.",
  clearFailureLog: "Bersihkan laporan masalah",
  clearFailureLogConfirmTitle: "Bersihkan laporan masalah?",
  clearFailureLogConfirm: "Bersihkan",
  loadFailed: "Tidak dapat dimuat. Coba lagi.",
  saveFailed: "Tidak dapat disimpan. Coba lagi.",
  noRoom: "Tidak ada ruang lagi di ponsel ini.",
  stopToEdit: "Hentikan rekaman untuk mengedit.",
  stopToErase: "Hentikan rekaman untuk menyetel ulang.",

  // Cover colours and chapter playback
  coverColourLabel: "Warna sampul",
  coverColourAmber: "Ambar",
  coverColourTeal: "Tosca",
  coverColourPlum: "Ungu tua",
  coverColourForest: "Hijau hutan",
  coverColourBrick: "Bata",
  coverColourSlate: "Abu tua",
  coverColourRose: "Mawar",
  coverColourOlive: "Zaitun",
  coverColourRust: "Karat",
  coverColourCocoa: "Cokelat",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, dipilih` : name,
  playChapter: (heading: string): string => `Putar ${heading}`,
  pauseChapter: (heading: string): string => `Jeda ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Lanjutkan ${heading}, dijeda di ${percent} persen`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} belum ada rekaman untuk diputar`,
};
