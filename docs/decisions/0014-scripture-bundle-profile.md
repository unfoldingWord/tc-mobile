# 0014 — The Scripture Bundle profile tC Mobile writes

**Status:** Accepted 2026-10-21 by the DRI, with Open 1 unanswered (see "Open") · **Date:** 2026-10-19 (drafted); 2026-10-21 (accepted) · **DRI:** the dev lead drafted it and accepted it; the requirements owner answered the product questions in "Open" · **Issue:** [#1474](https://github.com/unfoldingWord/tc-mobile/issues/1474), part of the v2 export epic [#1457](https://github.com/unfoldingWord/tc-mobile/issues/1457)

This ADR is **Accepted**. It decides what the `metadata.json` of an exported
book says, so the build lanes that write it (the metadata builder, the zip
writer, the language question in #1492) have one thing to follow.

It was drafted Proposed for two reasons. The requirements owner had not
answered the two product questions in "Open"; S8 and S19 (2026-10-19) answer
them, one fully and one in part. The spec's maintainers had not been asked to
confirm points 1, 2 and 4, and had given no answer by 2026-10-21. The DRI
accepted it on 2026-10-21 with that second reason standing. The DRI's pick,
verbatim: "Accept, Open 1 'no answer by 10-21' (Recommended)". One point of the
licence mapping stays visibly open (see "Open"); this acceptance does not settle
it.

## Naming

We say **Scripture Bundle** (formerly Scripture Burrito) in the app, the docs
and this ADR. The published spec has not been renamed in any place we looked:
its schema still enumerates `"format": "scripture burrito"`, and its repository,
documentation and flavour names still say "burrito". What goes in the file is
what the schema demands, not what we call the format. Every identifier below
(`format`, `ingredients`, `flavorType`, `currentScope`, the role names) is
copied from the spec's schemas. Nothing is invented except the `x-` names the
spec reserves for implementers, and those are marked as ours.

## Context

The v2 plan wants a book to leave the phone as one file that holds the audio
and everything the app knows about the book. The decisions this serves, as
recorded on [#1474](https://github.com/unfoldingWord/tc-mobile/issues/1474) and
in the 2026-10-19 round of answers:

- **D3-export**, the requirements owner: "For v2, we are looking to be able to
  safeguard data off-device. We need to use Scripture Bundle format […]. tC
  Desktop does/will read/write Scripture Bundle format."
- **Q11-backup**: "Default to including everything, all metadata, in a Scripture
  Bundle format with a robust manifest. We can process it later."
- **Q4-chapters**: "Yes: a segment stores a start and an end chapter:verse".
- **R3**: export works in the installed app only; the web build points to the
  app.
- **R9**: Scripture Bundle only in v2 (Shema Studio is v3-required).
- **R11**: "done" is "Valid against the published spec and read back by our own
  test; we ask the translationCore 4 team to add audio".
- **R12**: a book's language is asked at export and written into that book
  (#1492).
- **R7**: chapter numbers are real metadata, and "when in doubt, the metadata is
  the authoritative source".
- [ADR 0006](0006-obs-content.md) implications 1 and 3: attribution travels
  with exported OBS-derived work, and the trademark must not.
- [ADR 0011](0011-v2-storage-and-export.md) (v2 storage and export; at the time
  of writing it is in the open PR [#1441](https://github.com/unfoldingWord/tc-mobile/pull/1441), not yet on `develop`, so this link resolves once that
  merges) says export and backup share one format. This ADR is that format's
  profile.

### What the spec is, and what I could and could not check

Spec and schemas: <https://github.com/bible-technology/scripture-burrito>
(code MIT, docs CC BY-SA 4.0). Published docs: <https://docs.burrito.bible/>,
which serves `v1.0.0`.

Observed on 2026-10-19 by fetching the tag and the branch and running the
spec's schemas under ajv 8.20 with ajv-formats 3.0.1 (the validator pair the
spec's own `code/validate.js` uses, with the schema loader of my own because
upstream has trailing commas in some files):

|                                                                          | v1.0.0                                                                                                                                                                                   | 2.0.0 working draft                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where                                                                    | tag `v1.0.0`, commit `b4583610fca90cae6ef6a7b305903b315b772258`                                                                                                                          | branch `develop`, commit `6ed32ccb095a34221c16901484bd5640515901dd` (2026-10-16)                                                                                                                                                                                                                                  |
| `audioTranslation` flavour                                               | `performance` and `formats` required, nothing else allowed (`schema/scripture/audio_translation.schema.json`, `"required": ["performance", "formats"]`, `"additionalProperties": false`) | flavour carries `name` only; `performance` moves to optional per-ingredient `properties` (from the scope crawl of 2026-10-19, whose reading of the draft I did not redo; my loader picked the wrong one of two schema files sharing an id on `develop`, so my own run of the draft's audio rules is not reliable) |
| Custom flavour (`parascriptural` + `x-name`), no ingredient `properties` | passes (my run)                                                                                                                                                                          | passes (my run)                                                                                                                                                                                                                                                                                                   |

Two things my run showed that the scope crawl did not:

1. **v1.0.0 does not enforce `languages`.** `schema/source_metadata.schema.json`
   lines 55–71 say a `scripture` or `gloss` bundle requires `languages`, but the
   `if` compares `flavorType` (an object) with an enum of strings, so it never
   fires. A scripture audio bundle with no `languages` **passed** my v1.0.0 run
   and **failed** my run on `develop`. We write `languages` always (point 5), so
   the bundle is valid under both.
2. **One audio `metadata.json` cannot validate under both generations**, as the
   crawl said, but a custom flavour with no ingredient `properties` validates
   under both. That is the reason it is the fallback in point 2.

## Decision

### 1. Spec version: v1.0.0

`meta.version` is `"1.0.0"` and our test gate validates against the v1.0.0 tag
(commit above).

_Reason._ It is the tag the published documentation serves, and the 2.0.0 draft
is a working draft: its own audio example still says `"2.0.0"` while its schema
enum is `"1.0.0"` (scope crawl; not re-run). Validators in the wild follow the
published version. translationCore 4 bundles an equivalent copy of the v1.0.0
schemas for its own checks (crawl, `conformance/sb-schema/`; I did not read that
repository myself).

_When we would move._ When the 2.0.0 spec is released as a tag with a
`meta.version` that accepts `"2.0.0"`, and a maintainer or the translationCore 4
team confirms the readers we care about validate against it. The move is a
reviewed schema-bump change (vendored schemas, flavour rule, worked examples).
Books on the custom flavour path (point 2) are unaffected by that move; books on
`scripture/audioTranslation` change shape (the flavour loses `performance` and
`formats`, which become ingredient `properties`).

### 2. Flavour rule

Compute once per export, over the segments that have audio:

- **`scripture` / `audioTranslation`** only when **every** recorded segment has
  a reference in **one** USFM book code from the spec's `scope.schema.json`
  enumeration (`GEN` … `REV`, deuterocanon, a few extras). `currentScope` lists
  the book with the union of its segments' spans, e.g. `{"MRK": ["1:1-8", "1:9-13"]}`.
  A span may cross a chapter: `"1:9-2:3"` validates (observed).
- **Otherwise** (Open Bible Stories, books with no references, books mixed
  across several USFM books or with some unreferenced segments):
  `type.flavorType.name = "parascriptural"`, `flavor.name = "x-tcMobileAudio"`,
  and **no `currentScope`**.

_Reasons, each observed._

- `currentScope` must have at least one key and every key must be a USFM code:
  an empty `{}` fails (`minProperties`) and `{"OBS": []}` fails the enumeration,
  on both the audio flavour and the custom flavour, under `scripture` and
  `gloss`. `OBS` is the code the app stores for Open Bible Stories
  (`src/lib/obs/catalog.ts:103`), so an OBS book cannot use a flavour that
  requires `currentScope`. `parascriptural` does not require it.
- `Segment.reference` is `null` for every segment today
  (`src/lib/storage/books.ts:901` is the only writer, `src/types/domain.ts:167`
  the type), until the template work writes references. Most books will take the
  custom path at first (inference).
- `x-tcMobileAudio` matches the pattern the schema requires for an
  implementer's flavour, `^x-[a-z][a-zA-Z0-9]*$` (`schema/x_flavor.schema.json`).
- The spec says tools should treat a custom flavour as unknown content and not
  reject it on that basis (`docs/flavors/custom_flavors.rst`, from the crawl).
  Tools that look only for `audioTranslation` will see unknown content. That is
  the cost, accepted.

### 3. Layout

```
metadata.json                                   at the zip root
ingredients/audio/c<NNN>/s<NNN>.mp3             a finished segment
ingredients/audio/c<NNN>/s<NNN>.wav             a segment still being worked on
ingredients/tc-mobile/project.json              role "x-tcMobileProject", application/json
LICENSE.md                                      only when attribution text is needed (point 6)
```

- `c<NNN>` is the chapter's **position** in the book and `s<NNN>` the segment's
  position in its chapter, both counted from 1 and zero-padded to three digits
  (wider if a book ever needs it). Paths are never built from names or labels.
  _Reason:_ the schema allows spaces and most punctuation in an ingredient path
  (observed), but the crawl found that pankosmia's server and translationCore 4
  refuse many of them (`BURRITO-SPEC.md` §2 in translationCore 4, from the
  crawl; not re-read). Ordinals are also always unique, which a name or an
  imported chapter number is not.
- The **real chapter number** (R7) is data, not path: it lives in `project.json`
  and, for a referenced segment, in the ingredient's `scope`. A chapter's
  position and its number can differ; the metadata is authoritative.
- A finished segment is written as the MP3 the phone already holds
  (`audio/mpeg`, bytes unchanged). A segment still in PCM is written as a WAV,
  Int16 mono at 44 100 Hz, with no re-encoding, so export adds no lossy pass
  ([ADR 0009](0009-transcode-on-finished.md); `src/lib/audio/format.ts:15`).
  _Reason:_ Q11 says include everything; a lossy pass on export would lose some.
  Cost: a WAV is about ten times an MP3 of the same length (inference from
  [ADR 0002](0002-audio-storage-format.md)'s ~5.3 MB per minute for PCM).
- A segment with no audio (not yet recorded, or a broken pointer) has **no
  ingredient**. It is listed in `project.json` with the reason.
- **Every ingredient carries `size` and `checksum.md5`.** The schema makes
  `checksum` optional but, when present, requires a 32-character lowercase-hex
  `md5` (observed: `"md5": "XYZ"` fails). translationCore 4 requires it on every
  ingredient (crawl). `mimeType` and `size` are required by the schema.
- `metadata.json` is written last, listing every ingredient including
  `project.json`. That the order is safe for readers is inference (zip readers
  use the central directory); the read-back test in R11 is what proves it.

### 4. Where per-segment data goes

Not on the audio ingredient. v1.0.0's ingredient allows only `size`, `lang`,
`mimeType`, `checksum`, `scope` and `role`; an ingredient with `properties` is
rejected (observed: `additionalProperty: "properties"`). So `project.json`
(ours, versioned with its own `schemaVersion`) holds everything the app knows
per book, chapter, segment and take: ids, names and labels, order, the real
chapter number, status, encoding, generation, durations, times, the span, where
the book came from, its licence, the OBS story and frame, and the reason a
segment has no audio. The book's language (R12) is in `metadata.json` and also
in `project.json`. `scope` goes on an audio ingredient only when the segment has
a valid USFM reference.

### 5. Values for fields the app does not know

| Field                              | Value                                                                                                                                                 | Basis                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                           | `"scripture burrito"`                                                                                                                                 | enum in the schema (observed)                                                                                                                                                                                                             |
| `meta.version`                     | `"1.0.0"`                                                                                                                                             | point 1                                                                                                                                                                                                                                   |
| `meta.category`                    | `"source"`                                                                                                                                            | the book is the recordings, not a template of one                                                                                                                                                                                         |
| `meta.generator`                   | `{softwareName: "tC Mobile", softwareVersion: <app version>}`                                                                                         | both required inside `generator` (observed)                                                                                                                                                                                               |
| `meta.defaultLocale`               | the interface locale, BCP 47 (`src/lib/locale.ts`)                                                                                                    | not the book's language                                                                                                                                                                                                                   |
| `meta.dateCreated`                 | the export time, date-time                                                                                                                            | schema format                                                                                                                                                                                                                             |
| `meta.normalization`               | `"NFC"`                                                                                                                                               | optional; the app writes NFC (assumption; to be checked by the metadata builder)                                                                                                                                                          |
| `idAuthorities`                    | `{tcmobile: {id: "https://tcmobile.app", name: {en: "tC Mobile"}}}`                                                                                   | at least one authority required; the production domain is AGENTS.md's                                                                                                                                                                     |
| `identification.primary`           | `tcmobile` → the book's id → `{revision: "1", timestamp: <export time>}`                                                                              | exactly one authority → id → revision and timestamp. **Proposal:** revision stays `"1"` because nothing stores an export count                                                                                                            |
| `identification.name`              | the book's name, `{<defaultLocale>: name}`                                                                                                            | required; unnamed-book fallback is a copy decision for the build lane (a strings entry, not an empty object)                                                                                                                              |
| `languages`                        | `[{tag, name: {<defaultLocale>: <name>}}]` from the book's language                                                                                   | R12 / #1492: asked once at export, stored on the book. Never omitted. If the facilitator skips the question the tag is `und` (BCP 47 "undetermined", validates) with the name "Undetermined"; whether skipping is allowed is #1492's call |
| `performance` (audio flavour only) | `["singleVoice", "reading"]`                                                                                                                          | **assumption:** one person records, reading not drama. The schema requires exactly one of singleVoice/multipleVoice and one of reading/drama                                                                                              |
| `formats` (audio flavour only)     | one entry per codec present: `mp3` and/or `wav`, each `{compression, trackConfiguration: "1/0 (Mono)", samplingRate: 44100}`, WAV with `bitDepth: 16` | `compression` enum is `mp3`/`wav` only (observed). `bitRate` is left out: the unit is not stated in the schema and I did not find it in the docs                                                                                          |
| `confidential`                     | `false`                                                                                                                                               | S8 (2026-10-19), "Not confidential": no longer a proposal (see "Open")                                                                                                                                                                    |
| `localizedNames`                   | `book-<code>` only for a USFM-referenced book                                                                                                         | optional; each entry needs `short`                                                                                                                                                                                                        |

### 6. Copyright

Mapped from the book's licence (the v12 field the storage work adds):

| Book's licence                                       | `copyright`                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| CC BY-SA 4.0                                         | `{"licenses": [{"url": "https://creativecommons.org/licenses/by-sa/4.0/"}]}`    |
| CC BY 4.0                                            | `{"licenses": [{"url": "https://creativecommons.org/licenses/by/4.0/"}]}`       |
| CC0                                                  | `{"licenses": [{"url": "https://creativecommons.org/publicdomain/zero/1.0/"}]}` |
| All rights reserved                                  | `{"shortStatements": [{"statement": "All rights reserved.", "lang": "en"}]}`    |
| "Other", or not chosen yet (R20: empty until shared) | `{"shortStatements": [{"statement": "No licence chosen."}]}` (see below)        |

**"Other" and "not chosen yet" claim no licence.** The DRI decided on
2026-10-21 (Round 5, U1b: the export copyright for a book whose licence is
"Other" or not chosen yet), verbatim: "Say nothing". This replaces the earlier
assumption that such a book is treated as all rights reserved. The schema
requires the `copyright` key on a source bundle, and an absent key or `{}` fails
it (observed by running the pinned schema gate on the audio example), so "say
nothing" needed a carrier. The DRI chose it the same day, verbatim: "\"No
licence chosen.\"". The row is a `shortStatements` entry whose `statement` is
"No licence chosen.". It is not an empty string and not "All rights reserved."
The choice refines "Say nothing": the file claims no licence and no rights
position, and only says that none was chosen. Whether the entry carries a
`lang` is not decided.

`licenses` and `shortStatements` are **never both**: the schema is a `oneOf`,
and the two together fail with `passingSchemas [1,2]` (observed). A full
statement travels as an ingredient `LICENSE.md` with role `copyrightStatement`
(a valid role, observed) and is pointed to by adding `{"ingredient": "LICENSE.md"}`
to `licenses` (observed to validate beside a URL entry). That is how
attribution for OBS-derived work (ADR 0006 implication 1) travels. Its wording
must not reintroduce the trademark (implication 3); the wording is the
requirements owner's to confirm, and this ADR does not write it. If `agencies`
were ever added, one entry must carry the `rightsHolder` role
(`schema/copyright_constraints.schema.json`); we write no `agencies`.

### 7. Header images (Q13)

Embedded in the MP3, so no separate ingredient in v2. If a template ever ships a
separate image, it is an ingredient with role `illustration` (a valid role,
observed), optional.

### 8. The export's file name

A strings-table entry in the shape `<book> - project.zip`, built from the
sanitised book name (`filenameSafe`, `src/lib/utils.ts:46`, label capped at
`FILENAME_LABEL_MAX_BYTES` = 120, `src/lib/utils.ts:70`). It differs from Share
Book's `<book>.zip` (`src/lib/strings.ts:972`) so a person can tell the two files
apart. The word "project" is copy and follows the string rules (#169). The
file name is not an ingredient path, so the space is fine.

## Worked examples

Both validate under the pinned v1.0.0 schemas (the run's output is in the PR
comment, not here). Checksums are placeholders of the right shape.

### Referenced book — `scripture` / `audioTranslation`

```json
{
  "format": "scripture burrito",
  "meta": {
    "version": "1.0.0",
    "category": "source",
    "generator": { "softwareName": "tC Mobile", "softwareVersion": "2.0.0" },
    "defaultLocale": "en",
    "dateCreated": "2026-11-20T10:00:00.000Z",
    "normalization": "NFC"
  },
  "idAuthorities": {
    "tcmobile": { "id": "https://tcmobile.app", "name": { "en": "tC Mobile" } }
  },
  "identification": {
    "primary": {
      "tcmobile": {
        "0b5c6f0e-1111-4222-8333-944445555666": {
          "revision": "1",
          "timestamp": "2026-11-20T10:00:00.000Z"
        }
      }
    },
    "name": { "en": "Mark" }
  },
  "confidential": false,
  "type": {
    "flavorType": {
      "name": "scripture",
      "flavor": {
        "name": "audioTranslation",
        "performance": ["singleVoice", "reading"],
        "formats": {
          "mp3": {
            "compression": "mp3",
            "trackConfiguration": "1/0 (Mono)",
            "samplingRate": 44100
          },
          "wav": {
            "compression": "wav",
            "trackConfiguration": "1/0 (Mono)",
            "bitDepth": 16,
            "samplingRate": 44100
          }
        }
      },
      "currentScope": { "MRK": ["1:1-8", "1:9-13"] }
    }
  },
  "languages": [{ "tag": "sw", "name": { "en": "Swahili" } }],
  "localizedNames": { "book-mrk": { "short": { "en": "Mark" } } },
  "copyright": {
    "licenses": [{ "url": "https://creativecommons.org/licenses/by-sa/4.0/" }]
  },
  "ingredients": {
    "ingredients/audio/c001/s001.mp3": {
      "checksum": { "md5": "d32e9efa2f1af2064e513c807d606421" },
      "mimeType": "audio/mpeg",
      "size": 277053,
      "scope": { "MRK": ["1:1-8"] }
    },
    "ingredients/audio/c001/s002.wav": {
      "checksum": { "md5": "a32e9efa2f1af2064e513c807d606421" },
      "mimeType": "audio/wav",
      "size": 5292044,
      "scope": { "MRK": ["1:9-13"] }
    },
    "ingredients/tc-mobile/project.json": {
      "checksum": { "md5": "c32e9efa2f1af2064e513c807d606421" },
      "mimeType": "application/json",
      "size": 2048,
      "role": "x-tcMobileProject"
    }
  }
}
```

### Any other book — `parascriptural` / `x-tcMobileAudio`

The same document with these differences: the `type` is

```json
"type": { "flavorType": { "name": "parascriptural", "flavor": { "name": "x-tcMobileAudio" } } }
```

there is no `currentScope`, no `performance` or `formats`, no ingredient
`scope`, and no `localizedNames`. The ingredients are the same three shapes
(audio MP3, audio WAV, `project.json`), with no `properties` on any of them.
This is the document the validation run called `custom-x-tcMobileAudio`.

## Consequences

- **R11 is met with this ADR's test shape:** a schema gate vendored from the
  pinned tag, plus a test-only reader that unzips an export, checks every
  `size` and `md5` and rebuilds the book from `project.json`. Neither exists
  yet; both are later issues.
- **"Opens in translationCore Desktop" is not promised.** translationCore 4
  imports only two flavours and neither is audio (from the crawl:
  `src/data/import/burritoCheck.mjs`); R11 already says we ask them. A custom
  flavour will be read as unknown content at best.
- **Restore is not promised** (R4). `project.json` exists so a later import has
  what it needs.
- **The profile has a version of its own.** `project.json` carries
  `schemaVersion`, and changes to this profile after Acceptance are a new ADR or
  an amendment with the reason, not an edit in place.

## Open

1. **Maintainer confirmation of points 1, 2 and 4.** Ask the spec's maintainers
   (an issue on the spec repository, or the uW contact
   [prior-art](../research/prior-art.md) names) whether v1.0.0 is the right pin,
   whether `parascriptural` + `x-` is the right home for audio of books that
   have no USFM reference, and whether per-segment data in a sidecar is
   acceptable. **A person posts it.** Answer: no answer by 2026-10-21. The DRI
   accepted this ADR on that date with the question unanswered. A later answer
   is recorded here, and a "no" is an amendment with the reason.
2. **Answered by the requirements owner on 2026-10-19:**
   - **2a, `confidential`.** S8-confidential, `no`: "Not confidential".
     `confidential: false` (point 5) stands as decided.
   - **2b, the licence mapping, in part.** S19-arr-filename, `no-tag`: "Leave
     the tag off". Note: "Note: the only license options to be included are
     CC0, CC BY, and CC BY-SA. If the user selects "Other" the filename should
     not show any licensing information." So the licence options are CC0, CC BY
     and CC BY-SA, and "Other" puts no licence in the file name.
   - **Answered by the DRI, 2026-10-21 (Round 5, U1b):** for a book whose
     licence is "Other" or not chosen yet, the export copyright is "Say
     nothing", carried as a `shortStatements` entry with the statement "No
     licence chosen." (the DRI's pick, verbatim: "\"No licence chosen.\""). Point
     6's "All rights reserved" fallback is replaced.
   - **Still open, for the requirements owner (Round 5, U1a):** whether "Other"
     is the same as `all-rights-reserved`, the value the template contract and
     point 6's table carry. S19 lists CC0, CC BY and CC BY-SA plus "Other" and
     does not name `all-rights-reserved`.
   - Who owns the OBS attribution wording is also not answered.
3. **Which desktop app "tC Desktop" is** and what it needs to open an audio
   bundle: a question for the translationCore 4 team (R11), tracked in the
   export epic, not here.

## Evidence

- Spec: <https://github.com/bible-technology/scripture-burrito> at tag `v1.0.0`
  (`b4583610fca90cae6ef6a7b305903b315b772258`) and `develop`
  (`6ed32ccb095a34221c16901484bd5640515901dd`); files named inline above under
  `schema/` and `docs/`. Fetched 2026-10-19.
- App: `src/lib/obs/catalog.ts:103`, `src/lib/storage/books.ts:901`,
  `src/types/domain.ts:85` (`Book.languageCode`) and `:167`
  (`Segment.reference`), `src/lib/audio/format.ts:15`, `src/lib/utils.ts:46,70`,
  `src/lib/strings.ts:972`, `src/lib/locale.ts`.
- Anything marked "crawl" comes from the 2026-10-19 scope crawl of the export
  epic, which read translationCore 4 and pankosmia; I did not re-read those.
- Nothing here was run on a device.
