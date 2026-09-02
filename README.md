# tC Mobile

**translationCore Mobile** — an offline-first PWA that aims to be the
"world's simplest mobile audio notebook and editor" for oral communities doing
Bible translation.

> **Status: pre-pivot scaffold.** The audio core and the storage layer are
> working and unit-tested. The UI is a disposable vertical slice, and it is
> being replaced rather than evolved — see [The pivot](#the-pivot) below. The
> source requirements are [`docs/spec-transcription.md`](docs/spec-transcription.md)
> (page 1) and [`docs/spec-transcription-p3-p4.md`](docs/spec-transcription-p3-p4.md)
> (the mockups); [`docs/decisions/`](docs/decisions/) has what was decided and
> why.

## Why this exists

There is no pathway for translation production in communities that cannot use
text-based modalities. Oral communicators have no "pencil and paper." This is
an attempt at one.

## The pivot

Tim Jore drew a set of screen mockups on 22 Aug 2026, and they are now the
first principles for the UI. The domain model moves with them:

```
was:  Project -> Chapter -> Section -> Segment -> Take
now:  Book    -> Chapter ->            Segment  (-> Take, hidden, 1:1)
```

A segment is the unit of work — one recording, edited in place. The pre-pivot
UI in `src/components` and `src/app` is being replaced, not evolved.

[`docs/design/pivot-plan.md`](docs/design/pivot-plan.md) is the plan of record.
[#25](https://github.com/sethstoll3/tc-mobile/issues/25) is the umbrella issue,
and the work is nine batches, B0–B8. **None of them has started**, so
everything below describes the tree as it stands today: `Section` is still in
the model, and no mockup screen exists yet.

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

The split is deliberate. Tim said from the start that the UI "needs lots of
changes, but I don't know what they are yet" — the pivot is that rewrite
arriving. Keeping `lib/` DOM-free is what lets the UI layer be replaced without
touching the audio core.

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

Fifty OBS stories (598 illustrated frames) are bundled as beta content. Before
the pivot they mapped onto the domain model directly — a story a Chapter, a
frame a Section, one Section per frame built by `src/hooks/use-chapter.ts`.
`Section` is gone from the model as of B1–B4, and so is that loader: the pivot
screens (Books → Segments → Recorder) start from an **empty Books shelf** (G2),
and the bundled OBS catalog is **not yet imported** into the Book model — that
wiring is later pivot work.

```bash
node scripts/build-obs-catalog.mjs   # refresh src/data/obs-catalog.json from Door43
node scripts/build-obs-thumbs.mjs    # rebuild public/obs/thumbs/ from the 360px frames
```

Story text and frame metadata are bundled (230 KB), and so are the 128px
thumbnails — 598 of them for 2.5 MB, precached by the service worker (ADR 0006).
**The 360px frames are not bundled**, and after B0 (#26) they are **not cached
either**: the on-demand IndexedDB fetch for full-size artwork is gone. The
pre-pivot recording view that rendered a frame's CDN `<img>` is gone too, removed
with the rest of the pre-pivot UI in B2–B4.

Two things about this content changed with the pivot. Artwork is an optional
per-segment illustration rather than the thing that decides the browse layout
(D6), and no _mockup_ screen draws it — so B0 removed the media cache outright
(Q4 answered no; #1 closed as moot). Reference audio is out of Phase 1 (D5), so
the narration path — the `narrationUrl` helper and the reference control — is
gone too. See [ADR 0006](docs/decisions/0006-obs-content.md).

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

|                                                                        |                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`docs/design/pivot-plan.md`](docs/design/pivot-plan.md)               | **The plan of record** for the pivot — #25                      |
| [`docs/spec-transcription.md`](docs/spec-transcription.md)             | Tim's handwritten inception notes, page 1, transcribed          |
| [`docs/spec-transcription-p3-p4.md`](docs/spec-transcription-p3-p4.md) | The screen mockups, pages 3–4, transcribed                      |
| [`docs/design/`](docs/design/)                                         | Mockup images, the gap analysis, and the pre-pivot design work  |
| [`docs/research/prior-art.md`](docs/research/prior-art.md)             | Shema Studio, passage-recorder-app, tcorePSA, Scripture Burrito |
| [`docs/decisions/`](docs/decisions/)                                   | ADRs                                                            |
| [`AGENTS.md`](AGENTS.md)                                               | Contributor and agent guide                                     |

## Licence

This project is **MIT** (see [`LICENSE`](LICENSE)) with **one LGPL-3.0
dependency, the `@breezystack/lamejs` MP3 encoder** — **settled 2026-08-23,
keep it** ([ADR 0003](docs/decisions/0003-mp3-encoder.md)). lamejs is isolated
behind a single module boundary (`encodeMp3`, in a Web Worker chunk) — the one
unit an LGPL relink concerns. Providing the Corresponding Source that lets a
recipient exercise that relink right (LGPL §4(d)) is still open — see ADR 0003
and #36.

Every bundled open-source component is disclosed **inside the app**, reachable
on the phone under **Menu → About & licenses**: each runtime dependency and
Workbox (which builds the service worker) with its licence and copyright, and
the verbatim licence texts (MIT, the collected third-party notices, GNU LGPL v3,
GNU GPL v3) read in-drawer. The texts also ship (and precache for offline) under
[`public/licenses/`](public/licenses/), so a translator in the field is not sent
to `node_modules` to find them (#36).
