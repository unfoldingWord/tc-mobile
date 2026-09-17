# tC Mobile

**translationCore Mobile** — an offline-first PWA that aims to be the
"world's simplest mobile audio notebook and pencil" editor for oral communities doing
translation.

## Why this exists

There is no pathway for translation production in communities that cannot use
text-based modalities. Oral communicators have no "pencil and paper." This is
an attempt at one.

## Where the model came from

The product mockups of 22 Aug 2026 — which arrived about an hour after work
began — set the domain model the app uses today. The initial scaffold was
replaced rather than evolved:

```
was:  Project -> Chapter -> Section -> Segment -> Take
now:  Book    -> Chapter ->            Segment  (-> Take, hidden, 1:1)
```

A segment is the unit of work — one recording, edited in place.

The issues and the docs call that replacement **the pivot**, and the word is
load-bearing: it names the umbrella issue, the batch numbering, and the
`@pivotpending` tag in the source.
[`docs/design/pivot-plan.md`](docs/design/pivot-plan.md) is the plan of record,
[#25](https://github.com/unfoldingWord/tc-mobile/issues/25) is the umbrella
issue, and the work is nine batches, B0–B8 — all landed except the Template
Library half of B7.

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

**Cloudflare Workers Builds deploys** the PWA straight from the repo — no
Actions workflow deploys the web app. (The one deploy workflow in `.github/` is
the manual iOS TestFlight lane, run by hand — a native build, not a web deploy.)
Workers Builds is configured per Worker, so the repo is connected twice:
`tc-mobile` builds from `main`, `tc-mobile-staging` builds from `staging` with
`--env staging`.

### Testing on a phone

Open a deployed URL on the device. It is HTTPS, which matters —
`getUserMedia` refuses to run outside a secure context, so a LAN address like
`http://192.168.x.x` **cannot record audio** no matter what else is correct.

Add it to the home screen to exercise the installed PWA (standalone display and
safe-area insets behave differently there than in a browser tab). There is no
share-sheet export path yet — see #18.

### CI

`ci.yml`: full-history secret scan, format, lint, knip, typecheck, test, build,
and a check that the PWA service worker, manifest, and `version.json` were
emitted. It deploys nothing. (`.github/` also holds the two manual native
lanes, run by hand and never on push/PR: `ios-testflight.yml`, a TestFlight
upload, and `android-apk.yml`, a signed release APK attached to the run as an
artifact. They are the only workflows that ship a binary, and never to
Cloudflare.)

The repo is `unfoldingWord/tc-mobile`, in the unfoldingWord org, **public since
2026-09-13**. Keep it public: the native lanes' signing gate (a GitHub
environment with required reviewers, #321) exists only on public repositories
for this org's plan — `docs/native/README.md` §4a step 4 has the detail.

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

The split is deliberate. The requirements owner said from the start that the UI
would need extensive changes that were not yet specified — the pivot is that
rewrite arriving. Keeping `lib/` DOM-free is what lets the UI layer be replaced
without touching the audio core.

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
thumbnails — 598 of them for 2.5 MB. They ship in the build but are **excluded
from the service-worker precache until a screen reads them** (#177): no shipped
screen draws them yet, so precaching 2.5 MB of unused pictures only delayed
offline-readiness. `jpg` is restored to the precache when the Template Library
(#33) wires a reader — imports/calls `thumbUrl`, or otherwise references the
`/obs/thumbs/` path — the bundle-and-precache decision itself stands (ADR 0006,
2026-09-04 amendment).
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
> and must not carry the unfoldingWord® trademark. The requirements owner
> confirmed that reading on 2026-08-23 (#15 closed). **Nothing in the export
> path implements it yet** —
> there is no export path at all (#18) — and the data model still cannot tell an
> OBS-derived recording from a user-authored one. ADR 0006.

## Prior art

Read [`docs/research/prior-art.md`](docs/research/prior-art.md) before designing
anything. In short: **Shema Studio has already shipped essentially this entire
v1 feature list** (its source is not public — someone needs to ask the Shema
Studio developer), and **a uW Scripture Burrito prototype already proved this
exact stack** — Vite + PWA + IndexedDB — on low-end Android inside uW.

## Docs

|                                                            |                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| [`docs/design/pivot-plan.md`](docs/design/pivot-plan.md)   | **The plan of record** for the pivot — #25            |
| [`docs/design/`](docs/design/)                             | Screen design passes and design notes                 |
| [`docs/research/prior-art.md`](docs/research/prior-art.md) | Shema Studio, passage-recorder-app, Scripture Burrito |
| [`docs/decisions/`](docs/decisions/)                       | ADRs                                                  |
| [`AGENTS.md`](AGENTS.md)                                   | Contributor and agent guide                           |

## Licence

MIT — see [`LICENSE`](LICENSE). One LGPL-3.0 dependency, lamejs: **settled
2026-08-23, keep it** — [ADR 0003](docs/decisions/0003-mp3-encoder.md).

Every bundled open-source component is disclosed **inside the app**, reachable
on the phone under **Menu → About & licenses** (#36): each web-bundle dependency
and Workbox with its licence and copyright, and the verbatim licence texts (MIT,
the collected third-party notices, GNU LGPL v3, GNU GPL v3) read in-drawer. Those
texts also ship and precache for offline under
[`public/licenses/`](public/licenses/), so a translator in the field is not sent
to `node_modules` to find them. The Corresponding Source under LGPL §4(d)(0) is
this repository, available from unfoldingWord (ADR 0003). The in-app notice
covers the web bundle; the Capacitor native shell's own attribution is tracked
separately (#477).
