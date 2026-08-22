# 0007 — Model frame timing before the data exists

**Status:** Accepted · **Date:** 2026-08-22

## Context

Reference audio was accepted into v1 so a translator can hear a passage before
recording it. The useful form of that is **record-along**: play frame 7's
narration, then record frame 7. That needs frame-level timing.

## What the search found

Searched before designing. **No frame-level OBS timing data exists anywhere.**

| Source                                                                                 | Result                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| DCS catalogue                                                                          | No audio subject at all for OBS — only text resources                           |
| Door43 repo search (`obs-audio`, `obs_audio`, `audio-timing`, `obs+vtt`, `obs+timing`) | One hit: `GRA/apd_obs_audio` — 703 files, **all story-level MP3s, zero timing** |
| `unfoldingWord/en_obs` tree                                                            | 64 files, no VTT, cue, SRT or timing JSON                                       |
| `cdn.door43.org` per-frame MP3 probe                                                   | **404** — narration is published per story only                                 |
| Bolls                                                                                  | 31 languages, 149 translations, **no OBS at all**                               |

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

Everything downstream asks `loadChapterTiming()` and copes with `null`, which
is what it returns today. When timing appears, turning it on is one
`registerTimingProvider()` call — not a refactor.

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

Raise with **Tim Jore** and **Benjamin Wright** (who has already solved burrito
round-tripping in the browser).
