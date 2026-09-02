# 0009 — Transcode on Finished: MP3 replaces PCM, editing after Finished re-decodes

**Status:** Accepted · **Date:** 2026-09-02 · **Batch:** B8 (#34) · **DRI:** Seth Stoll

Implements decision **D3** (2026-08-23) and builds against the recorded
**Q5** default (Seth, on #34, 2026-08-23). Q5 itself stays open in the
register in `docs/design/pivot-plan.md`: a default built against is not an
answer, and the generation count below is what keeps the evidence to answer it.

## Context

Canonical PCM is ~5.3 MB/minute — roughly 660 MB for all 50 OBS stories on a
phone that may be shared and nearly full (#12, ADR 0002). D3 chose one of ADR
0002's three mitigations: keep PCM while a segment is being edited, transcode to
MP3 and drop the PCM when the translator marks it **Finished**. That makes the
Finished toggle a real state transition rather than a label, and it puts the
encoder — which ADR 0003 already flagged as a main-thread jank risk — on a path
every segment takes. #34 named three things this batch had to settle:

1. the encoder off the main thread;
2. the PCM dropped only after the MP3 is durably written;
3. what happens when a finished segment is edited, since its PCM is gone.

## Decision

### 1. The encoder runs in a Web Worker, behind one message

`src/hooks/mp3.worker.ts` wraps `lib/audio/mp3.ts`'s `encodeMp3`; `src/hooks/mp3-codec.ts`
spawns one worker per encode, transfers the PCM buffer in (moved, not copied),
transfers the MP3 out, and **terminates the worker on every exit** — so a
cancelled share (`AbortSignal`) really stops mid-encode instead of finishing for
nobody. There is **no inline fallback**: an earlier draft fell back to the
main-thread encoder where `Worker` was absent, and that one static import kept
lamejs in the app bundle (and duplicated it into the worker chunk) — round-1
George G2, verified against `dist/`. Every target phone has `Worker`; where it
is missing the encode rejects with a clear error.

**One encoder lane.** Every encode-bearing job — a Finished transcode, a Share
Chapter, a Share Book — runs through `withEncoder`, which serialises them
app-wide. The sweep takes the lane before it loads a clip and a share holds it
for its whole build, so a segment's PCM in one worker never coexists with a
chapter's PCM in another (round-1 George G1). Peak is one job's audio.

`lib/` never sees a worker. The export and transcode paths take an
`AudioCodec` — `encodeMp3` and `decodeMp3` as two async functions — and the hook
layer fills it in (`withEncoder`). Tests fill it with the synchronous
encoder wrapped in a promise and a fake decoder, which is what keeps the whole
gather → encode and encode → commit path unit-tested in Node.

This is also ADR 0003's outstanding obligation 1: with the fallback gone, Vite
emits the worker and its lamejs import as their **own chunk**
(`dist/assets/mp3.worker-*.js`, ~170 kB) and the app bundle carries no
`Mp3Encoder` — checked by grepping `dist/` at the PR's round-2 head, not
assumed. The LGPL encoder sits behind one message interface. The notice and
attribution work stays #36.

### 2. The commit is one strict-durability transaction that re-checks the world

`lib/storage/transcode.ts`:

- `listPcmFinishedSegments()` — which segments owe a transcode: Finished, with an
  active take whose clip is still PCM.
- `commitTranscode(segmentId, clipId, mp3, peaks)` — ONE readwrite transaction
  over `segments`/`takes`/`clipMeta`/`clipData` with `durability: "strict"`. It
  re-reads, inside the transaction, that the segment is still Finished, still
  points at the same take and the same clip, and that the clip is still PCM.
  Then `put` replaces the bytes under the clip id and stamps the metadata. The
  PCM is gone exactly when the MP3 is durable; there is no intermediate state.
  Anything else is **`stale`** and nothing is written — the translator
  un-finished, edited, re-recorded or erased while the worker was encoding — or
  **`already`** when a concurrent sweep landed first. An empty MP3 is refused.

The trigger is a **sweep**, not a per-callsite write: every Finished transition
(row menu, recorder checkbox on close, a take saved with the mark) asks
`requestTranscodeSweep()` (`src/hooks/finish-transcode.ts`), and `App` asks once
at launch. The sweep is idempotent and serialised module-wide, so a page
discarded mid-encode loses nothing — the PCM is still there, and the next launch
picks the segment up. That is what makes dropping audio in the background safe
to do at all. A failing segment is logged and left as PCM; nothing is shown,
because from the translator's side nothing has changed.

### 3. Editing a finished segment is allowed; the audio carries a generation count

Q5's default, adopted as built. A translator who cannot fix a mistake after
marking a segment done will stop marking segments done — which breaks the
progress model the Books screen rests on _and_ the storage saving D3 exists for,
because nothing ever transitions to MP3. One generation of loss on an edited
segment is the cheaper failure.

So the recorder decodes an MP3 clip back to PCM at mount
(`decodeMp3ToCanonical`, `hooks/audio-io.ts`) and edits it as before. The save
writes PCM under a new clip id (the 1:1 replace) and **inherits the prior
clip's `generation`**; the next Finished transcodes again and increments it.

`ClipMeta.generation` = lossy encode passes the audio has been through: 0 fresh,
1 transcoded once, 2 decoded-edited-transcoded, and so on. An erase resets it.
The inheritance rule is "a replacement take carries the prior clip's count",
which is exact while every save over an existing take is a merge into the
decoded buffer — the only way the recorder saves today. If a "replace the whole
take" gesture ever exists, that gesture must stamp 0, or fresh microphone audio
would be counted as lossy (noted by Seth in round 1). Nothing reads it yet. It
exists so the Q5 call — disallow, warn, or leave it — can be made later on
evidence from real devices rather than argued in the abstract.

### Schema — v4, append-only

`ClipMeta` gains `encoding` (`"pcm" | "mp3"`), `generation`, `byteLength` and
`peaks`. The v3→v4 upgrade is a **backfill** of existing rows as PCM/0 — no
store dropped, no bytes touched. Append-only discipline, as ADR 0008 promised
from v3 onward, and `tests/db-migration.test.ts` pins that a v3 device's
recordings come through.

`peaks` are the Segments-row waveform (`ROW_PEAK_BUCKETS`), taken from the PCM
just before it is dropped and stored on the MP3 clip, so listing a chapter never
decodes audio — nor even loads an MP3 row's bytes (the row reads metadata only).

`frameCount`/`durationMs` stay the original PCM's, and **a decode is not the
clip**. Measured in Chromium with impulses at known positions, for five input
lengths: the recording starts **1105 samples** into the decode (LAME's 576 of
encoder priming plus the 529-sample decoder delay), the decode is exactly the
stream's granule count × 1152 long, and the rest is tail padding. lamejs writes
no Xing/LAME info tag, so no decoder can trim that by tag. Every consumer of a
decode — the chapter export, playback, the recorder's edit buffer — therefore
goes through `fitMp3Decode` (`lib/audio/mp3-align.ts`), which counts the
stream's own granules from its headers, reads the decoder's behaviour off the
decode's length (trimmed nothing / trimmed its own delay / sample-exact), skips
the priming it finds, and fits the tail to `frameCount`. Round 1's fit kept the
decode's first `frameCount` samples instead: playback started ~25 ms late and
an edit → save of a finished segment deleted its last ~25 ms of speech, per
cycle (round-2 Frank P1 / George P2). The tests model the Chromium decoder on
ramp fixtures, never constants, so a fit that keeps the wrong end fails.

### Also in this batch — the Share Book archive is streamed

`exportBookZip` held every chapter's MP3 **and** the finished `zipSync` archive
at once (~2× the archive, ~240 MB on a long book — George on #114, deferred to
#34). It now uses fflate's streaming `Zip`; a stored entry's data chunk _is_ the
MP3 buffer, the chunks go to `File` as parts, and no archive-sized buffer is
allocated in app code. Peak is one chapter's PCM, its MP3, and the archive so
far. The encode itself is off-thread; the archive is not (a residual — fflate's
worker-backed `zip` would move it, and was not needed to remove the 2×).

## What is verified, and what is not

- **Node, `npm test`:** the transcode store (commit/stale/already/empty,
  generation chain, backfill), the export with MP3 clips (decode via codec,
  fit-to-length), the streamed archive (entries, identity of the data chunk).
  Every new T1 guard was **mutation-proven** — the PR body lists the mutations
  and which test died for each.
- **Browser (Chromium, Playwright, this workstation):** see the PR body for
  exactly what was run. **Not a phone.**
- **NOT verified on any device.** The worker round-trip on iOS Safari and
  Android Chrome, `decodeAudioData` of a LAME MP3 on both (and on an iOS context
  left `"interrupted"`), the time a real chapter takes to encode on a low-end
  phone, and the first-launch sweep over a device full of finished segments.
  These are the T2 gate before `staging → main`, alongside the B7 share checks
  already owed.

## Consequences

- #12's storage question is **answered for the finished half** of a device's
  audio. Draft segments are still PCM at ~5.3 MB/min. Open from ADR 0002:
  22 050 Hz for speech, and `navigator.storage.persist()`.
- ADR 0003's obligation 1 (replaceable boundary) is met; obligations 3 and 5
  remain #36.
- The `Finished` checkbox now costs an encode. On a slow phone a long segment's
  transcode may take seconds; it runs in the background and nothing waits on it,
  but battery and heat on the first sweep after upgrade are unmeasured.
- Every reader of a clip now branches on its encoding. `Clip` is a discriminated
  union, so the compiler enumerates them; `danglingReason` and the F3 rule are
  unchanged — an MP3 clip resolves exactly as a PCM one does.
