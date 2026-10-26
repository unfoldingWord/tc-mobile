import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The zh-Hans table: Simplified Chinese (Mandarin), drafted by AI under the
 * decisions on #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed")
 * and following `docs/i18n/glossary.md`. AI draft, unchecked by a reader: no
 * Chinese reader has checked the meaning.
 *
 * R19 ("Use Arabic numerals; default to simplified text on Chinese phones."):
 * digits are 0 to 9, and this one table also serves a phone set to Traditional
 * Chinese, so the text is Simplified for every Chinese phone.
 *
 * Register: buttons and labels are the bare verb a Chinese phone's own menus
 * use ("录音", "分享", "删除"); a notice about what did not happen says "未能"
 * or "无法" and blames no one; an instruction to the person is the plain
 * "请" request. A book is "书", a chapter "章", a segment "段落" and a
 * recording "录音" (glossary rows 1 to 4). The recorder screen is "录音机",
 * so it does not collide with the verb "录音". Words the glossary keeps as
 * they are stay Latin: "tC Mobile", "MIT", "GitHub" and the file extensions
 * and licence tags in a file name.
 *
 * Plurals: Chinese has one CLDR category, `other`, so every count entry
 * carries that one whole phrase with `{n}`. The English exact-one arm has no
 * Chinese counterpart: no word in a sentence changes with the count.
 *
 * Agreement: Chinese does not inflect, so a free text slot (a book name, a
 * heading) sits inside “” or after a colon only to set it apart from the
 * sentence. Entries that only arrange other entries (`trail`, `sentences`,
 * the filename builders) reuse the English logic through the merged table, so
 * the licence tag and byte budget live in one place. The tester-only phone
 * check stays English by decision (`english-only.ts`) and is not in this file.
 */
export const table: Partial<Strings> & ThisType<Strings> = {
  trail: (...parts: readonly string[]): string => parts.join(" > "),
  sentences: (...parts: readonly string[]): string => parts.join(""),

  // Books screen
  newBook: "新建书",
  menuOpen: "打开菜单",
  menuTitle: "菜单",
  menuClose: "关闭菜单",
  settingsOpen: "设置",
  settingsTitle: "设置",
  templatesOpen: "模板",
  templatesTitle: "模板",
  templateLicenceLabel: (licence: string): string => `许可证：${licence}`,
  settingsChapterNumbers: "始终显示章序号",
  settingsNormalizeOnFinished: "标记完成时均衡音量",
  booksEmpty: "开始你的第一本书",
  booksEmptyTeach: "书里存放你录下的各章。",
  loadingBooks: "正在加载你的书。",
  tryAgain: "重试",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? { other: "{name}，{n} 章，已展开" }
        : { other: "{name}，{n} 章，已收起" }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `向“${bookName}”添加章`,
  openChapter: (heading: string): string => `打开：${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `书 ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `第 ${n} 章`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `前往“${book}”`,
  goToChapter: (heading: string): string => `前往：${heading}`,

  // Naming
  renameBook: "重命名书",
  renameChapter: "重命名章",
  renameSegment: "重命名段落",
  bookNameField: "书的名称",
  chapterNameField: "章的名称",
  segmentNameField: "段落的名称",
  saveName: "保存名称",
  newBookTitle: "给新书起个名称",
  newBookClose: "关闭，不创建书",
  createBook: "创建书",
  newChapterTitle: "给新章起个名称",
  newChapterClose: "关闭，不创建章",
  createChapter: "创建章",
  savingName: "正在保存…",
  creatingBook: "正在创建你的书…",

  // Segments screen
  backToBooks: "返回书列表",
  addSegment: "添加段落",
  updating: "正在更新这一章。",
  staleChapter: "这一章已不可用。请返回书列表。",
  loadingChapter: "正在加载这一章。",
  segmentsEmpty: "添加第一个段落",
  segmentsEmptyTeach: "段落是一章中的一小段：录下来，听一听，需要时再录一次。",
  playSegment: (n: number): string => `播放第 ${n} 段`,
  pauseSegment: (n: number): string => `暂停第 ${n} 段`,
  openRecorderSegment: (n: number): string => `为第 ${n} 段打开录音机`,
  editSegment(n: number, label: string | null): string {
    return `编辑段落 ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `编辑段落 ${this.segmentHeading(n, label)}，已完成`;
  },
  openSegment(n: number, label: string | null): string {
    return `打开段落 ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `第 ${n} 段的播放位置`,
  markFinished: (n: number): string => `第 ${n} 段：标记为“完成”`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "名称未保存。请重试。",

  // Recorder sheet
  recorderDialog: "录音机",
  useLightTheme: "切换到浅色屏幕，适合强烈阳光",
  useDarkTheme: "切换到深色屏幕，适合昏暗光线",
  tileEdit: "编辑",
  tileFinished: "完成",
  tileStop: "停止",
  tileRename: "重命名",
  tileErase: "重置",
  tileDelete: "删除",
  tileShare: "分享",
  tileAbout: "关于",
  closeRecorder: "关闭录音机",
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
  record: "录音",
  stop: "停止录音",
  zoomAtWhole: "已缩小到全部。请放大到四分之一。",
  zoomAtQuarter: "缩放：四分之一。请缩小。",
  micOffTitle: "麦克风已关闭",
  micRetry: "重试",
  micBack: "返回",
  micStepsLabel: "如何打开麦克风",
  micStepOpenSettings: "打开手机上的“设置”",
  micStepAndroidApp: "点“应用”，再点 tC Mobile，再点“权限”",
  micStepIosApp: "点“隐私与安全性”，再点“麦克风”",
  micStepIosAppOn: "打开 tC Mobile",
  micStepMicOn: "打开“麦克风”",
  micStepComeBack: "回到这里，点“重试”",
  finishedWriteFailed: "未能保存“完成”标记。",
  recorderSaving: "正在保存…",
  takeCapWarning: (n: number): string => plural(n, { other: "还剩 {n} 分钟" }),
  loadFailedTitle: "未能打开这段录音",
  loadFailedBody: "你的录音是安全的。请重试，或返回后在列表中重置它。",
  loadRetry: "重试",
  loadBack: "返回",
  loadRetrying: "正在打开你的录音…",
  takeRecoverTitle: "这段录音暂时未能保存",
  takeRecoverBody: "你的录音还在这里。请重试，或把它分享出去以保存下来。",
  takeRecoverRetry: "重试",
  takeRecoverRetrying: "正在保存你的录音…",
  takeRecoverShare: "分享录音",
  takeRecoverSharing: "正在准备录音…",
  takeShareUnavailable: "这台设备无法分享。",
  takeShareFailed: "未能分享这段录音。请重试。",
  takeRetryFailed: "未能保存这段录音。请重试。",
  takeRecoverShared: "你已分享这段录音。",
  takeRecoverDone: "完成",
  takeRecoverDiscard: "删除这段录音",
  takeRecoverDiscardArmed: "再点一次，永久删除这段录音",
  takeRecoverDiscardHint: "再点一次即可删除。",
  playbackFailed: "未能播放这段录音。",
  micNoDevice: "这台设备上找不到麦克风。",
  micSiteBlocked:
    "此应用的录音已被阻止。请在浏览器的网站设置中允许使用麦克风，然后重试。",
  micOsBlocked:
    "设备不允许此应用使用麦克风。请在设备设置中检查麦克风权限，然后重试。",
  micPrompt:
    "录音需要使用麦克风。出现请求时请允许；如果你已经允许过，请检查设备设置。",
  micStartFailed: "未能开始录音。",
  recordingUnsupported: "这台设备无法录音。",
  playRecording: "播放录音",
  stopPlayback: "停止播放",
  enterEdit: "编辑录音",
  leaveEdit: "结束编辑",
  editingMarker: "编辑中",
  cut: "剪切所选部分",
  auditionSelection: "播放所选部分",
  auditionFromLine: "从标线处播放",
  paste: "粘贴到标线处",
  undo: "撤销",
  redo: "重做",
  nothingToUndo: "没有可撤销的操作。",
  nothingToRedo: "没有可重做的操作。",
  recorderMenuTitle: "更多",
  recorderMenuOpen: "更多操作",
  selectionStartHandle: "所选部分的起点",
  selectionEndHandle: "所选部分的终点",
  editFailed: "未能应用这次修改。请选择更短的一段。",
  clearFailed: "未能重置音频。请重试。",
  captureSilence: "没有录到声音。请重试。",
  captureUndecodable: "这台设备无法读取这段录音。",
  captureUnfinished: "未能完成这段录音。",
  blockedByTake: "要保存录音，请先点“关闭菜单”，再点“关闭录音机”。",
  micStarting: "麦克风还在启动。",
  nothingRecorded: "还没有录音。",
  nothingStored: "没有可重置的内容：什么都没有保存。",
  liveWaveform: "正在录音的波形",
  vuMeterLabel: "录音音量",
  vuMeterUnavailable: "这台设备无法显示音量",
  eraseSegment: "重置段落并重新开始",
  rerecord: "重置并重新录音",
  segmentMenu: (n: number): string => `第 ${n} 段的更多操作`,
  reorderLifted: (n: number): string => `正在移动第 ${n} 段。`,
  reorderMoved: (from: number, to: number): string =>
    `第 ${from} 段现在是第 ${to} 段。`,
  reorderStayed: (n: number): string => `第 ${n} 段留在原位。`,
  chapterReorderLifted: (n: number): string => `正在移动第 ${n} 章。`,
  chapterReorderMoved: (n: number, to: number): string =>
    `第 ${n} 章已移到第 ${to} 位。`,
  chapterReorderStayed: (n: number): string => `第 ${n} 章留在原位。`,
  bookReorderLifted: (heading: string): string => `正在移动：“${heading}”。`,
  bookReorderMoved: (heading: string, to: number): string =>
    `“${heading}”现在在书架第 ${to} 位。`,
  bookReorderStayed: (heading: string): string =>
    `“${heading}”在书架上的位置没有变化。`,
  eraseConfirmTitle: "重置段落并重新开始",
  eraseConfirm: "重置录音",
  eraseCancel: "取消",
  recordAgainConfirm: "重新录音",
  recordAgainKeep: "保留",
  eraseFailed: "未能重置这段录音。请重试。",
  eraseConfirmPreviewPlay: "播放将被丢掉的部分",
  eraseConfirmPreviewPause: "暂停",
  discardClip: "丢掉剪切的音频",
  discardClipConfirmTitle: "丢掉剪切的音频？",
  discardClipConfirm: "丢掉",
  deleteBook: "删除书",
  deleteBookConfirmTitle: (book: string): string =>
    `删除“${book}”及其中的所有内容？`,
  keepBook: "保留书",
  deleteBookYes: "是，删除这本书",
  deleteBookFailed: "未能删除这本书。请重试。",
  deleteSegment: "删除段落",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `删除第 ${ordinal} 段？`,
  deleteSegmentConfirm: "删除",
  deleteSegmentFailed: "未能删除这个段落。请重试。",
  chapterMenuOpen: "这一章的更多操作",
  chapterMenuTitle: "章",

  // Sharing
  shareChapter: "分享这一章",
  shareChapterUnconfirmed: "分享这一章。上次尝试未得到确认，点一下可重试。",
  shareSend: "现在分享",
  sharePreparing: "正在准备要分享的这一章。",
  shareHandingOver: "正在打开手机的“分享”菜单。",
  sharePreparingLabel: "正在准备分享",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, { other: `共 ${all} 项，正在发送 {n} 项` }),
  shareSent: "已交给手机的“分享”菜单。",
  shareDismissed: "“分享”菜单已关闭，没有发送任何内容。",
  shareUnproven: "“分享”菜单已关闭。手机无法确认内容是否已发送出去。",
  shareNothing: "分享这一章之前，请先录一个段落。",
  shareFailed: "未能分享这一章。请重试。",
  shareMissing: (n: number): string =>
    plural(n, { other: "有 {n} 个段落未能包含在内。" }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `“${book}”的更多操作`,
  bookMenuTitle: "书",
  shareBook: "分享这本书",
  shareBookUnconfirmed: "分享这本书。上次尝试未得到确认，点一下可重试。",
  shareBookPreparing: "正在准备要分享的这本书。",
  licenceAskTitle: "这本书的许可证",
  licenceAskLead: "谁可以分享这些录音？这本书只需选择一次。",
  licenceAllRightsReserved: "保留所有权利",
  licenceSaving: "正在保存许可证。",
  licenceAskContinue: "分享",
  licenceAskCancel: "取消",
  licenceTileLabel: "更改许可",
  tileLicence: "许可",
  tileTemplates: "模板",
  licenceAskSave: "保存",
  licenceAskSaveLead: "谁可以分享这些录音？你以后可以再更改。",
  licenceNameCcBySa: "知识共享 署名-相同方式共享 4.0",
  licenceNameCcBy: "知识共享 署名 4.0",
  licenceNameCc0: "知识共享 零 1.0，公有领域",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  shareBookNothing: "分享这本书之前，请先录一个段落。",
  shareBookFailed: "未能分享这本书。请重试。",
  shareBookFailedWeb: "未能分享这本书。请在 tC Mobile 应用中分享书。",
  shareBookMissing: (n: number): string =>
    plural(n, { other: "有 {n} 章未能包含在内。" }),
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
      other: `已包含的 ${scope} 章中，有 {n} 个段落未能包含在内。`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "未能准备好要分享的文件。请重试；如果仍然不行，请重新启动应用。",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  exportProject: "导出项目",
  tileExport: "导出",
  exportProjectPreparing: "正在准备要导出的项目。",
  exportProjectSuffix: "项目",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  languageAskTitle: "这本书的语言",
  languageAskLead:
    "这些录音是什么语言？只需选择一次，这本书之后的每次导出都会使用它。",
  languageSearch: "搜索语言",
  languageSearchHint: "名称或代码",
  languageRow: (name: string, tag: string): string => `${name}，${tag}`,
  languageLoading: "正在加载语言。",
  languageLoadFailed: "未能加载语言。",
  languageNoMatch: "没有找到语言。请输入其他名称或代码。",
  languageNarrow: "请多输入几个字，以查看其他语言。",
  languageCount: (n: number): string =>
    plural(n, { one: "{n} 种语言匹配。", other: "{n} 种语言匹配。" }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      other: `{n} 种语言匹配。显示前 ${shown} 种。请多输入几个字，缩小搜索范围。`,
    }),
  languageSaving: "正在保存语言。",
  languageAskCancel: "取消",
  shareNameFallback: "书",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly ? "你的修改未保存" : "这段录音未保存",
  saveFailedSaving: "正在保存",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "你修改后的录音暂时还在这里。"
        : `你修改后的第 ${ordinal} 段录音暂时还在这里。`
      : ordinal === null
        ? "你的录音暂时还在这里。"
        : `你的第 ${ordinal} 段录音暂时还在这里。`,
  saveFailedRetry: "重试保存",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "再点一次，放弃这些修改"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "放弃这些修改"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly ? "再点一次即可放弃。" : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "你的修改需要应用的新版本才能保存。"
      : "这段录音需要应用的新版本才能保存。",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "这本书已不存在。你的修改无法保存。"
      : "这本书已不存在。这段录音无法保存。",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly ? "未能保存你的修改。" : "未能保存这段录音。",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "这个版本的应用无法保存这些修改。重新启动后它们会丢失，但这是获得新版本的唯一办法。"
      : "这个版本的应用无法保存这段录音。重新启动后它会丢失，但这是获得新版本的唯一办法。",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "这本书已在应用的另一个副本中被删除。只有放弃这些修改才能退出。"
      : "这本书已在应用的另一个副本中被删除。要退出，请删除这段录音。",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "这个屏幕上是你修改内容的唯一副本。请不要关闭应用。"
      : "这个屏幕上是你尚未保存的录音的唯一副本。请不要关闭应用。",
  saveFailedAttempts: (attempts: number): string => `已尝试 ${attempts} 次`,
  appFailed: "出了点问题。",
  appReload: "重新启动应用",
  appReloadTeach: "应用会重新启动。",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "再点一次，重新启动，并丢失这段录音和你剪切的音频"
          : "再点一次，重新启动，并丢失这段录音";
      case "changes":
        return alsoCutAudio
          ? "再点一次，重新启动，并丢失这些修改和你剪切的音频"
          : "再点一次，重新启动，并丢失这些修改";
      case "cutAudio":
        return "再点一次，重新启动，并丢失你剪切的音频";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "再点一次，这段录音和你剪切的音频就会消失。"
          : "再点一次，这段录音就会消失。";
      case "changes":
        return alsoCutAudio
          ? "再点一次，这些修改和你剪切的音频就会消失。"
          : "再点一次，这些修改就会消失。";
      case "cutAudio":
        return "再点一次，你剪切的音频就会消失。";
    }
  },
  appReloading: "正在重新启动…",
  appReloadHeld: "这个问题暂时未能保存。请发送出去，或重试。",
  encoderFailing:
    "这部手机未能压缩录音。没有丢失任何内容，重新启动应用可能会有帮助。",

  // Storage and sharing everything
  storageNotPersisted:
    "如果手机空间用完，手机可能会删除你在这里录下的内容。请尽早分享你的作品。",
  storageLow:
    "这部手机的空间快用完了。请把段落标记为完成以腾出空间，或先分享作品再删除。",
  storageCritical:
    "这部手机几乎没有空间了，新的录音可能无法保存。请把段落标记为完成，或先分享作品再删除。",
  storageShareSoon: "请尽快分享作品",
  shareAll: "分享你的作品",
  shareAllUnconfirmed: "分享你的作品。上次尝试未得到确认，点一下可重试。",
  shareAllPreparing: "正在准备要分享的作品。",
  shareAllNothing: "分享作品之前，请先录一个段落。",
  shareAllFailed: "未能分享你的作品。请重试。",
  shareAllFailedWeb: "未能分享你的作品。请使用 tC Mobile 应用。",
  shareAllStorage:
    "这部手机没有足够的空间来准备你的作品。请把段落标记为完成，然后重试。",
  shareAllMissing: (n: number): string =>
    plural(n, { other: "有 {n} 本书未能包含在内。" }),
  shareAllIncomplete: (n: number): string =>
    plural(n, { other: "有 {n} 章未能完整包含在内。" }),
  shareAllFilename: "我的作品.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "此应用的另一个副本已打开。",
  dbBlockedTeach: "请关闭另一个，然后继续。",
  dbOutOfDate: "这个副本已过时。",
  dbOutOfDateTeach: "请重新启动以使用新版本。",

  // About and licences
  aboutOpen: "关于与许可证",
  aboutTitle: "关于与许可证",
  aboutBlurb: "免费的开源应用。你录下的一切都留在这部手机上。",
  aboutAppLicense: "此应用按 MIT 许可证提供。",
  aboutSourceOffer: "此应用的源代码是公开的。这个版本的源代码在这里：",
  aboutVisitAppSource: "在 GitHub 上打开这个版本的源代码",
  aboutPrivacy: "此应用如何处理你的数据：",
  aboutPrivacyLink: "隐私政策",
  aboutVisitPrivacy: "打开隐私政策",
  aboutThirdParty: "开源组件",
  aboutTexts: "许可证文本",
  aboutQrCaption: "扫描二维码获取应用",
  aboutContent: "内置内容",
  aboutReadText: (name: string): string => `阅读：${name}`,
  aboutBack: "返回列表",
  aboutTextLoading: "正在加载许可证文本。",
  aboutTextFailed: "未能加载许可证文本。",
  aboutVisitSource: (name: string): string => `打开“${name}”的项目页面`,
  aboutVisitKeptSource: (name: string): string =>
    `打开此版本所含“${name}”的源代码`,
  aboutVisitLicense: (name: string): string => `打开“${name}”的许可证`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, { other: "已记录 {n} 个问题" }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, { other: "打开菜单。已记录 {n} 个问题。" }),
  failuresTeach: "如果有东西出了问题，请把这个发给帮助你的人。",
  shareFailureLog: "发送问题报告",
  shareFailureLogUnconfirmed:
    "发送问题报告。上次尝试未得到确认，点一下可重试。",
  shareFailureLogPreparing: "正在准备问题报告。",
  shareFailureLogNothing: "现在没有可发送的内容。",
  shareFailureLogFailed: "未能发送问题报告。请重试。",
  shareFailureLogRestart:
    "这个副本已无法继续使用。请重新启动应用以获得新版本。",
  clearFailureLog: "清除问题报告",
  clearFailureLogConfirmTitle: "清除问题报告？",
  clearFailureLogConfirm: "清除",
  loadFailed: "未能加载。请重试。",
  saveFailed: "未能保存。请重试。",
  noRoom: "这部手机没有空间了。",
  stopToEdit: "请先停止录音，再编辑。",
  stopToErase: "请先停止录音，再重置。",
  aboutLanguageCodes: "语言代码：ISO 639-3，来自 iso639-3.sil.org。",
  bookNameTaken: "已有同名的书。请输入另一个名称。",

  // Cover colours and chapter playback
  coverColourLabel: "封面颜色",
  coverColourAmber: "琥珀色",
  coverColourTeal: "青绿色",
  coverColourPlum: "梅子色",
  coverColourForest: "森林绿",
  coverColourBrick: "砖红色",
  coverColourSlate: "石板灰",
  coverColourRose: "玫瑰色",
  coverColourOlive: "橄榄绿",
  coverColourRust: "锈红色",
  coverColourCocoa: "可可色",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}，已选中` : name,
  playChapter: (heading: string): string => `播放：${heading}`,
  pauseChapter: (heading: string): string => `暂停：${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `继续：${heading}，已暂停在 ${percent} %`,
  chapterPlayFailed: (heading: string): string =>
    `${heading}未能播放。点按重试`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading}：没有可播放的内容`,
};
