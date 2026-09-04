# 0006 — Bundle Open Bible Stories as beta content

**Status:** Accepted · **Date:** 2026-08-22

**Amended 2026-08-23** — the licensing consequence below is **settled**, #15
closed. What remains is implementation, not a decision.

**Amended 2026-08-24** — the **bundling decision stands unchanged**: what ships,
what is fetched on demand, and why. The **domain mapping does not**. ADR 0004
rejected the Section layer and the pivot
([`../design/pivot-plan.md`](../design/pivot-plan.md), #25) replaces the browse,
so a frame is a **Segment**. The corrections are marked inline below.

**Amended 2026-08-24 (B0, #26)** — **Q4 is answered: no.** The full-size-artwork
**media cache is removed** from the tree — its accessor code
(`hooks/obs-media.ts`, `lib/storage/media.ts`) and the exported `CachedMedia`
type — along with the narration path. The `media` **object store** in
`lib/storage/db.ts` is deliberately **left in place** (empty and unread) so B0
makes no IndexedDB schema change; it is removed by B1's drop-and-recreate (#27),
where the schema-change discipline and its migration test belong. It was kept on
the bet that a later phase would
wire per-segment artwork to it (#1), but no mockup places artwork anywhere, no
batch was scheduled to wire it, and code nothing uses is the sprawl the bar
rejects. **What still ships is unchanged:** the 2.5 MB bundle of 128px
thumbnails and the catalogue JSON — ~~those are precached, not cached-on-demand~~
**(revised 2026-09-04, #177: the catalogue JSON is precached only once a
production module imports `catalog.ts` — today none does, so the chunk is
tree-shaken out of the build and precached nowhere; the thumbnails' precache
is paused until a screen reads them — see the amendment above)** — and B0
does not touch them. #1 is closed as moot: with no cache to wire and no
mockup screen that needs one, there is no rework to do (the pre-pivot recording
view keeps its CDN `<img>` until B2/B3). Per-segment artwork is greenfield if a later
phase asks for it; the removed cache is recoverable from git. The inline
sentences below that still describe the cache as "kept" are struck.

**Amended 2026-09-04 (#177)** — a **precache exception**, not a reversal. The
thumbnails are still **bundled** and still ship in the build; they are
temporarily **excluded from the service-worker precache** because **no shipped
screen reads them yet**. `thumbUrl` (`src/lib/obs/catalog.ts`) has no importer:
the pre-pivot browse it served is gone, and the Template Library that will read
it (#33) has not landed. Precaching 598 files / 2.5 MB that nothing draws only
delayed offline-readiness (611 → 13 precache entries, ~80% of the bytes) and
exposed Workbox's atomic install to a full restart on any one failed fetch.
**The stranding rationale below is not weakened:** you cannot be stranded by a
picture no screen shows. When a screen reads `thumbUrl` (the Template Library,
#33), **`jpg` is restored to `workbox.globPatterns`** so the set is precached
again exactly as this ADR requires — the fix is **reader-gated**, and is **not**
a switch to runtime-caching, which this ADR rejected for its stranding risk.
Guarded by `tests/precache-manifest.test.ts`. Status stays **Accepted**.

## Context

Phase 1 was scoped as a blank audio notebook. That makes it hard to beta test:
a tester must invent their own structure before they can try anything.

As argued on 22 Aug there was a second reason — a blank notebook removes the
only non-textual way to tell one row from another, the central problem of the
pre-pivot section screen (`docs/design/section-screen.md`). **That half no
longer holds.** The mockups give a row its identity from its ordinal and its
waveform, and D6 demotes artwork to an optional illustration. The decision
below rests on the beta-testing ground alone, which is enough on its own.

## Decision

Bundle the unfoldingWord **Open Bible Stories** catalogue as beta content.

OBS maps onto the domain model with no translation at all:

| OBS          | tC Mobile |
| ------------ | --------- |
| Story (1–50) | Chapter   |
| Frame        | Segment   |

**Corrected 2026-08-24.** As written on 22 Aug this table mapped a frame to a
**Section** and carried two further rows, neither of which survives:

- _Frame artwork → "the section's non-textual identity."_ D6 makes artwork an
  optional per-segment illustration rather than the thing that decides the
  browse layout. ~~open question Q4 keeps it in the model and the media cache~~
  **Void, 2026-08-24 (B0, #26):** Q4 is answered no — the media cache is removed
  and artwork is drawn in no _mockup_ screen. (The pre-pivot recording view still
  renders the CDN image until B2/B3 replace it.)
- _Story narration MP3 → "reference audio to translate from."_ Reference audio
  is out of Phase 1 (D5). ~~Narration is still fetched by code in the tree, and
  B0 (#26) deletes that path.~~ **Done, 2026-08-24:** B0 deleted the narration
  path.

The Section layer itself is rejected by ADR 0004; B1 (#27) removes it from the
model.

### What is bundled, and what is not

**Revised 22 Aug 2026.** The first version of this ADR kept all artwork out of
the bundle on the grounds that it was 44 MB. That measured the wrong thing.

The CDN publishes frames at 360px and 2160px only, but the pre-pivot section
list rendered tiles at 48–56px. Centre-cropped and downscaled to 128px (2x the
largest tile), **the entire 598-frame set is 2.5 MB** — sixteen times smaller
than the source, and small enough to simply ship.

| Asset                                 | Size       | Decision                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story text + frame metadata           | 230 KB     | **Bundled** — `src/data/obs-catalog.json`                                                                                                                                                                                                      |
| **Thumbnails, 128px, all 598 frames** | **2.5 MB** | **Bundled; precache paused (#177)** — `public/obs/thumbs/`, built by `scripts/build-obs-thumbs.mjs`. Excluded from the precache until a screen reads `thumbUrl` (#33), when `jpg` is restored to `globPatterns`. See the 2026-09-04 amendment. |
| Full-size artwork, 360px              | 46.8 MB    | **Removed (B0, #26).** Was fetched per story into IndexedDB; the cache is deleted, Q4 answered no                                                                                                                                              |
| Full-size artwork, 2160px             | ~600 MB    | Not viable, unused                                                                                                                                                                                                                             |
| Story narration MP3, 32kbps           | ~1 MB each | **Removed (B0, #26).** Out of Phase 1 (D5); the fetch path is deleted                                                                                                                                                                          |

**What bundling bought, beyond offline-on-first-run:**

1. **It deletes a state from the design.** Pass A's inventory carried a "picture
   not downloaded" row state. With thumbnails bundled, the list can never be in
   it — the artwork is always there. A state removed is worth more than a state
   handled well.
2. **It removes the download dance from the primary path.** No per-story
   download prompt stands between a translator and their content.
3. **It removes a network dependency from the thing the app is for.** A
   facilitator installs over wifi and then goes to the field; waiting for a
   story to be browsed once before its pictures cache would strand them. The
   thumbnails are in the service-worker precache for exactly this reason.
   (Temporarily excepted while no screen reads them — see the 2026-09-04
   amendment, #177; the precache returns with the reader, #33.)

~~Full-size artwork is still fetched on demand~~ **Void, 2026-08-24 (B0, #26).**
Full-size artwork is **no longer fetched or cached**: the on-demand fetch layer
is removed. (The empty `media` object store stays until B1's drop-and-recreate,
so B0 changes no schema — see the amendment note above.) No _mockup_ screen shows
the picture (Q4, answered no), and the cache had no live reader, so there was
nothing for it to serve. The pre-pivot recording view's `<img>` still points at
the door43 CDN URL directly, which works online and is temporary — that view is
replaced by B2/B3.

Verified (kept as a record): the Door43 CDN serves `Access-Control-Allow-Origin:
*` on artwork and narration, so on-demand fetches needed no proxy and no Worker
(ADR 0005). That mattered while the cache existed; it no longer does.

~~Media fetched at runtime lives in IndexedDB rather than the Cache API…~~
**Void, 2026-08-24 (B0, #26).** There is no runtime media fetch after B0. The
`media` store itself still exists — empty and unread — until B1 removes it. The
rationale (durable, countable, removable per story) is kept only as the reason
the store was chosen while it had a writer.

## Licensing

- **OBS text:** CC BY-SA 4.0, © unfoldingWord.
- **Artwork:** © Sweet Publishing, CC BY-SA 3.0.
- **This repository:** MIT.

**Modification disclosure.** CC BY-SA requires indicating what changes were
made. The bundled thumbnails are **centre-cropped to a square and downscaled to
128px** from the published 360px frames. Nothing else is altered. Recorded here
and in `scripts/build-obs-thumbs.mjs`.

Bundling the catalogue is redistribution, so attribution is required and
travels **inside the catalogue JSON itself** (`attribution` field, asserted by
a test) so it cannot be separated from the content by an accident of refactoring.
The content and the code are separate works in mere aggregation; CC BY-SA's
share-alike applies to the OBS content, not to this repository's source.

### The licensing consequence — settled, and not yet implemented

The OBS licence states:

> "if you modify a copy or **translate this work**, thereby creating a
> derivative work, you must remove the unfoldingWord® trademark… You must also
> make your derivative work available under the same license (CC BY-SA)."

**A recorded oral translation of an OBS story is a derivative work.** Read
plainly, that means every recording a translator makes against bundled OBS
content is CC BY-SA, and must not carry the unfoldingWord trademark.

That reading was **confirmed by the requirements owner on 2026-08-23** (#15
closed). It is a licensing position taken on behalf of the church networks who
use this
app, so it was never engineering's call to make quietly — but it has now been
made, and it does not need re-asking.

What the settlement obliges:

1. Export metadata should carry the CC BY-SA attribution for OBS-derived work.
2. Recordings made against a **user-created** chapter, with no OBS content
   involved, are not derivative and carry no such obligation — so the data
   model must be able to tell the two apart. It currently cannot.
3. The trademark must not appear on exported derivative work.

**Nothing in the export path implements any of this yet** — and there is no
export path at all (#18). The decision is closed; the engineering is open.

## Consequences

- Beta testers get 50 real, ordered chapters with zero setup.
- ~~The section screen gets artwork for row identity.~~ **Void, 2026-08-24.**
  There is no section screen after the pivot, and a row's identity is its
  ordinal and its waveform (D6). `docs/design/section-screen.md` is pre-pivot
  design work, kept as a record and not as guidance.
- ~~Storage pressure grows: 46.8 MB of artwork sits alongside ~5.3 MB/min of
  PCM…~~ **Void, 2026-08-24 (B0, #26).** Artwork is no longer cached, so it adds
  nothing to storage. The PCM pressure (ADR 0002, D3's MP3-on-Finished
  transcode) stands on its own; #12 owns it.
- Refreshing the catalogue is `node scripts/build-obs-catalog.mjs`, which
  re-fetches from Door43 and fails loudly if a story parses to zero frames.
