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

1. **Keep the encoder behind a replaceable boundary.** **Not yet true.**
   `src/lib/audio/mp3.ts:21` imports `Mp3Encoder` statically; there is no
   dynamic `import()` of lamejs anywhere in `src/`. **#34** moves the encoder
   into a Web Worker, which is a _stronger_ boundary than a dynamic import would
   be — so the licensing position improves as a side effect of that performance
   work. Until #34 lands, this obligation is outstanding, not met. (Not "D3":
   D3 is transcode-on-Finished, which is what makes #34 a blocker rather than a
   nicety. They are different tickets.)
2. **Keep one module interface in front of it.** `encodeMp3` is the only entry
   point, so a user exercising their LGPL right to relink has exactly one thing
   to replace. Do not scatter lamejs calls.
3. **Ship the licence text and attribution** with the app, reachable by someone
   holding the phone — not only in `node_modules`.
4. **Do not patch lamejs.** If it ever must be patched, the modified source has
   to be published.
5. **Say so in the open.** `README.md` and the package metadata should state
   that the project is MIT with an LGPL-3.0 encoder, rather than leaving a
   reader to discover it from a lockfile.

Items 3 and 5 are done (#36): the MIT / LGPL-3.0 / GPL-3.0 licence texts and the
attribution of every bundled web-bundle component ship under `public/licenses/`
(precached for offline) and are reachable in-app at **Menu → About & licenses**
(`src/components/about-panel.tsx`, data in `src/components/licenses.ts`).
`package.json` declares `"license": "MIT"` and `README.md` states the
MIT-with-an-LGPL-3.0-encoder position in prose. The in-app surface has not yet
been eyeballed on a device.

**LGPL §4(d) — decided 2026-09-03 by the DRI; app source link confirmed
2026-09-24 (#144); library source kept in this repository by the DRI's
2026-09-26 ruling (#144, Frank round 6).** The boundary (items 1–2) is clean.
tC Mobile relies on **§4(d)(0)**, and the source is offered from
`unfoldingWord/tc-mobile`, public since **2026-09-13** (org-transfer plan D2).
This replaces the pre-publication interim of "source on request".

What the mechanism consists of, and what checks it — no more than this:

- **The app's own source.** The About screen links
  `github.com/unfoldingWord/tc-mobile/tree/<commit>`, where `<commit>` is the
  build's full 40-character commit id (the `__BUILD_SHA_FULL__` build define,
  `SourceOfferLink` in `src/components/about-panel.tsx`), not the 7-character
  footer stamp.
- **The library's source.** The source of `@breezystack/lamejs` 1.2.7 is kept
  in this repository under `third_party/lamejs-1.2.7/`, copied without change
  from the upstream commit npm records as that release's `gitHead`
  (`1fb0ef5fa177413107e2e107d054a9b994e3f79c`). The folder's `PROVENANCE.md`
  names the upstream repository, the commit, the date fetched and the files
  left out. The About screen's lamejs row links that folder at the same full
  commit id as the app link, so the link reaches the copy kept beside the code
  of the build on the phone, not an upstream repository that can change.
- **Checks.** `tests/vendored-lamejs.test.ts` fails if the folder's version
  stops matching the lamejs version in `package-lock.json`, if its `LICENSE`
  or type declarations stop matching the installed package, or if
  `PROVENANCE.md` stops naming that full commit id.
  `tests/dist-source-offer.test.ts` fails if the built bundle does not carry
  both links with the full commit id from `dist/version.json`.

What this does not establish: that these links satisfy §4(d)(0) or GPL §6.
Constraints on the **shipped copy** (the in-app note and the README, not this
ADR): they may name the public repository and link it, and carry no
exercisable-relink how-to. This mechanism was selected by the DRI, not
confirmed by qualified counsel (Frank rounds 2–3 and 6 on #144 asked; recorded
as fact, not as a compliance opinion).

The in-app notice describes the **web bundle** — which includes the
`@capacitor/*` JavaScript packages `src/` imports (core, app, filesystem, share
and what they pull), so those are disclosed there. The Capacitor native shell's own
open-source attribution (#262) — the Gradle / CocoaPods / native-Capacitor tree
— is separate, larger work, tracked in #477.

### What this closes

Known open item 3 in `AGENTS.md`, and issue #14. It also unblocks #34, which
could not settle while the encoder's presence on a required path was in doubt.

## Open flag — threading

`encodeMp3` is CPU-bound and currently runs on the main thread, which will jank
the UI on a long chapter. `onProgress` exists so a caller can show progress,
but **the encoder belongs in a Web Worker.**

This stopped being a performance nicety on 2026-08-23. Decision D3 transcodes to
MP3 when a translator marks a segment Finished, which puts the encoder on a
user-visible path on every segment rather than behind an export button. It is now
a blocker, tracked in #34.

**There is no encoder chunk.** Measured at `761b3c2`: the production build
emits exactly two JS assets — `index-*.js` at 465,785 bytes and the OBS
catalogue at 200,804 — and neither contains `Mp3Encoder`. lamejs is a static
import in `src/lib/audio/mp3.ts:21`, and because `encodeMp3` has no caller
outside its own test it is tree-shaken out of the bundle entirely. So the
splitting, the 169 kB chunk and the service-worker precache described here
before were all describing a build that does not exist. When #18 wires an
export path lamejs enters the main graph; #34's worker is what puts it behind
a real boundary.
