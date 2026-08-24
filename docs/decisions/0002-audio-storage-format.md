# 0002 — Store audio as canonical mono 16-bit PCM

**Status:** Accepted · **Date:** 2026-08-22

## Context

`MediaRecorder` hands back a compressed blob whose codec depends on the device:
webm/opus on Android and Chrome, mp4/aac on iOS Safari. The spec requires
sample-accurate waveform editing (cut, paste, insert) and export by
"concatenation of sections."

## Decision

Normalise every recording on ingest to **mono, 16-bit PCM at 44 100 Hz**
(`CANONICAL_SAMPLE_RATE`) and store that. Decoding and resampling happen once,
in `src/hooks/audio-io.ts`, using `decodeAudioData` plus an
`OfflineAudioContext` for the resample and downmix.

## Rationale

1. Cut/paste/insert on PCM are buffer operations. On a compressed stream they
   require a decode/re-encode round trip per edit.
2. Concatenating clips of mixed codecs is not a buffer join. Concatenating
   canonical PCM is.
3. Exactly one module has to know what codec the device produced.
4. The whole audio core becomes pure functions over `Int16Array`, unit-testable
   in Node with no audio hardware. `tests/audio-edit.test.ts` and
   `tests/audio-export.test.ts` exist because of this decision.

## Consequences

**Storage cost is the tradeoff:** mono 16-bit at 44.1 kHz is ~5.3 MB per
minute, ~317 MB per hour. An OBS story of 2–3 minutes is ~16 MB; all 50 stories
at ~2.5 min each is roughly **660 MB**.

That is inside typical browser storage quotas but not comfortably so, and it is
a real risk on a low-end device with a full disk. **Open mitigations, not yet
decided:**

- Drop to 22 050 Hz for speech (halves it; still well above what the voice
  needs).
- ~~Persist takes as MP3 and keep PCM only for the clip being edited.~~
  **Taken 2026-08-23 as D3:** PCM while a segment is being edited, transcode to
  64 kbps MP3 and drop the PCM when the translator marks it Finished. The
  encoder move that D3 forces is #34.
- Call `navigator.storage.persist()` so the browser does not evict the data,
  and surface `navigator.storage.estimate()` in the UI.

`totalClipBytes()` exists so this is visible rather than discovered in the
field. **Revisit before the October training.**
