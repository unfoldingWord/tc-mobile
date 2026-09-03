# 0003 — Use lamejs for MP3 export

**Status:** Accepted · **Date:** 2026-08-22, licensing settled 2026-08-23

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

## Licensing — settled 2026-08-23: keep lamejs

lamejs is **LGPL-3.0**; this repo is MIT. Bundling LGPL code into a JS bundle
is the well-known static-linking grey area. Three options were open: accept it,
relicense the repo, or move the encoder behind a boundary and document the swap
path.

**Decision: accept it and take the boundary option.** We ship
`@breezystack/lamejs`. The repo stays MIT with one LGPL-3.0 dependency, which is
an ordinary and defensible position — but it is only defensible if the
obligations are actually met, so they are listed here rather than assumed.

### What we owe, concretely

1. **Keep the encoder behind a replaceable boundary.** **Done (#34).**
   `src/lib/audio/mp3.ts` (the static `Mp3Encoder` import) is now imported only
   by `src/hooks/mp3.worker.ts`, so Vite bundles lamejs into its own
   `mp3.worker-*.js` chunk and it is absent from the main bundle — a _stronger_
   boundary than a dynamic `import()` would be. #34 moved the encoder into that
   Web Worker as a side effect of the threading work, so the licensing position
   improved with it. (Not "D3": D3 is transcode-on-Finished, which is what made
   #34 a blocker rather than a nicety. They are different tickets.)
2. **Keep one module interface in front of it.** `encodeMp3` is the only entry
   point, so an LGPL relink has exactly one unit — the `mp3.worker-*.js` chunk —
   to replace. Do not scatter lamejs calls.
3. **Ship the licence text and attribution** with the app, reachable by someone
   holding the phone — not only in `node_modules`.
4. **Do not patch lamejs.** If it ever must be patched, the modified source has
   to be published.
5. **Say so in the open.** `README.md` and the package metadata should state
   that the project is MIT with an LGPL-3.0 encoder, rather than leaving a
   reader to discover it from a lockfile.

Items 3 and 5 are done (#36): the MIT / LGPL-3.0 / GPL-3.0 licence texts and the
attribution of every bundled component — the direct runtime dependencies, the
transitive `scheduler`, and Workbox — ship under `public/licenses/` (precached
for offline) and are reachable in-app at **Menu → About & licenses**
(`src/components/about-panel.tsx`, data in
`src/components/licenses.ts`). `package.json` declares the project's own licence
(`"license": "MIT"`) and `README.md` states the full MIT-with-an-LGPL-3.0-encoder
position in prose. The in-app surface has not yet been eyeballed on a device.

**LGPL §4(d) — decided 2026-09-03 by the DRI: §4(d)(0), the Corresponding Source
is the repository.** The boundary (items 1–2) is clean; the LGPL also requires
that a recipient be _able_ to relink, which §4(d)(0) satisfies by providing the
Corresponding Application Code in a form that permits recombination with a
modified library. tC Mobile relies on **§4(d)(0)**: the Corresponding Source is
`unfoldingWord/tc-mobile` itself, and the plan of record is to make the
repository public before the v0.2.0 `staging → main` promotion (org-transfer plan
D2 — uW's default is public — pending the requirements owner's confirmation and
the pre-publication content/history review now running). **Until the repository is public, §4(d)(0)
is met by supplying the source on request from unfoldingWord.** Constraints on
the **shipped copy** (the in-app note and the README, not this ADR): they
describe the boundary and may state that the corresponding source is available
from unfoldingWord, but must not claim the repository is public until it is, and
carry no exercisable-relink language. This ADR itself records the §4(d)(0)
option in full, as the decision directs. #36 tracks the publication step.

### What this closes

Known open item 3 in `AGENTS.md`, and issue #14. It also unblocks #34, which
could not settle while the encoder's presence on a required path was in doubt.

## Resolved — threading and the encoder chunk (#34)

`encodeMp3` is CPU-bound and would jank the UI on a long chapter if it ran on
the main thread. This stopped being a performance nicety on 2026-08-23: decision
D3 transcodes to MP3 when a translator marks a segment Finished, putting the
encoder on a user-visible path on every segment rather than behind an export
button — a blocker, tracked in #34.

**#34 landed.** `encodeMp3` (`src/lib/audio/mp3.ts`) is now imported only by
`src/hooks/mp3.worker.ts`, so Vite emits it — and its static lamejs import — as
a separate `mp3.worker-*.js` chunk (measured ~169 kB), absent from the main
bundle and precached by the service worker. That is both the off-main-thread
home this flag asked for and the replaceable LGPL boundary of item 1: the one
thing a relinker replaces is that worker chunk. (The earlier note that "there is
no encoder chunk", measured at `761b3c2` when `encodeMp3` had no caller and was
tree-shaken out, no longer holds — the transcode path is now a real caller.)
