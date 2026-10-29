# Template package contract v0

This is the file shape tC Mobile reads when it builds a book from a template:
a Bible book, a collection of passages, a hymnal, Open Bible Stories. People
who build a content source read this first, before either side writes code.

Every rule below cites the code on `develop` that holds it. The types are in
`src/types/template.ts` and the validator is `src/lib/templates/validate.ts`
(cited below as `types/template.ts` and `validate.ts`). The validator is the
contract: a file it refuses is not a template package, whatever this page
says. Where a rule is kept by convention and no code can check it, the page
says so.

Part of #1451 (modular content sources). The format is v0, `formatVersion: 0`.
Written for #1467.

## The principle

The requirements owner decided on 2026-10-19 (verbatim): "We should be
creating a modular system that allows for a book that's New Testament or Old
Testament and adding some content. It's just something we can pull in at the
time of the build."

So the app never knows which source made a package. Nothing in the types or
the validator names a source, a testament or a dataset
(`types/template.ts:7-11`), and the validator never branches on `kind` or on
a book code (`validate.ts:16-19`). `tests/template-validate.test.ts` holds
both files to that by reading their code, and by validating a hymnal fixture
nobody wrote code for (`tests/fixtures/templates/hymnal-min.json`). A new
source is a new package.

## What a package is

A package is one JSON file: an ordered list of chapters, each an ordered list
of segments, with an optional passage span per segment, and the package's own
`title`. Chapter and segment titles are not in that file; they ship as
separate tables, one per language (see "Title tables").

A package holds one book or one collection. A whole New Testament is
therefore a set of packages, one per book. How a phone groups them is the
app's business, not the package's.

## Fields: `TemplatePackage`

Every key is required. A key that is absent is refused, because the validator
reads each key and refuses a value of the wrong type. Unknown extra keys are
ignored: the validator copies out only the keys named here
(`validate.ts:342-356`), so do not rely on them. Every text value must be
non-empty and must not start or end with whitespace; padding is refused, not
trimmed, so the string the app stores is the string that was checked
(`validate.ts:97-110`).

| Field              | Meaning and rule                                                                                                                                                                                                                                       | Cite                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `format`           | The literal `"tc-mobile-template"`. Anything else is refused.                                                                                                                                                                                          | `types/template.ts:89`, `validate.ts:279-281`                |
| `formatVersion`    | The contract's own version. Exactly `0` today. A reader refuses a version it does not know, and the message names the version it was given.                                                                                                            | `types/template.ts:90-91`, `validate.ts:282-287`             |
| `id`               | The package's identity, for ever. Stable and never reused. Starts with a letter or digit, then letters, digits and `: . _ -`, at most 64 characters. Examples in the fixtures: `bible:MRK`, `collection:psalm-songs`.                                  | `types/template.ts:92`, `validate.ts:38,288`                 |
| `version`          | The package's content version, as semver 2.0.0 (no leading zeros; pre-release and build metadata allowed). See "Versions".                                                                                                                             | `types/template.ts:93-94`, `validate.ts:42-49,289`           |
| `kind`             | What the package is, as a lowercase slug the source picks: `bible-book`, `collection`, `hymnal`. Starts with a letter, then lowercase letters, digits and `-`, at most 32 characters. Open vocabulary: a new slug needs no edit to types or validator. | `types/template.ts:22-29,95`, `validate.ts:39,290`           |
| `bookCode`         | The source's own short code for the whole package, or `null` if it has none. Capitals, digits, `_` and `-`, 1 to 16 characters (`MRK`).                                                                                                                | `types/template.ts:96-97`, `validate.ts:41,291-294`          |
| `title`            | The package's own name, as an object from language tag to text. At least one entry, each non-empty, and each language must be listed in `titleLanguages`.                                                                                              | `types/template.ts:98-99`, `validate.ts:297-308`             |
| `titleLanguages`   | Every language a title table may cover, as BCP-47 tags. At least one, no duplicates (tags compare without regard to case). The check is the tag's form only; it does not look subtags up in the registry.                                              | `types/template.ts:100-101`, `validate.ts:50-65,255-274`     |
| `dataLicence`      | The licence of the package data itself: one of the `LicenceId` ids below, exactly as written there. Any other value is refused.                                                                                                                        | `types/template.ts:102-103`, `validate.ts:24-34,136-150,310` |
| `recordingLicence` | The licence of recordings made from this template. Exactly `"CC-BY-SA-4.0"`; v0 admits no other value (decision D5).                                                                                                                                   | `types/template.ts:104-105`, `validate.ts:22-23,311-313`     |
| `attribution`      | The credit line that must travel with any display or export of the package. Non-empty text.                                                                                                                                                            | `types/template.ts:106-107`, `validate.ts:314`               |
| `source`           | Where the content came from: an object with `url` and `revision`, both required (below).                                                                                                                                                               | `types/template.ts:108`, `validate.ts:316-328`               |
| `chapters`         | The ordered list of chapters. At least one. Order is the order the app shows.                                                                                                                                                                          | `types/template.ts:109`, `validate.ts:329-340`               |

### `source`

| Field      | Meaning and rule                                                                               | Cite                  |
| ---------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| `url`      | Where the content lives. Must parse as an `http` or `https` URL.                               | `validate.ts:317-326` |
| `revision` | The exact revision the package was built from (a commit, a tag, a release id). Non-empty text. | `validate.ts:327`     |

### `LicenceId`

The ids the app's types name for a data licence: `CC-BY-SA-4.0`, `CC-BY-4.0`,
`CC0-1.0`, `all-rights-reserved` (`types/template.ts:41-42`). An SPDX id where
one exists; all-rights-reserved has none. These are the only values
`dataLicence` may take: the validator refuses anything else
(`validate.ts:24-34,136-150,310`).

### `TemplateRef`

Not a file field. It is what a book keeps to say which package, at which
version, it was made from: the package's `id`, `version` and `kind`
(`types/template.ts:32-38`, `validate.ts:360-362`).

| Field     | Meaning and rule                                 | Cite                   |
| --------- | ------------------------------------------------ | ---------------------- |
| `id`      | The package `id`. Stable for ever, never reused. | `types/template.ts:34` |
| `version` | The package `version` the book was made from.    | `types/template.ts:36` |
| `kind`    | The package `kind`.                              | `types/template.ts:37` |

## Fields: `TemplateChapter`

| Field      | Meaning and rule                                                                                                                                                                                                                                                | Cite                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `key`      | The chapter's stable key. Unique among the package's chapter keys; segment keys are a separate namespace, so a chapter key may equal a segment key. Same character rules as a segment key. Stable across versions of one package id (a convention, see "Keys"). | `types/template.ts:74-79`, `validate.ts:40,236-239` |
| `number`   | The real chapter number: an integer of at least 1, always present, unique within the package. A template gives the number; order alone is not the authority (R7).                                                                                               | `types/template.ts:80-84`, `validate.ts:240-244`    |
| `segments` | The ordered list of segments. At least one: a chapter with none is refused.                                                                                                                                                                                     | `types/template.ts:85`, `validate.ts:245-251`       |

## Fields: `TemplateSegment`

| Field       | Meaning and rule                                                                                                                                                                                                                           | Cite                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `key`       | The segment's stable key. Starts with a letter or digit, then letters, digits and `. : _ -`, at most 64 characters. Unique across the whole package, not just within its chapter. Stable across versions of one package id (a convention). | `types/template.ts:65-66`, `validate.ts:40,209-211` |
| `reference` | Where the segment sits in its source, as a span (below), or `null` for a segment with no passage, such as an introduction.                                                                                                                 | `types/template.ts:67-68`, `validate.ts:212-215`    |
| `thumbnail` | A path to a bundled image, or `null`. Relative: letters, digits and `. _ / -`, at most 128 characters, no scheme, no leading slash, no `..` segment.                                                                                       | `types/template.ts:69-70`, `validate.ts:67,216-224` |

## Fields: `SegmentSpan`

A span is numbers, never a scope string such as `"MRK 1:1-8"`. Every number is
an integer of at least 1 (`validate.ts:152-157`). Three states are allowed
(`types/template.ts:44-52`):

- Whole chapters: both verses `null`, `startChapter <= endChapter`.
- Verses in one chapter: both verses numbers, same chapter,
  `startVerse <= endVerse`.
- Verses across chapters: both verses numbers, `startChapter < endChapter`. A
  span may cross a chapter boundary (decision Q4); the collection fixture has
  one, `PSA` 17:50 to 18:1.

One verse `null` and the other a number is refused, and so is a span that ends
before it starts (`validate.ts:180-199`).

| Field          | Meaning and rule                                                                                                        | Cite                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `book`         | An opaque short code the source uses: capitals, digits, `_` and `-`, 1 to 16 characters. The app does not interpret it. | `types/template.ts:54`, `validate.ts:41,169`  |
| `startChapter` | The chapter the span starts in. Integer, at least 1.                                                                    | `types/template.ts:55`, `validate.ts:170-173` |
| `startVerse`   | The verse the span starts at, or `null` for whole chapters.                                                             | `types/template.ts:56`, `validate.ts:174`     |
| `endChapter`   | The chapter the span ends in. Integer, at least 1, not before `startChapter`.                                           | `types/template.ts:57`, `validate.ts:175`     |
| `endVerse`     | The verse the span ends at, or `null` for whole chapters.                                                               | `types/template.ts:58`, `validate.ts:176`     |

## Title tables

Titles ship as one table per language, so a phone loads only the one it shows
(`types/template.ts:112-115`). A package with titles in three languages is one
package file and three table files.

### `TemplateTitleTable`

| Field       | Meaning and rule                                                                                                                            | Cite                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packageId` | The `id` of the package this table belongs to. Must equal it.                                                                               | `types/template.ts:117`, `validate.ts:389-392`         |
| `version`   | The `version` of the package this table belongs to. Must equal it exactly: a table for 0.1.0 is refused against 0.2.0, never applied to it. | `types/template.ts:118`, `validate.ts:393-399`         |
| `language`  | The one language this table covers. Must be in the package's `titleLanguages`.                                                              | `types/template.ts:119`, `validate.ts:400-403`         |
| `chapters`  | An object from chapter `key` to title. Each key must be a chapter key the package has, each title non-empty. May be empty.                  | `types/template.ts:120-121`, `validate.ts:404,412`     |
| `segments`  | An object from segment `key` to title. Each key must be a segment key the package has, each title non-empty. May be empty.                  | `types/template.ts:122-123`, `validate.ts:405-407,413` |

### What a missing key does on the phone

A key the table lacks has no title, and that is never an error
(`types/template.ts:114-115`). In plain words: the lookup gives no title for
that chapter or segment, and it does not fail. That the book then still opens,
records, edits and shares as it did is the intended behaviour once a screen
reads titles; nothing in `src/` calls `titleFor` yet, so no test or device run
backs it.

`titleFor` returns no title, and never throws, in each of these cases
(`validate.ts:417-431`):

- no title table for the phone's language is loaded;
- the book was made without a template, so it has no key;
- the table has no entry for the key, for example because a later package
  version dropped that key.

The opposite case is an error at the source: a key the table has but the
package lacks fails validation (`validate.ts:373`). Leaving a title out is
allowed. Naming a key that does not exist is not.

`tests/template-validate.test.ts` ("a key that goes missing between versions")
pins the first case: a book keyed `s2` reads a title from v0.1.0, reads none
from v0.2.0, and nothing throws.

## Keys

Chapter and segment keys are how a book keeps its place in a template as the
template changes, and how a title is found. So:

- A key never changes meaning within one package `id`. A segment that was
  `MRK.1.1-8` in 0.1.0 is the same passage in 0.4.0.
- A key is not reused for different content, even after the old content is
  dropped.
- Dropping a key is allowed; the books that hold it lose its title and keep
  everything else, as above.

Nothing checks this. The validator reads one package at a time, so it cannot
see that a key moved between versions. The source's own release process has to
keep it. The fixtures `pair-v0.1.0.json` and `pair-v0.2.0.json` show a
legitimate drop. Breaking the rule is a defect in the source, not something the
app can repair.

## Versions

Two numbers move independently.

**`formatVersion`** is this contract's version. Today only `0` exists, and a
reader refuses any other value (`validate.ts:282-287`). A change to the
contract that an older reader could not handle is a new `formatVersion`,
written into this page before any source uses it.

**`version`** is the package's content version, semver 2.0.0. The validator
checks only that the string is well-formed semver (`validate.ts:42-49,289`); it
never compares versions. The rules below are an assumption: they are the
reading of #1467, not a decision the requirements owner has recorded, so
confirm them before the first source relies on them.

- Patch: no key added, dropped or retargeted (a typo in `attribution`, a
  corrected `thumbnail` path).
- Minor: keys added. Every key an existing book already holds still names the
  same passage.
- Major: keys dropped or content reorganised. Books holding a dropped key lose
  its title (see above) and keep their recordings.
- A span that moves under an existing key breaks the rule under "Keys"; give
  the new passage a new key instead. Do not ship a span change under a stable
  key while this list is still an assumption.
- A published version is never edited. A change is a new version.

Title tables carry the package `version` and must match it exactly
(`validate.ts:393-399`), so every package release ships its own tables, even
when the titles did not change.

## What "published" means

An assumption, not a decision: a published package is a tagged release of the
source's own repository, with the package file and its title tables attached as
release assets, and `source.revision` naming that tag. The dataset repository
that would hold this does not exist yet, and who owns it is open. Until that is
decided, "published" has no stronger meaning than "a file a build can fetch at
a fixed revision".

## Adding a content source

The goal is that a new source needs no change to app code. The contract half of
that is checked by tests today. The build half is not built yet, and this page
says so instead of describing it as done.

1. **Choose the identity.** Pick an `id` (`bible:MRK`, `collection:psalm-songs`)
   and a `kind` slug. Neither needs to exist anywhere in the app first
   (`types/template.ts:22-29`).
2. **Write the package file.** One chapter per chapter, one segment per unit of
   work, each with a stable `key` and, where it has a passage, a numeric span.
   A Bible book looks like `tests/fixtures/templates/bible-book-min.json`
   (`bookCode: "MRK"`, keys like `MRK.1.1-8`). A passage collection looks like
   `tests/fixtures/templates/collection-min.json` (`bookCode: null`, an
   introduction with a `null` reference, a span across a chapter boundary). A
   source with no scripture at all looks like
   `tests/fixtures/templates/hymnal-min.json`.
3. **Write one title table per language**, and list each language in
   `titleLanguages`. `titles-collection-min.es.json` is a table that leaves a
   key out on purpose.
4. **Run the validator on it.** `parseTemplatePackage` and
   `parseTemplateTitleTable` throw `TemplateValidationError` on the first
   violation and name the field (`validate.ts:70-77`). A package that passes is
   a package the app accepts.
5. **Publish it** as described above.
6. **Add it to the build's package list**: its loader goes in `PACKAGES` in
   `src/lib/templates/packages.ts` (#1451), which runs every package through
   the validator. The decision above says the content is pulled in at build
   time and that app code stays source-agnostic, so adding a source is a line
   in that list and nothing else.

What step 6 must not need is the point of the design: no edit to
`src/types/template.ts`, `src/lib/templates/validate.ts`, or any screen. If a
new source seems to need one, either the source or the contract is wrong, and
the contract is changed on this page first.

## Worked example: Open Bible Stories (in review on #1533)

Open Bible Stories is not yet published as a package file; it is adapted at
runtime from the catalogue already bundled in the app. The adapter is
`src/lib/templates/obs.ts` on PR #1533 (branch `feat/1466-obs-template-package`),
still in review. Its details may change and nothing in this contract depends on
them. As it stands on that branch it maps:

- a story to a chapter (key `01` to `50`, `number` the story number);
- a frame to a segment (key like `01-07`) whose span is that one frame, with
  chapter:verse equal to story:frame;
- the story titles into one English title table, with an empty segments table
  because frames have no titles.

It then passes the result through `parseTemplatePackage`, so the adapter cannot
hand the app a shape the contract refuses. Everything specific to that source
(the id, the kind, the key format) lives in the adapter and nowhere in the types
or the validator.

## Examples a source must satisfy

These fixtures are small and invented; none is a real dataset. A source's files
must pass the same validator they do.

| File                                                                                                                        | Shows                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `tests/fixtures/templates/obs-min.json`                                                                                     | Stories as chapters, one frame per segment.                                    |
| `tests/fixtures/templates/bible-book-min.json`                                                                              | A Bible book: `bookCode`, verse spans inside a chapter.                        |
| `tests/fixtures/templates/collection-min.json`                                                                              | A passage collection: no `bookCode`, a `null` reference, a cross-chapter span. |
| `tests/fixtures/templates/hymnal-min.json`                                                                                  | A source that no code in the app knows about.                                  |
| `tests/fixtures/templates/titles-collection-min.es.json`                                                                    | A title table for one language, leaving a key out.                             |
| `tests/fixtures/templates/pair-v0.1.0.json`, `pair-v0.2.0.json`, `titles-pair-v0.1.0.en.json`, `titles-pair-v0.2.0.en.json` | One package id at two versions, a key dropped between them.                    |

## Keeping this page honest

`tests/template-contract-doc.test.ts` reads this page and
`src/types/template.ts` and fails on a field present in one and not the other,
interface by interface. It checks names, not meaning. The prose and the line
cites above are kept by review, and line numbers move when those files change,
so a stale cite is a defect to fix where it is found.
