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
  writer, and MP3 export via lamejs.
- Scripture Burrito scope-string grammar (`src/lib/scripture/scope.ts`).
- IndexedDB storage (`src/lib/storage`): clip persistence and the
  Project → Chapter → Section → Segment → Take repository.
- Browser audio boundary (`src/hooks/audio-io.ts`) handling iOS mp4/aac
  capture, shared AudioContext, and resample-to-canonical on ingest.
- A disposable vertical-slice UI proving record → waveform → play → cut →
  export MP3 on a real device.
- 53 unit tests covering the audio core, scope grammar, and storage layer.
- Docs: spec transcription, prior-art research, and five ADRs.
- Open Bible Stories bundled as beta content: 50 stories / 598 frames of
  metadata (230 KB), with artwork and narration fetched per story into
  IndexedDB. `scripts/build-obs-catalog.mjs` rebuilds the catalogue from
  Door43. IndexedDB schema bumped to v2 for the media store.
- Cloudflare deployment: staging, production, and per-PR ephemeral Workers,
  with GitHub Actions for CI, PR deploy/cleanup, staging, and production.
  Staging is live at <https://tc-mobile-staging.unfoldingword.workers.dev>.
