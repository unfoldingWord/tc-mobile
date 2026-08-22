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
npm run verify   # format:check + lint + typecheck + test + build
```

Individually: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run format`, `npm run build`.

## Deploy

Static assets on Cloudflare Workers with SPA fallback — no backend
([ADR 0005](docs/decisions/0005-no-backend-in-phase-1.md)). Cloudflare still
deploys this as a Worker; it just has no script of its own.

| Environment    | Worker              | URL                                                              |
| -------------- | ------------------- | ---------------------------------------------------------------- |
| **Staging**    | `tc-mobile-staging` | <https://tc-mobile-staging.unfoldingword.workers.dev> ✅ live    |
| **Production** | `tc-mobile`         | `https://tc-mobile.unfoldingword.workers.dev` (not yet deployed) |
| **Per-PR**     | `tc-mobile-pr-<N>`  | `https://tc-mobile-pr-<N>.unfoldingword.workers.dev`             |

```bash
npm run deploy:staging   # wrangler deploy --env staging
npm run deploy           # production
```

Account: **unfoldingWord** (`5a3ffd86280d3ed086be76d955829242`).

### Testing on a phone

Open the staging URL on the device. It is HTTPS, which matters —
`getUserMedia` refuses to run outside a secure context, so a LAN address like
`http://192.168.x.x` **cannot record audio** no matter what else is correct.

Add it to the home screen to exercise the installed PWA (standalone display,
safe-area insets, and the iOS share-sheet export path all behave differently
there than in a browser tab).

### CI/CD

| Workflow             | Trigger                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `ci.yml`             | every push and PR — format, lint, typecheck, test, build, secret scan |
| `deploy-pr.yml`      | PR opened/updated → ephemeral Worker, URL commented on the PR         |
| `cleanup-pr.yml`     | PR closed → ephemeral Worker deleted                                  |
| `deploy-staging.yml` | PR merged to `main` → staging                                         |
| `deploy-prod.yml`    | manual dispatch only                                                  |

**Required repo secrets** (set these once the GitHub repo exists):
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Optional: `GITLEAKS_LICENSE`.

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
   → export: MP3 (lamejs) or WAV
```

See [ADR 0002](docs/decisions/0002-audio-storage-format.md) and
[ADR 0003](docs/decisions/0003-mp3-encoder.md).

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

MIT — see [`LICENSE`](LICENSE). Note the LGPL dependency flagged in
[ADR 0003](docs/decisions/0003-mp3-encoder.md).
