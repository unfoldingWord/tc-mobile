import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The vi table: Vietnamese, drafted by AI under the decisions on #1458 (Q1 and
 * Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. It is the first level-3 language in the app (#357,
 * the DRI's go on 2026-11-02). AI DRAFT, AWAITING NATIVE-SPEAKER REVIEW: no
 * Vietnamese reader has checked the meaning.
 *
 * Register: buttons and labels are the bare imperative the phone's own menus
 * use ("Ghi âm", "Chia sẻ"); sentences that speak to the person are plain and
 * polite, addressing the reader as "bạn" where a pronoun is needed. The tile
 * captions Edit and Stop are the shorter "Sửa" and "Dừng" (glossary section 5
 * lets a caption shrink to one word, and then that word is used wherever the
 * English word recurs). Digits are 0 to 9 (R19). Vietnamese has one CLDR plural
 * category, `other`, so every count entry carries only that form and the noun
 * is not marked for number.
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
  newBook: "Sách mới",
  menuOpen: "Mở menu",
  menuTitle: "Menu",
  menuClose: "Đóng menu",
  settingsOpen: "Cài đặt",
  settingsTitle: "Cài đặt",
  templatesOpen: "Mẫu",
  templatesTitle: "Mẫu",
  templateLicenceLabel: (licence: string): string => `Giấy phép: ${licence}`,
  loadingTemplates: "Đang tải các mẫu.",
  settingsChapterNumbers: "Luôn hiện số chương",
  settingsNormalizeOnFinished: "Cân bằng âm lượng khi xong",
  booksEmpty: "Bắt đầu cuốn sách đầu tiên của bạn",
  booksEmptyTeach: "Một cuốn sách gồm các chương mà bạn ghi âm.",
  loadingBooks: "Đang tải sách của bạn.",
  tryAgain: "Thử lại",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? { other: "{name}, {n} chương, đang mở" }
        : { other: "{name}, {n} chương, đang đóng" }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Thêm chương vào ${bookName}`,
  openChapter: (heading: string): string => `Mở ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Sách ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Chương ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Đến sách ${book}`,
  goToChapter: (heading: string): string => `Đến ${heading}`,

  // Naming
  renameBook: "Đổi tên sách",
  renameChapter: "Đổi tên chương",
  renameSegment: "Đổi tên đoạn",
  bookNameField: "Tên sách",
  chapterNameField: "Tên chương",
  segmentNameField: "Tên đoạn",
  saveName: "Lưu tên",
  newBookTitle: "Đặt tên cho sách mới của bạn",
  newBookClose: "Đóng mà không tạo sách",
  createBook: "Tạo sách",
  newChapterTitle: "Đặt tên cho chương mới của bạn",
  newChapterClose: "Đóng mà không tạo chương",
  createChapter: "Tạo chương",
  savingName: "Đang lưu…",
  creatingBook: "Đang tạo sách của bạn…",

  // Segments screen
  backToBooks: "Quay lại sách",
  addSegment: "Thêm đoạn",
  updating: "Đang cập nhật chương.",
  staleChapter: "Chương này không còn nữa. Quay lại Sách.",
  loadingChapter: "Đang tải chương.",
  segmentsEmpty: "Thêm đoạn đầu tiên",
  segmentsEmptyTeach:
    "Một đoạn là một phần của chương: ghi âm, phát, rồi ghi âm lại.",
  playSegment: (n: number): string => `Phát đoạn ${n}`,
  pauseSegment: (n: number): string => `Tạm dừng đoạn ${n}`,
  openRecorderSegment: (n: number): string => `Mở trình ghi âm cho đoạn ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Sửa đoạn ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Sửa đoạn ${this.segmentHeading(n, label)}, đã xong`;
  },
  openSegment(n: number, label: string | null): string {
    return `Mở đoạn ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Vị trí trong đoạn ${n}`,
  markFinished: (n: number): string => `Đánh dấu đoạn ${n} là xong`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Chưa lưu được tên. Hãy thử lại.",

  // Recorder sheet
  recorderDialog: "Trình ghi âm",
  useLightTheme: "Chuyển sang màn hình sáng, khi ở ngoài nắng",
  useDarkTheme: "Chuyển sang màn hình tối, khi ở nơi thiếu sáng",
  tileEdit: "Sửa",
  tileFinished: "Xong",
  tileStop: "Dừng",
  tileRename: "Đổi tên",
  tileErase: "Đặt lại",
  tileDelete: "Xóa",
  tileShare: "Chia sẻ",
  tileAbout: "Giới thiệu",
  closeRecorder: "Đóng trình ghi âm",
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
  record: "Ghi âm",
  stop: "Dừng ghi âm",
  zoomAtWhole: "Thu phóng: cả đoạn. Phóng to lên một phần tư.",
  zoomAtQuarter: "Thu phóng: một phần tư. Thu nhỏ về cả đoạn.",
  micOffTitle: "Micrô đang tắt",
  micRetry: "Thử lại",
  micBack: "Quay lại",
  micStepsLabel: "Các bước bật micrô",
  micStepOpenSettings: "Mở Cài đặt trên điện thoại của bạn",
  micStepAndroidApp: "Chạm Ứng dụng, rồi tC Mobile, rồi Quyền",
  micStepIosApp: "Chạm Quyền riêng tư & Bảo mật, rồi Micrô",
  micStepIosAppOn: "Bật tC Mobile",
  micStepMicOn: "Bật Micrô",
  micStepComeBack: "Quay lại đây và chạm Thử lại",
  finishedWriteFailed: "Chưa lưu được dấu xong.",
  recorderSaving: "Đang lưu…",
  takeCapWarning: (n: number): string => plural(n, { other: "Còn {n} phút" }),
  loadFailedTitle: "Không mở được bản ghi âm này",
  loadFailedBody:
    "Bản ghi âm của bạn vẫn an toàn. Hãy thử lại, hoặc quay lại để đặt lại từ danh sách.",
  loadRetry: "Thử lại",
  loadBack: "Quay lại",
  loadRetrying: "Đang mở bản ghi âm của bạn…",
  takeRecoverTitle: "Bản ghi âm này chưa được lưu",
  takeRecoverBody:
    "Bản ghi âm của bạn vẫn còn ở đây. Hãy thử lại, hoặc chia sẻ để giữ an toàn.",
  takeRecoverRetry: "Thử lại",
  takeRecoverRetrying: "Đang lưu bản ghi âm của bạn…",
  takeRecoverShare: "Chia sẻ bản ghi âm",
  takeRecoverSharing: "Đang chuẩn bị bản ghi âm…",
  takeShareUnavailable: "Thiết bị này không hỗ trợ chia sẻ.",
  takeShareFailed: "Không chia sẻ được bản ghi âm. Hãy thử lại.",
  takeRetryFailed: "Không lưu được bản ghi âm. Hãy thử lại.",
  takeRecoverShared: "Đã chia sẻ bản ghi âm.",
  takeRecoverDone: "Xong",
  takeRecoverDiscard: "Xóa bản ghi âm này",
  takeRecoverDiscardArmed: "Chạm lần nữa để xóa vĩnh viễn bản ghi âm này",
  takeRecoverDiscardHint: "Chạm lần nữa để xóa.",
  playbackFailed: "Không phát được bản ghi âm này.",
  micNoDevice: "Thiết bị này không có micrô.",
  micSiteBlocked:
    "Việc ghi âm đang bị chặn cho ứng dụng này. Hãy cho phép micrô trong cài đặt trang web của trình duyệt, rồi thử lại.",
  micOsBlocked:
    "Thiết bị của bạn không cho ứng dụng dùng micrô. Hãy kiểm tra quyền dùng micrô trong cài đặt thiết bị, rồi thử lại.",
  micPrompt:
    "Cần quyền dùng micrô để ghi âm. Hãy cho phép khi được hỏi, hoặc nếu đã cho phép, hãy kiểm tra cài đặt thiết bị của bạn.",
  micStartFailed: "Không bắt đầu ghi âm được.",
  recordingUnsupported: "Thiết bị này không ghi âm được.",
  playRecording: "Phát bản ghi âm",
  stopPlayback: "Dừng phát",
  enterEdit: "Sửa bản ghi âm",
  leaveEdit: "Thoát chế độ sửa",
  editingMarker: "Đang sửa",
  cut: "Cắt phần đã chọn",
  auditionSelection: "Nghe phần đã chọn",
  auditionFromLine: "Nghe từ vạch",
  paste: "Dán tại vạch",
  undo: "Hoàn tác",
  redo: "Làm lại",
  nothingToUndo: "Không có gì để hoàn tác.",
  nothingToRedo: "Không có gì để làm lại.",
  recorderMenuTitle: "Thêm",
  recorderMenuOpen: "Thêm thao tác",
  selectionStartHandle: "Đầu phần chọn",
  selectionEndHandle: "Cuối phần chọn",
  selectionHandleTime: (n: number): string => plural(n, { other: "{n} giây" }),
  editFailed: "Không thực hiện được thay đổi đó. Hãy thử chọn phần nhỏ hơn.",
  clearFailed: "Không đặt lại được âm thanh. Hãy thử lại.",
  captureSilence: "Không ghi được âm thanh nào. Hãy thử lại.",
  captureUndecodable: "Thiết bị này không đọc được bản ghi âm.",
  captureUnfinished: "Không hoàn tất được bản ghi âm này.",
  blockedByTake: 'Chọn "Đóng menu", rồi "Đóng trình ghi âm" để lưu bản ghi âm.',
  micStarting: "Micrô vẫn đang khởi động.",
  nothingRecorded: "Chưa ghi âm gì cả.",
  nothingStored: "Chưa có gì được lưu để đặt lại.",
  liveWaveform: "Dạng sóng của bản ghi âm trực tiếp",
  vuMeterLabel: "Mức ghi âm",
  vuMeterUnavailable: "Thiết bị này không có đồng hồ đo mức âm thanh",
  eraseSegment: "Đặt lại đoạn và bắt đầu lại",
  rerecord: "Đặt lại và ghi âm lại",
  segmentMenu: (n: number): string => `Thêm thao tác cho đoạn ${n}`,
  chapterRowMenu: (n: number): string => `Thêm thao tác cho chương ${n}`,
  reorderLifted: (n: number): string => `Đang di chuyển đoạn ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Đoạn ${from} giờ là đoạn ${to}.`,
  reorderStayed: (n: number): string => `Đoạn ${n} vẫn ở nguyên chỗ.`,
  chapterReorderLifted: (n: number): string => `Đang di chuyển chương ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `Chương ${from} giờ là chương ${to}.`,
  chapterReorderStayed: (n: number): string => `Chương ${n} vẫn ở nguyên chỗ.`,
  bookReorderLifted: (heading: string): string => `Đang di chuyển ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} giờ ở vị trí ${to} trên kệ.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} vẫn ở nguyên chỗ.`,
  moveUp: "Chuyển lên",
  moveDown: "Chuyển xuống",
  alreadyFirst: "Đã ở đầu",
  alreadyLast: "Đã ở cuối",
  eraseConfirmTitle: "Đặt lại đoạn và bắt đầu lại",
  eraseConfirm: "Đặt lại bản ghi âm",
  eraseCancel: "Hủy",
  recordAgainConfirm: "Ghi âm lại",
  recordAgainKeep: "Giữ lại",
  eraseFailed: "Không đặt lại được bản ghi âm. Hãy thử lại.",
  eraseConfirmPreviewPlay: "Nghe phần sẽ mất",
  eraseConfirmPreviewPause: "Tạm dừng",
  discardClip: "Bỏ phần âm thanh đã cắt",
  discardClipConfirmTitle: "Bỏ phần âm thanh đã cắt?",
  discardClipConfirm: "Bỏ",
  deleteBook: "Xóa sách",
  deleteBookConfirmTitle: (book: string): string =>
    `Xóa ${book} và mọi thứ trong đó?`,
  keepBook: "Giữ sách",
  deleteBookYes: "Có, xóa sách",
  deleteBookFailed: "Không xóa được sách này. Hãy thử lại.",
  deleteSegment: "Xóa đoạn",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Xóa đoạn ${ordinal}?`,
  deleteSegmentConfirm: "Xóa",
  deleteSegmentFailed: "Không xóa được đoạn này. Hãy thử lại.",
  chapterMenuOpen: "Thêm thao tác cho chương này",
  chapterMenuTitle: "Chương",

  // Sharing
  shareChapter: "Chia sẻ chương",
  shareChapterUnconfirmed:
    "Chia sẻ chương. Lần thử trước chưa được xác nhận: chạm để thử lại.",
  shareSend: "Chia sẻ ngay",
  sharePreparing: "Đang chuẩn bị chương để chia sẻ.",
  shareHandingOver: "Đang mở bảng chia sẻ của điện thoại.",
  sharePreparingLabel: "Đang chuẩn bị để chia sẻ",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, { other: `Đang chia sẻ {n} trong tổng số ${all}` }),
  shareSent: "Đã chuyển cho bảng chia sẻ của điện thoại.",
  shareDismissed: "Bảng chia sẻ đã đóng trước khi gửi gì.",
  shareUnproven:
    "Bảng chia sẻ đã đóng. Điện thoại này không cho biết đã gửi hay chưa.",
  shareNothing: "Hãy ghi âm một đoạn trước khi chia sẻ chương này.",
  shareFailed: "Không chia sẻ được chương này. Hãy thử lại.",
  shareMissing: (n: number): string =>
    plural(n, { other: "Không thể đưa {n} đoạn vào." }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Thêm thao tác cho ${book}`,
  bookMenuTitle: "Sách",
  shareBook: "Chia sẻ sách",
  shareBookUnconfirmed:
    "Chia sẻ sách. Lần thử trước chưa được xác nhận: chạm để thử lại.",
  shareBookPreparing: "Đang chuẩn bị sách để chia sẻ.",
  exportProject: "Xuất dự án",
  tileExport: "Xuất",
  exportProjectPreparing: "Đang chuẩn bị dự án để xuất.",
  languageAskTitle: "Ngôn ngữ của sách này",
  languageAskLead:
    "Các bản ghi âm bằng ngôn ngữ nào? Bạn chỉ chọn một lần, và mọi lần xuất sách này đều dùng ngôn ngữ đó.",
  languageSearch: "Tìm ngôn ngữ",
  languageSearchHint: "Tên hoặc mã",
  languageLoading: "Đang tải danh sách ngôn ngữ.",
  languageLoadFailed: "Không tải được danh sách ngôn ngữ.",
  languageNoMatch: "Không có ngôn ngữ nào khớp. Hãy thử tên hoặc mã khác.",
  languageNarrow: "Gõ thêm để thấy các ngôn ngữ khác.",
  languageCount: (n: number): string =>
    plural(n, { one: "{n} ngôn ngữ khớp.", other: "{n} ngôn ngữ khớp." }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      other: `{n} ngôn ngữ khớp. Đang hiện ${shown} ngôn ngữ đầu tiên. Gõ thêm để thu hẹp kết quả.`,
    }),
  languageSaving: "Đang lưu ngôn ngữ.",
  languageAskCancel: "Hủy",
  licenceAskTitle: "Giấy phép của sách này",
  licenceAskLead:
    "Ai được phép chia sẻ các bản ghi âm này? Bạn chỉ chọn một lần cho sách này.",
  licenceAllRightsReserved: "Bảo lưu mọi quyền",
  licenceSaving: "Đang lưu giấy phép.",
  licenceAskContinue: "Chia sẻ",
  licenceAskCancel: "Hủy",
  licenceTileLabel: "Đổi giấy phép",
  tileLicence: "Giấy phép",
  tileTemplates: "Mẫu",
  licenceAskSave: "Lưu",
  licenceAskSaveLead:
    "Ai được phép chia sẻ các bản ghi âm này? Bạn có thể đổi lại sau.",
  licenceNameCcBySa: "Creative Commons Ghi công-Chia sẻ tương tự 4.0",
  licenceNameCcBy: "Creative Commons Ghi công 4.0",
  licenceNameCc0: "Creative Commons Zero 1.0, phạm vi công cộng",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "dự án",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Hãy ghi âm một đoạn trước khi chia sẻ sách này.",
  shareBookFailed: "Không chia sẻ được sách này. Hãy thử lại.",
  shareBookFailedWeb:
    "Không chia sẻ được sách này. Chỉ có thể chia sẻ sách trong ứng dụng tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, { other: "Không thể đưa {n} chương vào." }),
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
      other: `Không thể đưa {n} đoạn trong ${scope} chương đã đưa vào.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Không chuẩn bị được để chia sẻ. Hãy thử lại; nếu vẫn lỗi, hãy khởi động lại ứng dụng.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Sách",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly
      ? "Thay đổi của bạn chưa được lưu"
      : "Bản ghi âm này chưa được lưu",
  saveFailedSaving: "Đang lưu",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Bản ghi âm bạn đang sửa vẫn còn ở đây."
        : `Bản ghi âm đoạn ${ordinal} bạn đang sửa vẫn còn ở đây.`
      : ordinal === null
        ? "Bản ghi âm của bạn vẫn còn ở đây."
        : `Bản ghi âm đoạn ${ordinal} vẫn còn ở đây.`,
  saveFailedRetry: "Thử lưu lại",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Chạm lần nữa để bỏ các thay đổi này"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Bỏ các thay đổi này"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly ? "Chạm lần nữa để bỏ." : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Thay đổi của bạn cần một phiên bản ứng dụng mới hơn."
      : "Bản ghi âm này cần một phiên bản ứng dụng mới hơn.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Sách này không còn nữa. Không thể lưu thay đổi của bạn."
      : "Sách này không còn nữa. Không thể lưu bản ghi âm này.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Không lưu được thay đổi của bạn."
      : "Không lưu được bản ghi âm này.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Bản ứng dụng này không lưu được. Nếu bạn khởi động lại, thay đổi sẽ mất, nhưng đó là cách duy nhất để có phiên bản mới."
      : "Bản ứng dụng này không lưu được. Nếu bạn khởi động lại, bản ghi âm sẽ mất, nhưng đó là cách duy nhất để có phiên bản mới.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Sách này đã bị xóa ở một bản ứng dụng khác. Bỏ các thay đổi là cách duy nhất để thoát."
      : "Sách này đã bị xóa ở một bản ứng dụng khác. Hãy xóa bản ghi âm này để thoát.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Màn hình này đang giữ bản duy nhất của các thay đổi của bạn. Đừng đóng ứng dụng."
      : "Màn hình này đang giữ bản duy nhất của phần việc chưa lưu của bạn. Đừng đóng ứng dụng.",
  saveFailedAttempts: (attempts: number): string => `Số lần thử: ${attempts}`,
  appFailed: "Đã xảy ra sự cố.",
  appReload: "Khởi động lại ứng dụng",
  appReloadTeach: "Ứng dụng sẽ bắt đầu lại.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Chạm lần nữa để khởi động lại và mất bản ghi âm này cùng phần âm thanh bạn đã cắt"
          : "Chạm lần nữa để khởi động lại và mất bản ghi âm này";
      case "changes":
        return alsoCutAudio
          ? "Chạm lần nữa để khởi động lại và mất các thay đổi này cùng phần âm thanh bạn đã cắt"
          : "Chạm lần nữa để khởi động lại và mất các thay đổi này";
      case "cutAudio":
        return "Chạm lần nữa để khởi động lại và mất phần âm thanh bạn đã cắt";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Chạm lần nữa, và bản ghi âm này cùng phần âm thanh bạn đã cắt sẽ mất."
          : "Chạm lần nữa, và bản ghi âm này sẽ mất.";
      case "changes":
        return alsoCutAudio
          ? "Chạm lần nữa, và các thay đổi này cùng phần âm thanh bạn đã cắt sẽ mất."
          : "Chạm lần nữa, và các thay đổi này sẽ mất.";
      case "cutAudio":
        return "Chạm lần nữa, và phần âm thanh bạn đã cắt sẽ mất.";
    }
  },
  appReloading: "Đang khởi động lại…",
  appReloadHeld: "Sự cố này chưa được lưu. Hãy gửi đi, hoặc thử lại.",
  encoderFailing:
    "Điện thoại này không thu nhỏ được bản ghi âm. Không có gì bị mất; khởi động lại ứng dụng có thể giúp ích.",

  // Storage and sharing everything
  storageNotPersisted:
    "Điện thoại này có thể xóa những gì bạn ghi âm ở đây nếu hết chỗ trống. Hãy chia sẻ phần việc của bạn bất cứ lúc nào có thể.",
  storageLow:
    "Chỗ trống trên điện thoại này sắp hết. Hãy đánh dấu các đoạn là xong để giải phóng chỗ trống, hoặc chia sẻ phần việc của bạn rồi xóa.",
  storageCritical:
    "Chỗ trống trên điện thoại này gần như đã hết, và các bản ghi âm mới có thể không được lưu. Hãy đánh dấu các đoạn là xong, hoặc chia sẻ phần việc của bạn rồi xóa.",
  storageShareSoon: "Hãy sớm chia sẻ phần việc của bạn",
  shareAll: "Chia sẻ phần việc của bạn",
  shareAllUnconfirmed:
    "Chia sẻ phần việc của bạn. Lần thử trước chưa được xác nhận: chạm để thử lại.",
  shareAllPreparing: "Đang chuẩn bị phần việc của bạn để chia sẻ.",
  shareAllNothing: "Hãy ghi âm một đoạn trước khi chia sẻ phần việc của bạn.",
  shareAllFailed: "Không chia sẻ được phần việc của bạn. Hãy thử lại.",
  shareAllFailedWeb:
    "Không chia sẻ được phần việc của bạn. Hãy dùng ứng dụng tC Mobile để chia sẻ.",
  shareAllStorage:
    "Điện thoại này không đủ chỗ trống để chuẩn bị phần việc của bạn. Hãy đánh dấu các đoạn là xong, rồi thử lại.",
  shareAllMissing: (n: number): string =>
    plural(n, { other: "Không thể đưa {n} sách vào." }),
  shareAllIncomplete: (n: number): string =>
    plural(n, { other: "Không thể đưa {n} chương đầy đủ vào." }),
  shareAllFilename: "Công việc của tôi.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Một bản khác của ứng dụng này đang mở.",
  dbBlockedTeach: "Hãy đóng bản kia để tiếp tục.",
  dbOutOfDate: "Bản này đã cũ.",
  dbOutOfDateTeach: "Hãy khởi động lại để dùng phiên bản mới.",

  // About and licences
  aboutOpen: "Giới thiệu và giấy phép",
  aboutTitle: "Giới thiệu và giấy phép",
  aboutBlurb:
    "Ứng dụng miễn phí và mã nguồn mở. Mọi thứ bạn ghi âm đều được lưu trên điện thoại này.",
  aboutAppLicense: "Ứng dụng này được cấp phép theo giấy phép MIT.",
  aboutSourceOffer:
    "Mã nguồn của ứng dụng này được công khai. Mã nguồn của phiên bản này:",
  aboutVisitAppSource: "Mở mã nguồn của phiên bản này trên GitHub",
  aboutPrivacy: "Cách ứng dụng này xử lý dữ liệu của bạn:",
  aboutPrivacyLink: "Chính sách quyền riêng tư",
  aboutVisitPrivacy: "Mở chính sách quyền riêng tư",
  aboutThirdParty: "Thành phần mã nguồn mở",
  aboutTexts: "Văn bản giấy phép",
  aboutQrCaption: "Quét để tải ứng dụng",
  aboutContent: "Nội dung đi kèm",
  aboutLanguageCodes: "Mã ngôn ngữ: ISO 639-3, từ iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Đọc ${name}`,
  aboutBack: "Quay lại danh sách",
  aboutTextLoading: "Đang tải văn bản giấy phép.",
  aboutTextFailed: "Không tải được văn bản giấy phép.",
  aboutVisitSource: (name: string): string => `Mở trang dự án của ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Mở mã nguồn của ${name} được đưa kèm trong phiên bản này`,
  aboutVisitLicense: (name: string): string => `Mở giấy phép của ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, { other: "Đã ghi {n} sự cố" }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, { other: "Mở menu. Đã ghi {n} sự cố." }),
  failuresTeach:
    "Hãy gửi báo cáo này cho người hướng dẫn của bạn nếu có gì không hoạt động.",
  shareFailureLog: "Gửi báo cáo sự cố",
  shareFailureLogUnconfirmed:
    "Gửi báo cáo sự cố. Lần thử trước chưa được xác nhận: chạm để thử lại.",
  shareFailureLogPreparing: "Đang chuẩn bị báo cáo sự cố.",
  shareFailureLogNothing: "Hiện không có gì để gửi.",
  shareFailureLogFailed: "Không gửi được báo cáo sự cố. Hãy thử lại.",
  shareFailureLogRestart:
    "Bản này không dùng được nữa. Hãy khởi động lại ứng dụng để dùng phiên bản mới.",
  clearFailureLog: "Xóa báo cáo sự cố",
  clearFailureLogConfirmTitle: "Xóa báo cáo sự cố?",
  clearFailureLogConfirm: "Xóa",
  loadFailed: "Không tải được. Hãy thử lại.",
  saveFailed: "Không lưu được. Hãy thử lại.",
  noRoom: "Điện thoại này không còn chỗ trống.",
  bookNameTaken: "Một cuốn sách khác đã dùng tên này. Hãy gõ tên khác.",
  stopToEdit: "Hãy dừng ghi âm để sửa.",
  stopToErase: "Hãy dừng ghi âm để đặt lại.",

  // Cover colours and chapter playback
  coverColourLabel: "Màu bìa",
  coverColourAmber: "Hổ phách",
  coverColourTeal: "Xanh ngọc",
  coverColourPlum: "Tím mận",
  coverColourForest: "Xanh rừng",
  coverColourBrick: "Đỏ gạch",
  coverColourSlate: "Xám đá phiến",
  coverColourRose: "Hồng",
  coverColourOlive: "Ô liu",
  coverColourRust: "Nâu gỉ",
  coverColourCocoa: "Nâu ca cao",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, đã chọn` : name,
  playChapter: (heading: string): string => `Phát ${heading}`,
  pauseChapter: (heading: string): string => `Tạm dừng ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Phát tiếp ${heading}, đang tạm dừng ở ${percent} phần trăm`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} không phát được. Chạm để thử lại`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} chưa có bản ghi âm để phát`,
  chapterPlayStarted: (heading: string): string => `Đang phát ${heading}`,
  chapterPlayPaused: (heading: string): string => `${heading} đã tạm dừng`,
  chapterPlayFinished: (heading: string): string => `${heading} đã xong`,
};
