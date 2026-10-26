import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The ru table: Russian in Cyrillic, drafted by AI under the decisions on
 * #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No Russian reader has checked the meaning (#1635).
 *
 * Register: buttons and labels are the infinitive a Russian phone's own menus
 * use ("Записать", "Поделиться", "Удалить"); a notice about what did not
 * happen is the impersonal "Не удалось ...", which blames no one; an
 * instruction to the person is the polite "вы" imperative ("Повторите
 * попытку"). A book is "книга", a chapter "глава" (the word Russian Bibles
 * use), a segment "фрагмент" and a recording "запись" (glossary rows 1 to 4).
 * The recorder screen is "диктофон", so it never collides with the noun
 * "запись". Words the glossary keeps as they are stay Latin: "tC Mobile",
 * "MIT", "GitHub" and the file extensions and licence tags in a file name.
 * Digits are 0 to 9 (R19).
 *
 * Plurals: Russian selects the CLDR categories `one`, `few`, `many` and
 * `other`, and `one` also covers 21, 31 and 101 (`few` is 2 to 4 and 22 to
 * 24, `many` is 0 and 5 to 20). Every count entry therefore carries all four
 * forms as whole phrases with `{n}`: "1 глава", "2 главы", "5 глав". `other`,
 * which Russian uses only for fractions, takes the genitive singular like
 * `few`. Wording that means exactly one rides the `"=1"` arm, never `one`.
 *
 * Agreement: a sentence is built so that no word has to agree with a free
 * text slot. A book name or a heading sits inside guillemets or after a
 * colon, and the verb stays an infinitive or the impersonal "Не удалось".
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
  newBook: "Новая книга",
  menuOpen: "Открыть меню",
  menuTitle: "Меню",
  menuClose: "Закрыть меню",
  settingsOpen: "Настройки",
  settingsTitle: "Настройки",
  templatesOpen: "Шаблоны",
  templatesTitle: "Шаблоны",
  templateLicenceLabel: (licence: string): string => `Лицензия: ${licence}`,
  settingsChapterNumbers: "Всегда показывать номера глав",
  settingsNormalizeOnFinished: "Выравнивать громкость при отметке «Готово»",
  booksEmpty: "Начните свою первую книгу",
  booksEmptyTeach: "В книге хранятся главы, которые вы записываете.",
  loadingBooks: "Загружаются ваши книги.",
  tryAgain: "Повторить",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} глава, список раскрыт",
            few: "{name}, {n} главы, список раскрыт",
            many: "{name}, {n} глав, список раскрыт",
            other: "{name}, {n} главы, список раскрыт",
          }
        : {
            one: "{name}, {n} глава, список свёрнут",
            few: "{name}, {n} главы, список свёрнут",
            many: "{name}, {n} глав, список свёрнут",
            other: "{name}, {n} главы, список свёрнут",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Добавить главу в «${bookName}»`,
  openChapter: (heading: string): string => `Открыть: ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Книга ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Глава ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Перейти к книге «${book}»`,
  goToChapter: (heading: string): string => `Перейти: ${heading}`,

  // Naming
  renameBook: "Переименовать книгу",
  renameChapter: "Переименовать главу",
  renameSegment: "Переименовать фрагмент",
  bookNameField: "Название книги",
  chapterNameField: "Название главы",
  segmentNameField: "Название фрагмента",
  saveName: "Сохранить название",
  newBookTitle: "Назовите новую книгу",
  newBookClose: "Закрыть, не создавая книгу",
  createBook: "Создать книгу",
  newChapterTitle: "Назовите новую главу",
  newChapterClose: "Закрыть, не создавая главу",
  createChapter: "Создать главу",
  savingName: "Сохранение…",
  creatingBook: "Создаём вашу книгу…",

  // Segments screen
  backToBooks: "Назад к книгам",
  addSegment: "Добавить фрагмент",
  updating: "Глава обновляется.",
  staleChapter: "Эта глава больше недоступна. Вернитесь к книгам.",
  loadingChapter: "Глава загружается.",
  segmentsEmpty: "Добавьте первый фрагмент",
  segmentsEmptyTeach:
    "Фрагмент — это один отрывок главы: запишите его, прослушайте, при желании запишите снова.",
  playSegment: (n: number): string => `Воспроизвести фрагмент ${n}`,
  pauseSegment: (n: number): string => `Пауза: фрагмент ${n}`,
  openRecorderSegment: (n: number): string =>
    `Открыть диктофон для фрагмента ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Изменить фрагмент ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Изменить фрагмент ${this.segmentHeading(n, label)}, готово`;
  },
  openSegment(n: number, label: string | null): string {
    return `Открыть фрагмент ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Позиция во фрагменте ${n}`,
  markFinished: (n: number): string => `Фрагмент ${n}: отметить «Готово»`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Название не сохранено. Повторите попытку.",

  // Recorder sheet
  recorderDialog: "Диктофон",
  useLightTheme: "Включить светлый экран, для яркого солнца",
  useDarkTheme: "Включить тёмный экран, для слабого света",
  tileEdit: "Изменить",
  tileFinished: "Готово",
  tileStop: "Стоп",
  tileRename: "Переименовать",
  tileErase: "Сбросить",
  tileDelete: "Удалить",
  tileShare: "Поделиться",
  tileAbout: "О приложении",
  closeRecorder: "Закрыть диктофон",
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
  record: "Записать",
  stop: "Остановить запись",
  zoomAtWhole: "Масштаб уменьшен. Увеличьте до четверти.",
  zoomAtQuarter: "Масштаб: четверть. Уменьшите.",
  micOffTitle: "Микрофон выключен",
  micRetry: "Повторить",
  micBack: "Назад",
  micStepsLabel: "Как включить микрофон",
  micStepOpenSettings: "Откройте «Настройки» на телефоне",
  micStepAndroidApp:
    "Нажмите «Приложения», затем tC Mobile, затем «Разрешения»",
  micStepIosApp:
    "Нажмите «Конфиденциальность и безопасность», затем «Микрофон»",
  micStepIosAppOn: "Включите tC Mobile",
  micStepMicOn: "Включите «Микрофон»",
  micStepComeBack: "Вернитесь сюда и нажмите «Повторить»",
  finishedWriteFailed: "Не удалось сохранить отметку «Готово».",
  recorderSaving: "Сохранение…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "Осталась {n} минута",
      few: "Осталось {n} минуты",
      many: "Осталось {n} минут",
      other: "Осталось {n} минуты",
    }),
  loadFailedTitle: "Не удалось открыть эту запись",
  loadFailedBody:
    "Ваша запись в безопасности. Повторите или вернитесь и сбросьте её в списке.",
  loadRetry: "Повторить",
  loadBack: "Назад",
  loadRetrying: "Открываем вашу запись…",
  takeRecoverTitle: "Эту запись пока не удалось сохранить",
  takeRecoverBody:
    "Ваша запись всё ещё здесь. Повторите или поделитесь ею, чтобы сохранить.",
  takeRecoverRetry: "Повторить",
  takeRecoverRetrying: "Сохраняем вашу запись…",
  takeRecoverShare: "Поделиться записью",
  takeRecoverSharing: "Готовим запись…",
  takeShareUnavailable: "На этом устройстве поделиться нельзя.",
  takeShareFailed: "Не удалось поделиться записью. Повторите попытку.",
  takeRetryFailed: "Не удалось сохранить запись. Повторите попытку.",
  takeRecoverShared: "Вы поделились записью.",
  takeRecoverDone: "Готово",
  takeRecoverDiscard: "Удалить эту запись",
  takeRecoverDiscardArmed: "Нажмите ещё раз, чтобы удалить эту запись навсегда",
  takeRecoverDiscardHint: "Нажмите ещё раз, чтобы удалить.",
  playbackFailed: "Не удалось воспроизвести эту запись.",
  micNoDevice: "На этом устройстве не найден микрофон.",
  micSiteBlocked:
    "Запись для этого приложения заблокирована. Разрешите микрофон в настройках сайта в браузере, затем повторите попытку.",
  micOsBlocked:
    "Устройство не даёт приложению использовать микрофон. Проверьте доступ к микрофону в настройках устройства, затем повторите попытку.",
  micPrompt:
    "Для записи нужен доступ к микрофону. Разрешите его, когда появится запрос, — или, если вы уже разрешили, проверьте настройки устройства.",
  micStartFailed: "Не удалось начать запись.",
  recordingUnsupported: "Это устройство не может записывать звук.",
  playRecording: "Воспроизвести запись",
  stopPlayback: "Остановить воспроизведение",
  enterEdit: "Изменить запись",
  leaveEdit: "Закончить изменение",
  editingMarker: "Изменение",
  cut: "Вырезать выделенное",
  auditionSelection: "Воспроизвести выделенное",
  auditionFromLine: "Воспроизвести от линии",
  paste: "Вставить на линии",
  undo: "Отменить",
  redo: "Вернуть",
  nothingToUndo: "Нечего отменять.",
  nothingToRedo: "Нечего возвращать.",
  recorderMenuTitle: "Ещё",
  recorderMenuOpen: "Другие действия",
  selectionStartHandle: "Начало выделения",
  selectionEndHandle: "Конец выделения",
  editFailed: "Не удалось применить изменение. Выберите участок короче.",
  clearFailed: "Не удалось сбросить звук. Повторите попытку.",
  captureSilence: "Звук не записан. Повторите попытку.",
  captureUndecodable: "Не удалось прочитать запись на этом устройстве.",
  captureUnfinished: "Не удалось завершить эту запись.",
  blockedByTake:
    "Чтобы сохранить запись, нажмите «Закрыть меню», затем «Закрыть диктофон».",
  micStarting: "Микрофон ещё запускается.",
  nothingRecorded: "Пока ничего не записано.",
  nothingStored: "Нечего сбрасывать: ничего не сохранено.",
  liveWaveform: "Волна идущей записи",
  vuMeterLabel: "Уровень записи",
  vuMeterUnavailable: "Индикатор уровня недоступен на этом устройстве",
  eraseSegment: "Сбросить фрагмент и начать заново",
  rerecord: "Сбросить и записать снова",
  segmentMenu: (n: number): string => `Другие действия для фрагмента ${n}`,
  reorderLifted: (n: number): string => `Перемещение фрагмента ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Фрагмент ${from} теперь фрагмент ${to}.`,
  reorderStayed: (n: number): string => `Фрагмент ${n} остался на месте.`,
  chapterReorderLifted: (n: number): string => `Перемещение главы ${n}.`,
  chapterReorderMoved: (n: number, to: number): string =>
    `Глава ${n} перемещена на место ${to}.`,
  chapterReorderStayed: (n: number): string => `Глава ${n} осталась на месте.`,
  bookReorderLifted: (heading: string): string => `Перемещение: «${heading}».`,
  bookReorderMoved: (heading: string, to: number): string =>
    `«${heading}» теперь на позиции ${to} на полке.`,
  bookReorderStayed: (heading: string): string =>
    `Положение «${heading}» на полке не изменилось.`,
  eraseConfirmTitle: "Сбросить фрагмент и начать заново",
  eraseConfirm: "Сбросить запись",
  eraseCancel: "Отмена",
  recordAgainConfirm: "Записать снова",
  recordAgainKeep: "Оставить",
  eraseFailed: "Не удалось сбросить запись. Повторите попытку.",
  eraseConfirmPreviewPlay: "Воспроизвести то, что будет потеряно",
  eraseConfirmPreviewPause: "Пауза",
  discardClip: "Выбросить вырезанный звук",
  discardClipConfirmTitle: "Выбросить вырезанный звук?",
  discardClipConfirm: "Выбросить",
  deleteBook: "Удалить книгу",
  deleteBookConfirmTitle: (book: string): string =>
    `Удалить «${book}» и всё, что в ней?`,
  keepBook: "Оставить книгу",
  deleteBookYes: "Да, удалить книгу",
  deleteBookFailed: "Не удалось удалить эту книгу. Повторите попытку.",
  deleteSegment: "Удалить фрагмент",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Удалить фрагмент ${ordinal}?`,
  deleteSegmentConfirm: "Удалить",
  deleteSegmentFailed: "Не удалось удалить этот фрагмент. Повторите попытку.",
  chapterMenuOpen: "Другие действия для этой главы",
  chapterMenuTitle: "Глава",

  // Sharing
  shareChapter: "Поделиться главой",
  shareChapterUnconfirmed:
    "Поделиться главой. Прошлая попытка не подтверждена — нажмите, чтобы повторить.",
  shareSend: "Поделиться сейчас",
  sharePreparing: "Готовим главу, чтобы ею поделиться.",
  shareHandingOver: "Открываем меню «Поделиться» на телефоне.",
  sharePreparingLabel: "Готовимся поделиться",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `{n} из ${all} отправляется`,
      few: `{n} из ${all} отправляются`,
      many: `{n} из ${all} отправляются`,
      other: `{n} из ${all} отправляются`,
    }),
  shareSent: "Передано в меню «Поделиться» на телефоне.",
  shareDismissed: "Меню «Поделиться» закрылось, ничего не отправив.",
  shareUnproven:
    "Меню «Поделиться» закрылось. Телефон не может подтвердить, ушло ли что-то дальше.",
  shareNothing: "Запишите фрагмент, прежде чем делиться этой главой.",
  shareFailed: "Не удалось поделиться этой главой. Повторите попытку.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "Не удалось включить {n} фрагмент.",
      few: "Не удалось включить {n} фрагмента.",
      many: "Не удалось включить {n} фрагментов.",
      other: "Не удалось включить {n} фрагмента.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Другие действия для «${book}»`,
  bookMenuTitle: "Книга",
  shareBook: "Поделиться книгой",
  shareBookUnconfirmed:
    "Поделиться книгой. Прошлая попытка не подтверждена — нажмите, чтобы повторить.",
  shareBookPreparing: "Готовим книгу, чтобы ею поделиться.",
  shareBookNothing: "Запишите фрагмент, прежде чем делиться этой книгой.",
  shareBookFailed: "Не удалось поделиться этой книгой. Повторите попытку.",
  shareBookFailedWeb:
    "Не удалось поделиться этой книгой. Делиться книгой можно в приложении tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "Не удалось включить {n} главу.",
      few: "Не удалось включить {n} главы.",
      many: "Не удалось включить {n} глав.",
      other: "Не удалось включить {n} главы.",
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
    // The segment count picks the noun form and the verb stays impersonal;
    // the chapter scope is a genitive after "из".
    const bySegments = (from: string): string =>
      plural(segments, {
        one: `Не удалось включить {n} фрагмент ${from}.`,
        few: `Не удалось включить {n} фрагмента ${from}.`,
        many: `Не удалось включить {n} фрагментов ${from}.`,
        other: `Не удалось включить {n} фрагмента ${from}.`,
      }).replaceAll("{chapters}", () => String(scope));
    // "из включённой главы" for exactly one, "из 21 включённой главы" for
    // `one`, "из 5 включённых глав" for the rest. Only the exact-one arm says
    // "a chapter", because `one` also covers 21 and 31.
    const partial = plural(scope, {
      "=1": bySegments("из включённой главы"),
      one: bySegments("из {chapters} включённой главы"),
      few: bySegments("из {chapters} включённых глав"),
      many: bySegments("из {chapters} включённых глав"),
      other: bySegments("из {chapters} включённых глав"),
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Не удалось подготовить файл, чтобы поделиться. Повторите попытку — если не получается, перезапустите приложение.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  exportProject: "Экспортировать проект",
  tileExport: "Экспорт",
  exportProjectPreparing: "Готовим проект к экспорту.",
  exportProjectSuffix: "проект",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  languageAskTitle: "Язык этой книги",
  languageAskLead:
    "На каком языке эти записи? Вы выбираете один раз, и каждый экспорт этой книги использует его.",
  languageSearch: "Поиск языков",
  languageSearchHint: "Название или код",
  languageRow: (name: string, tag: string): string => `${name}, ${tag}`,
  languageLoading: "Загружаются языки.",
  languageLoadFailed: "Не удалось загрузить языки.",
  languageNoMatch: "Языков не найдено. Введите другое название или код.",
  languageNarrow: "Введите больше, чтобы увидеть другие языки.",
  languageCount: (n: number): string =>
    plural(n, {
      one: "Подходит {n} язык.",
      few: "Подходят {n} языка.",
      many: "Подходят {n} языков.",
      other: "Подходят {n} языка.",
    }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      one: `Подходит {n} язык. Показаны первые ${shown}. Введите больше, чтобы сузить поиск.`,
      few: `Подходят {n} языка. Показаны первые ${shown}. Введите больше, чтобы сузить поиск.`,
      many: `Подходят {n} языков. Показаны первые ${shown}. Введите больше, чтобы сузить поиск.`,
      other: `Подходят {n} языка. Показаны первые ${shown}. Введите больше, чтобы сузить поиск.`,
    }),
  languageSaving: "Сохраняем язык.",
  languageAskCancel: "Отмена",
  licenceAskTitle: "Лицензия этой книги",
  licenceAskLead:
    "Кто может делиться этими записями? Вы выбираете один раз для этой книги.",
  licenceAllRightsReserved: "Все права защищены",
  licenceSaving: "Сохраняем лицензию.",
  licenceAskContinue: "Поделиться",
  licenceAskCancel: "Отмена",
  licenceTileLabel: "Изменить лицензию",
  tileLicence: "Лицензия",
  tileTemplates: "Шаблоны",
  licenceAskSave: "Сохранить",
  licenceAskSaveLead:
    "Кто может делиться этими записями? Вы можете изменить это позже.",
  licenceNameCcBySa: "Криэйтив Коммонс, Атрибуция, на тех же условиях 4.0",
  licenceNameCcBy: "Криэйтив Коммонс, Атрибуция 4.0",
  licenceNameCc0: "Криэйтив Коммонс, ноль 1.0, общественное достояние",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  shareNameFallback: "Книга",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "Ваши изменения не сохранены" : "Эта запись не сохранена",
  saveFailedSaving: "Сохранение",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Ваша изменённая запись пока здесь."
        : `Ваша изменённая запись фрагмента ${ordinal} пока здесь.`
      : ordinal === null
        ? "Ваша запись пока здесь."
        : `Ваша запись фрагмента ${ordinal} пока здесь.`,
  saveFailedRetry: "Повторить сохранение",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Нажмите ещё раз, чтобы отбросить эти изменения"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Отбросить эти изменения"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Нажмите ещё раз, чтобы отбросить."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Для ваших изменений нужна новая версия приложения."
      : "Для этой записи нужна новая версия приложения.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Этой книги больше нет. Ваши изменения сохранить нельзя."
      : "Этой книги больше нет. Эту запись сохранить нельзя.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Не удалось сохранить ваши изменения."
      : "Не удалось сохранить эту запись.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Эта копия приложения не может их сохранить. При перезапуске они будут потеряны, но это единственный способ получить новую версию."
      : "Эта копия приложения не может её сохранить. При перезапуске она будет потеряна, но это единственный способ получить новую версию.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Эта книга удалена в другой копии приложения. Выйти можно, только отбросив изменения."
      : "Эта книга удалена в другой копии приложения. Чтобы выйти, удалите эту запись.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "На этом экране единственная копия ваших изменений. Не закрывайте приложение."
      : "На этом экране единственная копия вашей несохранённой работы. Не закрывайте приложение.",
  saveFailedAttempts: (attempts: number): string => `Попыток: ${attempts}`,
  appFailed: "Что-то пошло не так.",
  appReload: "Перезапустить приложение",
  appReloadTeach: "Приложение запустится снова.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Нажмите ещё раз, чтобы перезапустить и потерять эту запись и вырезанный вами звук"
          : "Нажмите ещё раз, чтобы перезапустить и потерять эту запись";
      case "changes":
        return alsoCutAudio
          ? "Нажмите ещё раз, чтобы перезапустить и потерять эти изменения и вырезанный вами звук"
          : "Нажмите ещё раз, чтобы перезапустить и потерять эти изменения";
      case "cutAudio":
        return "Нажмите ещё раз, чтобы перезапустить и потерять вырезанный вами звук";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Нажмите ещё раз, и эта запись и вырезанный вами звук исчезнут."
          : "Нажмите ещё раз, и эта запись исчезнет.";
      case "changes":
        return alsoCutAudio
          ? "Нажмите ещё раз, и эти изменения и вырезанный вами звук исчезнут."
          : "Нажмите ещё раз, и эти изменения исчезнут.";
      case "cutAudio":
        return "Нажмите ещё раз, и вырезанный вами звук исчезнет.";
    }
  },
  appReloading: "Перезапуск…",
  appReloadHeld:
    "Эту проблему пока не удалось сохранить. Отправьте её или повторите.",
  encoderFailing:
    "Этот телефон не смог уменьшить записи. Ничего не потеряно — может помочь перезапуск приложения.",

  // Storage and sharing everything
  storageNotPersisted:
    "Если на телефоне закончится место, он может удалить то, что вы здесь записали. Поделитесь своей работой, когда сможете.",
  storageLow:
    "На этом телефоне заканчивается место. Отметьте фрагменты как готовые, чтобы освободить место, или поделитесь работой и затем удалите её.",
  storageCritical:
    "На этом телефоне почти не осталось места, и новые записи могут не сохраниться. Отметьте фрагменты как готовые или поделитесь работой и затем удалите её.",
  storageShareSoon: "Скоро поделитесь работой",
  shareAll: "Поделиться своей работой",
  shareAllUnconfirmed:
    "Поделиться своей работой. Прошлая попытка не подтверждена — нажмите, чтобы повторить.",
  shareAllPreparing: "Готовим вашу работу, чтобы ею поделиться.",
  shareAllNothing: "Запишите фрагмент, прежде чем делиться своей работой.",
  shareAllFailed: "Не удалось поделиться вашей работой. Повторите попытку.",
  shareAllFailedWeb:
    "Не удалось поделиться вашей работой. Используйте приложение tC Mobile.",
  shareAllStorage:
    "На этом телефоне нет места, чтобы подготовить вашу работу. Отметьте фрагменты как готовые и повторите попытку.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "Не удалось включить {n} книгу.",
      few: "Не удалось включить {n} книги.",
      many: "Не удалось включить {n} книг.",
      other: "Не удалось включить {n} книги.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "Не удалось полностью включить {n} главу.",
      few: "Не удалось полностью включить {n} главы.",
      many: "Не удалось полностью включить {n} глав.",
      other: "Не удалось полностью включить {n} главы.",
    }),
  shareAllFilename: "Моя работа.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Открыта другая копия этого приложения.",
  dbBlockedTeach: "Закройте другую, чтобы продолжить.",
  dbOutOfDate: "Эта копия устарела.",
  dbOutOfDateTeach: "Перезапустите, чтобы использовать новую версию.",

  // About and licences
  aboutOpen: "О приложении и лицензии",
  aboutTitle: "О приложении и лицензии",
  aboutBlurb:
    "Бесплатное приложение с открытым кодом. Всё, что вы записываете, остаётся на этом телефоне.",
  aboutAppLicense: "Это приложение предоставляется по лицензии MIT.",
  aboutSourceOffer:
    "Исходный код этого приложения открыт. Исходный код этой сборки:",
  aboutVisitAppSource: "Открыть исходный код этой сборки на GitHub",
  aboutPrivacy: "Как это приложение обращается с вашими данными:",
  aboutPrivacyLink: "Политика конфиденциальности",
  aboutVisitPrivacy: "Открыть политику конфиденциальности",
  aboutThirdParty: "Компоненты с открытым кодом",
  aboutTexts: "Тексты лицензий",
  aboutQrCaption: "Отсканируйте, чтобы получить приложение",
  aboutContent: "Встроенные материалы",
  aboutReadText: (name: string): string => `Прочитать: ${name}`,
  aboutBack: "Назад к списку",
  aboutTextLoading: "Загружается текст лицензии.",
  aboutTextFailed: "Не удалось загрузить текст лицензии.",
  aboutVisitSource: (name: string): string =>
    `Открыть страницу проекта «${name}»`,
  aboutVisitKeptSource: (name: string): string =>
    `Открыть исходный код «${name}», входящий в эту сборку`,
  aboutVisitLicense: (name: string): string => `Открыть лицензию «${name}»`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "Зафиксирована {n} проблема",
      few: "Зафиксировано {n} проблемы",
      many: "Зафиксировано {n} проблем",
      other: "Зафиксировано {n} проблемы",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Открыть меню. Зафиксирована {n} проблема.",
      few: "Открыть меню. Зафиксировано {n} проблемы.",
      many: "Открыть меню. Зафиксировано {n} проблем.",
      other: "Открыть меню. Зафиксировано {n} проблемы.",
    }),
  failuresTeach: "Отправьте это своему помощнику, если что-то не работает.",
  shareFailureLog: "Отправить отчёт о проблемах",
  shareFailureLogUnconfirmed:
    "Отправить отчёт о проблемах. Прошлая попытка не подтверждена — нажмите, чтобы повторить.",
  shareFailureLogPreparing: "Готовим отчёт о проблемах.",
  shareFailureLogNothing: "Сейчас нечего отправлять.",
  shareFailureLogFailed:
    "Не удалось отправить отчёт о проблемах. Повторите попытку.",
  shareFailureLogRestart:
    "Эту копию больше нельзя использовать. Перезапустите приложение, чтобы получить новую версию.",
  clearFailureLog: "Очистить отчёт о проблемах",
  clearFailureLogConfirmTitle: "Очистить отчёт о проблемах?",
  clearFailureLogConfirm: "Очистить",
  loadFailed: "Не удалось загрузить. Повторите попытку.",
  saveFailed: "Не удалось сохранить. Повторите попытку.",
  noRoom: "На этом телефоне не осталось места.",
  stopToEdit: "Остановите запись, чтобы изменить.",
  stopToErase: "Остановите запись, чтобы сбросить.",
  aboutLanguageCodes: "Коды языков: ISO 639-3, с сайта iso639-3.sil.org.",
  bookNameTaken: "Книга с таким названием уже есть. Введите другое название.",

  // Cover colours and chapter playback
  coverColourLabel: "Цвет обложки",
  coverColourAmber: "Янтарный",
  coverColourTeal: "Бирюзовый",
  coverColourPlum: "Сливовый",
  coverColourForest: "Лесной",
  coverColourBrick: "Кирпичный",
  coverColourSlate: "Сланцевый",
  coverColourRose: "Розовый",
  coverColourOlive: "Оливковый",
  coverColourRust: "Ржавый",
  coverColourCocoa: "Какао",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, выбрано` : name,
  playChapter: (heading: string): string => `Слушать: ${heading}`,
  pauseChapter: (heading: string): string => `Пауза: ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Продолжить: ${heading}, пауза на отметке ${percent} %`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} не воспроизвелось. Нажмите, чтобы повторить`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading}: нечего воспроизводить`,
};
