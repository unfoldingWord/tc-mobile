import { plural } from "@/lib/plural";
import { stringsEn, type Strings } from "@/lib/strings";
import { filenameSafe } from "@/lib/utils";

/**
 * The fr table: French, drafted by AI under the decisions on #1458 (Q1 and Q3,
 * "Use AI to draft, we'll revise as-needed") and following
 * `docs/i18n/glossary.md`. No French reader has checked the meaning (#1590).
 *
 * Register: buttons and labels are the infinitive ("Enregistrer",
 * "Partager"); sentences that speak to the person use the polite command
 * ("Réessayez"). "Enregistrer" is Record, so Save is "Sauvegarder" everywhere
 * (glossary row 21), and "Annuler" is Cancel, so Undo is "Défaire" (row 16).
 * Digits are 0 to 9 (R19). Count wording carries the CLDR categories `fr`
 * selects: `one`, `many` and `other` (`many` reads as `other`).
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
  newBook: "Nouveau livre",
  menuOpen: "Ouvrir le menu",
  menuTitle: "Menu",
  menuClose: "Fermer le menu",
  settingsOpen: "Réglages",
  settingsTitle: "Réglages",
  templatesOpen: "Modèles",
  templatesTitle: "Modèles",
  templateLicenceLabel: (licence: string): string => `Licence : ${licence}`,
  settingsChapterNumbers: "Toujours afficher le numéro de chapitre",
  settingsNormalizeOnFinished: "Égaliser le volume une fois terminé",
  booksEmpty: "Commencez votre premier livre",
  booksEmptyTeach: "Un livre contient les chapitres que vous enregistrez.",
  loadingBooks: "Chargement de vos livres.",
  tryAgain: "Réessayer",
  bookRow: (name: string, chapters: number, expanded: boolean): string =>
    plural(
      chapters,
      expanded
        ? {
            one: "{name}, {n} chapitre, déplié",
            many: "{name}, {n} chapitres, déplié",
            other: "{name}, {n} chapitres, déplié",
          }
        : {
            one: "{name}, {n} chapitre, replié",
            many: "{name}, {n} chapitres, replié",
            other: "{name}, {n} chapitres, replié",
          }
    ).replace("{name}", () => name),
  addChapter: (bookName: string): string => `Ajouter un chapitre à ${bookName}`,
  openChapter: (heading: string): string => `Ouvrir ${heading}`,
  bookHeading: (name: string | null, number: number | null): string =>
    name ?? (number === null ? "" : `Livre ${String(number).padStart(3, "0")}`),
  chapterName: (n: number): string => `Chapitre ${n}`,
  chapterHeading(name: string | null, n: number): string {
    return name ?? this.chapterName(n);
  },
  chapterBreadcrumb(book: string, chapter: string): string {
    return this.trail(book, chapter);
  },
  goToBook: (book: string): string => `Aller au livre ${book}`,
  goToChapter: (heading: string): string => `Aller à ${heading}`,

  // Naming
  renameBook: "Renommer le livre",
  renameChapter: "Renommer le chapitre",
  renameSegment: "Renommer le segment",
  bookNameField: "Nom du livre",
  chapterNameField: "Nom du chapitre",
  segmentNameField: "Nom du segment",
  saveName: "Sauvegarder le nom",
  newBookTitle: "Donnez un nom à votre nouveau livre",
  newBookClose: "Fermer sans créer de livre",
  createBook: "Créer le livre",
  newChapterTitle: "Donnez un nom à votre nouveau chapitre",
  newChapterClose: "Fermer sans créer de chapitre",
  createChapter: "Créer le chapitre",
  savingName: "Sauvegarde…",
  creatingBook: "Création de votre livre…",

  // Segments screen
  backToBooks: "Retour aux livres",
  addSegment: "Ajouter un segment",
  updating: "Mise à jour du chapitre.",
  staleChapter: "Ce chapitre n'est plus disponible. Retournez aux livres.",
  loadingChapter: "Chargement du chapitre.",
  segmentsEmpty: "Ajoutez le premier segment",
  segmentsEmptyTeach:
    "Un segment est un passage du chapitre : enregistrez-le, lisez-le, puis enregistrez-le encore.",
  playSegment: (n: number): string => `Lire le segment ${n}`,
  pauseSegment: (n: number): string => `Mettre le segment ${n} en pause`,
  openRecorderSegment: (n: number): string =>
    `Ouvrir l'enregistreur pour le segment ${n}`,
  editSegment(n: number, label: string | null): string {
    return `Modifier le segment ${this.segmentHeading(n, label)}`;
  },
  editSegmentFinished(n: number, label: string | null): string {
    return `Modifier le segment ${this.segmentHeading(n, label)}, terminé`;
  },
  openSegment(n: number, label: string | null): string {
    return `Ouvrir le segment ${this.segmentHeading(n, label)}`;
  },
  scrubSegment: (n: number): string => `Position dans le segment ${n}`,
  markFinished: (n: number): string => `Marquer le segment ${n} comme terminé`,
  segmentHeading: (n: number, label: string | null): string =>
    label == null ? `${n}` : `${n} · ${label}`,
  renameSegmentFailed: "Le nom n'a pas été sauvegardé. Réessayez.",

  // Recorder sheet
  recorderDialog: "Enregistreur",
  useLightTheme: "Passer à l'écran clair, pour le plein soleil",
  useDarkTheme: "Passer à l'écran sombre, pour peu de lumière",
  tileEdit: "Modifier",
  tileFinished: "Terminé",
  tileStop: "Arrêter",
  tileRename: "Renommer",
  tileErase: "Réinitialiser",
  tileDelete: "Supprimer",
  tileShare: "Partager",
  tileAbout: "À propos",
  closeRecorder: "Fermer l'enregistreur",
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
  record: "Enregistrer",
  stop: "Arrêter l'enregistrement",
  zoomAtWhole: "Zoom normal. Zoomez pour agrandir.",
  zoomAtQuarter: "Zoom agrandi. Dézoomez pour revenir au zoom normal.",
  micOffTitle: "Microphone éteint",
  micRetry: "Réessayer",
  micBack: "Retour",
  micStepsLabel: "Étapes pour activer le microphone",
  micStepOpenSettings: "Ouvrez les réglages de votre téléphone",
  micStepAndroidApp: "Touchez Applications, puis tC Mobile, puis Autorisations",
  micStepIosApp: "Touchez Confidentialité et sécurité, puis Microphone",
  micStepIosAppOn: "Activez tC Mobile",
  micStepMicOn: "Activez le microphone",
  micStepComeBack: "Revenez ici et touchez Réessayer",
  finishedWriteFailed: "La marque « terminé » n'a pas pu être sauvegardée.",
  recorderSaving: "Sauvegarde…",
  takeCapWarning: (n: number): string =>
    plural(n, {
      one: "Il reste {n} min",
      many: "Il reste {n} min",
      other: "Il reste {n} min",
    }),
  loadFailedTitle: "Cet enregistrement n'a pas pu s'ouvrir",
  loadFailedBody:
    "Votre enregistrement est en sécurité. Réessayez, ou retournez à la liste pour le réinitialiser.",
  loadRetry: "Réessayer",
  loadBack: "Retour",
  loadRetrying: "Ouverture de votre enregistrement…",
  takeRecoverTitle: "Cet enregistrement n'a pas encore pu être sauvegardé",
  takeRecoverBody:
    "Votre enregistrement est toujours là. Réessayez, ou partagez-le pour le mettre à l'abri.",
  takeRecoverRetry: "Réessayer",
  takeRecoverRetrying: "Sauvegarde de votre enregistrement…",
  takeRecoverShare: "Partager l'enregistrement",
  takeRecoverSharing: "Préparation de l'enregistrement…",
  takeShareUnavailable: "Le partage n'est pas disponible sur cet appareil.",
  takeShareFailed: "L'enregistrement n'a pas pu être partagé. Réessayez.",
  takeRetryFailed: "L'enregistrement n'a pas pu être sauvegardé. Réessayez.",
  takeRecoverShared: "Enregistrement partagé.",
  takeRecoverDone: "Terminé",
  takeRecoverDiscard: "Supprimer cet enregistrement",
  takeRecoverDiscardArmed:
    "Touchez encore pour supprimer cet enregistrement pour toujours",
  takeRecoverDiscardHint: "Touchez encore pour le supprimer.",
  playbackFailed: "Cet enregistrement n'a pas pu être lu.",
  micNoDevice: "Aucun microphone n'a été trouvé sur cet appareil.",
  micSiteBlocked:
    "L'enregistrement est bloqué pour cette application. Autorisez le microphone dans les réglages des sites de votre navigateur, puis réessayez.",
  micOsBlocked:
    "Votre appareil ne laisse pas l'application utiliser le microphone. Vérifiez l'accès au microphone dans les réglages de votre appareil, puis réessayez.",
  micPrompt:
    "L'accès au microphone est nécessaire pour enregistrer. Autorisez-le quand on vous le demande ou, si c'est déjà fait, vérifiez les réglages de votre appareil.",
  micStartFailed: "L'enregistrement n'a pas pu commencer.",
  recordingUnsupported: "Cet appareil ne peut pas enregistrer de son.",
  playRecording: "Lire l'enregistrement",
  stopPlayback: "Arrêter la lecture",
  enterEdit: "Modifier l'enregistrement",
  leaveEdit: "Quitter la modification",
  editingMarker: "Modification",
  cut: "Couper la sélection",
  auditionSelection: "Lire la sélection",
  auditionFromLine: "Lire à partir de la ligne",
  paste: "Coller sur la ligne",
  undo: "Défaire",
  redo: "Refaire",
  nothingToUndo: "Rien à défaire.",
  nothingToRedo: "Rien à refaire.",
  recorderMenuTitle: "Plus",
  recorderMenuOpen: "Plus d'actions",
  selectionStartHandle: "Début de la sélection",
  selectionEndHandle: "Fin de la sélection",
  selectionHandleTime: (n: number): string =>
    plural(n, {
      one: "{n} seconde",
      many: "{n} secondes",
      other: "{n} secondes",
    }),
  editFailed:
    "Ce changement n'a pas pu être appliqué. Essayez avec une sélection plus courte.",
  clearFailed: "Le son n'a pas pu être réinitialisé. Réessayez.",
  captureSilence: "Aucun son n'a été enregistré. Réessayez.",
  captureUndecodable: "L'enregistrement n'a pas pu être lu sur cet appareil.",
  captureUnfinished: "Cet enregistrement n'a pas pu être terminé.",
  blockedByTake:
    "Utilisez « Fermer le menu » puis « Fermer l'enregistreur » pour sauvegarder l'enregistrement.",
  micStarting: "Le microphone démarre encore.",
  nothingRecorded: "Rien n'est encore enregistré.",
  nothingStored: "Rien n'est sauvegardé à réinitialiser.",
  liveWaveform: "Onde de l'enregistrement en direct",
  vuMeterLabel: "Niveau d'enregistrement",
  vuMeterUnavailable:
    "L'indicateur de niveau n'est pas disponible sur cet appareil",
  eraseSegment: "Réinitialiser le segment et recommencer",
  rerecord: "Réinitialiser et enregistrer encore",
  segmentMenu: (n: number): string => `Plus d'actions pour le segment ${n}`,
  reorderLifted: (n: number): string => `Déplacement du segment ${n}.`,
  reorderMoved: (from: number, to: number): string =>
    `Le segment ${from} est maintenant le segment ${to}.`,
  reorderStayed: (n: number): string => `Le segment ${n} est resté à sa place.`,
  chapterReorderLifted: (n: number): string => `Déplacement du chapitre ${n}.`,
  chapterReorderMoved: (n: number, to: number): string =>
    `Le chapitre ${n} est passé à la place ${to}.`,
  chapterReorderStayed: (n: number): string =>
    `Le chapitre ${n} est resté à sa place.`,
  bookReorderLifted: (heading: string): string => `Déplacement de ${heading}.`,
  bookReorderMoved: (heading: string, to: number): string =>
    `${heading} est maintenant à la place ${to} de l'étagère.`,
  bookReorderStayed: (heading: string): string =>
    `${heading} est resté à sa place.`,
  eraseConfirmTitle: "Réinitialiser le segment et recommencer",
  eraseConfirm: "Réinitialiser l'enregistrement",
  eraseCancel: "Annuler",
  recordAgainConfirm: "Enregistrer encore",
  recordAgainKeep: "Le garder",
  eraseFailed: "L'enregistrement n'a pas pu être réinitialisé. Réessayez.",
  eraseConfirmPreviewPlay: "Lire ce qui sera perdu",
  eraseConfirmPreviewPause: "Pause",
  discardClip: "Jeter le son coupé",
  discardClipConfirmTitle: "Jeter le son coupé ?",
  discardClipConfirm: "Jeter",
  deleteBook: "Supprimer le livre",
  deleteBookConfirmTitle: (book: string): string =>
    `Supprimer ${book} et tout ce qu'il contient ?`,
  keepBook: "Garder le livre",
  deleteBookYes: "Oui, supprimer le livre",
  deleteBookFailed: "Ce livre n'a pas pu être supprimé. Réessayez.",
  deleteSegment: "Supprimer le segment",
  deleteSegmentConfirmTitle: (ordinal: number): string =>
    `Supprimer le segment ${ordinal} ?`,
  deleteSegmentConfirm: "Supprimer",
  deleteSegmentFailed: "Ce segment n'a pas pu être supprimé. Réessayez.",
  chapterMenuOpen: "Plus d'actions pour ce chapitre",
  chapterMenuTitle: "Chapitre",

  // Sharing
  shareChapter: "Partager le chapitre",
  shareChapterUnconfirmed:
    "Partager le chapitre. Le dernier essai n'est pas confirmé : touchez pour réessayer.",
  shareSend: "Partager maintenant",
  sharePreparing: "Préparation du chapitre à partager.",
  shareHandingOver: "Ouverture du menu de partage du téléphone.",
  sharePreparingLabel: "Préparation du partage",
  shareItemsGoOut: (out: number, all: number): string =>
    plural(out, {
      one: `Partage de {n} sur ${all}`,
      many: `Partage de {n} sur ${all}`,
      other: `Partage de {n} sur ${all}`,
    }),
  shareSent: "Remis au menu de partage du téléphone.",
  shareDismissed: "Le menu de partage a été fermé avant tout envoi.",
  shareUnproven:
    "Le menu de partage a été fermé. Ce téléphone ne peut pas confirmer que l'envoi a eu lieu.",
  shareNothing: "Enregistrez un segment avant de partager ce chapitre.",
  shareFailed: "Ce chapitre n'a pas pu être partagé. Réessayez.",
  shareMissing: (n: number): string =>
    plural(n, {
      one: "{n} segment n'a pas pu être inclus.",
      many: "{n} segments n'ont pas pu être inclus.",
      other: "{n} segments n'ont pas pu être inclus.",
    }),
  shareFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareFilename>
  ): string {
    return stringsEn.shareFilename.apply(this, args);
  },
  bookMenuOpen: (book: string): string => `Plus d'actions pour ${book}`,
  bookMenuTitle: "Livre",
  shareBook: "Partager le livre",
  shareBookUnconfirmed:
    "Partager le livre. Le dernier essai n'est pas confirmé : touchez pour réessayer.",
  shareBookPreparing: "Préparation du livre à partager.",
  exportProject: "Exporter le projet",
  tileExport: "Exporter",
  exportProjectPreparing: "Préparation du projet à exporter.",
  languageAskTitle: "Langue de ce livre",
  languageAskLead:
    "Dans quelle langue sont les enregistrements ? Vous la choisissez une fois, et chaque exportation de ce livre l’utilise.",
  languageSearch: "Rechercher une langue",
  languageSearchHint: "Nom ou code",
  languageLoading: "Chargement des langues.",
  languageLoadFailed: "Impossible de charger les langues.",
  languageNoMatch: "Aucune langue ne correspond. Essayez un autre nom ou code.",
  languageNarrow: "Tapez plus pour voir d’autres langues.",
  languageCount: (n: number): string =>
    plural(n, {
      one: "{n} langue correspond.",
      many: "{n} langues correspondent.",
      other: "{n} langues correspondent.",
    }),
  languageCountMore: (n: number, shown: number): string =>
    plural(n, {
      one: `{n} langues correspondent. Les ${shown} premières sont affichées. Tapez plus pour préciser la recherche.`,
      many: `{n} langues correspondent. Les ${shown} premières sont affichées. Tapez plus pour préciser la recherche.`,
      other: `{n} langues correspondent. Les ${shown} premières sont affichées. Tapez plus pour préciser la recherche.`,
    }),
  languageSaving: "Sauvegarde de la langue.",
  languageAskCancel: "Annuler",
  licenceAskTitle: "Licence de ce livre",
  licenceAskLead:
    "Qui peut partager ces enregistrements ? Vous choisissez une fois pour ce livre.",
  licenceAllRightsReserved: "Tous droits réservés",
  licenceSaving: "Sauvegarde de la licence.",
  licenceAskContinue: "Partager",
  licenceAskCancel: "Annuler",
  licenceTileLabel: "Changer la licence",
  tileLicence: "Licence",
  tileTemplates: "Modèles",
  licenceAskSave: "Enregistrer",
  licenceAskSaveLead:
    "Qui peut partager ces enregistrements ? Vous pouvez le modifier plus tard.",
  licenceNameCcBySa:
    "Licence Creative Commons Attribution, Partage dans les mêmes conditions 4.0",
  licenceNameCcBy: "Licence Creative Commons Attribution 4.0",
  licenceNameCc0: "Licence Creative Commons Zéro 1.0, domaine public",
  licenceChoiceName: (name: string, label: string): string =>
    `${name} (${label})`,
  exportProjectSuffix: "projet",
  exportProjectFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.exportProjectFilename>
  ): string {
    return stringsEn.exportProjectFilename.apply(this, args);
  },
  shareBookNothing: "Enregistrez un segment avant de partager ce livre.",
  shareBookFailed: "Ce livre n'a pas pu être partagé. Réessayez.",
  shareBookFailedWeb:
    "Ce livre n'a pas pu être partagé. Le partage d'un livre fonctionne dans l'application tC Mobile.",
  shareBookMissing: (n: number): string =>
    plural(n, {
      one: "{n} chapitre n'a pas pu être inclus.",
      many: "{n} chapitres n'ont pas pu être inclus.",
      other: "{n} chapitres n'ont pas pu être inclus.",
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
      scope === 1 ? "un chapitre inclus" : `${scope} chapitres inclus`;
    const partial = plural(segments, {
      one: `{n} segment de ${where} n'a pas pu être inclus.`,
      many: `{n} segments de ${where} n'ont pas pu être inclus.`,
      other: `{n} segments de ${where} n'ont pas pu être inclus.`,
    });
    return this.sentences(this.shareBookMissing(chapters), partial);
  },
  shareEncoderStopped:
    "Le partage n'a pas pu être préparé. Réessayez ; si cela continue, redémarrez l'application.",
  shareBookFilename(
    this: Strings,
    ...args: Parameters<typeof stringsEn.shareBookFilename>
  ): string {
    return stringsEn.shareBookFilename.apply(this, args);
  },
  shareNameFallback: "Livre",

  // Save and recovery
  saveFailedDialog: (editOnly: boolean): string =>
    editOnly
      ? "Vos changements ne sont pas sauvegardés"
      : "Cet enregistrement n'est pas sauvegardé",
  saveFailedSaving: "Sauvegarde",
  saveFailedHeld: (editOnly: boolean, ordinal: number | null): string =>
    editOnly
      ? ordinal === null
        ? "Votre enregistrement modifié est toujours là."
        : `Votre enregistrement modifié du segment ${ordinal} est toujours là.`
      : ordinal === null
        ? "Votre enregistrement est toujours là."
        : `Votre enregistrement du segment ${ordinal} est toujours là.`,
  saveFailedRetry: "Réessayer de sauvegarder",
  saveFailedDiscard(editOnly: boolean, armed: boolean): string {
    return armed
      ? editOnly
        ? "Touchez encore pour abandonner ces changements"
        : this.takeRecoverDiscardArmed
      : editOnly
        ? "Abandonner ces changements"
        : this.takeRecoverDiscard;
  },
  saveFailedDiscardHint(editOnly: boolean): string {
    return editOnly
      ? "Touchez encore pour les abandonner."
      : this.takeRecoverDiscardHint;
  },
  saveFailedNeedsUpdate: (editOnly: boolean): string =>
    editOnly
      ? "Vos changements ont besoin de la nouvelle version de l'application."
      : "Cet enregistrement a besoin de la nouvelle version de l'application.",
  saveFailedBookGone: (editOnly: boolean): string =>
    editOnly
      ? "Ce livre n'existe plus. Vos changements ne peuvent pas être sauvegardés."
      : "Ce livre n'existe plus. Cet enregistrement ne peut pas être sauvegardé.",
  saveFailedUnknown: (editOnly: boolean): string =>
    editOnly
      ? "Vos changements n'ont pas pu être sauvegardés."
      : "Cet enregistrement n'a pas pu être sauvegardé.",
  saveFailedUpdateLoses: (editOnly: boolean): string =>
    editOnly
      ? "Cette copie de l'application ne peut pas les sauvegarder. Si vous redémarrez, ils seront perdus, mais c'est le seul moyen d'obtenir la nouvelle version."
      : "Cette copie de l'application ne peut pas le sauvegarder. Si vous redémarrez, il sera perdu, mais c'est le seul moyen d'obtenir la nouvelle version.",
  saveFailedBookDeleted: (editOnly: boolean): string =>
    editOnly
      ? "Ce livre a été supprimé dans une autre copie de l'application. Abandonner est la seule issue."
      : "Ce livre a été supprimé dans une autre copie de l'application. Supprimez cet enregistrement pour sortir.",
  saveFailedOnlyCopy: (editOnly: boolean): string =>
    editOnly
      ? "Cet écran a la seule copie de vos changements. Ne fermez pas l'application."
      : "Cet écran a la seule copie de votre travail non sauvegardé. Ne fermez pas l'application.",
  saveFailedAttempts: (attempts: number): string => `Essais : ${attempts}`,
  appFailed: "Quelque chose s'est mal passé.",
  appReload: "Redémarrer l'application",
  appReloadTeach: "L'application va démarrer de nouveau.",
  restartArmed: (
    subject: Parameters<typeof stringsEn.restartArmed>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Touchez encore pour redémarrer et perdre cet enregistrement et le son que vous avez coupé"
          : "Touchez encore pour redémarrer et perdre cet enregistrement";
      case "changes":
        return alsoCutAudio
          ? "Touchez encore pour redémarrer et perdre ces changements et le son que vous avez coupé"
          : "Touchez encore pour redémarrer et perdre ces changements";
      case "cutAudio":
        return "Touchez encore pour redémarrer et perdre le son que vous avez coupé";
    }
  },
  restartGone: (
    subject: Parameters<typeof stringsEn.restartGone>[0],
    alsoCutAudio: boolean
  ): string => {
    switch (subject) {
      case "recording":
        return alsoCutAudio
          ? "Touchez encore et cet enregistrement et le son que vous avez coupé disparaissent."
          : "Touchez encore et cet enregistrement disparaît.";
      case "changes":
        return alsoCutAudio
          ? "Touchez encore et ces changements et le son que vous avez coupé disparaissent."
          : "Touchez encore et ces changements disparaissent.";
      case "cutAudio":
        return "Touchez encore et le son que vous avez coupé disparaît.";
    }
  },
  appReloading: "Redémarrage…",
  appReloadHeld:
    "Ce problème n'a pas encore pu être sauvegardé. Envoyez-le ou réessayez.",
  encoderFailing:
    "Ce téléphone n'a pas pu alléger les enregistrements. Rien n'est perdu ; redémarrer l'application peut aider.",

  // Storage and sharing everything
  storageNotPersisted:
    "Ce téléphone peut effacer ce que vous enregistrez ici s'il manque d'espace. Partagez votre travail dès que possible.",
  storageLow:
    "Il reste peu d'espace sur ce téléphone. Marquez des segments comme terminés pour libérer de l'espace, ou partagez votre travail puis retirez-le.",
  storageCritical:
    "Il ne reste presque plus d'espace sur ce téléphone, et les nouveaux enregistrements risquent de ne pas être sauvegardés. Marquez des segments comme terminés, ou partagez votre travail puis retirez-le.",
  storageShareSoon: "Partagez votre travail bientôt",
  shareAll: "Partager votre travail",
  shareAllUnconfirmed:
    "Partager votre travail. Le dernier essai n'est pas confirmé : touchez pour réessayer.",
  shareAllPreparing: "Préparation de votre travail à partager.",
  shareAllNothing: "Enregistrez un segment avant de partager votre travail.",
  shareAllFailed: "Votre travail n'a pas pu être partagé. Réessayez.",
  shareAllFailedWeb:
    "Votre travail n'a pas pu être partagé. Utilisez l'application tC Mobile pour le partager.",
  shareAllStorage:
    "Ce téléphone n'a pas assez d'espace pour préparer votre travail. Marquez des segments comme terminés, puis réessayez.",
  shareAllMissing: (n: number): string =>
    plural(n, {
      one: "{n} livre n'a pas pu être inclus.",
      many: "{n} livres n'ont pas pu être inclus.",
      other: "{n} livres n'ont pas pu être inclus.",
    }),
  shareAllIncomplete: (n: number): string =>
    plural(n, {
      one: "{n} chapitre n'a pas pu être inclus en entier.",
      many: "{n} chapitres n'ont pas pu être inclus en entier.",
      other: "{n} chapitres n'ont pas pu être inclus en entier.",
    }),
  shareAllFilename: "Mon travail.zip",
  shareAllFolder(book: string): string {
    return filenameSafe(book) || this.shareNameFallback;
  },
  dbBlocked: "Une autre copie de cette application est ouverte.",
  dbBlockedTeach: "Fermez l'autre pour continuer.",
  dbOutOfDate: "Cette copie n'est plus à jour.",
  dbOutOfDateTeach: "Redémarrez pour utiliser la nouvelle version.",

  // About and licences
  aboutOpen: "À propos et licences",
  aboutTitle: "À propos et licences",
  aboutBlurb:
    "Une application gratuite et libre. Tout ce que vous enregistrez reste sur ce téléphone.",
  aboutAppLicense: "Cette application est proposée sous la licence MIT.",
  aboutSourceOffer:
    "Le code source de cette application est public. Code source de cette version :",
  aboutVisitAppSource: "Ouvrir le code source de cette version sur GitHub",
  aboutPrivacy: "Comment cette application traite vos données :",
  aboutPrivacyLink: "Politique de confidentialité",
  aboutVisitPrivacy: "Ouvrir la politique de confidentialité",
  aboutThirdParty: "Composants libres",
  aboutTexts: "Textes des licences",
  aboutQrCaption: "Scannez pour obtenir l'application",
  aboutContent: "Contenu inclus",
  aboutLanguageCodes: "Codes de langue : ISO 639-3, de iso639-3.sil.org.",
  aboutReadText: (name: string): string => `Lire ${name}`,
  aboutBack: "Retour à la liste",
  aboutTextLoading: "Chargement du texte de la licence.",
  aboutTextFailed: "Le texte de la licence n'a pas pu être chargé.",
  aboutVisitSource: (name: string): string =>
    `Ouvrir la page du projet ${name}`,
  aboutVisitKeptSource: (name: string): string =>
    `Ouvrir le code source de ${name} inclus dans cette version`,
  aboutVisitLicense: (name: string): string => `Ouvrir la licence de ${name}`,

  // Problem report
  failuresMarker: (n: number): string =>
    plural(n, {
      one: "{n} problème noté",
      many: "{n} problèmes notés",
      other: "{n} problèmes notés",
    }),
  menuOpenWithFailures: (n: number): string =>
    plural(n, {
      one: "Ouvrir le menu. {n} problème noté.",
      many: "Ouvrir le menu. {n} problèmes notés.",
      other: "Ouvrir le menu. {n} problèmes notés.",
    }),
  failuresTeach: "Envoyez ceci à votre aide si quelque chose ne marche pas.",
  shareFailureLog: "Envoyer le rapport de problèmes",
  shareFailureLogUnconfirmed:
    "Envoyer le rapport de problèmes. Le dernier essai n'est pas confirmé : touchez pour réessayer.",
  shareFailureLogPreparing: "Préparation du rapport de problèmes.",
  shareFailureLogNothing: "Il n'y a rien à envoyer pour l'instant.",
  shareFailureLogFailed:
    "Le rapport de problèmes n'a pas pu être envoyé. Réessayez.",
  shareFailureLogRestart:
    "Cette copie ne peut plus être utilisée. Redémarrez l'application pour utiliser la nouvelle version.",
  clearFailureLog: "Effacer le rapport de problèmes",
  clearFailureLogConfirmTitle: "Effacer le rapport de problèmes ?",
  clearFailureLogConfirm: "Effacer",
  loadFailed: "Le chargement a échoué. Réessayez.",
  saveFailed: "La sauvegarde a échoué. Réessayez.",
  noRoom: "Il n'y a plus de place sur ce téléphone.",
  bookNameTaken: "Un autre livre porte ce nom. Saisissez un nom différent.",
  stopToEdit: "Arrêtez l'enregistrement pour modifier.",
  stopToErase: "Arrêtez l'enregistrement pour réinitialiser.",

  // Cover colours and chapter playback
  coverColourLabel: "Couleur de la couverture",
  coverColourAmber: "Ambre",
  coverColourTeal: "Turquoise",
  coverColourPlum: "Prune",
  coverColourForest: "Forêt",
  coverColourBrick: "Brique",
  coverColourSlate: "Ardoise",
  coverColourRose: "Rose",
  coverColourOlive: "Olive",
  coverColourRust: "Rouille",
  coverColourCocoa: "Cacao",
  coverSwatchLabel: (name: string, selected: boolean): string =>
    selected ? `${name}, sélectionné` : name,
  playChapter: (heading: string): string => `Lire ${heading}`,
  pauseChapter: (heading: string): string => `Mettre ${heading} en pause`,
  resumeChapter: (heading: string, percent: number): string =>
    `Reprendre ${heading}, en pause à ${percent} pour cent`,
  chapterPlayFailed: (heading: string): string =>
    `${heading} n'a pas pu être lu. Touchez pour réessayer`,
  chapterNothingToPlay: (heading: string): string =>
    `${heading} n'a rien d'enregistré à lire`,
};
