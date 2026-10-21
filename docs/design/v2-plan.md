# tC Mobile v2 Plan

**Date:** 2026-10-19 · **Author:** Tim (requirements owner) · **Status:** the
product owner's plan of record for v2, with the decisions taken on it the same
day recorded [after the plan](#decisions-recorded-2026-10-19).

> **How this file is kept.** The plan below is the product owner's text as
> written on 2026-10-19, with its tables converted to Markdown and its open
> questions numbered 1–14 (the numbering the decisions use). Where the plan
> describes the repository, it describes commit `9caf92b` (v1.0.1), as its
> Sources say. The decisions that change earlier records are written back to
> [`pivot-plan.md`](pivot-plan.md) (A4, D4, Q4) and to
> [ADR 0011](../decisions/0011-v2-storage-and-export.md), which revisits
> [ADR 0005](../decisions/0005-no-backend-in-phase-1.md).

> **A note on the name "Scripture Burrito".** The plan says "Scripture Burrito".
> The format is now called **Scripture Bundle**. In the product owner's words
> (decision D3-export below): "We need to use Scripture Bundle format
> (tragically misnamed as "Scripture Burrito" for a long time up until it was
> corrected, so don't be confused by it)." The plan's wording is kept as
> written; read every "Scripture Burrito" in it as Scripture Bundle.

v2 ships seven required changes by the end of 2026, built on one new
prerequisite: a Bible Passages dataset. Six more items are desired. Two items
move to v3, and one request from the October 19 meeting is dropped.

The plan merges three sources: the v2 whiteboard, the October 19
feature-request meeting (item numbers below refer to its action list), and
interviews with Tim on October 19. Where they conflicted, the interview answer
wins.

## Scope at a glance

| Item                                                                    | Priority        | Source                                    |
| ----------------------------------------------------------------------- | --------------- | ----------------------------------------- |
| Template library: OBS, Bible books, passage collections                 | v2 required     | Whiteboard (starred); meeting 6           |
| Chapter play button                                                     | v2 required     | Whiteboard (starred); meeting 4.1         |
| Blue selection envelope in edit mode                                    | v2 required     | Whiteboard (starred); meeting 1.1         |
| Licensing checklist and licence tag in the file name                    | v2 required     | Meeting 7.1, 7.2                          |
| Record and back up directly to microSD (Android)                        | v2 required     | Meeting 5.1, 9.1, 9.2                     |
| Export a book as a project (Scripture Burrito zip)                      | v2 required     | Meeting 10.1 to 10.3                      |
| App text localized into 26 Strategic Languages (Resource Level 3 and 4) | v2 required     | Meeting 8.1                               |
| Bible Passages dataset                                                  | v2 prerequisite | Whiteboard; interview                     |
| Header images for segments                                              | v2 desired      | Whiteboard                                |
| New Generations ESP Scripture sets                                      | v2 desired      | Whiteboard; meeting 6.1                   |
| Noise removal (opt-in) and normalization (default on)                   | v2 desired      | Whiteboard; meeting 2.1, 2.2              |
| External microphone testing                                             | v2 desired      | Meeting 2.3                               |
| MP3 cover art generated from the chapter title                          | v2 desired      | Whiteboard; meeting 3.1                   |
| Cloud backup sync: Google Drive and iCloud                              | v2 desired      | Meeting 9.3, 9.4                          |
| Audio for all text strings                                              | v3 required     | Whiteboard; meeting 8.2 to 8.5            |
| BT Servant chat (opt-in)                                                | v3 required     | Whiteboard                                |
| Text labels on edit-mode buttons                                        | Dropped         | Meeting 1.2; interview kept current icons |

## Required: template library

A user starts a new book from a template, and the app lays out its chapters and
segments in one step. Decision Q2 in the pivot plan defines a template as "a
structure generator that may carry content."

| Template kind                                                 | Structure                                                   | Content it carries                                                         | v2       |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Open Bible Stories                                            | 50 stories, frames as segments                              | Story structure and content                                                | Required |
| Bible book                                                    | Bible chapters; segments from translationNotes (UTN) chunks | Verse span and title per segment; no Scripture text or audio               | Required |
| Passage collection (e.g. "35 Stories that Changed the World") | Ordered Bible passages                                      | Verse spans, titles, plus intro and connective segments with no verse span | Required |
| New Generations ESP Scripture sets                            | Their existing structure                                    | Passage references                                                         | Desired  |

The Bible-book and collection templates draw on the Bible Passages dataset. The
meeting asked for "the entire taxonomy and structure of the Bible," so the
dataset covers all 66 books.

Delivery uses two routes. The app bundles a starter set. Users download more
templates, which then stay on the phone for offline use.

Existing work in the repo:

- #253 covers storage: create a book from a template in one transaction.
- #246 covers the picker UI.
- `src/lib/obs/catalog.ts` handles OBS only; the team generalizes it first (see
  Other prerequisites).

## Required: chapter play button

Each chapter row on the Books screen gets a play button. One tap plays every
recorded segment in the chapter, in order, and moves from one segment to the
next without another touch.

- Location: the chapter row on the Books screen only.
- Plays: recorded segments, in segment order. Empty segments are skipped.
- Goal from the meeting: "start a chapter and listen without touching the phone
  again."
- Open points: what a second tap does (pause or stop), and whether the row shows
  progress through the chapter.

## Required: blue selection envelope

In the trim editor, the selection envelope and both handles turn blue. The
waveform stays amber. Today the amber selection sits on an amber waveform, and
testers could not see the selection well.

- Changes: selection envelope fill, both drag handles.
- Stays: the amber waveform (`--s-voice`) and the current undo and redo icons.
  The meeting asked for text labels on edit buttons; the interview dropped that
  for v2.
- Design check: the O4 system already uses blue for the guide ring
  (`--s-guide`, "your next action") and for "hear this" (`--s-hear`). The team
  picks one of these or adds a new token so the envelope does not read as a
  guide ring.

## Required: licensing on share

When a user shares audio, the app asks which licence applies, offers CC BY-SA as
a checklist option, and writes the chosen licence into the file name.

Why now: the repo README records a settled but unbuilt rule. Recordings made
against OBS are CC BY-SA derivative works and must not carry the unfoldingWord
trademark (#15, closed 2026-08-23). Share Chapter and Share Book carry no
attribution today (#252), and the data model cannot yet tell an OBS-derived
recording from a user-authored one.

Open points:

- Which licences besides CC BY-SA appear in the checklist.
- Whether template-derived books (OBS, and Bible books from the CC BY-SA
  dataset) lock the licence to CC BY-SA.
- The file-name tag format, for example `Mark_01_CC-BY-SA-4.0.mp3`.

## Required: microSD storage and project backup

On Android, users can record straight to a microSD card and back up all projects
to it. This reverses decision D4 (23 Aug), which limited microSD to the share
sheet.

| Capability                        | Platform     | v2       |
| --------------------------------- | ------------ | -------- |
| Record audio directly to microSD  | Android      | Required |
| Back up all projects to microSD   | Android      | Required |
| Sync backups through Google Drive | Android, iOS | Desired  |
| Sync backups through iCloud       | iOS          | Desired  |

What this touches:

- D4 left ADR 0005 unchanged. Reversing D4 means the team reopens ADR 0005 and
  records a new decision. This plan has not checked what ADR 0005 says.
- v1 keeps recordings in browser storage (IndexedDB) and warns that the phone
  may delete them when space runs low. A microSD backup gives users a copy
  outside that storage.
- iPhones have no microSD slot, so iOS users depend on cloud sync, which is
  desired, not required.

Open points: what a backup contains (the same project package as export, or a
separate format), how a user restores one, and how the app behaves when the card
is removed mid-recording.

## Required: export a book as a project

A user exports a whole book as a working project, packaged as a Scripture
Burrito zip, and opens it in translationCore Desktop or on another phone.
Finished-audio sharing stays as it is.

| Export                 | Format                    | Purpose                                          | Decision                                            |
| ---------------------- | ------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Share Chapter          | One concatenated MP3      | Listen and distribute                            | A4, unchanged                                       |
| Share Book             | Zip of chapter MP3s       | Listen and distribute                            | A4, unchanged                                       |
| Export book as project | Scripture Burrito, zipped | Move working data to tC Desktop or another phone | New; overrides A4's "No Burrito" for this path only |

A project export carries working data, not only final audio: segments, takes,
titles, verse spans, done state, and template provenance.

Prior art: the README notes that an unfoldingWord Scripture Burrito prototype
ran the same stack (Vite, PWA, IndexedDB) on low-end Android.

Open points: import on the receiving phone (v2 or later), what tC Desktop needs
to open the package, and whether the microSD backup reuses this format.

## Required: localization

All user-facing app text ships in 26 Strategic Languages in v2: every language
at Resource Level 3 or 4 in the Strategic Languages dataset. Segment titles in
the Bible Passages dataset use the same list.

v1 keeps its UI text in `src/lib/strings.ts`, so the team starts from one file
of strings.

The list has 10 languages at level 4 and 16 at level 3, English included. They
use 11 scripts, and Arabic, Farsi and Urdu run right to left.

| Level | Language     | BCP 47 | Script                           |
| ----- | ------------ | ------ | -------------------------------- |
| 4     | Arabic (MSA) | ar     | Arabic, right to left            |
| 4     | English      | en     | Latin                            |
| 4     | French       | fr     | Latin                            |
| 4     | Hindi        | hi     | Devanagari                       |
| 4     | Indonesian   | id     | Latin                            |
| 4     | Mandarin     | zh     | Simplified Han                   |
| 4     | Portuguese   | pt     | Latin                            |
| 4     | Russian      | ru     | Cyrillic                         |
| 4     | Spanish      | es     | Latin                            |
| 4     | Swahili      | sw     | Latin                            |
| 3     | Amharic      | am     | Ethiopic                         |
| 3     | Assamese     | as     | Bengali                          |
| 3     | Bengali      | bn     | Bengali                          |
| 3     | Burmese      | my     | Myanmar                          |
| 3     | Farsi        | fa     | Arabic (Nastaliq), right to left |
| 3     | Hausa        | ha     | Latin                            |
| 3     | Lao          | lo     | Lao                              |
| 3     | Lingala      | ln     | Latin                            |
| 3     | Malay        | ms     | Latin                            |
| 3     | Nepali       | ne     | Devanagari                       |
| 3     | Tagalog      | tl     | Latin                            |
| 3     | Thai         | th     | Thai                             |
| 3     | Tok Pisin    | tpi    | Latin                            |
| 3     | Turkish      | tr     | Latin                            |
| 3     | Urdu         | ur     | Arabic, right to left            |
| 3     | Vietnamese   | vi     | Latin                            |

Source: Strategic_Languages.csv, Resource Level and suppressed-script columns.

Open points: who translates and reviews the app text in each language, how the
app picks its language, and right-to-left layout for Arabic, Farsi and Urdu.

## Prerequisite: Bible Passages dataset

The team builds the Bible Passages dataset before any Bible-book or collection
template can ship. It lives in Servant.Bible as a dataset with its own MCP
server, under CC BY-SA 4.0.

| Property        | Decision                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------- |
| Home            | Servant.Bible dataset, served by a Servant.Bible MCP server                                   |
| Licence         | CC BY-SA 4.0                                                                                  |
| Coverage        | All 66 books                                                                                  |
| Segments        | One per translationNotes (UTN) chunk                                                          |
| Per segment     | Book, chapter, verse span, title. No Scripture text, no audio.                                |
| Titles          | AI drafts, people review                                                                      |
| Title languages | The 26 Resource Level 3 and 4 Strategic Languages (English included; list under Localization) |
| Collections     | Ordered passage lists with optional intro and connective segments                             |
| Header images   | Optional image reference per segment (desired)                                                |

Build steps:

1. Extract chunk boundaries and verse spans from UTN for all 66 books.
2. Draft English titles with AI; reviewers approve or edit each one.
3. Draft and review titles in the other 25 languages.
4. Define the collection format, including segments with no verse span.
5. Author the first required collection ("35 Stories that Changed the World" or
   another the team names).
6. Publish the dataset and stand up the MCP server.

Scale risk: the team must review every segment title in 26 languages before the
end of 2026. The plan has no count of UTN chunks yet; that number sets the review
load.

The Servant.Bible framing positions it as infrastructure for people who build
Bible technology, so other apps can use this dataset too.

## Other prerequisites

Four pieces of groundwork sit under the required features. The template schema
comes first because the dataset, the catalog, export and licensing all read from
it.

- **Template schema.** One schema for OBS, Bible books and collections: template
  ID and version; book, chapter and segment structure; verse span, title and
  optional image reference per segment; title language; provenance and licence
  fields (#19). The same structure should feed MP3 metadata and the Burrito
  export.
- **Generalized catalog.** Replace the OBS-only path in
  `src/lib/obs/catalog.ts` with a catalog that lists any template kind, bundled
  or downloaded.
- **Template delivery.** A build step bakes dataset entries into template
  packages and the app bundles a starter set. The app also downloads more
  templates from the Servant.Bible MCP server and keeps them for offline use.
- **Storage before UI.** Land #253 (create a book from a template in one
  transaction) before #246 (picker UI).

The data model also needs a field that marks a book as template-derived.
Licensing (CC BY-SA lock) and export (provenance) both depend on it.

## Desired items

The team builds these if capacity allows after the required work. Each line
records what the sources asked for.

| Item                               | What it covers                                                                      | Notes                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Header images for segments         | An image at the top of a segment                                                    | Reopens decision Q4 (see Decisions). The OBS catalog already lists a 360px image per frame on cdn.door43.org.           |
| New Generations ESP Scripture sets | Their sets, in their existing structure, as a selectable template                   | Tim's position: the collection is data only and falls under fair use, so no permission is needed. Not legally reviewed. |
| Noise removal                      | Opt-in checkbox                                                                     | Whiteboard and meeting 2.1                                                                                              |
| Normalization                      | On by default, or off                                                               | Whiteboard and meeting 2.2                                                                                              |
| External microphones               | Test and confirm they work                                                          | Meeting 2.3; a test task, not a feature                                                                                 |
| MP3 cover art                      | Generated on the phone from the chapter title, offline; each chapter looks distinct | Meeting 3.1. Overlaps MP3 attribution metadata in #252.                                                                 |
| Cloud backup sync                  | Google Drive and iCloud                                                             | Builds on the required microSD backup                                                                                   |

## Moved to v3 (required there)

| Item                       | What it covers                                                                                                                                 | Notes                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Audio for all text strings | Users record audio for any app text. Purple mic where no audio exists, purple speaker where it does. One dialog sets and updates audio titles. | Meeting 8.2 to 8.5. Builds on v2 localization.                                                           |
| BT Servant chat            | Opt-in chat mode, audio-first                                                                                                                  | The Design canvas prototype (mode slider, colour-coded audio messages) carries forward as v3 groundwork. |

## Decisions this plan changes

v2 reverses or narrows three decisions recorded in `pivot-plan.md`. The team
should record each change there before building.

| Decision                                                 | Recorded | v2 change                                                         | Status                                        |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------- | --------------------------------------------- |
| A4: Share Book is a zip of chapter MP3s, "No Burrito"    | 22 Aug   | Sharing stays as A4. A new project export uses Scripture Burrito. | Decided in interview                          |
| D4: microSD via the share sheet only; ADR 0005 unchanged | 23 Aug   | Reversed: record and back up directly to microSD on Android       | Decided in interview                          |
| Q4: no per-segment artwork; OBS media cache removed      | 24 Aug   | Header images return as a desired item                            | Reopens only if the team builds header images |

One meeting request also conflicts with the text-minimal aim: text labels on
edit buttons (meeting 1.2). Decision A5 already relaxes the text constraint, but
the interview kept the current icons for v2.

## tC Audio Library (concept, after v2)

tC Audio Library is a possible separate mobile app that plays and shares
recordings made in tC Mobile. v2 does not build it, but v2's template schema and
MP3 metadata should carry the structure it will read.

**Problem.** Audio Bibles navigate by book, chapter and verse. People look for a
book and then a story or passage.

**Input.** MP3s exported from tC Mobile, with metadata.

Structure the Library browses:

- Language
- Book (OBS, Bible, others)
- Chapter (optional)
- Passage or story
- Segment

Uses:

- Consumption: browse by location and by navigation.
- Sharing: on the same device, within a group, and on the Internet.

What v2 must leave in place for it: the template schema and MP3 metadata carry
language, book, optional chapter, passage or story, and segment.

## Open questions

Fourteen questions remain. The first three set the size of the dataset work and
so the schedule.

1. Set the order in which the 26 languages get titles and app text.
2. Count the UTN chunks across 66 books; that count times the languages gives
   the title review load.
3. Name the title reviewers per language and the review rule (length, style).
4. Pick the UTN release, and decide how to handle chunks that cross a chapter
   boundary.
5. Name the passage collection(s) required for v2.
6. Choose which templates go in the bundled starter set, and set an app-size
   budget for it.
7. Pick the blue for the selection envelope (guide, hear, or a new token).
8. Chapter play: what a second tap does, and whether the row shows progress.
9. Licensing: which licences besides CC BY-SA, whether template-derived books
   lock to CC BY-SA, and the file-name tag format.
10. Read ADR 0005 and record the decision that replaces D4.
11. Backup: its contents and format, how a user restores it, and what happens if
    the card is removed while recording.
12. Project export: import on the receiving phone (v2 or later), and what tC
    Desktop needs to open the package.
13. Header images, if built: image source, licence, offline storage.
14. Get a legal view on the fair-use position for New Generations sets before
    shipping them.

## Sequence to end of 2026

Four required items can start now. Bible-book and collection templates come
last, behind two chains: schema, storage and picker, and the dataset from chunks
to 26-language titles.

No step has a date yet; only the end-of-2026 release target is set. Desired
items fit in after the required lanes as capacity allows.

## Sources

- v2 whiteboard photo (Tim, October 2026)
- "2026-10-19 TCM v2 feature requests" meeting notes (Tim, 4:54)
- Interviews with Tim, October 19, 2026; Strategic_Languages.csv (Resource Level
  column)
- unfoldingWord/tc-mobile at commit 9caf92b (v1.0.1): README,
  `src/data/obs-catalog.json`, `package.json`
- `pivot-plan.md`: decisions A4, A5, D4, Q2, Q4
- Issues #15, #19, #246, #252, #253
- BT Servant web client
- tC Mobile 2.0 prototype (Design canvas)

## Decisions recorded 2026-10-19

The product owner (Tim), the project manager (Elsy) and the dev lead (Seth)
answered the plan's questions on the project site's review page on 2026-10-19;
the DRI recorded the final choices the same day. Every role that picked an
option picked the one recorded here. The option text is the text of the
question list. **Tim's notes are quoted verbatim**; where a decision has no note,
none was given. "Answers" names the plan's open questions (numbered above) that
the decision settles. A bare number means the quoted text decides every clause
of that question; anything less is marked "in part", and the missing clause is
named in the cell or under "What is still open".

The decision IDs below are this record's own. Their D and Q numbers are not the
pivot plan's D and Q numbers: pivot-plan D4 (microSD via the share sheet) and
v2 D4-collections are different decisions.

### Product (owner: Tim)

| ID                 | Question                                                     | Decided                                                           | Tim's note (verbatim)                                                                                                                                                                                                                                                                 | Answers                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1-dataset**     | How much of the Bible Passages dataset is in v2?             | "All 66 books, titles in all 26 languages"                        | "The Bible Passages dataset is going to be a work in progress for a long time to come, so we should ship v. 0.1 ASAP and update it over time."                                                                                                                                        | None directly. It sets the dataset's v2 target; question 2 (the chunk count) is what sizes it.                                                                                       |
| **D2-microsd**     | What does v2 do with the microSD card on Android?            | "Record straight onto the card, and back up to it"                | "Removing a card mid-recording is highly unlikely, so should be warned against, but not worried about."                                                                                                                                                                               | 10 (replaces pivot-plan D4; see ADR 0011); 11 in part (card removal while recording).                                                                                                |
| **D3-export**      | Does v2 also import a project exported from another phone?   | "Export in v2, import later"                                      | "For v2, we are looking to be able to safeguard data off-device. We need to use Scripture Bundle format (tragically misnamed as "Scripture Burrito" for a long time up until it was corrected, so don't be confused by it). tC Desktop does/will read/write Scripture Bundle format." | 12 in part (import is later; the format is Scripture Bundle, which tC Desktop reads and writes per the note). The manifest fields it reads stay open.                                |
| **D4-collections** | Which collection is required, and what comes inside the app? | "Bundle OBS, the collection and the New Testament books"          | None.                                                                                                                                                                                                                                                                                 | 6 in part (what the starter set bundles; R1 and R2 revise it, and no app-size budget is set). Question 5 was open here because the collection was not named; closed by Round 2's R1. |
| **D5-licence**     | How do licences work when someone shares?                    | "Books made from a template are CC BY-SA 4.0; other books choose" | "All OBS recordings are CC BY-SA 4.0 (as per the license); recordings of Scripture propose CC BY-SA 4.0 as the default with the rationale: "You keep your copyright in the work and also allow others to freely and legally share this work with others.""                            | 9 in part. Other licences, the file-name tag and the Bible-template conflict stay open (below).                                                                                      |
| **D6-languages**   | How do the 26 languages arrive?                              | "The 10 level-4 languages in v2, the 16 level-3 languages after"  | None.                                                                                                                                                                                                                                                                                 | 1 in part (order). Arabic is level 4, so right-to-left layout is in v2.                                                                                                              |

### Delivery (owner: Seth)

| ID                  | Decided                                                                                       | Answers                                  |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **P1-start**        | "Sprint 6 (2 Nov), once v1.1 is in production"                                                | None.                                    |
| **P2-version**      | "Keep sprint-end minors (1.2, 1.3 …); the release that completes the required items is 2.0.0" | None.                                    |
| **P3-labels**       | #956 and #359: "Remove the label; they stay in Backlog"                                       | None.                                    |
| **P4-dataset-home** | "Its own Servant.Bible repo and owner; tC Mobile reads a published template package"          | None. The repository does not exist yet. |

### Later questions

| ID                  | Question                                        | Decided or recorded text (verbatim)                                                                                                                              | Answers                                                                                                                                                               |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1-order**        | Language order for titles and app text          | Tim: "We will use AI to draft all of them and revise them as-needed. There is a lot of prior art in 18n/l10n work, so we should be fine."                        | 1 in part. The note says how titles and app text are drafted, not their order; the two tiers in D6-languages are the only order recorded (see below).                 |
| **Q3-reviewers**    | Who reviews titles, and the rule                | Tim: "Use AI to draft, we'll revise as-needed."                                                                                                                  | 3 in part. The note says who drafts (AI) and that the text is revised as needed; it names no reviewers per language and sets no length or style rule (see below).     |
| **Q4-chapters**     | Can a segment cross a chapter boundary?         | "Yes: a segment stores a start and an end chapter:verse"                                                                                                         | 4 in part. The UTN release is not picked.                                                                                                                             |
| **Q7-blue**         | Which blue is the selection envelope?           | "A new selection colour, so it never reads as the guide ring"                                                                                                    | 7 in part. The choice is made (a new token, not the guide or hear colour); the new token's colour value is not recorded (see below).                                  |
| **Q8-chapter-play** | What does a second tap do?                      | "It pauses, and the row shows how far through the chapter it is"                                                                                                 | 8.                                                                                                                                                                    |
| **Q11-backup**      | Backup contents and restore                     | Tim: "Default to including everything, all metadata, in a Scripture Bundle format with a robust manifest. We can process it later."                              | 11 in part (contents and format). Restore: closed by Round 2's R4; see below.                                                                                         |
| **Q13-images**      | Header images: source, licence, offline storage | Tim: "Header images are CC0 when generated on the app. Store them wherever, preferably embedded in the MP3 at a low resolution to not consume too much storage." | 13 in part. Source and licence are answered (generated on the app, CC0); where the image is stored is only a preference ("wherever, preferably embedded"; see below). |
| **Q14-legal**       | Legal view on New Generations sets              | Tim: "They are data, like a phonebook, not subject to copyright restrictions."                                                                                   | None as a legal view. The note is **the product owner's position** on question 14; no legal review is recorded.                                                       |

### What is still open

This list was reconciled with Round 2 on 2026-10-19; what Round 2 closed is in
the next list, not here.

- **Question 1** — the order of the 26 languages for titles and app text.
  Q1-order's note says how they are drafted and sets no order. The only order
  recorded is D6-languages' two tiers (level 4, then level 3); the order within
  a tier is not recorded.
- **Question 2** — the chunk count is not a decision. It is counted outside
  this file and is not restated here.
- **Question 3** — the title reviewers per language and the review rule
  (length, style). Q3-reviewers' note, "Use AI to draft, we'll revise
  as-needed.", names no reviewer and sets no rule.
- **Question 4, first half** — which UTN release.
- **Question 6, second half** — the app-size budget for the starter set. Round
  2's R1 and R2 change what the bundle holds and leave the budget open.
- **Question 7, the token's value** — Q7-blue picks "A new selection colour";
  which colour is not recorded.
- **Question 9, in part** — which licences besides CC BY-SA the checklist
  offers, and the file-name tag format; neither D5-licence's option nor its
  note names them. The two also differ on Bible-book templates: the option
  makes every template-derived book CC BY-SA 4.0, and the note has recordings
  of Scripture only propose it as the default. Which one holds is open. Round
  2's R20 sets only the starting licence of a book not made from a template.
- **D1-dataset and D6-languages** — D1-dataset puts titles in all 26
  languages in v2, and D6-languages brings the 16 level-3 languages "after".
  Whether level-3 titles ship in v2 ahead of the app text is not recorded.
  Round 2's R8 puts the level-3 languages after 2.0.0 as v2-desired; the
  titles question stays open.
- **Question 12, second half** — which flavour and manifest fields tC Desktop
  reads to open the package. Round 2's R11 sets the v2 bar at the published
  spec plus our own read-back test; the fields stay open.
- **Question 13, storage** — Q13-images' note makes header images CC0 when
  generated on the app and says "Store them wherever, preferably embedded in the
  MP3 at a low resolution". "Preferably" is a preference, not a storage
  decision.
- **Question 14** — no legal review is recorded. The plan's own line says a
  legal view comes "before shipping them".

### Closed by Round 2

These were open when the register above was written. Each is closed by the
Round 2 answer named; the answer is quoted in the next section.

- **Question 5** — which passage collection is required. Closed by R1: OBS and
  "35 Stories that Changed the World", plus the entire Bible Passages dataset.
  D4-collections' option text ("the collection") did not name it.
- **Q4-chapters and Q8-chapter-play** — which chapter's play includes a segment
  that crosses a chapter boundary. Closed by R6: the chapter it starts in; it
  plays and exports there.
- **Question 11, restore** — closed by R4. The app need not restore a v2
  backup: backup only in v2, restore comes with import and is v2-desired, not
  required. At a minimum the data must be archivable off the device.
  [ADR 0011](../decisions/0011-v2-storage-and-export.md) records the same.

## Round 2 decisions recorded 2026-10-19

The requirements owner (Tim) answered a second set of twenty questions, R1 to
R20, on the project site's review page on 2026-10-19. The question text, the
option text and **Tim's notes are quoted verbatim**; "free text, no option"
means the answer was a note alone. "Settles" names the earlier decision or open
question the answer bears on; "Still open" says what the answer leaves
undecided. The R ids are this record's own and are not the Round 1 D and Q ids
above.

### Where Round 2 changes earlier scope

- **R1 adds the whole Bible Passages dataset to what ships in the app.**
  D4-collections bundled OBS, "the collection" and the New Testament books; R1
  names the collection (below) and adds the entire dataset.
- **R2 bears on D4's New-Testament-only bundle, and the record does not say
  which outcome stands.** The recorded option, `bundle-when-ready`, is "Bundled
  too, in an app update once their titles are ready". Tim's note on the same
  answer begins "Changing this to "Whole Bible included" in English, at a
  minimum". Both are recorded and neither is marked as replacing the other, so
  whether the Old Testament ships with the first v2 build or in a later update
  is not decided here. Do not schedule either from this file.
- **R4 makes restore v2-desired**, not required; archiving the data off the
  device is the v2 minimum.
- **R8 makes the 16 level-3 languages v2-desired**; they become v3-required if
  they miss the v2 launch.
- **R9 and R10 move to v3-required:** Shema Studio import and export, and audio
  titles.

### The twenty answers

1. **R1-collection** — "Which collection is bundled in the app (D4)?" Decided
   (free text, no option). Note: "Minimum collection of pre-defined templates to
   include: OBS and "35 Stories that Changed the World." The entire "Bible
   Passages dataset" needs to be included also, for easy population of Bible
   stories, as selected by the user."
   - Settles: question 5 (the collection is named) and D4-collections in part.
   - Still open: the app-size budget (question 6, second half). The note says
     "minimum", so whether anything beyond these ships is not recorded.
2. **R2-ot** — "D1 covers all 66 books, but D4 bundles only the New Testament.
   How do Old Testament templates arrive?" Decided: `bundle-when-ready` —
   "Bundled too, in an app update once their titles are ready". Note: "Changing
   this to "Whole Bible included" in English, at a minimum, with localized
   titles if possible. Note that depending on filesize limitations, we may need
   to include additional languages as separate downloadable/importable
   "language packs", TBD."
   - Settles: in part. The option and the note both have the Old Testament
     bundled, so the bundle is not New-Testament-only.
   - Still open: **the option and the note differ on timing.** The option says
     the Old Testament comes "in an app update once their titles are ready"; the
     note says "Whole Bible included", with no stated date, and the record does
     not say the note replaces the option. Language packs are "TBD", and which
     languages' titles are bundled depends on file size. The note's "if
     possible" leaves localized titles undecided.
3. **R3-android-share** — "On Android, do export and Share Book need to work in
   the browser, or only in the installed app?" Decided: `app-only` — "The
   installed app only; the web build shows a message pointing to the app".
   - Settles: ADR 0011's open line on which share path the export uses on
     Android. Share Book in an Android browser
     ([#272](https://github.com/unfoldingWord/tc-mobile/issues/272)) is no
     longer a prerequisite for the export.
   - Still open: the web message's wording.
4. **R4-restore** — "Can a v2 backup be restored on a phone?" Decided:
   `write-only` — "Backup only in v2; restoring on a phone comes with import".
   Note: "Restore is v2-desired, not required. At a minimum, we need to be able
   to archive the data off the device. We'll figure out import after that."
   - Settles: question 11's restore half and ADR 0011's restore line.
   - Still open: when import lands is not dated beyond "after".
5. **R5-app-only-card** — "The microSD card is only reachable from the
   installed Android app. Is that acceptable?" Decided: `app-only` — "Yes: card
   recording and backup are Android-app features".
   - Settles: ADR 0011's expectation that the card path is native-only, which
     was an inference.
6. **R6-span-home** — "A segment that crosses a chapter (Q4): which chapter
   shows it?" Decided: `start-chapter` — "The chapter it starts in; it plays
   and exports there".
   - Settles: the open line on Q4-chapters and Q8-chapter-play (which chapter's
     play includes a crossing segment).
7. **R7-chapter-number** — "Chapter numbers (#1272): today a chapter's number is
   its position. What do template books do?" Decided: `always-real` — "Every
   chapter carries the number someone types or the template gives". Note:
   "Chapters should have titles/metadata that indicate what they are, as
   relying on order alone is brittle. In Bible recordings, the order will
   usually align with the chapter number declared in the metadata; when in
   doubt, the metadata is the authoritative source."
   - Settles: #1272's question. No earlier plan question.
8. **R8-level3** — "D6 says the 16 level-3 languages come "after". After what?"
   Decided: `after-2` — "After 2.0.0". Note: "the 16 level-3 languages are
   v2-desired (will become v3-required if they miss the v2 launch)"
   - Settles: D6-languages' "after".
   - Still open: D1-dataset puts titles in all 26 languages in v2. Whether
     level-3 titles ship in v2 ahead of the level-3 app text is still not
     recorded.
9. **R9-shema** — "#353 also asked for Shema Studio's format. Is it in v2?"
   Decided: `bundle-only` — "Scripture Bundle only in v2". Note: "Shema Studio
   import/export will be v3-required."
   - Settles: #353's second format.
10. **R10-audio-titles** — "Audio titles: v2 or v3?" Decided: `v3` — "v3, as
    the plan says". Note: "this has moved to v3-required."
    - Settles: the plan's "Moved to v3" line, now v3-required.
11. **R11-tcd-audio** — "translationCore 4 does not open audio bundles yet.
    What does "done" mean for v2 project export?" Decided: `valid-and-ask` —
    "Valid against the published spec and read back by our own test; we ask the
    translationCore 4 team to add audio". Note: "translationCore 4 Desktop
    development is on a merger path to support all the above in future
    releases."
    - Settles: what "done" means for the export. Question 12, second half, in
      part: the test bar is the published spec, not a desktop app.
    - Still open: which manifest fields and flavour the desktop app reads is
      still not recorded.
12. **R12-book-language** — "Should a book know its language?" Decided:
    `at-export` — "Ask only when exporting". Note: "Ask at export, then write
    it into the metadata for that book; keep the path to getting started as
    short as possible."
    - Settles: no earlier question; sets when a book's language is asked.
13. **R13-alarm-stall** — "If an alarm stops the recording without the phone
    telling the app, what should the recorder show?" Decided: `stalled-state` —
    "A visible "recording stopped" state that saves what was captured".
    - Settles: no earlier question.
14. **R14-community** — "Consent principle (#1436): who is "the community" that
    recordings belong to?" Decided: `recording-team` — "The team that made the
    recording". Note: "But give the opportunity to clarify/specify where
    appropriate"
    - Settles: #1436's definition.
    - Still open: how the app lets a team clarify or specify is not designed.
15. **R15-privacy-promise** — "Should PRIVACY.md also make the consent
    principle a public promise?" Decided: `no` — "Not yet: keep it internal
    until a sharing feature needs it".
    - Settles: no earlier question.
16. **R16-card-default** — "On Android phones with a card slot, should new
    recordings go to the card by default?" Decided: `off` — "Off by default; a
    facilitator switches it on". Note: "On launch, when the app notes that a
    micro SD card is available, it should prompt the user if they want to
    record directly to the card. Default is to record to internal."
    - Settles: D2-microsd's default.
    - Still open: **the note adds a launch prompt beyond the option.** The
      option says a facilitator switches it on; the note says the app prompts
      when it detects a card. Both are recorded; how they combine (for example,
      how often the prompt shows) is not decided.
17. **R17-card-encrypt** — "Should recordings on the card be encrypted?"
    Decided: `no` — "No: plain audio files the app owns".
    - Settles: no earlier question.
18. **R18-ui-words** — "Two wording calls from the rc.2 follow-ups (#1233)"
    Decided (free text, no option). Note: "Use "Reset recording"; Use the number
    and name"
    - Settles: #1233's two wording calls. The orchestrator's mapping, from the
      order the site's question listed them (not Tim's words): (1) #1233 items
      8, 9 and 12, one verb for removing a recording, "Reset" or "Clear" →
      "Use "Reset recording""; (2) item 21, shared file names use the chapter
      name only or its number and name (for example "03 Jonah runs") → "Use the
      number and name".
19. **R19-digits** — "Languages: which digits each language shows, whether
    Traditional-Chinese phones get the Simplified text, and whether tester-only
    screens are translated" Decided (free text, no option). Note: "Use Arabic
    numerals; default to simplified text on Chinese phones."
    - Settles: the digits call ("Use Arabic numerals") and, in part, the
      Traditional-Chinese call.
    - Still open: **the note did not answer whether tester-only screens are
      translated.** It says "default to simplified text on Chinese phones"; it
      does not say whether a Traditional-Chinese phone can switch to Traditional
      text.
20. **R20-new-book-licence** — "A new book that is not made from a template:
    what licence does it start with?" Decided: `empty-preselect` — "Empty until
    someone chooses; CC BY-SA 4.0 is pre-selected when they share".
    - Settles: question 9 in part (a non-template book's starting licence).
    - Still open: other licences and the file-name tag remain as above.

### DRI pick (verbatim)

Seth, 2026-10-19, on R1 and R2:

> ok great. i think the whole bible changes the scope, but mostly not with us in a sense. we We should be creating a modular system that allows for a book that's New Testament or Old Testament and adding some content. It's just something we can pull in at the time of the build. Let's make sure we're building our code in a way that is modular and capable of adapting to other sources that might be included.

### Coordinator reading

This is the coordinator's reading, not the DRI's words and not Tim's decision.
Template content is a set of packages in one source-agnostic shape (E2,
[#1451](https://github.com/unfoldingWord/tc-mobile/issues/1451)). Which
packages ship (OBS, 35 Stories, the New Testament, the Old Testament, the Bible
Passages dataset, later language packs or other sources) is chosen at build
time, not coded into the app. However R2's timing is settled, the Old Testament's arrival lands mostly on
the dataset side (E10,
[#1459](https://github.com/unfoldingWord/tc-mobile/issues/1459)) and the
build's package list, not on app code.

### Principle: template content is source-agnostic packages chosen at build time

Following the DRI's direction quoted above ("a modular system ... something we
can pull in at the time of the build ... modular and capable of adapting to
other sources that might be included"), the app's code does not know which
template collections exist. It reads packages of one shape, and the build
decides which are included. This is the DRI's direction, not a decision Tim
made in Round 2.

### What Round 2 leaves open

- The app-size budget (R1, R2), and whether language packs are downloaded
  (R2, "TBD").
- When the Old Testament ships: R2's option says in an app update once titles
  are ready, and its note says "Whole Bible included" (R2).
- Whether level-3 titles ship in v2 ahead of the level-3 app text (R8).
- Which manifest fields the desktop app reads (R11).
- How the launch prompt and the facilitator switch combine (R16).
- Whether tester-only screens are translated, and whether a Traditional-Chinese
  phone can switch to Traditional text (R19).
- The web message's wording (R3) and when import lands (R4).

## Round 3 decisions recorded 2026-10-19

The requirements owner answered a third set of twenty-two questions, S1 to S22,
on the project site's review page on 2026-10-19. The question text, the option
text and **the requirements owner's notes are quoted verbatim**. Where an answer
has no option, only a note, the entry says "free text, no option". Where an
answer has an option and no note, none was given. The S ids are this record's
own and are not the earlier D, Q or R ids. Recording an answer is not building
it: an entry's "Settles" line names what the answer bears on, and "Still open"
names what it leaves undecided where the record shows something.

1. **S1-story-template** — "1 · Finding things by story (#1435)". Decided
   `story-template`: "A story template is the answer; the Book, Chapter,
   Segment structure stays".
2. **S2-append-waveform** — "2 · Wide waveform while appending (#1201)".
   Decided `fine`: "Fine as it is".
3. **S3-editor-optional** — "3 · Should the editor be optional? (#595)".
   Decided `keep`: "Keep the editor as it is". Note: "Especially when
   dealing with segments that have been named, it is much more cumbersome to
   delete the entire segment than add it and move it into the right location
   and rename it. It is much easier to simply re-record the segment. Leave as
   is."
4. **S4-speech** — "4 · How the app speaks to people who do not read (#1344)".
   Decided `tts`: "The phone's own text-to-speech". Note: "Any user can use the
   phone's own text to speech, comma. That does not create any new issues for
   this app as long as the text strings are available to the phone operating
   system so that it can be converted to audio by the operating system."
5. **S5-after-interviews** — "5 · After the training interviews (#1271)".
   Decided `no-change`: "No change". Note: "It worked really well to have a
   separate microphone icon to indicate entering the recording studio. When we
   explained to users that it was a recording studio and it gave them a
   dedicated space for all recording and editing, they immediately appreciated
   that."
6. **S6-licence-when** — "6 · When the licence question appears (#1455)".
   Decided `once-per-book`: "Once per book, with a way to change it later".
7. **S7-id3** — "7 · Attribution inside the audio file (#252)". Decided
   `id3-v2`: "Also write title, comment and copyright inside the MP3 in v2".
   Note: "Everything that can be included in the metadata regarding the
   copyright and licensing should be included. But nothing should be included
   that potentially compromises the identity of the user."
   - Still open: which ID3 frames count as identity. The note names the
     constraint and no list. PR #1577 implements an allowlist (TIT2, TALB,
     TRCK, TCOP, COMM) with no person frames; that is the PR's reading, not a
     decision.
8. **S8-confidential** — "8 · Is the backup copy confidential? (#1474)".
   Decided `no`: "Not confidential". Settles: ADR 0014's Open 2a.
9. **S9-review-loop** — "9 · Review loop with the assistant (#1431)". Decided
   `share-sheet`: "The share sheet is enough for v2". Note: "We may revisit
   this in version three if the need is expressed. Otherwise we will just leave
   it as sharing at the chapter level."
10. **S10-level3-titles** — "10 · Level-3 template titles: v2 or later?
    (#1441)". Decided `level3-desired`: "Level-3 titles are v2-desired, like
    level-3 app text". Note: "V2 requires the top ten languages of level four.
    Everything else is V2 desired or V3 required depending on time
    constraints."
    - Still open: which languages beyond the top ten level-4 languages are
      V2-desired and which are V3-required "depending on time constraints".
      The note sets no rule for the choice.
11. **S11-tester-screens** — "11 · Are tester-only screens translated?".
    Decided `english`: "English only". Note: "We will revisit if this is
    needed."
12. **S12-chapter-badge** — "12 · Chapter badge when a chapter has a name
    (#1272)". Decided `name`: "Show the name only when there is one". Note:
    "Include an option in the settings to always show the sequential chapter
    number.By default it should show the chapter name when there is one, and
    the sequential numbering if there is not a chapter name."
    - Still open: R7 says every chapter carries the number someone types or the
      template gives. Whether "sequential" means that number or the chapter's
      place in the list is not recorded, and neither is where the setting
      lives.
13. **S13-duplicate-names** — "13 · Two books with the same name (#1272)".
    Decided `block`: "Block it". Note: "require unique names for the books."
14. **S14-long-names** — "14 · Reading a long name in full (#1284)". Decided
    `tap-hold`: "Tap or hold a name to see it in full".
15. **S15-consent-wording** — "15 · Mark the consent principle Accepted? (ADR
    0012)". Decided `accept`: "Yes, mark it Accepted". Settles: ADR 0012 is
    Accepted, for the wording of the principle only. The author's reading of
    its consequences is not covered (see the paragraphs under the ADR's status
    line).
16. **S16-mic-refused** — "16 · Mic permission refused twice (#1089)". Decided
    `steps`: "Steps for turning the microphone on in phone settings".
17. **S17-unclear-menu** — "17 · Which menu options did the interviews show
    were unclear? (#1212)". Free text, no option: "nothing to report,
    leave as-is".
18. **S18-icon-check** — "18 · Was the ten-minute icon-recognition sheet run at
    the training, and are there filled sheets? (#249)". Free text, no option:
    "not run, but all evidence indicates users understood without any
    difficulty".
19. **S19-arr-filename** — "19 · File name for books that stay "all rights
    reserved" (#1455)". Decided `no-tag`: "Leave the tag off". Note: "Note: the
    only license options to be included are CC0, CC BY, and CC BY-SA. If the
    user selects "Other" the filename should not show any licensing
    information."
    - Settles: ADR 0014's Open 2b in part (see the ADR).
    - Answered later by the DRI, 2026-10-21 (Round 5, U1b): for a book whose
      licence is "Other" or not chosen yet, the export copyright is "Say
      nothing", carried as the statement "No licence chosen." (the DRI's
      pick, verbatim: "\"No licence chosen.\""; ADR 0014 point 6).
    - Still open (Round 5, U1a, for the requirements owner): D5-licence's
      option lists "all rights reserved" and S19 lists CC0, CC BY and CC BY-SA
      plus "Other". Whether "Other" is the same as all rights reserved is not
      recorded.
20. **S20-video** — "20 · Video (#1434)". Decided `out`: "Not in scope".
21. **S21-mic-level** — "21 · Mic input level (#359)". Decided `suggest`:
    "Suggest raising it after a quiet first take".
22. **S22-palettes** — "22 · Alternate colour palettes (#956)". Free text, no
    option: "No alternate color palettes in v2. If requested by users, we'll
    consider for v3".

## Round 4: one decision, four not decided

Round 4 is five questions that came out of the 2026-10-20 call. Only T4 is
decided.

### T4 is decided by the DRI

**T4-normalize-when** — "When does normalization run?" Decided `on-finished`:
"When a segment is marked Finished". The DRI recorded it, with this note (the
attribution prefix is replaced by a role): "[the DRI], Zulip 2026-10-20:
"normalize should be on 'finalize segment' - not on export because at finalize
it converts from wav (non-lossy format) to mp3 (lossy) so you want to run it
before that step.""

The DRI decided it as pipeline placement, which is a technical question and so
the DRI's call. The DRI's standing rule, 2026-10-21, verbatim: "note that
technical questions are for me". It waits on no confirmation from the
requirements owner. The call record has the requirements owner describing a
checked box on export; T4 is the DRI's answer to that.

Two Round 5 questions follow from it and are answered:

- **U6a** (does normalization run when a segment is marked Finished): "Decided
  by T4 (the DRI, 2026-10-20): normalize when a segment is marked Finished,
  before the lossy MP3 step."
- **U6c** (segments finished before it ships, and unfinished segments in a
  shared chapter): the DRI, picker 2026-10-21: "Leave them as they are
  (Recommended)".

WAV retention is not a new question. [ADR 0009](../decisions/0009-transcode-on-finished.md)
already says that Finished drops the PCM: "transcode to MP3 and drop the PCM
when the translator marks it **Finished**", and "The PCM is gone exactly when
the MP3 is durable; there is no intermediate state." That is existing
behaviour, in one transaction. T4 puts normalization before that step, so the
stored copy is the evened-out one.

Where it sits relative to the finish transaction, read from
`src/hooks/finish-transcode.ts` as it stands (normalization is not in that file
yet): a sweep turn loads the clip's PCM (`loadSegmentClip`), computes the peaks,
encodes (`codec.encodeMp3(samples)`) and only then calls
`commitTranscode(segmentId, clipId, mp3, peaks)`, the one transaction that
replaces the PCM. T4's placement means normalization runs on the in-memory PCM
before the encode, so the PCM is dropped only in that commit. A crash before the
commit keeps the un-normalized PCM, and ADR 0009 says the next sweep redoes it
("the PCM is still there"). That is the consequence of the placement, not yet
built code. Whether a switch to turn it off exists, and
whether it is on by default, are not recorded.

### T1, T2, T3 and T5 are not decided

These were asked and have **no final record and no answer from the requirements
owner**. The lines below are picks by other roles, recorded as picks, not as
decisions. Nothing in this repository should treat them as settled.

- **T1** — "Restore in 1.2?" Options: "Yes: backup and restore both ship in
  1.2" (`restore-1-2`), "Backup in 1.2; restore later, as R4 says"
  (`backup-1-2`). Picks: the DRI and the PM both `restore-1-2`; the PM's note:
  "As discussed in the meeting, to prevent data loss on upgrade or reinstall."
  R4 (final) still says backup only in v2.
- **T2** — "Where does a backup go?" Options: "microSD card and cloud; no
  on-device copy" (`card-cloud`), "microSD card, cloud and an on-device copy"
  (`card-cloud-device`). Picks: the DRI and the PM both `card-cloud-device`; the
  DRI's note: "I think the user should choose. iphones dont have SD cards."
- **T3** — "Which cloud first?" Options: "iCloud and Google Drive together"
  (`both`), "iCloud first" (`icloud`), "Google Drive first" (`gdrive`). Pick:
  the DRI `both`. The PM made no pick.
- **T5** — "A level slider, and a limiter while recording?" Options: "Fully
  automatic, no slider" (`auto`), "Add a slider for how loud" (`slider`).
  Picks: the DRI and the PM both `auto`.
