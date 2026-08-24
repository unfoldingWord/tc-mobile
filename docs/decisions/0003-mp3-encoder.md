# 0003 — Use lamejs for MP3 export

**Status:** Accepted · **Date:** 2026-08-22, licensing settled 2026-08-23

## Context

The spec requires "export recording to MP3." No browser can encode MP3; only
decode. An encoder has to ship with the app.

## Decision

Use **`@breezystack/lamejs`** — a maintained fork of the unmaintained `lamejs`.
Pure JavaScript, no WASM fetch, so export works offline on first run.

Verified working: `tests/audio-export.test.ts` encodes a real tone and asserts
a valid MPEG frame sync and a plausible bitrate.

## Why MP3 specifically, and not AAC

Scripture Burrito's `audioTranslation` flavor restricts ingredient
`compression` to an enum of **`mp3` and `wav` only** — no AAC, no Opus
(docs/research/prior-art.md §4). Shema Studio ships M4A/AAC, which is therefore
_not declarable_ in a burrito. MP3 keeps tC Mobile on the interchange
standard's happy path.

## Why not ffmpeg.wasm

It is far heavier and slower to start on the entry-level Android phones this
targets, and PCM editing plus a single encode at export needs none of its
capability.

## Licensing — settled 2026-08-23: keep lamejs

lamejs is **LGPL-3.0**; this repo is MIT. Bundling LGPL code into a JS bundle
is the well-known static-linking grey area. Three options were open: accept it,
relicense the repo, or move the encoder behind a boundary and document the swap
path.

**Decision: accept it and take the boundary option.** We ship
`@breezystack/lamejs`. The repo stays MIT with one LGPL-3.0 dependency, which is
an ordinary and defensible position — but it is only defensible if the
obligations are actually met, so they are listed here rather than assumed.

### What we owe, concretely

1. **Keep the encoder behind a replaceable boundary.** **Not yet true.**
   `src/lib/audio/mp3.ts:21` imports `Mp3Encoder` statically; there is no
   dynamic `import()` of lamejs anywhere in `src/`. Decision D3 moves the
   encoder into a Web Worker, which is a _stronger_ boundary than a dynamic
   import would be — so the licensing position improves as a side effect of the
   performance work in #34. Until #34 lands, this obligation is outstanding,
   not met.
2. **Keep one module interface in front of it.** `encodeMp3` is the only entry
   point, so a user exercising their LGPL right to relink has exactly one thing
   to replace. Do not scatter lamejs calls.
3. **Ship the licence text and attribution** with the app, reachable by someone
   holding the phone — not only in `node_modules`.
4. **Do not patch lamejs.** If it ever must be patched, the modified source has
   to be published.
5. **Say so in the open.** `README.md` and the package metadata should state
   that the project is MIT with an LGPL-3.0 encoder, rather than leaving a
   reader to discover it from a lockfile.

Items 3 and 5 are not done yet — tracked in #36.

### What this closes

Known open item 3 in `AGENTS.md`, and issue #14. It also unblocks #34, which
could not settle while the encoder's presence on a required path was in doubt.

## Open flag — threading

`encodeMp3` is CPU-bound and currently runs on the main thread, which will jank
the UI on a long chapter. `onProgress` exists so a caller can show progress,
but **the encoder belongs in a Web Worker.**

This stopped being a performance nicety on 2026-08-23. Decision D3 transcodes to
MP3 when a translator marks a segment Finished, which puts the encoder on a
user-visible path on every segment rather than behind an export button. It is now
a blocker, tracked in #34.

The encoder chunk is already loaded via dynamic `import()` so it does not delay
first paint (169 kB, split from the 435 kB main bundle) while remaining
precached by the service worker for offline use.
