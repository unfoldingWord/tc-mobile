# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial scaffold: Vite 7 + React 19 + TypeScript strict + Tailwind 4, with
  the onion architecture enforced by ESLint.
- PWA setup via `vite-plugin-pwa` — installable, offline app shell, icons.
- Audio core (`src/lib/audio`): canonical mono 16-bit PCM, sample-accurate
  cut / insert / paste / replace / concat, waveform peak extraction, WAV
  writer, and a lamejs MP3 encoder — the encoder only; nothing wires it to an
  export (#18).
- Scripture Burrito scope-string grammar (`src/lib/scripture/scope.ts`).
- IndexedDB storage (`src/lib/storage`): clip persistence and the
  Project → Chapter → Section → Segment → Take repository.
- Browser audio boundary (`src/hooks/audio-io.ts`) handling iOS mp4/aac
  capture, shared AudioContext, and resample-to-canonical on ingest.
- A disposable vertical-slice UI exercising record → waveform → play → cut →
  encode MP3. Browser-verified only; no device, OS or browser was recorded at
  the time, and there is no export path out of the app (#18).
- Unit tests covering the audio core, scope grammar, and storage layer — 53 on
  scaffold day, 149 as of 2026-08-24. Browser-only paths (MediaRecorder,
  `decodeAudioData`) are not among them.
- Docs: spec transcription, prior-art research, and seven ADRs.
- Open Bible Stories bundled as beta content: 50 stories / 598 frames of
  metadata (230 KB), with artwork and narration fetched per story into
  IndexedDB. `scripts/build-obs-catalog.mjs` rebuilds the catalogue from
  Door43. IndexedDB schema bumped to v2 for the media store.
- Cloudflare deployment: staging, production, and per-PR preview Workers.
  **Cloudflare Workers Builds owns deployment**, not Actions — the four Actions
  deploy workflows were deleted to remove a double-deploy collision, and
  `ci.yml` is the only workflow left. See AGENTS.md.
  Staging is live at <https://tc-mobile-staging.unfoldingword.workers.dev>.
