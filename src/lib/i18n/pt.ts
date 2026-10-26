import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The pt table: Brazilian Portuguese, drafted by AI under the decisions on
 * #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md` (section 2 assumes the Brazilian variety; the `pt`
 * registry tag also matches `pt-PT` phones, which this text does not target).
 * No Portuguese reader has checked the meaning (#1597).
 *
 * Register: buttons and labels are the infinitive ("Gravar", "Compartilhar");
 * sentences that speak to the person use the polite command with "você"
 * understood ("Tente de novo"). Digits are 0 to 9 (R19). Count wording carries
 * the CLDR categories `pt` selects: `one`, `many` and `other` (`many` reads as
 * `other`). CLDR `pt` selects `one` for 0 as well as 1, and the noun is
 * singular there, which is the form this table puts on `one`.
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
  newBook: "Novo livro",
  menuOpen: "Abrir menu",
  menuTitle: "Menu",
  menuClose: "Fechar menu",
  settingsOpen: "Configurações",
  settingsTitle: "Configurações",
  templatesOpen: "Modelos",
  templatesTitle: "Modelos",
  templateLicenceLabel: (licence: string): string => `Licença: ${licence}`,
  settingsChapterNumbers: "Mostrar sempre o número do capítulo",
  settingsNormalizeOnFinished: "Igualar o volume ao concluir",
  booksEmpty: "Comece seu primeiro livro",
  booksEmptyTeach: "Um livro contém os capítulos que você grava.",
  loadingBooks: "Carregando seus livros.",
  tryAgain: "Tentar novamente",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} capítulo, expandido",
            many: "{name}, {n} capítulos, expandido",
            other: "{name}, {n} capítulos, expandido",
          }
        : {
            one: "{name}, {n} capítulo, recolhido",
            many: "{name}, {n} capítulos, recolhido",
            other: "{name}, {n} capítulos, recolhido",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Adicionar capítulo a ${bookName}`,
  openChapter: (heading: string): string => `Abrir ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Livro ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Capítulo ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Ir para o livro ${book}`,
  goToChapter: (heading: string): string => `Ir para ${heading}`,

  // Naming
  renameBook: "Renomear livro",
  renameChapter: "Renomear capítulo",
  renameSegment: "Renomear segmento",
  bookNameField: "Nome do livro",
  chapterNameField: "Nome do capítulo",
  segmentNameField: "Nome do segmento",
  saveName: "Salvar nome",
  newBookTitle: "Dê um nome ao seu novo livro",
  newBookClose: "Fechar sem criar um livro",
  createBook: "Criar livro",
  newChapterTitle: "Dê um nome ao seu novo capítulo",
  newChapterClose: "Fechar sem criar um capítulo",
  createChapter: "Criar capítulo",
  savingName: "Salvando…",
  creatingBook: "Criando seu livro…",

  // Segments screen
  backToBooks: "Voltar para os livros",
  addSegment: "Adicionar segmento",
  updating: "Atualizando o capítulo.",
  staleChapter: "Este capítulo não está mais disponível. Volte para Livros.",
  loadingChapter: "Carregando o capítulo.",
  segmentsEmpty: "Adicione o primeiro segmento",
  segmentsEmptyTeach:
    "Um segmento é uma passagem do capítulo: grave, reproduza e grave de novo.",
  playSegment: (n: number): string => `Reproduzir segmento ${n}`,
  pauseSegment: (n: number): string => `Pausar segmento ${n}`,
  openRecorderSegment: (n: number): string =>
    `Abrir o gravador para o segmento ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Editar segmento ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Editar segmento ${this.segmentHeading(n, label)}, concluído`;
  },
  openSegment(n: number, label: string | null): string {
    return `Abrir segmento ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Posição no segmento ${n}`,
  markFinished: (n: number): string => `Marcar o segmento ${n} como concluído`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "O nome não foi salvo. Tente novamente.",

  // Recorder sheet
  recorderDialog: "Gravador",
  useLightTheme: "Mudar para a tela clara, para a luz do sol",
  useDarkTheme: "Mudar para a tela escura, para pouca luz",
  tileEdit: "Editar",
  tileFinished: "Concluído",
  tileStop: "Parar",
  tileRename: "Renomear",
  tileErase: "Redefinir",
  tileDelete: "Excluir",
  tileShare: "Compartilhar",
  tileAbout: "Sobre",
  closeRecorder: "Fechar gravador",
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
  record: "Gravar",
  stop: "Parar gravação",
  zoomAtWhole:
    "Ampliação no segmento inteiro. Aproxime a vista para um quarto.",
  zoomAtQuarter:
    "Ampliação em um quarto. Afaste a vista para o segmento inteiro.",
  micOffTitle: "Microfone desligado",
  micRetry: "Tentar novamente",
  micBack: "Voltar",
  micStepsLabel: "Passos para ativar o microfone",
  micStepOpenSettings: "Abra as configurações do seu celular",
  micStepAndroidApp:
    "Toque em Apps, depois em tC Mobile e depois em Permissões",
  micStepIosApp: "Toque em Privacidade e segurança e depois em Microfone",
  micStepIosAppOn: "Ative o tC Mobile",
  micStepMicOn: "Ative o microfone",
  micStepComeBack: "Volte aqui e toque em Tentar novamente",
  finishedWriteFailed: "Não foi possível salvar a marca de concluído.",
  recorderSaving: "Salvando…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "Resta {n} min",
      many: "Restam {n} min",
      other: "Restam {n} min",
    }),
  loadFailedTitle: "Não foi possível abrir esta gravação",
  loadFailedBody:
    "Sua gravação está segura. Tente novamente, ou volte para redefini-la a partir da lista.",
  loadRetry: "Tentar novamente",
  loadBack: "Voltar",
  loadRetrying: "Abrindo sua gravação…",
  takeRecoverTitle: "Esta gravação ainda não foi salva",
  takeRecoverBody:
    "Sua gravação ainda está aqui. Tente novamente, ou compartilhe-a para mantê-la segura.",
  takeRecoverRetry: "Tentar novamente",
  takeRecoverRetrying: "Salvando sua gravação…",
  takeRecoverShare: "Compartilhar a gravação",
  takeRecoverSharing: "Preparando a gravação…",
  takeShareUnavailable: "Compartilhar não está disponível neste aparelho.",
  takeShareFailed: "Não foi possível compartilhar a gravação. Tente novamente.",
  takeRetryFailed: "Não foi possível salvar a gravação. Tente novamente.",
  takeRecoverShared: "Gravação compartilhada.",
  takeRecoverDone: "Concluído",
  takeRecoverDiscard: "Excluir esta gravação",
  takeRecoverDiscardArmed:
    "Toque de novo para excluir esta gravação para sempre",
  takeRecoverDiscardHint: "Toque de novo para excluí-la.",
  playbackFailed: "Não foi possível reproduzir esta gravação.",
  micNoDevice: "Nenhum microfone foi encontrado neste aparelho.",
  micSiteBlocked:
    "A gravação está bloqueada para este aplicativo. Permita o microfone nas configurações de sites do seu navegador e tente novamente.",
  micOsBlocked:
    "Seu aparelho não deixa o aplicativo usar o microfone. Verifique o acesso ao microfone nas configurações do aparelho e tente novamente.",
  micPrompt:
    "É preciso acesso ao microfone para gravar. Permita quando for solicitado ou, se você já permitiu, verifique as configurações do seu aparelho.",
  micStartFailed: "Não foi possível começar a gravar.",
  recordingUnsupported: "Este aparelho não consegue gravar áudio.",
  playRecording: "Reproduzir gravação",
  stopPlayback: "Parar reprodução",
  enterEdit: "Editar gravação",
  leaveEdit: "Sair da edição",
  editingMarker: "Editando",
  cut: "Cortar a seleção",
  auditionSelection: "Reproduzir a seleção",
  auditionFromLine: "Reproduzir a partir da linha",
  paste: "Colar na linha",
  undo: "Desfazer",
  redo: "Refazer",
  nothingToUndo: "Nada para desfazer.",
  nothingToRedo: "Nada para refazer.",
  recorderMenuTitle: "Mais",
  recorderMenuOpen: "Mais ações",
  selectionStartHandle: "Início da seleção",
  selectionEndHandle: "Fim da seleção",
  editFailed:
    "Não foi possível aplicar essa alteração. Tente uma seleção menor.",
  clearFailed: "Não foi possível redefinir o áudio. Tente novamente.",
  captureSilence: "Nenhum som foi gravado. Tente novamente.",
  captureUndecodable: "Não foi possível ler a gravação neste aparelho.",
  captureUnfinished: "Não foi possível concluir esta gravação.",
  blockedByTake:
    'Use "Fechar menu" e depois "Fechar gravador" para salvar a gravação.',
  micStarting: "O microfone ainda está iniciando.",
  nothingRecorded: "Ainda não há nada gravado.",
  nothingStored: "Não há nada salvo para redefinir.",
  liveWaveform: "Onda da gravação ao vivo",
  vuMeterLabel: "Nível de gravação",
  vuMeterUnavailable: "O medidor de nível não está disponível neste aparelho",
  eraseSegment: "Redefinir segmento e começar de novo",
  rerecord: "Redefinir e gravar de novo",
  segmentMenu: (n: number): string => `Mais ações para o segmento ${n}`,
  reorderLifted: (n: number): string => `Movendo o segmento ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `O segmento ${from} agora é o segmento ${to}.`,
  reorderStayed: (n: number): string => `O segmento ${n} ficou onde estava.`,
  chapterReorderLifted: (n: number): string => `Movendo o capítulo ${n}.`,
  chapterReorderMoved: (n: number, to: number): string =>
    `O capítulo ${n} foi para a posição ${to}.`,
  chapterReorderStayed: (n: number): string =>
    `O capítulo ${n} ficou onde estava.`,
  bookReorderLifted: (heading: string): string => `Movendo ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} agora está na posição ${to} da estante.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} ficou onde estava.`,
  eraseConfirmTitle: "Redefinir segmento e começar de novo",
  eraseConfirm: "Redefinir gravação",
  eraseCancel: "Cancelar",
  recordAgainConfirm: "Gravar de novo",
  recordAgainKeep: "Manter",
  eraseFailed: "Não foi possível redefinir a gravação. Tente novamente.",
  eraseConfirmPreviewPlay: "Reproduzir o que será perdido",
  eraseConfirmPreviewPause: "Pausar",
  discardClip: "Descartar o áudio cortado",
  discardClipConfirmTitle: "Descartar o áudio cortado?",
  discardClipConfirm: "Descartar",
  deleteBook: "Excluir livro",
  deleteBookConfirmTitle: (book: string): string =>
    `Excluir ${book} e tudo o que ele contém?`,
  keepBook: "Manter o livro",
  deleteBookYes: "Sim, excluir o livro",
  deleteBookFailed: "Não foi possível excluir este livro. Tente novamente.",
  deleteSegment: "Excluir segmento",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Excluir o segmento ${ordinal}?`,
  deleteSegmentConfirm: "Excluir",
  deleteSegmentFailed:
    "Não foi possível excluir este segmento. Tente novamente.",
  chapterMenuOpen: "Mais ações para este capítulo",
  chapterMenuTitle: "Capítulo",

  // Sharing
  shareChapter: "Compartilhar capítulo",
  shareChapterUnconfirmed:
    "Compartilhar capítulo. A última tentativa não foi confirmada: toque para tentar novamente.",
  shareSend: "Compartilhar agora",
  sharePreparing: "Preparando o capítulo para compartilhar.",
  shareHandingOver: "Abrindo o menu de compartilhamento do celular.",
  sharePreparingLabel: "Preparando para compartilhar",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `Compartilhando {n} de ${all}`,
      many: `Compartilhando {n} de ${all}`,
      other: `Compartilhando {n} de ${all}`,
    }),
  shareSent: "Entregue ao menu de compartilhamento do celular.",
  shareDismissed:
    "O menu de compartilhamento foi fechado antes de enviar qualquer coisa.",
  shareUnproven:
    "O menu de compartilhamento foi fechado. Este celular não consegue confirmar que foi enviado.",
  shareNothing: "Grave um segmento antes de compartilhar este capítulo.",
  shareFailed: "Não foi possível compartilhar este capítulo. Tente novamente.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "Não foi possível incluir {n} segmento.",
      many: "Não foi possível incluir {n} segmentos.",
      other: "Não foi possível incluir {n} segmentos.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Mais ações para ${book}`,
  bookMenuTitle: "Livro",
  shareBook: "Compartilhar livro",
  shareBookUnconfirmed:
    "Compartilhar livro. A última tentativa não foi confirmada: toque para tentar novamente.",
  shareBookPreparing: "Preparando o livro para compartilhar.",
  exportProject: "Exportar projeto",
  tileExport: "Exportar",
  exportProjectPreparing: "Preparando o projeto para exportar.",
  languageAskTitle: "Idioma deste livro",
  languageAskLead:
    "Em que idioma estão as gravações? Você escolhe uma vez, e cada exportação deste livro usa esse idioma.",
  languageSearch: "Buscar idiomas",
  languageSearchHint: "Nome ou código",
  languageRow: (name: string, tag: string): string => `${name}, ${tag}`,
  languageLoading: "Carregando os idiomas.",
  languageLoadFailed: "Não foi possível carregar os idiomas.",
  languageNoMatch: "Nenhum idioma corresponde. Tente outro nome ou código.",
  languageNarrow: "Digite mais para ver outros idiomas.",
  languageCount: (n: number): string =>
    plural(n, {
      one: "{n} idioma corresponde.",
      many: "{n} idiomas correspondem.",
      other: "{n} idiomas correspondem.",
    }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      one: `{n} idiomas correspondem. Mostrando os primeiros ${shown}. Digite mais para refinar a busca.`,
      many: `{n} idiomas correspondem. Mostrando os primeiros ${shown}. Digite mais para refinar a busca.`,
      other: `{n} idiomas correspondem. Mostrando os primeiros ${shown}. Digite mais para refinar a busca.`,
    }),
  languageSaving: "Salvando o idioma.",
  languageAskCancel: "Cancelar",
  licenceAskTitle: "Licença deste livro",
  licenceAskLead:
    "Quem pode compartilhar estas gravações? Você escolhe uma vez para este livro.",
  licenceAllRightsReserved: "Todos os direitos reservados",
  licenceSaving: "Salvando a licença.",
  licenceAskContinue: "Compartilhar",
  licenceAskCancel: "Cancelar",
  licenceTileLabel: "Alterar licença",
  tileLicence: "Licença",
  tileTemplates: "Modelos",
  licenceAskSave: "Salvar",
  licenceAskSaveLead:
    "Quem pode compartilhar estas gravações? Você pode alterar isso depois.",
  licenceNameCcBySa: "Creative Commons Atribuição-CompartilhaIgual 4.0",
  licenceNameCcBy: "Creative Commons Atribuição 4.0",
  licenceNameCc0: "Creative Commons Zero 1.0, domínio público",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "projeto",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Grave um segmento antes de compartilhar este livro.",
  shareBookFailed: "Não foi possível compartilhar este livro. Tente novamente.",
  shareBookFailedWeb:
    "Não foi possível compartilhar este livro. Compartilhar um livro funciona no aplicativo tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "Não foi possível incluir {n} capítulo.",
      many: "Não foi possível incluir {n} capítulos.",
      other: "Não foi possível incluir {n} capítulos.",
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
    const where =
      scope === 1 ? "um capítulo incluído" : `${scope} capítulos incluídos`;
    const partial = plural(segments, {
      one: `Não foi possível incluir {n} segmento de ${where}.`,
      many: `Não foi possível incluir {n} segmentos de ${where}.`,
      other: `Não foi possível incluir {n} segmentos de ${where}.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Não foi possível preparar isto para compartilhar. Tente novamente; se continuar acontecendo, reinicie o aplicativo.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Livro",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly
      ? "Suas alterações não foram salvas"
      : "Esta gravação não foi salva",
  saveFailedSaving: "Salvando",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Sua gravação editada ainda está aqui."
        : `Sua gravação editada do segmento ${ordinal} ainda está aqui.`
      : ordinal === null
        ? "Sua gravação ainda está aqui."
        : `Sua gravação do segmento ${ordinal} ainda está aqui.`,
  saveFailedRetry: "Tentar salvar novamente",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Toque de novo para descartar estas alterações"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Descartar estas alterações"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Toque de novo para descartá-las."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Suas alterações precisam da nova versão do aplicativo."
      : "Esta gravação precisa da nova versão do aplicativo.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Este livro não existe mais. Não é possível salvar suas alterações."
      : "Este livro não existe mais. Não é possível salvar esta gravação.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Não foi possível salvar suas alterações."
      : "Não foi possível salvar esta gravação.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Esta cópia do aplicativo não consegue salvá-las. Se você reiniciar, elas serão perdidas, mas é a única forma de obter a nova versão."
      : "Esta cópia do aplicativo não consegue salvá-la. Se você reiniciar, ela será perdida, mas é a única forma de obter a nova versão.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Este livro foi excluído em outra cópia do aplicativo. Descartar é a única saída."
      : "Este livro foi excluído em outra cópia do aplicativo. Exclua esta gravação para sair.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Esta tela tem a única cópia das suas alterações. Não feche o aplicativo."
      : "Esta tela tem a única cópia do seu trabalho não salvo. Não feche o aplicativo.",
  saveFailedAttempts: (attempts: number): string => `Tentativas: ${attempts}`,
  appFailed: "Algo deu errado.",
  appReload: "Reiniciar o aplicativo",
  appReloadTeach: "O aplicativo vai iniciar de novo.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Toque de novo para reiniciar e perder esta gravação e o áudio que você cortou"
          : "Toque de novo para reiniciar e perder esta gravação";
      case "changes":
        return alsoCutAudio
          ? "Toque de novo para reiniciar e perder estas alterações e o áudio que você cortou"
          : "Toque de novo para reiniciar e perder estas alterações";
      case "cutAudio":
        return "Toque de novo para reiniciar e perder o áudio que você cortou";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Toque de novo e esta gravação e o áudio que você cortou desaparecem."
          : "Toque de novo e esta gravação desaparece.";
      case "changes":
        return alsoCutAudio
          ? "Toque de novo e estas alterações e o áudio que você cortou desaparecem."
          : "Toque de novo e estas alterações desaparecem.";
      case "cutAudio":
        return "Toque de novo e o áudio que você cortou desaparece.";
    }
  },
  appReloading: "Reiniciando…",
  appReloadHeld:
    "Este problema ainda não foi salvo. Envie-o ou tente novamente.",
  encoderFailing:
    "Este celular não conseguiu reduzir o tamanho das gravações. Nada foi perdido; reiniciar o aplicativo pode ajudar.",

  // Storage and sharing everything
  storageNotPersisted:
    "Este celular pode apagar o que você gravar aqui se ficar sem espaço. Compartilhe seu trabalho quando puder.",
  storageLow:
    "Este celular está com pouco espaço. Marque segmentos como concluídos para liberar espaço, ou compartilhe seu trabalho e depois remova-o.",
  storageCritical:
    "Este celular está quase sem espaço, e novas gravações podem não ser salvas. Marque segmentos como concluídos, ou compartilhe seu trabalho e depois remova-o.",
  storageShareSoon: "Compartilhe seu trabalho em breve",
  shareAll: "Compartilhar seu trabalho",
  shareAllUnconfirmed:
    "Compartilhar seu trabalho. A última tentativa não foi confirmada: toque para tentar novamente.",
  shareAllPreparing: "Preparando seu trabalho para compartilhar.",
  shareAllNothing: "Grave um segmento antes de compartilhar seu trabalho.",
  shareAllFailed:
    "Não foi possível compartilhar seu trabalho. Tente novamente.",
  shareAllFailedWeb:
    "Não foi possível compartilhar seu trabalho. Use o aplicativo tC Mobile para compartilhá-lo.",
  shareAllStorage:
    "Este celular não tem espaço para preparar seu trabalho. Marque segmentos como concluídos e tente novamente.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "Não foi possível incluir {n} livro.",
      many: "Não foi possível incluir {n} livros.",
      other: "Não foi possível incluir {n} livros.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "Não foi possível incluir {n} capítulo completo.",
      many: "Não foi possível incluir {n} capítulos completos.",
      other: "Não foi possível incluir {n} capítulos completos.",
    }),
  shareAllFilename: "Meu trabalho.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Outra cópia deste aplicativo está aberta.",
  dbBlockedTeach: "Feche a outra para continuar.",
  dbOutOfDate: "Esta cópia está desatualizada.",
  dbOutOfDateTeach: "Reinicie para usar a nova versão.",

  // About and licences
  aboutOpen: "Sobre e licenças",
  aboutTitle: "Sobre e licenças",
  aboutBlurb:
    "Um aplicativo gratuito e de código aberto. Tudo o que você grava fica neste celular.",
  aboutAppLicense: "Este aplicativo é oferecido sob a licença MIT.",
  aboutSourceOffer:
    "O código-fonte deste aplicativo é público. Código-fonte desta versão:",
  aboutVisitAppSource: "Abrir o código-fonte desta versão no GitHub",
  aboutPrivacy: "Como este aplicativo trata seus dados:",
  aboutPrivacyLink: "Política de privacidade",
  aboutVisitPrivacy: "Abrir a política de privacidade",
  aboutThirdParty: "Componentes de código aberto",
  aboutTexts: "Textos das licenças",
  aboutQrCaption: "Escaneie para obter o aplicativo",
  aboutContent: "Conteúdo incluído",
  aboutLanguageCodes: "Códigos de idioma: ISO 639-3, de iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Ler ${name}`,
  aboutBack: "Voltar para a lista",
  aboutTextLoading: "Carregando o texto da licença.",
  aboutTextFailed: "Não foi possível carregar o texto da licença.",
  aboutVisitSource: (name: string): string =>
    `Abrir a página do projeto ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Abrir o código-fonte de ${name} incluído nesta versão`,
  aboutVisitLicense: (name: string): string => `Abrir a licença de ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} problema registrado",
      many: "{n} problemas registrados",
      other: "{n} problemas registrados",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Abrir menu. {n} problema registrado.",
      many: "Abrir menu. {n} problemas registrados.",
      other: "Abrir menu. {n} problemas registrados.",
    }),
  failuresTeach: "Envie isto ao seu ajudante se algo não estiver funcionando.",
  shareFailureLog: "Enviar relatório de problemas",
  shareFailureLogUnconfirmed:
    "Enviar relatório de problemas. A última tentativa não foi confirmada: toque para tentar novamente.",
  shareFailureLogPreparing: "Preparando o relatório de problemas.",
  shareFailureLogNothing: "Não há nada para enviar agora.",
  shareFailureLogFailed:
    "Não foi possível enviar o relatório de problemas. Tente novamente.",
  shareFailureLogRestart:
    "Esta cópia não pode mais ser usada. Reinicie o aplicativo para usar a nova versão.",
  clearFailureLog: "Apagar relatório de problemas",
  clearFailureLogConfirmTitle: "Apagar o relatório de problemas?",
  clearFailureLogConfirm: "Apagar",
  loadFailed: "Não foi possível carregar. Tente novamente.",
  saveFailed: "Não foi possível salvar. Tente novamente.",
  noRoom: "Não há mais espaço neste celular.",
  bookNameTaken: "Outro livro tem este nome. Digite um nome diferente.",
  stopToEdit: "Pare a gravação para editar.",
  stopToErase: "Pare a gravação para redefinir.",

  // Cover colours and chapter playback
  coverColourLabel: "Cor da capa",
  coverColourAmber: "Âmbar",
  coverColourTeal: "Turquesa",
  coverColourPlum: "Ameixa",
  coverColourForest: "Floresta",
  coverColourBrick: "Tijolo",
  coverColourSlate: "Ardósia",
  coverColourRose: "Rosa",
  coverColourOlive: "Oliva",
  coverColourRust: "Ferrugem",
  coverColourCocoa: "Cacau",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, selecionado` : name,
  playChapter: (heading: string): string => `Reproduzir ${heading}`,
  pauseChapter: (heading: string): string => `Pausar ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Retomar ${heading}, em pausa em ${percent} por cento`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} não foi reproduzido. Toque para tentar de novo`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} não tem nada gravado para reproduzir`,
};
