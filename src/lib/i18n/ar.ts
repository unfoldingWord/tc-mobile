import { plural } from "@/lib/plural";
import type { Strings } from "@/lib/strings";

/**
 * The ar table: Arabic (Modern Standard Arabic), drafted by AI under the
 * decisions on #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed")
 * and following `docs/i18n/glossary.md`. AI DRAFT, AWAITING NATIVE-SPEAKER
 * REVIEW: no Arabic reader has checked the meaning.
 *
 * PART 1 OF 2, AND HELD: the Books, naming, Segments and recorder-sheet keys;
 * the rest read English and are named in `pending.ts`. Complete or not,
 * Arabic stays off while it is on `GO_LIVE_HELD` (`locales.ts`). Nothing here
 * has been checked right to left on a device.
 *
 * Register: buttons and captions are the verbal noun ("تشغيل", "حذف"), but
 * Record and Stop recording take the glossary's imperative (rows 5, 6). The
 * visible Done is "تم" (row 10); where a sentence needs the state as an
 * adjective it is "مكتمل", since "تم" is a verb. The captions Reset and About
 * shrink to "إعادة تعيين" and "حول" (rows 11, 27; section 5). Digits are 0 to
 * 9 (R19). Every count entry carries Arabic's six plural categories, each
 * with `{n}`; with a figure the noun is plural for few (3 to 10) and singular
 * otherwise, a question for a reader. `trail` keeps the English `>`; how it
 * reads right to left is the layout's question (glossary section 6).
 */
export const table: Partial<Strings> & ThisType<Strings> = {
  trail: (...parts: readonly string[]): string => parts.join(" > "),
  sentences: (...parts: readonly string[]): string => parts.join(" "),

  // Books screen
  newBook: "كتاب جديد",
  menuOpen: "فتح القائمة",
  menuTitle: "القائمة",
  menuClose: "إغلاق القائمة",
  settingsOpen: "الإعدادات",
  settingsTitle: "الإعدادات",
  templatesOpen: "القوالب",
  templatesTitle: "القوالب",
  templateLicenceLabel: (licence: string): string => `الترخيص: ${licence}`,
  loadingTemplates: "جارٍ تحميل القوالب.",
  settingsChapterNumbers: "إظهار أرقام الفصول دائمًا",
  settingsNormalizeOnFinished: "موازنة مستوى الصوت عند الاكتمال",
  booksEmpty: "ابدأ كتابك الأول",
  booksEmptyTeach: "يضم الكتاب الفصول التي تسجّلها.",
  loadingBooks: "جارٍ تحميل كتبك.",
  tryAgain: "حاول مرة أخرى",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            zero: "{name}، {n} فصل، مفتوح",
            one: "{name}، {n} فصل، مفتوح",
            two: "{name}، {n} فصل، مفتوح",
            few: "{name}، {n} فصول، مفتوح",
            many: "{name}، {n} فصلًا، مفتوح",
            other: "{name}، {n} فصل، مفتوح",
          }
        : {
            zero: "{name}، {n} فصل، مغلق",
            one: "{name}، {n} فصل، مغلق",
            two: "{name}، {n} فصل، مغلق",
            few: "{name}، {n} فصول، مغلق",
            many: "{name}، {n} فصلًا، مغلق",
            other: "{name}، {n} فصل، مغلق",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `إضافة فصل إلى ${bookName}`,
  openChapter: (heading: string): string => `فتح ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `كتاب ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `الفصل ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `الانتقال إلى كتاب ${book}`,
  goToChapter: (heading: string): string => `الانتقال إلى ${heading}`,

  // Naming
  renameBook: "إعادة تسمية الكتاب",
  renameChapter: "إعادة تسمية الفصل",
  renameSegment: "إعادة تسمية المقطع",
  bookNameField: "اسم الكتاب",
  chapterNameField: "اسم الفصل",
  segmentNameField: "اسم المقطع",
  saveName: "حفظ الاسم",
  newBookTitle: "سمِّ كتابك الجديد",
  newBookClose: "إغلاق دون إنشاء كتاب",
  createBook: "إنشاء الكتاب",
  newChapterTitle: "سمِّ فصلك الجديد",
  newChapterClose: "إغلاق دون إنشاء فصل",
  createChapter: "إنشاء الفصل",
  savingName: "جارٍ الحفظ…",
  creatingBook: "جارٍ إنشاء كتابك…",

  // Segments screen
  backToBooks: "رجوع إلى الكتب",
  addSegment: "إضافة مقطع",
  updating: "جارٍ تحديث الفصل.",
  staleChapter: "هذا الفصل لم يعد موجودًا. ارجع إلى الكتب.",
  loadingChapter: "جارٍ تحميل الفصل.",
  segmentsEmpty: "أضف المقطع الأول",
  segmentsEmptyTeach:
    "المقطع جزء واحد من الفصل: سجّله، واستمع إليه، ثم سجّله مرة أخرى.",
  playSegment: (n: number): string => `تشغيل المقطع ${n}`,
  pauseSegment: (n: number): string => `إيقاف المقطع ${n} مؤقتًا`,
  openRecorderSegment: (n: number): string => `فتح المسجّل للمقطع ${n}`,
  editSegment(n: number, label: string | null): string {
    return `تعديل المقطع ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `تعديل المقطع ${this.segmentHeading(n, label)}، مكتمل`;
  },
  openSegment(n: number, label: string | null): string {
    return `فتح المقطع ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `الموضع في المقطع ${n}`,
  markFinished: (n: number): string => `تحديد المقطع ${n} كمكتمل`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "لم يُحفظ الاسم. حاول مرة أخرى.",

  // Recorder sheet
  recorderDialog: "المسجّل",
  useLightTheme: "التبديل إلى الشاشة الفاتحة، لضوء الشمس الساطع",
  useDarkTheme: "التبديل إلى الشاشة الداكنة، للإضاءة الخافتة",
  tileEdit: "تعديل",
  tileFinished: "تم",
  tileStop: "إيقاف",
  tileRename: "إعادة تسمية",
  tileErase: "إعادة تعيين",
  tileDelete: "حذف",
  tileShare: "مشاركة",
  tileAbout: "حول",
  closeRecorder: "إغلاق المسجّل",
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
  record: "سجّل",
  stop: "أوقف التسجيل",
  zoomAtWhole: "تم التصغير. كبّر إلى الربع.",
  zoomAtQuarter: "مكبَّر إلى الربع. صغّر.",
  micOffTitle: "الميكروفون متوقف",
  micRetry: "حاول مرة أخرى",
  micBack: "رجوع",
  micStepsLabel: "خطوات تشغيل الميكروفون",
  micStepOpenSettings: "افتح الإعدادات في هاتفك",
  micStepAndroidApp: "اضغط على التطبيقات، ثم tC Mobile، ثم الأذونات",
  micStepIosApp: "اضغط على الخصوصية والأمن، ثم الميكروفون",
  micStepIosAppOn: "شغّل tC Mobile",
  micStepMicOn: "شغّل الميكروفون",
  micStepComeBack: "ارجع إلى هنا واضغط «حاول مرة أخرى»",
  finishedWriteFailed: "تعذّر حفظ علامة الاكتمال.",
  recorderSaving: "جارٍ الحفظ…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      zero: "متبقٍ {n} دقيقة",
      one: "متبقٍ {n} دقيقة",
      two: "متبقٍ {n} دقيقة",
      few: "متبقٍ {n} دقائق",
      many: "متبقٍ {n} دقيقة",
      other: "متبقٍ {n} دقيقة",
    }),
  loadFailedTitle: "تعذّر فتح هذا التسجيل",
  loadFailedBody:
    "تسجيلك في أمان. حاول مرة أخرى، أو ارجع لإعادة تعيينه من القائمة.",
  loadRetry: "حاول مرة أخرى",
  loadBack: "رجوع",
  loadRetrying: "جارٍ فتح تسجيلك…",
  takeRecoverTitle: "لم يُحفظ هذا التسجيل بعد",
  takeRecoverBody: "تسجيلك ما زال هنا. حاول مرة أخرى، أو شاركه ليبقى في أمان.",
  takeRecoverRetry: "حاول مرة أخرى",
  takeRecoverRetrying: "جارٍ حفظ تسجيلك…",
  takeRecoverShare: "مشاركة التسجيل",
  takeRecoverSharing: "جارٍ تجهيز التسجيل…",
  takeShareUnavailable: "المشاركة غير متاحة على هذا الجهاز.",
  takeShareFailed: "تعذّرت مشاركة التسجيل. حاول مرة أخرى.",
  takeRetryFailed: "تعذّر حفظ التسجيل. حاول مرة أخرى.",
  takeRecoverShared: "تمت مشاركة التسجيل.",
  takeRecoverDone: "تم",
  takeRecoverDiscard: "حذف هذا التسجيل",
  takeRecoverDiscardArmed: "اضغط مرة أخرى لحذف هذا التسجيل نهائيًا",
  takeRecoverDiscardHint: "اضغط مرة أخرى لحذفه.",
  playbackFailed: "تعذّر تشغيل هذا التسجيل.",
  micNoDevice: "لم يُعثر على ميكروفون في هذا الجهاز.",
  micSiteBlocked:
    "التسجيل محظور لهذا التطبيق. اسمح بالميكروفون في إعدادات الموقع في المتصفح، ثم حاول مرة أخرى.",
  micOsBlocked:
    "جهازك لا يسمح للتطبيق باستخدام الميكروفون. تحقق من إذن الميكروفون في إعدادات الجهاز، ثم حاول مرة أخرى.",
  micPrompt:
    "يلزم إذن الميكروفون للتسجيل. اسمح به عند السؤال، وإن كنت قد سمحت به من قبل فتحقق من إعدادات جهازك.",
  micStartFailed: "تعذّر بدء التسجيل.",
  recordingUnsupported: "هذا الجهاز لا يستطيع تسجيل الصوت.",
  playRecording: "تشغيل التسجيل",
  stopPlayback: "إيقاف التشغيل",
  enterEdit: "تعديل التسجيل",
  leaveEdit: "إنهاء التعديل",
  editingMarker: "جارٍ التعديل",
  cut: "قص التحديد",
  auditionSelection: "تشغيل التحديد",
  auditionFromLine: "التشغيل من الخط",
  paste: "لصق عند الخط",
  undo: "تراجع",
  redo: "إعادة",
  nothingToUndo: "لا شيء للتراجع عنه.",
  nothingToRedo: "لا شيء لإعادته.",
  recorderMenuTitle: "المزيد",
  recorderMenuOpen: "إجراءات أخرى",
  selectionStartHandle: "بداية التحديد",
  selectionEndHandle: "نهاية التحديد",
  selectionHandleTime: (n: number): string =>
    plural(n, {
      zero: "{n} ثانية",
      one: "{n} ثانية",
      two: "{n} ثانية",
      few: "{n} ثوانٍ",
      many: "{n} ثانية",
      other: "{n} ثانية",
    }),
  editFailed: "تعذّر تطبيق هذا التعديل. جرّب تحديدًا أقصر.",
  clearFailed: "تعذّرت إعادة تعيين الصوت. حاول مرة أخرى.",
  captureSilence: "لم يُسجَّل أي صوت. حاول مرة أخرى.",
  captureUndecodable: "تعذّرت قراءة التسجيل على هذا الجهاز.",
  captureUnfinished: "تعذّر إنهاء هذا التسجيل.",
  blockedByTake: "اختر «إغلاق القائمة»، ثم «إغلاق المسجّل»، لحفظ التسجيل.",
  micStarting: "الميكروفون ما زال قيد التشغيل.",
  nothingRecorded: "لم يُسجَّل شيء بعد.",
  nothingStored: "لا يوجد شيء محفوظ لإعادة تعيينه.",
  liveWaveform: "موجة التسجيل المباشر",
  vuMeterLabel: "مستوى التسجيل",
  vuMeterUnavailable: "مقياس المستوى غير متاح على هذا الجهاز",
  eraseSegment: "إعادة تعيين المقطع والبدء من جديد",
  rerecord: "إعادة التعيين والتسجيل مرة أخرى",
  segmentMenu: (n: number): string => `إجراءات أخرى للمقطع ${n}`,
  chapterRowMenu: (n: number): string => `إجراءات أخرى للفصل ${n}`,
  reorderLifted: (n: number): string => `جارٍ نقل المقطع ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `المقطع ${from} أصبح الآن المقطع ${to}.`,
  reorderStayed: (n: number): string => `بقي المقطع ${n} في مكانه.`,
  chapterReorderLifted: (n: number): string => `جارٍ نقل الفصل ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `الفصل ${from} أصبح الآن الفصل ${to}.`,
  chapterReorderStayed: (n: number): string => `بقي الفصل ${n} في مكانه.`,
  bookReorderLifted: (heading: string): string => `جارٍ نقل ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} الآن في الموضع ${to} على الرف.`,
  bookReorderStayed: (heading: string): string => `بقي ${heading} في مكانه.`,
  moveUp: "نقل لأعلى",
  moveDown: "نقل لأسفل",
  alreadyFirst: "في الأعلى بالفعل",
  alreadyLast: "في الأسفل بالفعل",
  eraseConfirmTitle: "إعادة تعيين المقطع والبدء من جديد",
  eraseConfirm: "إعادة تعيين التسجيل",
  eraseCancel: "إلغاء",
  recordAgainConfirm: "التسجيل مرة أخرى",
  recordAgainKeep: "الإبقاء عليه",
  eraseFailed: "تعذّرت إعادة تعيين التسجيل. حاول مرة أخرى.",
  eraseConfirmPreviewPlay: "تشغيل ما سيُفقد",
  eraseConfirmPreviewPause: "إيقاف مؤقت",
  discardClip: "التخلص من الصوت المقصوص",
  discardClipConfirmTitle: "التخلص من الصوت المقصوص؟",
  discardClipConfirm: "تخلّص منه",
  deleteBook: "حذف الكتاب",
  deleteBookConfirmTitle: (book: string): string => `حذف ${book} وكل ما فيه؟`,
  keepBook: "الإبقاء على الكتاب",
  deleteBookYes: "نعم، احذف الكتاب",
  deleteBookFailed: "تعذّر حذف هذا الكتاب. حاول مرة أخرى.",
  deleteSegment: "حذف المقطع",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `حذف المقطع ${ordinal}؟`,
  deleteSegmentConfirm: "حذف",
  deleteSegmentFailed: "تعذّر حذف هذا المقطع. حاول مرة أخرى.",
  chapterMenuOpen: "إجراءات أخرى لهذا الفصل",
  chapterMenuTitle: "الفصل",
};
