import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/** A counted noun's three forms after a figure: singular, few, many. */
type Noun = readonly [singular: string, few: string, many: string];

/**
 * The one plural model (#1870, George r1 Low 2). After a figure the noun is
 * plural for few (3 to 10) and the singular with the written accusative for
 * many (11 to 99). It is the bare singular otherwise: after 100 and 1000 it
 * is genitive, which is not written, and after 0, 1 and 2 it is a compromise.
 * An AI reading of the grammar: a native-speaker review of it is a condition
 * of lifting the hold. `tests/ar-plural-model.test.ts` holds every count to it.
 */
const counted = (noun: Noun, frame: (word: string) => string) => ({
  zero: frame(noun[0]),
  one: frame(noun[0]),
  two: frame(noun[0]),
  few: frame(noun[1]),
  many: frame(noun[2]),
  other: frame(noun[0]),
});

const BOOK: Noun = ["كتاب", "كتب", "كتابًا"];
const CHAPTER: Noun = ["فصل", "فصول", "فصلًا"];
const SEGMENT: Noun = ["مقطع", "مقاطع", "مقطعًا"];
const LANGUAGE: Noun = ["لغة", "لغات", "لغةً"];
const PROBLEM: Noun = ["مشكلة", "مشاكل", "مشكلةً"];
const MINUTE: Noun = ["دقيقة", "دقائق", "دقيقةً"];
const SECOND: Noun = ["ثانية", "ثوانٍ", "ثانيةً"];

/**
 * The ar table: Arabic (Modern Standard Arabic), drafted by AI under the
 * decisions on #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed")
 * and following `docs/i18n/glossary.md`. AI DRAFT, AWAITING NATIVE-SPEAKER
 * REVIEW: no Arabic reader has checked the meaning.
 *
 * HELD: every translatable key is drafted (#1458 part 3), and Arabic still
 * stays off while it is on `GO_LIVE_HELD` (`locales.ts`). Nothing here has
 * been checked right to left on a device.
 *
 * Register: buttons and captions are the verbal noun ("تشغيل", "حذف"), but
 * Record and Stop recording take the glossary's imperative (rows 5, 6). The
 * visible Done is "تم" (row 10); where a sentence needs the state as an
 * adjective it is "مكتمل", since "تم" is a verb. The captions Reset and About
 * shrink to "إعادة تعيين" and "حول" (rows 11, 27; section 5). Digits are 0 to
 * 9 (R19). Every count entry carries Arabic's six plural categories, each
 * with `{n}`, on the model `counted` states. `trail` keeps the English `>`;
 * how it reads right to left is the layout's question (glossary section 6).
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
  settingsCompressOnFinished: "تخفيف المقاطع العالية عند الاكتمال",
  booksEmpty: "ابدأ كتابك الأول",
  booksEmptyTeach: "يضم الكتاب الفصول التي تسجّلها.",
  loadingBooks: "جارٍ تحميل كتبك.",
  tryAgain: "حاول مرة أخرى",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      counted(
        CHAPTER,
        (x) => `{name}، {n} ${x}، ${expanded ? "مفتوح" : "مغلق"}`
      )
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
    plural(
      n,
      counted(MINUTE, (x) => `متبقٍ {n} ${x}`)
    ),
  loadFailedTitle: "تعذّر فتح هذا التسجيل",
  loadFailedBody:
    "تسجيلك في أمان. حاول مرة أخرى. إذا لم يُفتح رغم ذلك، يمكنك إعادة تعيينه من القائمة.",
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
    plural(
      n,
      counted(SECOND, (x) => `{n} ${x}`)
    ),
  editFailed: "تعذّر تطبيق هذا التعديل. جرّب تحديدًا أقصر.",
  clearFailed: "تعذّرت إعادة تعيين الصوت. حاول مرة أخرى.",
  captureSilence: "لم يُسجَّل أي صوت. حاول مرة أخرى.",
  captureUndecodable: "تعذّرت قراءة التسجيل على هذا الجهاز.",
  captureUnfinished: "تعذّر إنهاء هذا التسجيل.",
  captureStoppedSilent:
    "توقّف التسجيل لأن الميكروفون لم يلتقط سوى الصمت. ما سجّلته محفوظ.",
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

  // Sharing
  shareChapter: "مشاركة الفصل",
  shareChapterUnconfirmed:
    "مشاركة الفصل. لم تُؤكَّد المحاولة الأخيرة: اضغط للمحاولة مرة أخرى.",
  shareSend: "المشاركة الآن",
  sharePreparing: "جارٍ تجهيز الفصل للمشاركة.",
  shareHandingOver: "جارٍ فتح قائمة المشاركة في الهاتف.",
  sharePreparingLabel: "جارٍ التجهيز للمشاركة",
  // No counted noun, and a verb that comes first does not agree in number.
  shareItemsGoOut: (out: number, all: number): string =>
    plural(
      out,
      counted(["", "", ""], () => `يُرسَل {n} من ${all}`)
    ),
  shareSent: "سُلِّم إلى قائمة المشاركة في الهاتف.",
  shareDismissed: "أُغلقت قائمة المشاركة قبل إرسال أي شيء.",
  shareUnproven:
    "أُغلقت قائمة المشاركة. لا يستطيع هذا الهاتف التأكد من أنها أُرسلت.",
  shareNothing: "سجّل مقطعًا قبل مشاركة هذا الفصل.",
  shareFailed: "تعذّرت مشاركة هذا الفصل. حاول مرة أخرى.",
  shareMissing: (n: number): string =>
    plural(
      n,
      counted(SEGMENT, (x) => `تعذّر تضمين {n} ${x}.`)
    ),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `إجراءات أخرى لكتاب ${book}`,
  bookMenuTitle: "الكتاب",
  shareBook: "مشاركة الكتاب",
  shareBookUnconfirmed:
    "مشاركة الكتاب. لم تُؤكَّد المحاولة الأخيرة: اضغط للمحاولة مرة أخرى.",
  shareBookPreparing: "جارٍ تجهيز الكتاب للمشاركة.",
  exportProject: "تصدير المشروع",
  tileExport: "تصدير",
  exportProjectPreparing: "جارٍ تجهيز المشروع للتصدير.",
  exportProjectWebPointer:
    "التصدير يعمل في التطبيق المثبَّت. افتح التطبيق لتصدير هذا المشروع.",
  languageAskTitle: "لغة هذا الكتاب",
  languageAskLead:
    "بأي لغة هذه التسجيلات؟ تختارها مرة واحدة، ويستخدمها كل تصدير لهذا الكتاب.",
  languageSearch: "البحث في اللغات",
  languageSearchHint: "الاسم أو الرمز",
  languageLoading: "جارٍ تحميل اللغات.",
  languageLoadFailed: "تعذّر تحميل اللغات.",
  languageNoMatch: "لا توجد لغة مطابقة. جرّب اسمًا أو رمزًا آخر.",
  languageNarrow: "اكتب المزيد لرؤية لغات أخرى.",
  languageCount: (n: number): string =>
    plural(
      n,
      counted(LANGUAGE, (x) => `تطابق {n} ${x}.`)
    ),
  languageCountMore: (n: number, shown: number): string =>
    plural(
      n,
      counted(
        LANGUAGE,
        (x) =>
          `تطابق {n} ${x}. يظهر أول ${shown} منها. اكتب المزيد لتضييق البحث.`
      )
    ),
  languageSaving: "جارٍ حفظ اللغة.",
  languageAskCancel: "إلغاء",
  licenceAskTitle: "ترخيص هذا الكتاب",
  licenceAskLead: "من يمكنه مشاركة هذه التسجيلات؟ تختار مرة واحدة لهذا الكتاب.",
  licenceAllRightsReserved: "جميع الحقوق محفوظة",
  licenceSaving: "جارٍ حفظ الترخيص.",
  licenceAskContinue: "مشاركة",
  licenceAskCancel: "إلغاء",
  licenceTileLabel: "تغيير الترخيص",
  tileLicence: "الترخيص",
  tileTemplates: "القوالب",
  licenceAskSave: "حفظ",
  licenceAskSaveLead: "من يمكنه مشاركة هذه التسجيلات؟ يمكنك تغيير هذا لاحقًا.",
  licenceNameCcBySa: "المشاع الإبداعي: نسب المصنَّف - الترخيص بالمثل 4.0",
  licenceNameCcBy: "المشاع الإبداعي: نسب المصنَّف 4.0",
  licenceNameCc0: "المشاع الإبداعي صفر 1.0، ملكية عامة",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "مشروع",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "سجّل مقطعًا قبل مشاركة هذا الكتاب.",
  shareBookFailed: "تعذّرت مشاركة هذا الكتاب. حاول مرة أخرى.",
  shareBookFailedWeb:
    "تعذّرت مشاركة هذا الكتاب. مشاركة الكتاب تعمل في تطبيق tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(
      n,
      counted(CHAPTER, (x) => `تعذّر تضمين {n} ${x}.`)
    ),
  shareBookPartial(n: number): string {
    return this.shareMissing(n);
  },
  shareBookMissingAndPartial(
    chapters: number,
    segments: number,
    partialChapters: number
  ): string {
    // "In N of the included chapters": a partitive, so the chapter count
    // takes no counted noun and needs no plural forms of its own. Called only
    // with `segments` > 0 (`shareGapText`), and the book export counts a
    // chapter for each gap (`lib/export/book.ts`), so 0 is only the `?? 0`
    // fallback; the clamp reads it as one chapter, as English does.
    const scope = Math.max(partialChapters, 1);
    const where =
      scope === 1 ? "في فصل مُدرَج" : `في ${scope} من الفصول المُدرَجة`;
    const partial = plural(
      segments,
      counted(SEGMENT, (x) => `تعذّر تضمين {n} ${x} ${where}.`)
    );
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "تعذّر تجهيز هذا للمشاركة. حاول مرة أخرى، وإن تكرر ذلك فأعد تشغيل التطبيق.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "كتاب",

  // The save that failed, the crash screen, the encoder
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "تغييراتك غير محفوظة" : "هذا التسجيل غير محفوظ",
  saveFailedSaving: "جارٍ الحفظ",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "تسجيلك المعدَّل ما زال هنا."
        : `تسجيلك المعدَّل للمقطع ${ordinal} ما زال هنا.`
      : ordinal === null
        ? "تسجيلك ما زال هنا."
        : `تسجيلك للمقطع ${ordinal} ما زال هنا.`,
  saveFailedRetry: "حاول الحفظ مرة أخرى",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "اضغط مرة أخرى للتخلص من هذه التغييرات"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "التخلص من هذه التغييرات"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "اضغط مرة أخرى للتخلص منها."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "تغييراتك تحتاج إلى الإصدار الجديد من التطبيق."
      : "هذا التسجيل يحتاج إلى الإصدار الجديد من التطبيق.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "هذا الكتاب لم يعد موجودًا. لا يمكن حفظ تغييراتك."
      : "هذا الكتاب لم يعد موجودًا. لا يمكن حفظ هذا التسجيل.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly ? "تعذّر حفظ تغييراتك." : "تعذّر حفظ هذا التسجيل.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "هذه النسخة من التطبيق لا تستطيع حفظها. إعادة التشغيل تُضيّعها، لكنها الطريقة الوحيدة للحصول على الإصدار الجديد."
      : "هذه النسخة من التطبيق لا تستطيع حفظه. إعادة التشغيل تُضيّعه، لكنها الطريقة الوحيدة للحصول على الإصدار الجديد.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "حُذف هذا الكتاب في نسخة أخرى من التطبيق. التخلص من التغييرات هو المخرج الوحيد."
      : "حُذف هذا الكتاب في نسخة أخرى من التطبيق. احذف هذا التسجيل للخروج.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "هذه الشاشة تحمل النسخة الوحيدة من تغييراتك. لا تغلق التطبيق."
      : "هذه الشاشة تحمل النسخة الوحيدة من عملك غير المحفوظ. لا تغلق التطبيق.",
  // A label and a figure, as in English: no counted noun, so no plural forms.
  saveFailedAttempts: (attempts: number): string => `المحاولات: ${attempts}`,
  appFailed: "حدث خطأ ما.",
  appReload: "إعادة تشغيل التطبيق",
  appReloadTeach: "سيبدأ التطبيق من جديد.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "اضغط مرة أخرى لإعادة التشغيل وفقدان هذا التسجيل والصوت الذي قصصته"
          : "اضغط مرة أخرى لإعادة التشغيل وفقدان هذا التسجيل";
      case "changes":
        return alsoCutAudio
          ? "اضغط مرة أخرى لإعادة التشغيل وفقدان هذه التغييرات والصوت الذي قصصته"
          : "اضغط مرة أخرى لإعادة التشغيل وفقدان هذه التغييرات";
      case "cutAudio":
        return "اضغط مرة أخرى لإعادة التشغيل وفقدان الصوت الذي قصصته";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "اضغط مرة أخرى فيزول هذا التسجيل والصوت الذي قصصته."
          : "اضغط مرة أخرى فيزول هذا التسجيل.";
      case "changes":
        return alsoCutAudio
          ? "اضغط مرة أخرى فتزول هذه التغييرات والصوت الذي قصصته."
          : "اضغط مرة أخرى فتزول هذه التغييرات.";
      case "cutAudio":
        return "اضغط مرة أخرى فيزول الصوت الذي قصصته.";
    }
  },
  appReloading: "جارٍ إعادة التشغيل…",
  appReloadHeld: "تعذّر حفظ هذه المشكلة بعد. أرسلها، أو حاول مرة أخرى.",
  encoderFailing:
    "تعذّر على هذا الهاتف تصغير التسجيلات. لم يُفقد شيء، وقد تساعد إعادة تشغيل التطبيق.",

  // Storage and sharing everything
  storageNotPersisted:
    "قد يحذف هذا الهاتف ما تسجّله هنا إذا قلّت المساحة. شارك عملك حين تستطيع.",
  storageLow:
    "المساحة في هذا الهاتف قليلة. حدّد المقاطع كمكتملة لتوفير مساحة، أو شارك عملك ثم احذفه.",
  storageCritical:
    "المساحة في هذا الهاتف توشك أن تنفد، وقد لا تُحفظ التسجيلات الجديدة. حدّد المقاطع المكتملة، أو شارك عملك ثم احذفه.",
  storageShareSoon: "شارك عملك قريبًا",
  shareAll: "مشاركة عملك",
  shareAllUnconfirmed:
    "مشاركة عملك. لم تُؤكَّد المحاولة الأخيرة: اضغط للمحاولة مرة أخرى.",
  shareAllPreparing: "جارٍ تجهيز عملك للمشاركة.",
  shareAllNothing: "سجّل مقطعًا قبل مشاركة عملك.",
  shareAllFailed: "تعذّرت مشاركة عملك. حاول مرة أخرى.",
  shareAllFailedWeb: "تعذّرت مشاركة عملك. استخدم تطبيق tC Mobile لمشاركته.",
  shareAllStorage:
    "لا توجد في هذا الهاتف مساحة لتجهيز عملك. حدّد المقاطع المكتملة، ثم حاول مرة أخرى.",
  shareAllMissing: (n: number): string =>
    plural(
      n,
      counted(BOOK, (x) => `تعذّر تضمين {n} ${x}.`)
    ),
  shareAllIncomplete: (n: number): string =>
    plural(
      n,
      counted(CHAPTER, (x) => `تعذّر تضمين {n} ${x} بالكامل.`)
    ),
  shareAllFilename: "عملي.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "هناك نسخة أخرى من هذا التطبيق مفتوحة.",
  dbBlockedTeach: "أغلق النسخة الأخرى للمتابعة.",
  dbOutOfDate: "هذه النسخة قديمة.",
  dbOutOfDateTeach: "أعد التشغيل لاستخدام الإصدار الجديد.",

  // About and licences
  aboutOpen: "حول التطبيق والتراخيص",
  aboutTitle: "حول التطبيق والتراخيص",
  aboutBlurb: "تطبيق مجاني ومفتوح المصدر. كل ما تسجّله يبقى على هذا الهاتف.",
  aboutAppLicense: "هذا التطبيق متاح بموجب ترخيص MIT.",
  aboutSourceOffer: "الشيفرة المصدرية لهذا التطبيق عامة. مصدر هذا الإصدار:",
  aboutVisitAppSource: "فتح مصدر هذا الإصدار على GitHub",
  aboutPrivacy: "كيف يتعامل هذا التطبيق مع بياناتك:",
  aboutPrivacyLink: "سياسة الخصوصية",
  aboutVisitPrivacy: "فتح سياسة الخصوصية",
  aboutThirdParty: "مكوّنات مفتوحة المصدر",
  aboutTexts: "نصوص التراخيص",
  aboutQrCaption: "امسح الرمز للحصول على التطبيق",
  aboutContent: "المحتوى المرفق",
  aboutLanguageCodes: "رموز اللغات: ISO 639-3، من iso639-3.sil.org.",
  aboutReadText: (name: string): string => `قراءة ${name}`,
  aboutBack: "رجوع إلى القائمة",
  aboutTextLoading: "جارٍ تحميل نص الترخيص.",
  aboutTextFailed: "تعذّر تحميل نص الترخيص.",
  aboutVisitSource: (name: string): string => `فتح صفحة مشروع ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `فتح مصدر ${name} المحفوظ مع هذا الإصدار`,
  aboutVisitLicense: (name: string): string => `فتح ترخيص ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(
      n,
      counted(PROBLEM, (x) => `سُجّلت {n} ${x}`)
    ),
  menuOpenWithFailures: (n: number): string =>
    plural(
      n,
      counted(PROBLEM, (x) => `فتح القائمة. سُجّلت {n} ${x}.`)
    ),
  failuresTeach: "أرسل هذا إلى مساعدك إذا كان هناك شيء لا يعمل.",
  shareFailureLog: "إرسال تقرير المشاكل",
  shareFailureLogUnconfirmed:
    "إرسال تقرير المشاكل. لم تُؤكَّد المحاولة الأخيرة: اضغط للمحاولة مرة أخرى.",
  shareFailureLogPreparing: "جارٍ تجهيز تقرير المشاكل.",
  shareFailureLogNothing: "لا يوجد ما يُرسَل الآن.",
  shareFailureLogFailed: "تعذّر إرسال تقرير المشاكل. حاول مرة أخرى.",
  shareFailureLogRestart:
    "لم يعد ممكنًا استخدام هذه النسخة. أعد تشغيل التطبيق لاستخدام الإصدار الجديد.",
  clearFailureLog: "مسح تقرير المشاكل",
  clearFailureLogConfirmTitle: "مسح تقرير المشاكل؟",
  clearFailureLogConfirm: "مسح",
  loadFailed: "تعذّر التحميل. حاول مرة أخرى.",
  saveFailed: "تعذّر الحفظ. حاول مرة أخرى.",
  noRoom: "لم تبقَ مساحة في هذا الهاتف.",
  bookNameTaken: "يوجد كتاب آخر بهذا الاسم. اكتب اسمًا مختلفًا.",
  stopToEdit: "أوقف التسجيل للتعديل.",
  stopToErase: "أوقف التسجيل لإعادة التعيين.",

  // Cover colours and chapter playback
  coverColourLabel: "لون الغلاف",
  coverColourAmber: "كهرماني",
  coverColourTeal: "أزرق مخضر",
  coverColourPlum: "برقوقي",
  coverColourForest: "أخضر غامق",
  coverColourBrick: "طوبي",
  coverColourSlate: "أردوازي",
  coverColourRose: "وردي",
  coverColourOlive: "زيتوني",
  coverColourRust: "صدئي",
  coverColourCocoa: "كاكاو",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}، محدَّد` : name,
  playChapter: (heading: string): string => `تشغيل ${heading}`,
  pauseChapter: (heading: string): string => `إيقاف ${heading} مؤقتًا`,
  resumeChapter: (heading: string, percent: number): string =>
    `استئناف ${heading}، متوقف مؤقتًا عند ${percent} بالمئة`,
  chapterPlayFailed: (heading: string): string =>
    `لم يُشغَّل ${heading}. اضغط للمحاولة مرة أخرى`,
  chapterNothingToPlay: (heading: string): string =>
    `لا يوجد في ${heading} تسجيل لتشغيله`,
  chapterPlayStarted: (heading: string): string => `جارٍ تشغيل ${heading}`,
  chapterPlayPaused: (heading: string): string => `${heading} متوقف مؤقتًا`,
  chapterPlayFinished: (heading: string): string => `انتهى ${heading}`,
};
