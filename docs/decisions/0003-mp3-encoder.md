# 0003 — Use lamejs for MP3 export

**Status:** Accepted, with two open flags · **Date:** 2026-08-22

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

## Open flag 1 — licensing

lamejs is **LGPL-3.0**; this repo is MIT. Bundling LGPL code into a JS bundle
is the well-known static-linking grey area. This is **flagged for a human
decision, not settled here.** Options: accept it, relicense the repo, or move
the encoder behind a dynamic import boundary and document the swap path.

## Open flag 2 — threading

`encodeMp3` is CPU-bound and currently runs on the main thread, which will jank
the UI on a long chapter. `onProgress` exists so a caller can show progress,
but **the encoder belongs in a Web Worker.** Not done in the scaffold; it is
the first performance task.

The encoder chunk is already loaded via dynamic `import()` so it does not delay
first paint (169 kB, split from the 435 kB main bundle) while remaining
precached by the service worker for offline use.
