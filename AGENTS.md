# AGENTS.md — tC Mobile

The canonical contributor guide. Read this before changing anything.

## Purpose

tC Mobile is an offline-first PWA for oral Bible translation: record a passage,
edit the waveform, manage sections, export MP3. It targets Android and iOS
phones, frequently offline, used by people who may not read.

The driving deadline is the **East Africa training in the first week of
October 2026**, with production readiness targeted for **end of September 2026**.

## Tech stack

|         |                                                          |
| ------- | -------------------------------------------------------- |
| Runtime | Node 22+                                                 |
| Build   | Vite 7, `@vitejs/plugin-react`                           |
| UI      | React 19, Tailwind CSS 4, `lucide-react`                 |
| PWA     | `vite-plugin-pwa` 1.3 (Workbox `generateSW`)             |
| Storage | IndexedDB via `idb` 8                                    |
| Audio   | Web Audio + MediaRecorder; `@breezystack/lamejs` for MP3 |
| Tests   | Vitest 3, `fake-indexeddb`                               |
| Lint    | ESLint 9 flat config, `typescript-eslint` 8, Prettier 3  |
| Deploy  | Cloudflare Workers static assets, Wrangler 4             |

## Commands

```bash
npm run dev            # dev server
npm run dev:lan        # bind 0.0.0.0 for phone testing (see HTTPS caveat below)
npm run build          # production build
npm run preview        # preview the build
npm run lint           # ESLint, zero warnings allowed
npm run typecheck      # tsc -b (project references)
npm test               # vitest run
npm run format         # prettier --write
npm run verify         # everything above, in one command
npm run deploy:staging # wrangler deploy --env staging
npm run deploy         # wrangler deploy (production)
```

## Architecture — onion layers

```
types → lib → hooks → components → app
```

Styling is layered separately, in `src/app/styles/`:

```
1-primitives.css   raw values, no meaning        (nothing outside layer 2 may use these)
2-semantic.css     roles + themes                (the only layer that knows about themes)
3-components.css   component tokens and parts    (may use layer 2, never layer 1)
```

`@layer primitives, semantic, components, utilities` fixes the cascade order
once, so Tailwind utilities always win and a one-off utility stays a safe
escape hatch rather than a specificity fight. Using a primitive directly in a
component is the leak this exists to prevent — it is what makes a theme
unswitchable later.

Imports never go upward. This is enforced by ESLint `no-restricted-imports` in
`eslint.config.mjs`, not by convention.

**The rule that matters most:** `lib/` must stay free of DOM, Web Audio, and
MediaRecorder. All browser APIs live in `hooks/` (`hooks/audio-io.ts` is the
single audio boundary). That is what keeps the audio core unit-testable in
plain Node, and it is why the test suite can cover cut/paste/insert/export
without a browser or a microphone.

If you find yourself wanting `window` in `lib/`, the code belongs in `hooks/`.

## Testing

- `tests/` at the repo root, `*.test.ts`, run in the Node environment.
- The audio core and the storage layer are covered. Browser-only paths
  (MediaRecorder, `decodeAudioData`, the share sheet) are **not** covered by
  automated tests — they are verified on-device. Say so honestly rather than
  claiming coverage that does not exist.
- `fake-indexeddb` backs the storage tests. Reset between cases by **clearing
  every object store**, not by `deleteDatabase`: deletion blocks indefinitely
  while any connection is open, and a harness that resolves on `onblocked`
  silently carries the previous test's data forward.

## Branches and deployment

```
feature branch  ->  develop  ->  main
                    (default)     (release)
```

`develop` is the default branch and where work lands. `main` is the release
branch; promoting is a PR from `develop` to `main`, and that PR **is** the
production gate.

**Cloudflare Workers Builds owns deployment**, connected directly to the GitHub
repo. There are no deploy workflows in `.github/` — deleting them removed a
real collision, since CF and Actions would otherwise both deploy on the same
triggers, to different targets.

| Branch    | Cloudflare does                            | Result                             |
| --------- | ------------------------------------------ | ---------------------------------- |
| `main`    | `npm run build` then `npx wrangler deploy` | Production worker `tc-mobile`      |
| any other | `npx wrangler versions upload`             | A preview version with its own URL |

Preview versions per branch replace the per-PR ephemeral workers this repo used
to create: native to Cloudflare, no cleanup job, no worker sprawl.

Cloudflare account **unfoldingWord** (`5a3ffd86280d3ed086be76d955829242`). The
API token lives in Cloudflare's build settings, **not** in a GitHub secret —
GitHub Actions no longer deploys anything, so it needs no Cloudflare
credentials. Only `ci.yml` remains there.

Add `docs/**` and `*.md` to Cloudflare's **Exclude paths**, or every
documentation commit burns a build and redeploys.

No deploys from a local machine except deliberate ones during this prototype
phase.

## Device testing — the HTTPS caveat

`getUserMedia` requires a secure context. `localhost` qualifies;
`http://192.168.x.x` does **not**. So `npm run dev:lan` alone will _not_ let a
phone record. Use a tunnel (`cloudflared tunnel --url http://localhost:5173`),
a per-PR Worker, or staging:

**<https://tc-mobile-staging.unfoldingword.workers.dev>**

**Test on real iOS at least once per meaningful audio change.** iOS Safari is
the platform most likely to break here: it produces mp4/aac rather than
webm/opus, caps AudioContext creation, and starts contexts suspended until a
user gesture. All three are handled in `hooks/audio-io.ts` — and all three are
easy to regress.

## Conventions

- **Branches:** `<type>/<short-description>` — `feat/waveform-selection`,
  cut from `develop` and merged back by PR.
- **Commits:** Conventional Commits. Subject _and_ body, neither blank.
- **Pre-commit** (fast): lint-staged, typecheck. **Pre-push** (slow): tests, build.
- **Never** `--no-verify`. Never suppress a lint rule or add a type suppression
  without asking first.
- **Never** swallow an error silently. If a `catch` is genuinely empty, the
  comment must say why.

## Risk tiers

| Tier   | Examples here                                        | Bar                                                                                                               |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **T1** | `lib/audio/*`, `lib/storage/*`, the IndexedDB schema | Tests required. Data loss or corrupted audio is unrecoverable in the field. Schema changes need a migration path. |
| **T2** | `hooks/*`, export/share paths                        | Tests where possible + on-device check on both Android and iOS.                                                   |
| **T3** | `components/*`, `app/*`, copy, styling               | Review only. This layer is expected to churn.                                                                     |

## Known open items

1. **MP3 encoding runs on the main thread** and will jank on a long chapter.
   Move it to a Web Worker — ADR 0003.
2. **PCM storage is ~5.3 MB/minute.** All 50 OBS stories is roughly 660 MB.
   Mitigations are listed but undecided — ADR 0002. **Resolve before October.**
3. **lamejs is LGPL-3.0** in an MIT repo — ADR 0003. Needs a human decision.
4. **The division-scheme question** — ADR 0004. Needs Tim's decision.
5. **No Scripture Burrito export yet.** The audio flavor supports it and MP3 is
   the right format; talk to Benjamin Wright first — `docs/research/prior-art.md` §4.
6. **No Shema Studio source access.** Tim asked us to read it; there is no
   public repo. Someone needs to ask Han Chung.
7. **No OBS frame timing exists**, so reference audio is story-level and
   record-along is not possible — ADR 0007. The seam is built; someone needs to
   ask uW to publish timing files.
8. **OBS-derived recordings may be CC BY-SA.** A recorded translation of an OBS
   story is arguably a derivative work. The data model cannot tell an
   OBS-derived recording from a user-authored one, and the export path
   implements none of it — ADR 0006. **Needs Tim and uW licensing.**

## DRI

**Seth Stoll** is building this. **Tim Jore** owns the requirements.

**The repository is deliberately personal and private** —
`sethstoll3/tc-mobile`, not `unfoldingWord/tc-mobile`. Per
`dev-practices/new-project-checklist.md`, creating an org repo requires
tech-lead approval and a recorded DRI, and neither exists yet. A private
personal repo sidesteps that gate honestly rather than pre-empting it.

**Moving it into the org later is the plan, and it is a real transfer** — the
Cloudflare account is already unfoldingWord, so deployment does not change, but
the repo secrets, the Actions history and any issue references do. Get the
approval and the DRI recorded first.
