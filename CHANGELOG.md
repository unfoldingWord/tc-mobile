# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

**This section is not maintained.** It still reads as the initial-scaffold
day entry and was never updated for the pivot (`docs/design/pivot-plan.md`)
or any batch since. At least three of its own claims are now wrong: it says
Vite 7 (`package.json` pins `^8.3.0`), it describes a WAV writer that no
longer exists under `src/lib/`, and it says the MP3 encoder has "nothing
wires it to an export (#18)" even though Share Chapter / Share Book (B7) and
the transcode pipeline (B8) wire it. Treat AGENTS.md as the current source of
truth for what has shipped; this list is left below as a historical record of
the pre-pivot scaffold, not a live changelog (#838).

### Added

- Initial scaffold: Vite 7 + React 19 + TypeScript strict + Tailwind 4, with
  the onion architecture enforced by ESLint.
- PWA setup via `vite-plugin-pwa` — installable, offline app shell, icons.
- Audio core (`src/lib/audio`): canonical mono 16-bit PCM, sample-accurate
  cut / insert / paste / replace / concat, waveform peak extraction, WAV
  writer, and a lamejs MP3 encoder — the encoder only; nothing wires it to an
  export (#18).
- Scripture Burrito scope-string grammar (`tests/scope.ts`; moved out of
  `src/lib/scripture/` as test-only in #818/#159, 2026-09-24 — no `src/`
  caller existed).
- IndexedDB storage (`src/lib/storage`): clip persistence and a chapter and
  segment repository. Its original Project → Chapter → Section → Segment → Take
  hierarchy belongs to the initial scaffold, replaced on 22 Aug 2026 ("the
  pivot", `docs/design/pivot-plan.md`), and will not reach a release — B1 (#27)
  replaces it with Book → Chapter → Segment, with Take hidden and 1:1.
- Browser audio boundary (`src/hooks/audio-io.ts`) handling iOS mp4/aac
  capture, shared AudioContext, and resample-to-canonical on ingest.
- A disposable vertical-slice UI exercising record → waveform → play → cut →
  encode MP3. Browser-verified only; no device, OS or browser was recorded at
  the time, and there is no export path out of the app (#18).
- Unit tests covering the audio core, scope grammar, and storage layer — 53 on
  scaffold day, and growing with every batch, so `npm test` is the count rather
  than this line. Browser-only paths (MediaRecorder, `decodeAudioData`) are not
  among them.
- Docs: prior-art research, the ADRs, and the plan of record for the 22 Aug 2026
  replacement of the initial scaffold ("the pivot", `docs/design/pivot-plan.md`,
  #25).
- Open Bible Stories bundled as beta content: 50 stories / 598 frames of
  metadata (230 KB) plus 128px thumbnails. The thumbnails ship in the build but
  are excluded from the service-worker precache until a screen reads them (#177,
  ADR 0006 2026-09-04 amendment); the precache returns when the Template Library
  (#33) wires a reader.
  `scripts/build-obs-catalog.mjs` rebuilds the catalogue from Door43. (B0 (#26)
  removed the on-demand full-size-artwork cache and the narration path; the
  empty v2 `media` store is retired by B1's drop-and-recreate.)
- Cloudflare deployment: staging, production, and per-PR preview Workers.
  **Cloudflare Workers Builds owns deployment**, not Actions — the four Actions
  deploy workflows were deleted to remove a double-deploy collision, and
  `ci.yml` is the only workflow left. See AGENTS.md.
  Staging is live at <https://tc-mobile-staging.unfoldingword.workers.dev>.
