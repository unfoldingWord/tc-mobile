# 0017 — Bundle SIL's langtags as the language list

**Status:** Accepted · **Date:** 2026-10-22 (the DRI's licence decision on
#1492)

## Context

R12 (requirements owner, 2026-10-19, recorded in #1441): "Ask at export, then
write it into the metadata for that book; keep the path to getting started as
short as possible." So the first Export project of a book with no language asks
which language the recordings are in, stores a BCP 47 tag on the book, and the
Scripture Bundle's `metadata.json` carries it (ADR 0014).

How the language is picked was the DRI's call on 2026-10-22 (#1492), verbatim:
"Bundled searchable list (Recommended)". The app works offline, so the list
ships inside it.

The list needs, for each language, a valid BCP 47 tag, a name a facilitator
can search for, and its autonym where one is known. SIL's
[langtags](https://github.com/silnrsi/langtags) has all three for every
ISO 639-3 language, already reduced to the shortest valid tag.

## Decision

Bundle a cut-down copy of SIL's `langtags.json`, release **26242.1446**
(2026-06-09, the latest stable release on 2026-10-22).

- `scripts/build-language-list.mjs` reads that release, checks its SHA-256,
  and writes `src/data/language-list.json`: the tag, the English name and the
  autonym, one language per line, nothing else. The file is committed;
  `tests/language-list.test.ts` pins its shape and its source release.
  Moving to a newer release changes the script's version and hash in a PR of
  its own.
- It is loaded with a dynamic `import()` (`src/lib/languages/list.ts`), the
  pattern of `lib/obs/catalog.ts`, so app start does not parse it. The chunk
  is a `.js` file, so the service worker precaches it and the ask works
  offline.
- Rows dropped: langtags' own bookkeeping rows (tags starting `_`), rows
  marked `obsolete`, and rows with no name. The autonym is `localname`, else
  `localnames[0]`, as langtags' `doc/langtags.md` says to read it.

## Licensing — the terms read, and the DRI's decision

**langtags.** The repository's `LICENSE` at the pinned release reads
"Copyright (c) 2019-2025 SIL International (htttp://www.sil.org) / Released
under the MIT license cited below", followed by the MIT text. That text ships
verbatim as `public/licenses/SIL-LANGTAGS-MIT.txt`.

**Where the names come from.** langtags' `doc/langtags.md` lists its sources,
including "Ethnologue: Language names and autonyms", and says of `name`: "The
name from the Ethnologue names list for the language and region of the full
tag." Of `localnames`: "Specifies a list of local names (autonyms), coming from
the Ethnologue." So the names and autonyms this list carries are Ethnologue
data, distributed by SIL inside an MIT-licensed release.

**ISO 639-3.** The tags are, for the most part, ISO 639-3 codes. The
registrar's terms of use
(<https://iso639-3.sil.org/code_tables/download_tables#termsofuse>), read on
2026-10-22, say the code set "may be downloaded and incorporated into software
products, web-based systems, digital devices, etc., either commercial or
non-commercial, provided that: attribution is given to iso639-3.sil.org as the
source of the codes; the identifiers of the code set are not modified or
extended except as may be privately agreed using the Private Use Area (range
qaa to qtz), and then such extensions shall not be distributed publicly; the
product, system, or device does not provide a means to redistribute the code
set."

**The question.** The app ships the list in its bundle, and a public repository
holds the generated file, so it is fair to ask whether that is a "means to
redistribute the code set", and whether the MIT grant on langtags covers the
Ethnologue names inside it.

**The DRI's picks, 2026-10-22 (#1492), verbatim:** first, how the language is
picked: "Bundled searchable list (Recommended)"; then the licence: "MIT grant
is enough, bundle langtags". The list ships from SIL's `langtags.json` under
SIL's MIT licence, and the ISO 639-3 codes in it carry the attribution their
terms ask for (point 4 below).

## What we owe, concretely

1. **The MIT notice travels with the copy.** Done: the text is under
   `public/licenses/` (precached, so it opens offline) and listed in
   **Menu → About & licenses**, with the attribution "Language data:
   © 2019-2025 SIL International (langtags), MIT"
   (`src/components/licenses.ts`).
2. **The tags are not modified.** The script copies each tag as langtags
   writes it and never mints one.
3. **One source.** The file is regenerated only by the script, from a release
   the script names and hashes.
4. **The codes are attributed to their registrar.** The ISO 639-3 terms ask
   that "attribution is given to iso639-3.sil.org as the source of the
   codes". Met: **Menu → About & licenses** says "Language codes: ISO 639-3,
   from iso639-3.sil.org." (`aboutLanguageCodes` in `src/lib/strings.ts`,
   translated with the rest of the table; pinned by
   `tests/about-language-codes.test.ts`). This is compliance with the terms
   the DRI's decision already accepts, not a further decision.

## Not decided here

- The language's name in `metadata.json` is still the tag (ADR 0014's
  default); writing the English name or the autonym there is not in #1492.
