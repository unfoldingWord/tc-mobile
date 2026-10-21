# Terminology glossary and drafting brief for the AI translations

Part of #1458 (the interface-language epic); written under #1484. This is the
one reference every AI drafting lane reads before it translates a single value
of `src/lib/strings.ts`, so that the ten interface languages use the same
terms, in the words Bible translators already use.

**Status of this file.** The wording in section 5 is an AI-drafted proposal. No
human has reviewed it, and no native reader has been asked. It is a starting
point for the drafting lanes, not a reviewed lexicon. Where a cell comes from
somewhere other than the proposal, section 5 says so.

## 1. Decisions this file follows

Quoted as recorded; nothing is paraphrased into a wider rule.

- **Q1-order** (#1458): "We will use AI to draft all of them and revise them as-needed. There is a lot of prior art in 18n/l10n work, so we should be fine."
- **Q3-reviewers** (#1458): "Use AI to draft, we'll revise as-needed."
- **D6-languages** (#1458, decided `level-4-first`): "The 10 level-4 languages in v2, the 16 level-3 languages after".
- **#357, 2026-10-08 (DRI)**: "The 26 (levels 3+4) (Recommended)" for the whole target set; follow the OS language, no picker, bundled translations.
- **#357, 2026-10-19 (DRI), missing keys**: "Pending list, strict at release (Recommended)".
- **R18-ui-words**, two wording calls from #1233. Note: "Use "Reset recording"; Use the number and name". The first is the one word for clearing a recording (section 4). The second is what a shared file name carries (section 7).
- **R19-digits**. Note: "Use Arabic numerals; default to simplified text on Chinese phones." The first sentence fixes the digits (section 6). The second means a phone set to Traditional-script Chinese gets the one Simplified Mandarin text.

**What the R19 note does not say.** R19 also asked whether the tester-only
screens are translated. The recorded note does not answer that part. The
phone-check strings (`src/lib/strings.ts`, `phoneCheck*`) are therefore
undecided here: a drafting lane leaves the keys out, so they fall back to
English, and lists them as pending (section 9, item 6) until the requirements
owner answers. This is an open item, not a
default this file invents.

## 2. The languages this epic ships

Ten columns, matching the epic's list of what a translator can do when it
ships: Arabic, English, French, Hindi, Indonesian, Mandarin (Simplified),
Portuguese, Russian, Spanish and Swahili. English is the source and the
reference column. The 16 level-3 languages follow later and are not in this
file.

| Code      | Language              | Script     | Direction     |
| --------- | --------------------- | ---------- | ------------- |
| `en`      | English               | Latin      | left to right |
| `ar`      | Arabic                | Arabic     | right to left |
| `es`      | Spanish               | Latin      | left to right |
| `fr`      | French                | Latin      | left to right |
| `hi`      | Hindi                 | Devanagari | left to right |
| `id`      | Indonesian            | Latin      | left to right |
| `pt`      | Portuguese            | Latin      | left to right |
| `ru`      | Russian               | Cyrillic   | left to right |
| `sw`      | Swahili               | Latin      | left to right |
| `zh-Hans` | Mandarin (Simplified) | Han        | left to right |

**Assumption, to confirm:** Portuguese and Spanish each need one variety. The
reference site below tags its Portuguese as Brazilian and its Spanish as
Latin-American. This file follows that, and it is not a decision anyone has
recorded for the app.

## 3. Wording reference: churchbased.bible

Step one of #1484 was to check the locale files and the licence of
https://github.com/unfoldingWord/churchbased.bible, which #169's 2026-10-01
comment proposed as a wording reference. Checked on 2026-10-19 by reading the
repository's default branch.

**Licence finding.** The repository carries a `LICENSE` file: the MIT License,
"Copyright (c) 2026 unfoldingWord". GitHub's licence field reads MIT. The
README and `DEPLOY.md` state no separate licence for the translated content,
so the repository-level MIT licence is the only one on record for those
files. This is a finding from reading the repository, not legal advice. It
does not turn the locale files into licensed app strings. This glossary copies
none of them: it uses a handful of single words as evidence of common usage,
each cited, and nothing longer.

**What the locale files are.** They are the translated copy of a marketing site
about church-based Bible translation: `src/i18n/<locale>/{home,about,training,research,stories,contact,ui}.json`
for 16 languages. Each locale folder has a `REVIEW.md` in which the AI
translation pass lists the choices a native reviewer "should verify". The
site's own `TRANSLATION-GUIDE.md` says the files were machine-translated and
then corrected by an AI pass. Nothing in the repository says a native reader
has gone through it, so treat it as one more AI draft.

**Fit with this app.** All ten of this epic's languages are present
(`ar, en, es, fr, hi, id, pt, ru, sw, zh`). The register fits: the guide asks for
"warm, plain, respectful". The vocabulary barely overlaps. The site has no
words for recording, playing, a segment, or storage. Only a few short labels
match the app's: `ui.json` `strings.menuLabel` (Menu), `strings.close` (Close),
`contact.json` `form.back` (Back), and, near enough to cite, `about.json`
`title` and `contact.json` `form.name` (About, Name). Everything else in
section 5 is the drafting proposal. The site's Chinese is Simplified
(`zh-Hans`), which agrees with R19.

**Marking used in section 5.** A cell ending in † is the same word the site
uses for that label, found at the path named in the "Source" column. A cell
without † is an AI proposal under Q1 and Q3, to be confirmed.

## 4. Register: plain, short, for people who may not read

The app is for people who may not read (AGENTS.md, "Purpose"). So:

- **Plain words**, the ones a church member uses, not the ones a
  software manual uses. Prefer a short common word over a precise rare one.
- **Short.** A button or caption is one word where the language allows one.
  A sentence is one idea. If the English is "Mark segment 3 done", the draft is
  not a paragraph.
- **A command is a command.** Buttons and menu rows are the imperative, in the
  polite-neutral form the language uses on its phones (no slang, no honorific
  stack). Notices are whole, calm sentences. Never blame the person: "Could not
  save. Try again." says what happened and what to do.
- **One term, one word, everywhere.** Section 5 is the list. A draft that
  renders "segment" two ways in two places fails review.
- **Say what a thing does, not what the code calls it.** Key names such as
  `erase` are the code's words; the screens say "Reset".
- **Words the app does not use stay unused.** "Export" and "download" do not
  appear in the interface: the app says Share. "Take" is hidden in the model
  (one recording per segment) and the screens say recording. Do not introduce
  either word to a translation.
- **Kept as they are in every language**: `MP3`, `.mp3`, `.zip`, the licence
  names (`MIT`, `LGPL-3.0`, `GPL-3.0`, `CC BY-SA 4.0`, `CC BY-SA 3.0`), the
  product name tC Mobile, and the name unfoldingWord (always camelCase,
  never translated or re-cased). These are the allowlist the check in #1485
  reads, plus the per-language supplement in section 9, item 5.

**The one word for clearing a recording (R18).** At `origin/develop` the
English table still spells this three ways: the tile caption `tileErase` is
"Reset" (`src/lib/strings.ts:332`), the menu row and dialog title `eraseSegment`
and `eraseConfirmTitle` are "Reset segment and start over" (`:659`, `:691`),
the confirm button `eraseConfirm` is "Clear" (`:692`), and `rerecord` is
"Clear and record again" (`:663`). R18 decided "Reset recording". A drafting
lane takes the English at its base commit: if those keys still read "Clear",
it does not translate "Clear" and "Reset" as two different verbs. It uses the
single word in section 5 for both and records which keys it did that for in
the PR, so the English change can follow. Whoever changes the English owns
the English edit; this file does not.

## 5. The core terms

English is the word as it appears in `src/lib/strings.ts` at `origin/develop`
(`3ebd6b97`). Key and line are given so a lane can find every use. Where the
screens use two English words for one idea, the row says which wins.

| #   | English              | Source in `strings.ts`                                                          | Note                                                                                                                                           |
| --- | -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Book                 | `newBook`, `bookRow`, `deleteBook` (`:106`, `:134`, `:719`)                     | The translator's own book (for example a Bible book or a story set), a shelf item holding chapters.                                            |
| 2   | Chapter              | `chapterName` (`:157`), `shareChapter` (`:768`)                                 | The default name is "Chapter N".                                                                                                               |
| 3   | Segment              | `addSegment`, `segmentsEmptyTeach` (`:252`, `:262`)                             | "One passage of the chapter". Not "verse" and not "section" (Section left the model).                                                          |
| 4   | Recording (noun)     | `booksEmptyTeach`, `takeRecoverTitle` (`:131`, `:444`)                          | The screens say "recording", never "take".                                                                                                     |
| 5   | Record               | `record` (`:370`)                                                               | The button.                                                                                                                                    |
| 6   | Stop recording       | `stop` (`:374`)                                                                 | The second tap on the record control.                                                                                                          |
| 7   | Play                 | `playSegment` (`:264`)                                                          |                                                                                                                                                |
| 8   | Pause                | `pauseSegment` (`:265`)                                                         |                                                                                                                                                |
| 9   | Share                | `tileShare` (`:338`), `shareChapter`, `shareBook` (`:768`, `:843`)              | Send out through the phone's share sheet. Never "export" or "download".                                                                        |
| 10  | Done                 | `tileFinished` (`:324`), `markFinished` (`:284`)                                | The visible word is "Done" (D17, #949). Longer sentences say "finished" (`storageLow`, `storageCritical`, `:1193`-`:1196`); use the same word. |
| 11  | Reset recording      | `tileErase`, `eraseSegment`, `eraseConfirm`, `rerecord` (`:332`, `:659`-`:692`) | R18. Clears the audio and keeps the segment. See the register section above.                                                                   |
| 12  | Delete               | `tileDelete`, `deleteSegment`, `deleteBook` (`:337`, `:755`, `:719`)            | Removes the segment or book itself, not only its audio. Never the same word as row 11.                                                         |
| 13  | Rename               | `renameBook`, `renameChapter`, `renameSegment` (`:204`-`:206`)                  |                                                                                                                                                |
| 14  | Cancel               | `eraseCancel` (`:697`)                                                          |                                                                                                                                                |
| 15  | Edit                 | `tileEdit` (`:323`), `editSegment` (`:273`)                                     |                                                                                                                                                |
| 16  | Undo                 | `undo` (`:546`)                                                                 |                                                                                                                                                |
| 17  | Menu                 | `menuTitle` (`:111`)                                                            |                                                                                                                                                |
| 18  | Close                | `menuClose`, `closeRecorder` (`:112`, `:344`)                                   |                                                                                                                                                |
| 19  | Back / Go back       | `micBack` (`:393`), `backToBooks` (`:251`)                                      |                                                                                                                                                |
| 20  | Try again            | `tryAgain` (`:133`)                                                             |                                                                                                                                                |
| 21  | Save                 | `saveName` (`:213`), `saveFailed` (`:1356`)                                     |                                                                                                                                                |
| 22  | Name                 | `bookNameField`, `chapterNameField` (`:209`, `:210`)                            | The title the translator types for a book, chapter or segment, not a person's name.                                                            |
| 23  | Microphone           | `micOffTitle`, `micNoDevice` (`:391`, `:498`)                                   |                                                                                                                                                |
| 24  | Phone                | `storageCritical` (`:1195`)                                                     | The device the app runs on.                                                                                                                    |
| 25  | Space (on the phone) | `storageCritical`, `shareAllStorage` (`:1193`-`:1222`)                          | The screens say "space" and "room", never "storage". A concept row, not a word to hunt for.                                                    |
| 26  | Licence              | `aboutTitle`, `aboutTexts` (`:1258`, `:1280`)                                   | British spelling in the English source; the licence names themselves (`MIT`, `CC BY-SA 4.0`) are not translated.                               |
| 27  | About                | `tileAbout`, `aboutOpen` (`:341`, `:1257`)                                      | About this app.                                                                                                                                |

The proposals, one language per column group. Cells marked † are the same word
the site uses (section 3).

**Arabic, Spanish, French, Hindi, Indonesian**

| #   | `ar`                | `es`                    | `fr`                           | `hi`                  | `id`                | Source                                                                                                                                                          |
| --- | ------------------- | ----------------------- | ------------------------------ | --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | كتاب                | libro                   | livre                          | पुस्तक                | buku                | AI proposal                                                                                                                                                     |
| 2   | فصل                 | capítulo                | chapitre                       | अध्याय                | pasal               | AI proposal. `ar`: Arabic Bibles print إصحاح for a scripture chapter; فصل is the general word. `id`: Indonesian Bibles use "pasal". Verify.                     |
| 3   | مقطع                | segmento                | segment                        | खंड                   | segmen              | AI proposal                                                                                                                                                     |
| 4   | تسجيل               | grabación               | enregistrement                 | रिकॉर्डिंग            | rekaman             | AI proposal                                                                                                                                                     |
| 5   | سجّل                | Grabar                  | Enregistrer                    | रिकॉर्ड करें          | Rekam               | AI proposal                                                                                                                                                     |
| 6   | أوقف التسجيل        | Detener grabación       | Arrêter l'enregistrement       | रिकॉर्डिंग रोकें      | Hentikan rekaman    | AI proposal                                                                                                                                                     |
| 7   | تشغيل               | Reproducir              | Lire                           | चलाएँ                 | Putar               | AI proposal                                                                                                                                                     |
| 8   | إيقاف مؤقت          | Pausa                   | Pause                          | विराम                 | Jeda                | AI proposal                                                                                                                                                     |
| 9   | مشاركة              | Compartir               | Partager                       | साझा करें             | Bagikan             | AI proposal. The site uses the same stems in a sentence (`contact.json` `form.subjectOptions[3]`: مشاركة, Compartir, Partager, साझा, Berbagi).                  |
| 10  | تم                  | Hecho                   | Terminé                        | पूर्ण                 | Selesai             | AI proposal                                                                                                                                                     |
| 11  | إعادة تعيين التسجيل | Restablecer grabación   | Réinitialiser l'enregistrement | रिकॉर्डिंग रीसेट करें | Setel ulang rekaman | AI proposal. A literal "reset" can read as a settings reset on a phone; the draft must keep the meaning "clear this recording, keep the segment". Verify first. |
| 12  | حذف                 | Eliminar                | Supprimer                      | हटाएँ                 | Hapus               | AI proposal                                                                                                                                                     |
| 13  | إعادة تسمية         | Renombrar               | Renommer                       | नाम बदलें             | Ubah nama           | AI proposal                                                                                                                                                     |
| 14  | إلغاء               | Cancelar                | Annuler                        | रद्द करें             | Batal               | AI proposal                                                                                                                                                     |
| 15  | تعديل               | Editar                  | Modifier                       | संपादित करें          | Edit                | AI proposal                                                                                                                                                     |
| 16  | تراجع               | Deshacer                | Défaire                        | पूर्ववत करें          | Urungkan            | AI proposal. `fr`: "Annuler" is Cancel (row 14), so Undo takes a different verb.                                                                                |
| 17  | القائمة †           | Menú †                  | Menu †                         | मेनू †                | Menu †              | `ui.json` `strings.menuLabel`                                                                                                                                   |
| 18  | إغلاق †             | Cerrar †                | Fermer †                       | बंद करें †            | Tutup †             | `ui.json` `strings.close`                                                                                                                                       |
| 19  | رجوع †              | Volver †                | Retour †                       | वापस †                | Kembali †           | `contact.json` `form.back` (the site shows an arrow beside the word; the arrow is not part of it)                                                               |
| 20  | حاول مرة أخرى       | Intentar de nuevo       | Réessayer                      | फिर से कोशिश करें     | Coba lagi           | AI proposal                                                                                                                                                     |
| 21  | حفظ                 | Guardar                 | Sauvegarder                    | सहेजें                | Simpan              | AI proposal. `fr`: "Enregistrer" is Record (row 5), so Save takes "Sauvegarder" everywhere.                                                                     |
| 22  | الاسم †             | Nombre †                | Nom †                          | नाम †                 | Nama †              | `contact.json` `form.name`. The site means a person's name in a form; the sense here is a title. Verify.                                                        |
| 23  | الميكروفون          | micrófono               | microphone                     | माइक्रोफ़ोन           | mikrofon            | AI proposal                                                                                                                                                     |
| 24  | الهاتف              | teléfono                | téléphone                      | फ़ोन                  | ponsel              | AI proposal                                                                                                                                                     |
| 25  | مساحة               | espacio                 | espace                         | जगह                   | ruang               | AI proposal                                                                                                                                                     |
| 26  | ترخيص               | licencia                | licence                        | लाइसेंस               | lisensi             | AI proposal                                                                                                                                                     |
| 27  | حول التطبيق         | Acerca de la aplicación | À propos de l'application      | ऐप के बारे में        | Tentang aplikasi    | AI proposal. The site's nav label "About us" is a different thing (the organisation).                                                                           |

**Portuguese, Russian, Swahili, Mandarin (Simplified)**

| #   | `pt`               | `ru`              | `sw`             | `zh-Hans` | Source                                                                                                                                |
| --- | ------------------ | ----------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | livro              | книга             | kitabu           | 书        | AI proposal                                                                                                                           |
| 2   | capítulo           | глава             | sura             | 章        | AI proposal. `sw`: Swahili Bibles use "sura" for a chapter. Verify.                                                                   |
| 3   | segmento           | фрагмент          | kipande          | 段落      | AI proposal                                                                                                                           |
| 4   | gravação           | запись            | rekodi           | 录音      | AI proposal                                                                                                                           |
| 5   | Gravar             | Записать          | Rekodi           | 录音      | AI proposal                                                                                                                           |
| 6   | Parar gravação     | Остановить запись | Acha kurekodi    | 停止录音  | AI proposal                                                                                                                           |
| 7   | Reproduzir         | Воспроизвести     | Cheza            | 播放      | AI proposal                                                                                                                           |
| 8   | Pausar             | Пауза             | Sitisha          | 暂停      | AI proposal                                                                                                                           |
| 9   | Compartilhar       | Поделиться        | Shiriki          | 分享      | AI proposal. The site's `ru` rewrites the sentence ("Хочу рассказать о проекте"), so it is no evidence for the Russian word.          |
| 10  | Concluído          | Готово            | Imekamilika      | 完成      | AI proposal                                                                                                                           |
| 11  | Redefinir gravação | Сбросить запись   | Weka upya rekodi | 重置录音  | AI proposal. Same warning as `ar` to `id`: keep the meaning "clear this recording, keep the segment". Verify first.                   |
| 12  | Excluir            | Удалить           | Futa             | 删除      | AI proposal                                                                                                                           |
| 13  | Renomear           | Переименовать     | Badilisha jina   | 重命名    | AI proposal                                                                                                                           |
| 14  | Cancelar           | Отмена            | Ghairi           | 取消      | AI proposal                                                                                                                           |
| 15  | Editar             | Изменить          | Hariri           | 编辑      | AI proposal                                                                                                                           |
| 16  | Desfazer           | Отменить          | Tendua           | 撤销      | AI proposal                                                                                                                           |
| 17  | Menu †             | Меню †            | Menyu †          | 菜单 †    | `ui.json` `strings.menuLabel`                                                                                                         |
| 18  | Fechar †           | Закрыть †         | Funga †          | 关闭 †    | `ui.json` `strings.close`                                                                                                             |
| 19  | Voltar †           | Назад †           | Rudi nyuma †     | 返回 †    | `contact.json` `form.back`                                                                                                            |
| 20  | Tentar novamente   | Повторить         | Jaribu tena      | 重试      | AI proposal                                                                                                                           |
| 21  | Salvar             | Сохранить         | Hifadhi          | 保存      | AI proposal                                                                                                                           |
| 22  | Nome †             | Имя †             | Jina †           | 名称      | `contact.json` `form.name` for `pt`, `ru`, `sw`. `zh-Hans`: the site's 姓名 is a person's full name, so the proposal differs. Verify. |
| 23  | microfone          | микрофон          | maikrofoni       | 麦克风    | AI proposal                                                                                                                           |
| 24  | celular            | телефон           | simu             | 手机      | AI proposal. `pt`: the Brazilian word, following section 2's assumption.                                                              |
| 25  | espaço             | место             | nafasi           | 空间      | AI proposal                                                                                                                           |
| 26  | licença            | лицензия          | leseni           | 许可证    | AI proposal                                                                                                                           |
| 27  | Sobre o aplicativo | О приложении      | Kuhusu programu  | 关于      | AI proposal. The site's nav label "About us" is a different thing (the organisation).                                                 |

Rows 5 to 8 and 10 to 16 are button and menu captions, so a lane may shorten
the cell to a single word where the language allows it, and must then use that
word everywhere the English word recurs. The Source column's "Verify" notes are
the questions to put to a reader when one is found; none blocks a draft.
A cell that is the same as another row's cell in that language (`zh-Hans` 录音
in rows 4 and 5), or the same as the English, is a Verify question too; the
lane names the other row, or the English, in what it returns (section 9,
item 7).

## 6. Placeholders, plurals and numbers

**Placeholders.** The table has two shapes that carry values:

- A plural form is a whole phrase with `{n}` where the count goes (for example
  `"{n} chapters"`; `src/lib/plural.ts`). Keep `{n}` exactly as typed, once per
  form, with the braces. Never translate or space what is inside them. Put it
  wherever the language puts its numeral.
- A function entry (`(name: string, chapters: number) => ...`) fills named
  slots. A translated version keeps every slot of the English one and uses each
  once. Word order is free; a slot may not be dropped or doubled. The slot
  value is already the right text: a book name or a heading, to be placed in
  the sentence unchanged.
- Do not build a sentence from translated fragments. Each entry is a whole
  sentence (AGENTS.md; `src/lib/strings.ts`, the `trail` docblock). Where the
  English joins two parts with `>`, the join is not translated; right-to-left
  mirroring of it is the layout lane's question, not a drafting one.
- No `{`, `}` or `undefined` may remain in any finished value (#1485 check d).
  "Finished" means the text a screen shows, after the slots are filled, not
  the catalog value a lane drafts. The catalog value `"{n} chapitres"` keeps
  `{n}`; rendered with 3 it is "3 chapitres", and a `{`, `}` or `undefined`
  left in that rendered text means a slot was dropped or misspelt.

**Plural categories per language.** A table must carry every category the
language selects, plus `other`, and may carry the exact-one arm `"=1"`
(`src/lib/plural.ts`). Wording that means exactly one ("one chapter was left
out") uses `"=1"`; `one` in Russian also selects 21 and 31.

| Language             | Categories the table needs       |
| -------------------- | -------------------------------- |
| Arabic               | zero, one, two, few, many, other |
| Russian              | one, few, many, other            |
| French               | one, many, other                 |
| Spanish              | one, many, other                 |
| Portuguese           | one, many, other                 |
| Hindi                | one, other                       |
| Swahili              | one, other                       |
| English              | one, other                       |
| Mandarin, Indonesian | other only                       |

These were read from `Intl.PluralRules(...).resolvedOptions().pluralCategories`
on Node 22 with ICU 78.2, on 2026-10-19. That is a Node run, not a phone's
engine; a phone's ICU may differ.

**Digits (R19).** "Use Arabic numerals". Every number the interface shows is
written 0 to 9, in every language including Arabic and Hindi. A draft never
writes a number as Arabic-Indic or Devanagari digits and never spells one out
in words where the English has a digit. This agrees with the epic's own note
that the numbers lane "ships all-Western first". Right-to-left text keeps
Western digits in their usual left-to-right run.

## 7. File names (R18, second call)

R18: "Use the number and name". A shared file's name carries the chapter number
and the chapter's name. At `origin/develop` the code has not changed yet:
`shareFilename` (`src/lib/strings.ts:828`-`:837`) builds `<book> - <chapter
name>.mp3`, with the default "Chapter N" when no name is set, and
`shareBookFilename` and `shareAllFilename` (`:971`, `:1231`) build
`<book>.zip` and "My work.zip". Whoever changes the format owns the change.
For translators the rules are:

- The extension is not translated: `.mp3` and `.zip` stay exactly.
- The only drafted words that can land in a file name are the default chapter
  name ("Chapter N"), the book placeholder ("Book 001"), and "My work". Draft
  them in the file-name-safe form: no `/ \ : * ? " < >` and no control
  characters (`filenameSafe`, `src/lib/utils.ts`), and as short as the plain
  word allows, since each label is capped at 120 bytes of UTF-8 and Arabic,
  Hindi, Russian and Mandarin take two to three bytes a character.
- Digits in a file name are Arabic numerals (section 6), so a folder sorts the
  same way in every language.

## 8. Length budget

An English word is about as long as the longest label allowed. The tile
captions are the tight case: one visible word, which must fit its tile at
320 and 360 px (`e2e/segment-menu-tile-fit.spec.ts`). Mandarin runs shorter
than English. French, Spanish, Portuguese and Russian often run longer, so the
rule for a draft is: pick the shortest plain word that is still the glossary
term, and if a longer one is the only correct one, say so in the PR so the
layout check sees it. The numeric ratio is deliberately not set here. #1485
says the ratio is chosen from the first draft and recorded in its test, not
guessed beforehand.

## 9. The brief a drafting lane receives

What a lane must have in hand, and where each piece comes from.

1. **The list of keys.** Every top-level entry of `src/lib/strings.ts` at the
   lane's base commit. The epic counts about 294 (#1458). Do not trust a count
   in prose: read the file. The pending-list command from #1481 is what lists
   the keys still falling back to English, once it exists.
2. **The `Strings` type.** `#1480` restructures the table into one table per
   locale behind the same `strings` import. At `origin/develop` (`3ebd6b97`) no
   exported `Strings` type exists: the table is one object literal, `strings`,
   exported from `src/lib/strings.ts`. A lane starts after #1480 and #1481 have
   merged and drafts against the type those issues define. This file does not
   pre-empt its shape.
3. **This glossary,** sections 4 to 8, and the language's column in section 5.
4. **The plural categories** for the language, section 6.
5. **The quality checks of #1485** a draft has to pass: no value equal to the
   English one unless allowlisted (the allowlist is in section 4, plus, for
   the language being drafted, and no other, every section 5 cell of that language spelled the same
   as the English, such as `fr` Menu and Pause, `id` Menu and Edit, `pt`
   Menu); each value holds at least one letter of the language's script and no
   stray Latin letters beyond the allowlist. The letters inside a kept slot
   (`{n}` and each named slot such as `{name}`) are the slot, not stray Latin,
   in every language: an Arabic catalog value `"{n}"` plus Arabic words
   passes, and removing the `n` fails section 6. For a Latin-script language
   (`es`, `fr`, `id`, `pt`, `sw`) Latin letters are its own script, not stray;
   the length stays within the ratio the test records; no `{`, `}` or
   `undefined` in the rendered text, after the slots are filled (section 6:
   the drafted value keeps `{n}` and every named slot).
6. **The pending list.** A development build may carry a time-limited list of
   keys still falling back to English; the release gate requires it to be
   empty (#357, 2026-10-19). A lane that leaves a key out puts it on that list
   rather than copying English in.
7. **What a lane returns.** The draft values; a list of every term where it
   departed from section 5, with the reason; its Verify questions, each cell
   that matches another row or the English, naming that row or the English
   (section 5); and the keys it put on the pending
   list, each with a reason. It does not change the English table, the
   glossary, or the check.

Out of scope for the glossary and for a drafting lane: translating the table
(each language's own issue does that), the right-to-left layout work, the
interface fonts, and the audio of any string (v3).
