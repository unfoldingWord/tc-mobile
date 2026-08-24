# 0006 — Bundle Open Bible Stories as beta content

**Status:** Accepted · The licensing consequence below is **settled** —
2026-08-23, #15 closed. What remains is implementation, not a decision.
**Date:** 2026-08-22

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

**Revised 22 Aug 2026.** The first version of this ADR kept all artwork out of
the bundle on the grounds that it was 44 MB. That measured the wrong thing.

The CDN publishes frames at 360px and 2160px only, but the section list renders
tiles at 48–56px. Centre-cropped and downscaled to 128px (2x the largest tile),
**the entire 598-frame set is 2.5 MB** — sixteen times smaller than the source,
and small enough to simply ship.

| Asset                                 | Size       | Decision                                                                                  |
| ------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Story text + frame metadata           | 230 KB     | **Bundled** — `src/data/obs-catalog.json`                                                 |
| **Thumbnails, 128px, all 598 frames** | **2.5 MB** | **Bundled and precached** — `public/obs/thumbs/`, built by `scripts/build-obs-thumbs.mjs` |
| Full-size artwork, 360px              | 46.8 MB    | Fetched per story into IndexedDB, for the recording view only                             |
| Full-size artwork, 2160px             | ~600 MB    | Not viable, unused                                                                        |
| Story narration MP3, 32kbps           | ~1 MB each | Optional per-story download                                                               |

**What bundling bought, beyond offline-on-first-run:**

1. **It deletes a state from the design.** Pass A's inventory carried a "picture
   not downloaded" row state. With thumbnails bundled, the list can never be in
   it — the artwork is always there. A state removed is worth more than a state
   handled well.
2. **It removes the download dance from the primary path.** No per-story
   download prompt stands between a translator and their section list.
3. **It removes a network dependency from the thing the app is for.** A
   facilitator installs over wifi and then goes to the field; waiting for a
   story to be browsed once before its pictures cache would strand them. The
   thumbnails are in the service-worker precache for exactly this reason.

Full-size artwork is still fetched on demand, because the recording view is the
only place the picture is actually looked at, and 46.8 MB is still not
something to impose on a shared phone.

Verified: the Door43 CDN serves `Access-Control-Allow-Origin: *` on artwork and
narration, so on-demand fetches need no proxy and no Worker (ADR 0005).

Media fetched at runtime lives in IndexedDB rather than the Cache API because a
story downloaded for field use is content the translator is relying on: it must
be durable, countable against the storage budget (ADR 0002), and removable one
story at a time.

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

The OBS licence states, verbatim:

> "if you modify a copy or **translate this work**, thereby creating a
> derivative work, you must remove the unfoldingWord® trademark… You must also
> make your derivative work available under the same license (CC BY-SA)."

**A recorded oral translation of an OBS story is a derivative work.** Read
plainly, that means every recording a translator makes against bundled OBS
content is CC BY-SA, and must not carry the unfoldingWord trademark.

That reading was put to Tim and **confirmed on 2026-08-23** (#15 closed). It
is a licensing position taken on behalf of the church networks who use this
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

- Beta testers get 50 real, ordered, illustrated chapters with zero setup.
- The section screen gets artwork for row identity — see the revision note in
  `docs/design/section-screen.md`.
- Storage pressure grows: 46.8 MB of artwork sits alongside ~5.3 MB/min of PCM
  (ADR 0002). The per-story download model is the mitigation, and it makes the
  cost visible instead of silent.
- Refreshing the catalogue is `node scripts/build-obs-catalog.mjs`, which
  re-fetches from Door43 and fails loudly if a story parses to zero frames.
