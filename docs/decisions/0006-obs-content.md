# 0006 — Bundle Open Bible Stories as beta content

**Status:** Accepted, with a product-level licensing consequence that needs a
human decision · **Date:** 2026-08-22

## Context

Phase 1 was scoped as a blank audio notebook. That makes it hard to beta test —
a tester must invent their own sections before they can try anything — and it
removes the only non-textual way to tell one section from another, which is the
central problem of the section screen (`docs/design/section-screen.md`).

## Decision

Bundle the unfoldingWord **Open Bible Stories** catalogue as beta content.

OBS maps onto the domain model with no translation at all:

| OBS                 | tC Mobile                          |
| ------------------- | ---------------------------------- |
| Story (1–50)        | Chapter                            |
| Frame               | Section                            |
| Frame artwork       | The section's non-textual identity |
| Story narration MP3 | Reference audio to translate from  |

### What is bundled, and what is not

| Asset                       | Size                               | Decision                                                                                                                                              |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story text + frame metadata | 230 KB                             | **Bundled** — `src/data/obs-catalog.json`, built by `scripts/build-obs-catalog.mjs`. Loaded by dynamic `import()` so it stays out of the entry chunk. |
| Frame artwork, 360px        | ~77 KB each, **44 MB for all 598** | **Not bundled.** Fetched per story on demand into IndexedDB.                                                                                          |
| Frame artwork, 2160px       | ~600 MB total                      | Not used. Only 360px and 2160px exist; 2160px is not viable.                                                                                          |
| Story narration MP3, 32kbps | ~1 MB per story                    | Not bundled. Optional per-story download.                                                                                                             |

Verified: the Door43 CDN serves `Access-Control-Allow-Origin: *` on both
artwork and narration, so the PWA fetches them directly — no proxy, no Worker,
consistent with ADR 0005.

Downloads are **per story, not all-or-nothing.** 44 MB is not something to
impose on a shared phone without asking, and a partially-downloaded story is
still useful in a workshop — so individual frame failures are counted and
reported rather than aborting the download.

Media lives in IndexedDB rather than the Cache API because a story downloaded
for field use is not a cache: it is content the translator is relying on, and
it must be durable, countable against the storage budget (ADR 0002), and
removable one story at a time.

## Licensing

- **OBS text:** CC BY-SA 4.0, © unfoldingWord.
- **Artwork:** © Sweet Publishing, CC BY-SA 3.0.
- **This repository:** MIT.

Bundling the catalogue is redistribution, so attribution is required and
travels **inside the catalogue JSON itself** (`attribution` field, asserted by
a test) so it cannot be separated from the content by an accident of refactoring.
The content and the code are separate works in mere aggregation; CC BY-SA's
share-alike applies to the OBS content, not to this repository's source.

### ⚠️ The consequence that needs a human decision

The OBS licence states, verbatim:

> "if you modify a copy or **translate this work**, thereby creating a
> derivative work, you must remove the unfoldingWord® trademark… You must also
> make your derivative work available under the same license (CC BY-SA)."

**A recorded oral translation of an OBS story is a derivative work.** Read
plainly, that means every recording a translator makes against bundled OBS
content is CC BY-SA, and must not carry the unfoldingWord trademark.

That is a licensing position being taken on behalf of the church networks who
use this app, and it is **not a call for engineering to make quietly.** It
needs Tim, and probably whoever owns uW's licensing.

Practical implications if the reading holds:

1. Export metadata should carry the CC BY-SA attribution for OBS-derived work.
2. Recordings made against a **user-created** chapter, with no OBS content
   involved, are not derivative and carry no such obligation — so the data
   model must be able to tell the two apart. It currently cannot.
3. The trademark must not appear on exported derivative work.

**Nothing in the export path implements any of this yet.** Flagged, not solved.

## Consequences

- Beta testers get 50 real, ordered, illustrated chapters with zero setup.
- The section screen gets artwork for row identity — see the revision note in
  `docs/design/section-screen.md`.
- Storage pressure grows: 44 MB of artwork sits alongside ~5.3 MB/min of PCM
  (ADR 0002). The per-story download model is the mitigation, and it makes the
  cost visible instead of silent.
- Refreshing the catalogue is `node scripts/build-obs-catalog.mjs`, which
  re-fetches from Door43 and fails loudly if a story parses to zero frames.
