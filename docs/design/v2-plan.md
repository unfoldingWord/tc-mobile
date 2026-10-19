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
the decision settles, fully or in part.

The decision IDs below are this record's own. Their D and Q numbers are not the
pivot plan's D and Q numbers: pivot-plan D4 (microSD via the share sheet) and
v2 D4-collections are different decisions.

### Product (owner: Tim)

| ID                 | Question                                                     | Decided                                                           | Tim's note (verbatim)                                                                                                                                                                                                                                                                 | Answers                                                                                               |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **D1-dataset**     | How much of the Bible Passages dataset is in v2?             | "All 66 books, titles in all 26 languages"                        | "The Bible Passages dataset is going to be a work in progress for a long time to come, so we should ship v. 0.1 ASAP and update it over time."                                                                                                                                        | None directly. It sets the dataset's v2 target; question 2 (the chunk count) is what sizes it.        |
| **D2-microsd**     | What does v2 do with the microSD card on Android?            | "Record straight onto the card, and back up to it"                | "Removing a card mid-recording is highly unlikely, so should be warned against, but not worried about."                                                                                                                                                                               | 10 (replaces pivot-plan D4; see ADR 0011); 11 in part (card removal while recording).                 |
| **D3-export**      | Does v2 also import a project exported from another phone?   | "Export in v2, import later"                                      | "For v2, we are looking to be able to safeguard data off-device. We need to use Scripture Bundle format (tragically misnamed as "Scripture Burrito" for a long time up until it was corrected, so don't be confused by it). tC Desktop does/will read/write Scripture Bundle format." | 12 (import is later; the format is Scripture Bundle, which tC Desktop reads and writes per the note). |
| **D4-collections** | Which collection is required, and what comes inside the app? | "Bundle OBS, the collection and the New Testament books"          | None.                                                                                                                                                                                                                                                                                 | 6 in part (the starter set; no app-size budget is set). 5 stays open: the collection is not named.    |
| **D5-licence**     | How do licences work when someone shares?                    | "Books made from a template are CC BY-SA 4.0; other books choose" | "All OBS recordings are CC BY-SA 4.0 (as per the license); recordings of Scripture propose CC BY-SA 4.0 as the default with the rationale: "You keep your copyright in the work and also allow others to freely and legally share this work with others.""                            | 9.                                                                                                    |
| **D6-languages**   | How do the 26 languages arrive?                              | "The 10 level-4 languages in v2, the 16 level-3 languages after"  | None.                                                                                                                                                                                                                                                                                 | 1 in part (order). Arabic is level 4, so right-to-left layout is in v2.                               |

### Delivery (owner: Seth)

| ID                  | Decided                                                                                       | Answers                                  |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **P1-start**        | "Sprint 6 (2 Nov), once v1.1 is in production"                                                | None.                                    |
| **P2-version**      | "Keep sprint-end minors (1.2, 1.3 …); the release that completes the required items is 2.0.0" | None.                                    |
| **P3-labels**       | #956 and #359: "Remove the label; they stay in Backlog"                                       | None.                                    |
| **P4-dataset-home** | "Its own Servant.Bible repo and owner; tC Mobile reads a published template package"          | None. The repository does not exist yet. |

### Later questions

| ID                  | Question                                        | Decided or recorded text (verbatim)                                                                                                                              | Answers                                                               |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Q1-order**        | Language order for titles and app text          | Tim: "We will use AI to draft all of them and revise them as-needed. There is a lot of prior art in 18n/l10n work, so we should be fine."                        | 1 (with D6-languages).                                                |
| **Q3-reviewers**    | Who reviews titles, and the rule                | Tim: "Use AI to draft, we'll revise as-needed."                                                                                                                  | 3.                                                                    |
| **Q4-chapters**     | Can a segment cross a chapter boundary?         | "Yes: a segment stores a start and an end chapter:verse"                                                                                                         | 4 in part. The UTN release is not picked.                             |
| **Q7-blue**         | Which blue is the selection envelope?           | "A new selection colour, so it never reads as the guide ring"                                                                                                    | 7.                                                                    |
| **Q8-chapter-play** | What does a second tap do?                      | "It pauses, and the row shows how far through the chapter it is"                                                                                                 | 8.                                                                    |
| **Q11-backup**      | Backup contents and restore                     | Tim: "Default to including everything, all metadata, in a Scripture Bundle format with a robust manifest. We can process it later."                              | 11 in part (contents and format). Restore stays open; see below.      |
| **Q13-images**      | Header images: source, licence, offline storage | Tim: "Header images are CC0 when generated on the app. Store them wherever, preferably embedded in the MP3 at a low resolution to not consume too much storage." | 13.                                                                   |
| **Q14-legal**       | Legal view on New Generations sets              | Tim: "They are data, like a phonebook, not subject to copyright restrictions."                                                                                   | 14, as **the product owner's position**. No legal review is recorded. |

### What is still open

- **Question 2** — the chunk count is not a decision. It is counted outside
  this file and is not restated here.
- **Question 4, first half** — which UTN release.
- **Question 5** — which passage collection is required. D4-collections bundles
  "the collection" without naming it.
- **Question 6, second half** — the app-size budget for the starter set.
- **Question 11, restore** — D3-export puts import after v2, and Q11-backup
  puts the backup in Scripture Bundle format. Read together (an inference, not
  a decision), a v2 backup can be written but the app cannot restore it. Whether
  that is what the requirements owner intends is a question for the
  requirements owner;
  [ADR 0011](../decisions/0011-v2-storage-and-export.md) records it as open.
- **Question 12, second half** — what tC Desktop needs to open the package,
  beyond the format the D3-export note names.
- **Question 14** — no legal review is recorded. The plan's own line says a
  legal view comes "before shipping them".
