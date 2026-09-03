# 0007 — Model frame timing before the data exists

**Status:** Superseded by B0 (#26) · **Date:** 2026-08-22

**Superseded 2026-08-24 (B0, #26).** The seam this ADR built — `lib/timing/**`,
`types/timing.ts`, and `tests/timing.test.ts` — has been **removed from the
tree**. Record-along is out of Phase 1 (D5), no mockup shows reference audio,
and a seam kept inert against data that does not exist is the speculative,
nothing-uses-it code the engineering bar rejects. The design reasoning below is
kept as the record of _why_ it was built and why it was cheap to remove; it no
longer describes code in `src/`. **The ask in "The ask this creates" still
stands** — #13 tracks asking unfoldingWord to publish OBS audio timing, and if
that data ever lands the parsers are recoverable from git history rather than
gone.

## Context

Reference audio was accepted into v1 so a translator can hear a passage before
recording it. The useful form of that is **record-along**: play frame 7's
narration, then record frame 7. That needs frame-level timing.

## What the search found

Searched before designing. **No frame-level OBS timing data exists anywhere.**

| Source                                                                                 | Result                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DCS catalogue                                                                          | **98 entries / 92 languages carry OBS audio** (`?hasAudio=true`), indexed by `media.yaml`, not by an audio subject — which is why a search for one came back empty. All story-level. **Zero timing.** |
| Door43 repo search (`obs-audio`, `obs_audio`, `audio-timing`, `obs+vtt`, `obs+timing`) | One hit: `GRA/apd_obs_audio` — 703 files, **all story-level MP3s, zero timing**                                                                                                                       |
| `unfoldingWord/en_obs` tree                                                            | 64 files, no VTT, cue, SRT or timing JSON                                                                                                                                                             |
| `cdn.door43.org` per-frame MP3 probe                                                   | **404** — narration is published per story only                                                                                                                                                       |
| Bolls                                                                                  | 31 languages, 149 translations, **no OBS at all**                                                                                                                                                     |

**Corrected 2026-08-22.** The first row originally read "No audio subject at
all for OBS — only text resources." That was wrong, and wrong in the direction
that misroutes the next reader: OBS audio _is_ on DCS, for 92 languages,
published by the OBS content owner at uW in late July 2026. It is discoverable
through `media.yaml` and the catalogue's `hasAudio` filter rather than through a
subject, which is how the original search missed it.

**The decision below does not change.** Every other row still holds and no VTT,
cue, SRT or burrito timing ingredient was found anywhere (`sb_count: 0`).

Two things worth knowing before anyone spends time on this:

- **Do not chase gateway-language reference audio for October.** The 92
  languages are overwhelmingly South Asian — `OBS-TLF` alone is 59 of the 98
  entries. There is no `sw`, `am`, `om`, `ti`, `so`, `lg`, `luo`, `rw`, `ny` or
  `sn`. Multi-language narration is a real Phase-2 capability and a dead end
  for the October 2026 training.
- **`src/hooks/obs-media.ts:16` hardcodes the English v6 chapter URL.** Verified
  2026-08-23 by fetching
  `https://git.door43.org/unfoldingWord/en_obs/raw/branch/master/media.yaml`:
  its `mp3` entry carries
  `chapter_url: 'https://cdn.door43.org/en/obs/v6/{quality}/en_obs_{chapter}_{quality}.mp3'`,
  which is our string with `{quality}` → `${quality}` and `{chapter}` → `${id}`.
  The coupling is real and `media.yaml` is the discoverable source of it — so a
  future change should read the template rather than re-hardcode it.

The _format_ however is settled: Scripture Burrito's alignment spec defines
`type: "audio-reference"`, mapping VTT timecodes to scripture references
(`docs/research/prior-art.md` §4), and the spec repo is live.

## Decision

Build the seam now, with nothing plugged into it.

```
types/timing.ts        FrameTiming, ChapterTiming, TimingProvider
lib/timing/parse.ts    WebVTT + Burrito alignment parsers, and validation
lib/timing/registry.ts register / loadChapterTiming / frameAt / frameStart
lib/timing/providers.ts webVtt, burritoTiming, staticTiming
```

`loadChapterTiming()` returns `null` today, and **nothing downstream asks it
yet** — its only callers are `lib/timing/` itself and `tests/timing.test.ts`.
Registering a provider is therefore the last step of turning this on, not the
only one; the playback wiring is #5. The shape is built so that step is a
registration rather than a refactor, which is the claim this ADR can make.

The parsers are pure functions over text and are **already unit-tested against
the real document shapes**, so when data finally arrives the parsing is
known-good rather than newly written under deadline.

## Why build it now rather than when the data lands

1. The shape of the data is knowable today; the absence is a publishing gap,
   not a design unknown.
2. It forces the UI to be honest now. Reference playback is story-level, and
   the code says so, rather than implying a capability it does not have.
3. It is cheap: ~250 lines and no runtime cost while nothing is registered.

## What is deliberately not done

**Frame boundaries are not estimated from text length.** It would work often
enough to look right and be wrong on scripture audio, and a confidently-wrong
playhead is worse than no playhead. `validateFrameTimings` likewise rejects
overlapping or reversed spans at the registry boundary rather than trusting a
provider.

## The ask this creates

**Someone should ask unfoldingWord to publish OBS audio timing.** The format
already exists and is already emitted by other tooling in this space. With one
timing file per story, frame-aligned reference playback becomes a registration
here rather than a feature — and record-along is the thing that makes this app
usable in an actual workshop.

Raise with the OBS content owner at uW first — the 92-language OBS audio was
published in July 2026 by running Whisper over YouTube audio to split it into
stories, so the one answerable question is whether that segmentation kept its
timecodes. Then the requirements owner for the product call, and the Scripture
Burrito maintainer at uW for the burrito timing shape (burrito round-tripping in
the browser is already solved there — `docs/research/prior-art.md` §3).
