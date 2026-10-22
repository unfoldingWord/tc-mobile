import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The es table: Latin-American Spanish, drafted by AI under the decisions on
 * #1458 (Q1 and Q3, "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No Spanish reader has checked the meaning (#1585).
 *
 * Register: buttons and labels are the infinitive ("Grabar", "Compartir");
 * sentences that speak to the person use the informal command ("Intenta de
 * nuevo"). Digits are 0 to 9 (R19). Count wording carries the CLDR categories
 * `es` selects: `one`, `many` and `other` (`many` reads as `other`).
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
  newBook: "Libro nuevo",
  menuOpen: "Abrir menú",
  menuTitle: "Menú",
  menuClose: "Cerrar menú",
  settingsOpen: "Ajustes",
  settingsTitle: "Ajustes",
  settingsChapterNumbers: "Mostrar siempre el número de capítulo",
  booksEmpty: "Empieza tu primer libro",
  booksEmptyTeach: "Un libro contiene los capítulos que grabas.",
  loadingBooks: "Cargando tus libros.",
  tryAgain: "Intentar de nuevo",
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
            one: "{name}, {n} capítulo, contraído",
            many: "{name}, {n} capítulos, contraído",
            other: "{name}, {n} capítulos, contraído",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Agregar capítulo a ${bookName}`,
  openChapter: (heading: string): string => `Abrir ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Libro ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Capítulo ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Ir al libro ${book}`,
  goToChapter: (heading: string): string => `Ir a ${heading}`,

  // Naming
  renameBook: "Renombrar libro",
  renameChapter: "Renombrar capítulo",
  renameSegment: "Renombrar segmento",
  bookNameField: "Nombre del libro",
  chapterNameField: "Nombre del capítulo",
  segmentNameField: "Nombre del segmento",
  saveName: "Guardar nombre",
  newBookTitle: "Nombra tu nuevo libro",
  newBookClose: "Cerrar sin crear un libro",
  createBook: "Crear libro",
  newChapterTitle: "Nombra tu nuevo capítulo",
  newChapterClose: "Cerrar sin crear un capítulo",
  createChapter: "Crear capítulo",
  savingName: "Guardando…",
  creatingBook: "Creando tu libro…",

  // Segments screen
  backToBooks: "Volver a los libros",
  addSegment: "Agregar segmento",
  updating: "Actualizando el capítulo.",
  staleChapter: "Este capítulo ya no está disponible. Vuelve a Libros.",
  loadingChapter: "Cargando el capítulo.",
  segmentsEmpty: "Agrega el primer segmento",
  segmentsEmptyTeach:
    "Un segmento es un pasaje del capítulo: grábalo, reprodúcelo y grábalo de nuevo.",
  playSegment: (n: number): string => `Reproducir segmento ${n}`,
  pauseSegment: (n: number): string => `Pausar segmento ${n}`,
  openRecorderSegment: (n: number): string =>
    `Abrir la grabadora para el segmento ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Editar segmento ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Editar segmento ${this.segmentHeading(n, label)}, hecho`;
  },
  openSegment(n: number, label: string | null): string {
    return `Abrir segmento ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Posición en el segmento ${n}`,
  markFinished: (n: number): string => `Marcar el segmento ${n} como hecho`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "No se guardó el nombre. Intenta de nuevo.",

  // Recorder sheet
  recorderDialog: "Grabadora",
  useLightTheme: "Cambiar a la pantalla clara, para la luz del sol",
  useDarkTheme: "Cambiar a la pantalla oscura, para poca luz",
  tileEdit: "Editar",
  tileFinished: "Hecho",
  tileStop: "Detener",
  tileRename: "Renombrar",
  tileErase: "Restablecer",
  tileDelete: "Eliminar",
  tileShare: "Compartir",
  tileAbout: "Acerca de",
  closeRecorder: "Cerrar grabadora",
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
  record: "Grabar",
  stop: "Detener grabación",
  zoomAtWhole: "Vista alejada. Acerca la vista a un cuarto.",
  zoomAtQuarter: "Vista acercada a un cuarto. Aleja la vista.",
  micOffTitle: "Micrófono apagado",
  micRetry: "Intentar de nuevo",
  micBack: "Volver",
  micStepsLabel: "Pasos para activar el micrófono",
  micStepOpenSettings: "Abre la configuración de tu teléfono",
  micStepAndroidApp: "Toca Aplicaciones, luego tC Mobile y luego Permisos",
  micStepIosApp: "Toca Privacidad y seguridad y luego Micrófono",
  micStepIosAppOn: "Activa tC Mobile",
  micStepMicOn: "Activa el micrófono",
  micStepComeBack: "Vuelve aquí y toca Intentar de nuevo",
  finishedWriteFailed: "No se pudo guardar la marca de hecho.",
  recorderSaving: "Guardando…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "Queda {n} min",
      many: "Quedan {n} min",
      other: "Quedan {n} min",
    }),
  loadFailedTitle: "No se pudo abrir esta grabación",
  loadFailedBody:
    "Tu grabación está segura. Intenta de nuevo, o vuelve para restablecerla desde la lista.",
  loadRetry: "Intentar de nuevo",
  loadBack: "Volver",
  loadRetrying: "Abriendo tu grabación…",
  takeRecoverTitle: "Esta grabación aún no se pudo guardar",
  takeRecoverBody:
    "Tu grabación sigue aquí. Intenta de nuevo, o compártela para ponerla a salvo.",
  takeRecoverRetry: "Intentar de nuevo",
  takeRecoverRetrying: "Guardando tu grabación…",
  takeRecoverShare: "Compartir la grabación",
  takeRecoverSharing: "Preparando la grabación…",
  takeShareUnavailable: "Compartir no está disponible en este dispositivo.",
  takeShareFailed: "No se pudo compartir la grabación. Intenta de nuevo.",
  takeRetryFailed: "No se pudo guardar la grabación. Intenta de nuevo.",
  takeRecoverShared: "Grabación compartida.",
  takeRecoverDone: "Hecho",
  takeRecoverDiscard: "Eliminar esta grabación",
  takeRecoverDiscardArmed:
    "Toca de nuevo para eliminar esta grabación para siempre",
  takeRecoverDiscardHint: "Toca de nuevo para eliminarla.",
  playbackFailed: "No se pudo reproducir esta grabación.",
  micNoDevice: "No se encontró un micrófono en este dispositivo.",
  micSiteBlocked:
    "La grabación está bloqueada para esta aplicación. Permite el micrófono en la configuración de sitios de tu navegador y luego intenta de nuevo.",
  micOsBlocked:
    "Tu dispositivo no deja que la aplicación use el micrófono. Revisa el acceso al micrófono en la configuración de tu dispositivo y luego intenta de nuevo.",
  micPrompt:
    "Se necesita acceso al micrófono para grabar. Permítelo cuando te lo pidan o, si ya lo permitiste, revisa la configuración de tu dispositivo.",
  micStartFailed: "No se pudo empezar a grabar.",
  recordingUnsupported: "Este dispositivo no puede grabar audio.",
  playRecording: "Reproducir grabación",
  stopPlayback: "Detener reproducción",
  enterEdit: "Editar grabación",
  leaveEdit: "Dejar de editar",
  editingMarker: "Editando",
  cut: "Cortar la selección",
  auditionSelection: "Reproducir la selección",
  auditionFromLine: "Reproducir desde la línea",
  paste: "Pegar en la línea",
  undo: "Deshacer",
  redo: "Rehacer",
  nothingToUndo: "Nada que deshacer.",
  nothingToRedo: "Nada que rehacer.",
  recorderMenuTitle: "Más",
  recorderMenuOpen: "Más acciones",
  selectionStartHandle: "Inicio de la selección",
  selectionEndHandle: "Fin de la selección",
  editFailed:
    "No se pudo aplicar ese cambio. Prueba con una selección más corta.",
  clearFailed: "No se pudo restablecer el audio. Intenta de nuevo.",
  captureSilence: "No se grabó ningún sonido. Intenta de nuevo.",
  captureUndecodable: "No se pudo leer la grabación en este dispositivo.",
  captureUnfinished: "No se pudo terminar esta grabación.",
  blockedByTake:
    'Usa "Cerrar menú" y luego "Cerrar grabadora" para guardar la grabación.',
  micStarting: "El micrófono todavía se está iniciando.",
  nothingRecorded: "Todavía no hay nada grabado.",
  nothingStored: "No hay nada guardado para restablecer.",
  liveWaveform: "Onda de la grabación en vivo",
  vuMeterLabel: "Nivel de grabación",
  vuMeterUnavailable:
    "El medidor de nivel no está disponible en este dispositivo",
  eraseSegment: "Restablecer segmento y empezar de nuevo",
  rerecord: "Restablecer y grabar de nuevo",
  segmentMenu: (n: number): string => `Más acciones para el segmento ${n}`,
  reorderLifted: (n: number): string => `Moviendo el segmento ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `El segmento ${from} ahora es el segmento ${to}.`,
  reorderStayed: (n: number): string =>
    `El segmento ${n} se quedó donde estaba.`,
  chapterReorderLifted: (n: number): string => `Moviendo el capítulo ${n}.`,
  chapterReorderMoved: (from: number, to: number): string =>
    `El capítulo ${from} ahora es el capítulo ${to}.`,
  chapterReorderStayed: (n: number): string =>
    `El capítulo ${n} se quedó donde estaba.`,
  bookReorderLifted: (heading: string): string => `Moviendo ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} ahora está en la posición ${to} del estante.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} se quedó donde estaba.`,
  eraseConfirmTitle: "Restablecer segmento y empezar de nuevo",
  eraseConfirm: "Restablecer grabación",
  eraseCancel: "Cancelar",
  recordAgainConfirm: "Grabar de nuevo",
  recordAgainKeep: "Conservarla",
  eraseFailed: "No se pudo restablecer la grabación. Intenta de nuevo.",
  eraseConfirmPreviewPlay: "Reproducir lo que se perderá",
  eraseConfirmPreviewPause: "Pausa",
  discardClip: "Descartar el audio cortado",
  discardClipConfirmTitle: "¿Descartar el audio cortado?",
  discardClipConfirm: "Descartar",
  deleteBook: "Eliminar libro",
  deleteBookConfirmTitle: (book: string): string =>
    `¿Eliminar ${book} y todo lo que contiene?`,
  keepBook: "Conservar el libro",
  deleteBookYes: "Sí, eliminar el libro",
  deleteBookFailed: "No se pudo eliminar este libro. Intenta de nuevo.",
  deleteSegment: "Eliminar segmento",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `¿Eliminar el segmento ${ordinal}?`,
  deleteSegmentConfirm: "Eliminar",
  deleteSegmentFailed: "No se pudo eliminar este segmento. Intenta de nuevo.",
  chapterMenuOpen: "Más acciones para este capítulo",
  chapterMenuTitle: "Capítulo",

  // Sharing
  shareChapter: "Compartir capítulo",
  shareChapterUnconfirmed:
    "Compartir capítulo. No se confirmó el último intento: toca para intentar de nuevo.",
  shareSend: "Compartir ahora",
  sharePreparing: "Preparando el capítulo para compartir.",
  shareHandingOver: "Abriendo el menú para compartir del teléfono.",
  sharePreparingLabel: "Preparando para compartir",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `Se comparte {n} de ${all}`,
      many: `Se comparten {n} de ${all}`,
      other: `Se comparten {n} de ${all}`,
    }),
  shareSent: "Entregado al menú para compartir del teléfono.",
  shareDismissed: "Se cerró el menú para compartir antes de enviar nada.",
  shareUnproven:
    "Se cerró el menú para compartir. Este teléfono no puede confirmar que se haya enviado.",
  shareNothing: "Graba un segmento antes de compartir este capítulo.",
  shareFailed: "No se pudo compartir este capítulo. Intenta de nuevo.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "No se pudo incluir {n} segmento.",
      many: "No se pudieron incluir {n} segmentos.",
      other: "No se pudieron incluir {n} segmentos.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Más acciones para ${book}`,
  bookMenuTitle: "Libro",
  shareBook: "Compartir libro",
  shareBookUnconfirmed:
    "Compartir libro. No se confirmó el último intento: toca para intentar de nuevo.",
  shareBookPreparing: "Preparando el libro para compartir.",
  shareBookNothing: "Graba un segmento antes de compartir este libro.",
  shareBookFailed: "No se pudo compartir este libro. Intenta de nuevo.",
  shareBookFailedWeb:
    "No se pudo compartir este libro. Compartir un libro funciona en la aplicación tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "No se pudo incluir {n} capítulo.",
      many: "No se pudieron incluir {n} capítulos.",
      other: "No se pudieron incluir {n} capítulos.",
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
      scope === 1 ? "un capítulo incluido" : `${scope} capítulos incluidos`;
    const partial = plural(segments, {
      one: `No se pudo incluir {n} segmento de ${where}.`,
      many: `No se pudieron incluir {n} segmentos de ${where}.`,
      other: `No se pudieron incluir {n} segmentos de ${where}.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "No se pudo preparar esto para compartir. Intenta de nuevo; si sigue pasando, reinicia la aplicación.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Libro",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly
      ? "Tus cambios no están guardados"
      : "Esta grabación no está guardada",
  saveFailedSaving: "Guardando",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Tu grabación editada sigue aquí."
        : `Tu grabación editada del segmento ${ordinal} sigue aquí.`
      : ordinal === null
        ? "Tu grabación sigue aquí."
        : `Tu grabación del segmento ${ordinal} sigue aquí.`,
  saveFailedRetry: "Intentar guardar de nuevo",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Toca de nuevo para descartar estos cambios"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Descartar estos cambios"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Toca de nuevo para descartarlos."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Tus cambios necesitan la nueva versión de la aplicación."
      : "Esta grabación necesita la nueva versión de la aplicación.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Este libro ya no existe. No se pueden guardar tus cambios."
      : "Este libro ya no existe. No se puede guardar esta grabación.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "No se pudieron guardar tus cambios."
      : "No se pudo guardar esta grabación.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Esta copia de la aplicación no puede guardarlos. Si reinicias, se perderán, pero es la única forma de obtener la nueva versión."
      : "Esta copia de la aplicación no puede guardarla. Si reinicias, se perderá, pero es la única forma de obtener la nueva versión.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Este libro se eliminó en otra copia de la aplicación. Descartar es la única salida."
      : "Este libro se eliminó en otra copia de la aplicación. Elimina esta grabación para salir.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Esta pantalla tiene la única copia de tus cambios. No cierres la aplicación."
      : "Esta pantalla tiene la única copia de tu trabajo sin guardar. No cierres la aplicación.",
  saveFailedAttempts: (attempts: number): string => `Intentos: ${attempts}`,
  appFailed: "Algo salió mal.",
  appReload: "Reiniciar la aplicación",
  appReloadTeach: "La aplicación se iniciará de nuevo.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Toca de nuevo para reiniciar y perder esta grabación y el audio que cortaste"
          : "Toca de nuevo para reiniciar y perder esta grabación";
      case "changes":
        return alsoCutAudio
          ? "Toca de nuevo para reiniciar y perder estos cambios y el audio que cortaste"
          : "Toca de nuevo para reiniciar y perder estos cambios";
      case "cutAudio":
        return "Toca de nuevo para reiniciar y perder el audio que cortaste";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Toca de nuevo y esta grabación y el audio que cortaste desaparecen."
          : "Toca de nuevo y esta grabación desaparece.";
      case "changes":
        return alsoCutAudio
          ? "Toca de nuevo y estos cambios y el audio que cortaste desaparecen."
          : "Toca de nuevo y estos cambios desaparecen.";
      case "cutAudio":
        return "Toca de nuevo y el audio que cortaste desaparece.";
    }
  },
  appReloading: "Reiniciando…",
  appReloadHeld:
    "Este problema aún no se pudo guardar. Envíalo o intenta de nuevo.",
  encoderFailing:
    "Este teléfono no pudo hacer más pequeñas las grabaciones. No se perdió nada; reiniciar la aplicación puede ayudar.",

  // Storage and sharing everything
  storageNotPersisted:
    "Este teléfono puede borrar lo que grabes aquí si se queda sin espacio. Comparte tu trabajo cuando puedas.",
  storageLow:
    "A este teléfono le queda poco espacio. Marca segmentos como hechos para liberar espacio, o comparte tu trabajo y luego quítalo.",
  storageCritical:
    "A este teléfono casi no le queda espacio, y es posible que las grabaciones nuevas no se guarden. Marca los segmentos hechos, o comparte tu trabajo y luego quítalo.",
  storageShareSoon: "Comparte tu trabajo pronto",
  shareAll: "Compartir tu trabajo",
  shareAllUnconfirmed:
    "Compartir tu trabajo. No se confirmó el último intento: toca para intentar de nuevo.",
  shareAllPreparing: "Preparando tu trabajo para compartir.",
  shareAllNothing: "Graba un segmento antes de compartir tu trabajo.",
  shareAllFailed: "No se pudo compartir tu trabajo. Intenta de nuevo.",
  shareAllFailedWeb:
    "No se pudo compartir tu trabajo. Usa la aplicación tC Mobile para compartirlo.",
  shareAllStorage:
    "Este teléfono no tiene espacio para preparar tu trabajo. Marca los segmentos hechos y luego intenta de nuevo.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "No se pudo incluir {n} libro.",
      many: "No se pudieron incluir {n} libros.",
      other: "No se pudieron incluir {n} libros.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "No se pudo incluir completo {n} capítulo.",
      many: "No se pudieron incluir completos {n} capítulos.",
      other: "No se pudieron incluir completos {n} capítulos.",
    }),
  shareAllFilename: "Mi trabajo.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Hay otra copia de esta aplicación abierta.",
  dbBlockedTeach: "Cierra la otra para continuar.",
  dbOutOfDate: "Esta copia está desactualizada.",
  dbOutOfDateTeach: "Reinicia para usar la nueva versión.",

  // About and licences
  aboutOpen: "Acerca de y licencias",
  aboutTitle: "Acerca de y licencias",
  aboutBlurb:
    "Una aplicación gratuita y de código abierto. Todo lo que grabas se queda en este teléfono.",
  aboutAppLicense: "Esta aplicación se ofrece bajo la licencia MIT.",
  aboutSourceOffer:
    "El código fuente de esta aplicación es público. Código fuente de esta versión:",
  aboutVisitAppSource: "Abrir el código fuente de esta versión en GitHub",
  aboutPrivacy: "Cómo trata esta aplicación tus datos:",
  aboutPrivacyLink: "Política de privacidad",
  aboutVisitPrivacy: "Abrir la política de privacidad",
  aboutThirdParty: "Componentes de código abierto",
  aboutTexts: "Textos de licencias",
  aboutContent: "Contenido incluido",
  aboutReadText: (name: string): string => `Leer ${name}`,
  aboutBack: "Volver a la lista",
  aboutTextLoading: "Cargando el texto de la licencia.",
  aboutTextFailed: "No se pudo cargar el texto de la licencia.",
  aboutVisitSource: (name: string): string =>
    `Abrir la página del proyecto ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Abrir el código fuente de ${name} incluido en esta versión`,
  aboutVisitLicense: (name: string): string => `Abrir la licencia de ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} problema registrado",
      many: "{n} problemas registrados",
      other: "{n} problemas registrados",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Abrir menú. {n} problema registrado.",
      many: "Abrir menú. {n} problemas registrados.",
      other: "Abrir menú. {n} problemas registrados.",
    }),
  failuresTeach: "Envía esto a tu ayudante si algo no funciona.",
  shareFailureLog: "Enviar informe de problemas",
  shareFailureLogUnconfirmed:
    "Enviar informe de problemas. No se confirmó el último intento: toca para intentar de nuevo.",
  shareFailureLogPreparing: "Preparando el informe de problemas.",
  shareFailureLogNothing: "No hay nada que enviar ahora.",
  shareFailureLogFailed:
    "No se pudo enviar el informe de problemas. Intenta de nuevo.",
  shareFailureLogRestart:
    "Ya no se puede usar esta copia. Reinicia la aplicación para usar la nueva versión.",
  clearFailureLog: "Borrar informe de problemas",
  clearFailureLogConfirmTitle: "¿Borrar el informe de problemas?",
  clearFailureLogConfirm: "Borrar",
  loadFailed: "No se pudo cargar. Intenta de nuevo.",
  saveFailed: "No se pudo guardar. Intenta de nuevo.",
  noRoom: "No queda espacio en este teléfono.",
  stopToEdit: "Detén la grabación para editar.",
  stopToErase: "Detén la grabación para restablecer.",

  // Cover colours and chapter playback
  coverColourLabel: "Color de la portada",
  coverColourAmber: "Ámbar",
  coverColourTeal: "Turquesa",
  coverColourPlum: "Ciruela",
  coverColourForest: "Bosque",
  coverColourBrick: "Ladrillo",
  coverColourSlate: "Pizarra",
  coverColourRose: "Rosa",
  coverColourOlive: "Oliva",
  coverColourRust: "Óxido",
  coverColourCocoa: "Cacao",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, seleccionado` : name,
  playChapter: (heading: string): string => `Reproducir ${heading}`,
  pauseChapter: (heading: string): string => `Pausar ${heading}`,
  resumeChapter: (heading: string, percent: number): string =>
    `Reanudar ${heading}, en pausa al ${percent} por ciento`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} no tiene nada grabado para reproducir`,
};
