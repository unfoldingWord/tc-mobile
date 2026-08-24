# tC Mobile

**translationCore Mobile** — an offline-first PWA that aims to be the
"world's simplest mobile audio notebook and editor" for oral communities doing
Bible translation.

> **Status: scaffold.** The audio core, storage layer, and build/deploy pipeline
> are working and tested. The UI is a deliberately disposable vertical slice
> that proves the pipeline end to end on a real phone. See
> [`docs/spec-transcription.md`](docs/spec-transcription.md) for the source
> requirements and [`docs/decisions/`](docs/decisions/) for what was decided
> and why.

## Why this exists

There is no pathway for translation production in communities that cannot use
text-based modalities. Oral communicators have no "pencil and paper." This is
an attempt at one.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:lan      # bind to 0.0.0.0 — open it from a phone on the same Wi-Fi
```

> ⚠️ **Microphone access requires a secure context.** `localhost` counts;
> `http://192.168.x.x` does **not**. To test on a phone over LAN you need HTTPS
> — deploy to a staging URL, or use a tunnel (`cloudflared tunnel --url
http://localhost:5173`).

## Verify

```bash
npm run verify   # format:check + lint + knip + typecheck + test + build
```

Individually: `npm run lint`, `npm run knip`, `npm run typecheck`, `npm test`,
`npm run format`, `npm run build`.

## Branches and deployment

```
feature  ->  develop  ->  staging  ->  main
             (default)    (staging)    (production)
```

| Branch                 | Purpose               | Deploys to                         |
| ---------------------- | --------------------- | ---------------------------------- |
| `feature/*`, `develop` | dev and local testing | a preview version with its own URL |
| `staging`              | what testers use      | `tc-mobile-staging`                |
| `main`                 | production            | `tc-mobile`                        |

Each promotion is a PR. The `staging` -> `main` PR is the production gate.

Live staging: <https://tc-mobile-staging.unfoldingword.workers.dev>

**Cloudflare Workers Builds deploys** straight from the repo — there are no
deploy workflows in `.github/`. It is configured per Worker, so the repo is
connected twice: `tc-mobile` builds from `main`, `tc-mobile-staging` builds
from `staging` with `--env staging`.

### Testing on a phone

Open a deployed URL on the device. It is HTTPS, which matters —
`getUserMedia` refuses to run outside a secure context, so a LAN address like
`http://192.168.x.x` **cannot record audio** no matter what else is correct.

Add it to the home screen to exercise the installed PWA (standalone display and
safe-area insets behave differently there than in a browser tab). There is no
share-sheet export path yet — see #18.

### CI

`ci.yml` only: full-history secret scan, format, lint, knip, typecheck, test, build,
and a check that the PWA service worker and manifest were emitted. It deploys
nothing.

The repo is `sethstoll3/tc-mobile` — **private and personal for now**, pending
the tech-lead approval and recorded DRI an org repo requires.

## Architecture

Onion layers, enforced by ESLint `no-restricted-imports` — imports never go
"upward":

```
src/
├── types/       Domain types              (no internal imports)
├── lib/         Pure audio + storage core (imports: types)
│   ├── audio/     PCM edit, peaks, WAV, MP3 — no DOM, unit-tested in Node
│   ├── scripture/ Burrito scope-string grammar
│   └── storage/   IndexedDB repositories
├── hooks/       Browser boundary          (imports: lib, types)
│                  the ONLY place MediaRecorder / Web Audio appear
├── components/  UI components             (imports: hooks, lib, types)
└── app/         Screens                   (imports: everything)
```

The split is load-bearing. Tim has said the UI "needs lots of changes, but I
don't know what they are yet," so the durable investment is the audio core and
the data model — and keeping them DOM-free is what lets the disposable layer be
rewritten without risking them.

## Audio pipeline

```
MediaRecorder (webm/opus on Android, mp4/aac on iOS)
   → decodeAudioData + OfflineAudioContext resample
   → canonical mono 16-bit PCM @ 44.1 kHz     ← everything internal is this
   → edit: cut / insert / paste / concat      (pure Int16Array functions)
   → export: MP3 (lamejs) or WAV                (encoder only — not wired, #18)
```

See [ADR 0002](docs/decisions/0002-audio-storage-format.md) and
[ADR 0003](docs/decisions/0003-mp3-encoder.md).

## Content — Open Bible Stories

Fifty OBS stories (598 illustrated frames) ship as beta content so testers get
real, ordered, illustrated chapters with zero setup. OBS maps onto the domain
model directly: **story → Chapter, frame → Section**, and the frame artwork
gives each section a non-textual identity — which is the core problem this app
has to solve for people who cannot read.

```bash
node scripts/build-obs-catalog.mjs   # refresh src/data/obs-catalog.json from Door43
```

Story text and frame metadata are bundled (230 KB), and so are the 128px
thumbnails — 598 of them for 2.5 MB, which is what makes the section list work
offline on first run (ADR 0006). **The 360px frames are not** — 46.8 MB for all
598 — so those are fetched per story on demand into IndexedDB and are
offline-forever once downloaded. Narration MP3s (~1 MB/story)
are an optional per-story download. See
[ADR 0006](docs/decisions/0006-obs-content.md).

### Attribution

unfoldingWord® Open Bible Stories is made available under a
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
Artwork is © [Sweet Publishing](https://www.sweetpublishing.com) under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0). This repository's
own source is MIT; the OBS content and this code are separate works in mere
aggregation.

> **Settled, not yet implemented.** The OBS licence treats a _translation_ as a
> derivative work, so recordings produced against OBS content **are** CC BY-SA
> and must not carry the unfoldingWord® trademark. Tim confirmed that reading on
> 2026-08-23 (#15 closed). **Nothing in the export path implements it yet** —
> there is no export path at all (#18) — and the data model still cannot tell an
> OBS-derived recording from a user-authored one. ADR 0006.

## Prior art

Read [`docs/research/prior-art.md`](docs/research/prior-art.md) before designing
anything. In short: **Shema Studio has already shipped essentially this entire
v1 feature list** (its source is not public — someone needs to ask Han Chung),
and **Benjamin Wright's `tcorePSA` already proved this exact stack** —
Vite + PWA + IndexedDB — on low-end Android inside uW.

## Docs

|                                                            |                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`docs/spec-transcription.md`](docs/spec-transcription.md) | Tim's handwritten inception notes, transcribed                  |
| [`docs/research/prior-art.md`](docs/research/prior-art.md) | Shema Studio, passage-recorder-app, tcorePSA, Scripture Burrito |
| [`docs/decisions/`](docs/decisions/)                       | ADRs                                                            |
| [`AGENTS.md`](AGENTS.md)                                   | Contributor and agent guide                                     |

## Licence

MIT — see [`LICENSE`](LICENSE). One LGPL-3.0 dependency, lamejs: **settled
2026-08-23, keep it** — [ADR 0003](docs/decisions/0003-mp3-encoder.md). The
notice and attribution obligations that come with keeping it are #36.
