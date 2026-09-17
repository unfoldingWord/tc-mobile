# 0009 — Transcode on Finished: MP3 replaces PCM, editing after Finished re-decodes

**Status:** Accepted · **Date:** 2026-09-02 · **Batch:** B8 (#34) · **DRI:** the maintainer · **Amended:** 2026-09-03 (#182) — see [Amendments](#amendments)

Implements decision **D3** (2026-08-23) and builds against the recorded
**Q5** default (the DRI, on #34, 2026-08-23).

**Decided 2026-09-15** — the requirements owner confirmed the default as the
answer: yes, keep allowing an edit after a segment is Finished, as built here
(requirements owner, 2026-09-15, [#243](https://github.com/unfoldingWord/tc-mobile/issues/243)).
Q5 is closed in the register in
[`docs/design/pivot-plan.md`](../design/pivot-plan.md); the generation count
below remains the mechanism it always was, not open evidence-gathering.

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
would be counted as lossy (noted by the DRI in round 1). Nothing reads it yet.
It was built so the Q5 call — disallow, warn, or leave it — could be made later
on evidence from real devices rather than argued in the abstract. **Decided
2026-09-15: leave it** (see above) — nothing reads `generation` to disallow or
warn as of this writing, and that is now the answer, not an open call.

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

## Amendments

### 2026-09-03 (#182) — one warm worker, reused, instead of one per encode

Decision §1 above said `mp3-codec.ts` "spawns one worker per encode … and
**terminates the worker on every exit**." That made every encode re-fetch the
hashed worker chunk by URL, and with the PWA on `autoUpdate` +
`cleanupOutdatedCaches` a service-worker update purges that chunk out from under
the still-open page — so the next Finished transcode or Share failed silently
once a second build had shipped (#182).

**Amended:** `mp3-codec.ts` now keeps **one** worker warm for the page's
lifetime — `warmEncoder()`, called from the app shell (`App.tsx`) at launch
while the running build's precache still holds the chunk — and reuses it for
every encode; a live worker holds its code and never re-fetches. The reuse is
sound only because the two properties §1 already relies on hold: the worker's
message handler is stateless (a fresh `encodeMp3` per message), and
`withEncoder` serialises every encode onto one lane, so the shared worker never
carries two jobs at once. **Abort still stops the in-flight encode now** — only
`terminate()` can — so an abort drops the worker and immediately **re-warms** a
fresh one (round-1 R2). The re-warm rebuilt from the hashed chunk URL, so it
restored the warm worker only while that chunk was still fetchable: a cancel after
a service-worker update had purged the chunk still degraded to the next encode's
failure. That post-purge-abort window is closed by the **#192** amendment below.
A worker that dies
on its own — a script-load failure, which `new Worker` reports asynchronously as
an `error` event, or a crash between encodes — is caught by a **durable `error`
listener** attached at construction that drops the dead handle, so the next
encode rebuilds rather than posting into a worker that never answers and wedging
the lane for the page's life (round-1 R1). So "terminates on every exit" is
superseded by "terminates on abort or a worker error; on abort it re-warms,
otherwise it is kept warm and reused."

**Why #166 matters more, not less.** A warm worker that _hangs_ — answers
neither a message nor an `error` — blocks every later encode until the page is
reloaded, for the life of the page, where one-per-encode contained a hang to the
single job that hung. The durable listener above closes the _dies-loudly_ case
(an `error` fires); a silent hang is only closable by #166's timeout, so this
amendment raises that deadline's priority.

The new lifetime is unit-tested in Node with a stubbed `globalThis.Worker`
(`tests/mp3-codec.test.ts`): reuse across encodes, drop-and-re-warm on abort,
drop-on-error, and the R1 case (a warm worker that errors before the first
encode is not reused as a hung handle). Mutation-proven specifically for the
DURABLE-LISTENER guard: removing `encoderWorker`'s `addEventListener("error")`
kills the idle-death and busy-death cases. The stub dispatches its error to the
durable listener before the per-job `onerror`, matching a real `Worker`'s
listener order (round-2 F1); the interaction of `terminate()` with event
dispatch is spec-derived, not device-verified. Still browser-boundary and
unverified on a device: the purge → cache-miss interaction itself needs a device
with two deployed builds. The "What is verified" section above is otherwise
unchanged by this amendment.

### 2026-09-11 (#192) — every worker is built from a blob snapshot of the chunk

The #182 amendment above left one window open, and named it. A warm worker holds
its code and never re-fetches, but **abort terminates the worker** — only
`terminate()` stops an in-flight encode — and the rebuild that follows went back
to `new Worker(new URL("./mp3.worker.ts", import.meta.url))`, i.e. the hashed
chunk URL a service-worker update purges. The abort can come hours after the
update (the translator opens Share and cancels), so the rebuild cannot race the
purge: the encoder was then dead for the rest of the page's life, and both egress
paths — the Finished sweep's storage relief (#12) and Share — failed silently.

**Amended:** `mp3-codec.ts` takes a **blob snapshot** of the worker chunk at
warmup, while the running build's precache still holds it, and builds **every**
worker from it — warm, post-abort and post-crash alike. A `blob:` URL is backed
by an in-memory copy, so no cache eviction can reach it.

Two mechanics are load-bearing and were verified against `dist/`, not assumed:

1. **The chunk URL must come from `?worker&url`.** A bare
   `new URL("./mp3.worker.ts", import.meta.url)` used anywhere other than inside
   a `new Worker(...)` literal makes Vite inline the raw `.ts` **source** as a
   `data:video/mp2t;base64,…` URI, which is un-runnable. Only `?worker&url`
   yields the built chunk's URL.
2. **It must be the module's only reference to the worker file.** Two forms would
   emit two chunks and duplicate lamejs — the defect round-1 George G2 caught.
   Verified: the build emits exactly one `assets/mp3.worker-<hash>.js`, at the
   same hash as before this change, lamejs appears in that chunk and nowhere
   else, the app bundle references it by real URL (no `data:` inlining), and it
   is still in the Workbox precache manifest — which is what makes the snapshot's
   `fetch` succeed offline.

   The **e2e** build's graph holds both forms — `?worker&url` here and the
   `new URL("../hooks/mp3.worker.ts", import.meta.url)` literal in
   `src/app/e2e-harness.ts`, where a probe needs a worker of its own — and George
   R3 P3-4 asked whether that emits a second chunk. Measured, on
   `npm run build:e2e`: it does not. `dist-e2e/assets/` holds exactly one
   `mp3.worker-CQgI_WP3.js`, at the same hash and byte length as `dist/`'s, and
   `Mp3Encoder` appears in that file and no other. Vite resolves both forms to
   the same module and emits one chunk. Production could not have been affected
   either way — `vite.config.ts` marks the harness external for every mode but
   `"e2e"` — but the rule above is about the emitted graph, so it is worth having
   the number rather than the reasoning.

The blob worker is constructed **classic** — `new Worker(blobUrl)` with no
options. Vite emits the chunk as a zero-import IIFE, so module semantics buy
nothing, while declaring `module` asks the platform to parse a blob as an ES
module and to apply whatever module-worker rules it has for `blob:` (George R1
P1). The direct chunk URL keeps `{ type: "module" }`, which dev's live-import
ESM needs.

**A snapshot that cannot run must not brick the encoder.** Node has no `Worker`
and no real blob worker, and the browsers that matter here — iOS Safari, the
Android WebView — are not the one CI runs. So the path ships with a self-healing
guard rather than on faith. A snapshot-built worker that fails
**without ever having answered a message** is read as a bad snapshot: the
snapshot is revoked and discarded, and the next rebuild falls back to the chunk
URL, so the codec degrades to #182's behaviour instead of losing the encoder
entirely. A worker that has answered at least once has **proven** the blob runs,
so a later crash — an OOM mid-encode — keeps it; discarding there would re-expose
#192 after one ordinary crash. The snapshot is production-only: in dev the chunk
is served as an unbundled module with live imports, so a blob copy would resolve
nothing, and dev has no service worker purging assets out from under the page.

**"Fails" means both ways a worker can fail, not just the error event.** #192's
fix shape was written before the silence deadline (#166, PR #279) existed, and
names only `worker.onerror`. That arm catches the snapshot that will not parse or
load — a wrong format, a CSP that forbids blob workers. It does not catch the
snapshot that **loads and then answers nothing**: a truncated fetch ending on a
statement boundary is valid JS with no `message` listener, which errors never and
goes silent forever.

**`ready` is how that one is caught, and caught EARLY.** `mp3.worker.ts` posts
one `ready` at the foot of its module, after its `message` listener is
registered; an unproven blob-built worker is given no PCM until it has, bounded
by `ENCODER_READY_TIMEOUT_MS` (3 s — this measures script load of an in-memory
blob, not an encode). A handle that does not answer costs this job nothing but
the wait: another worker is built and **the same job runs there**, its PCM never
having left this thread. Which script that worker comes from is the subject of
the timeout rules below, and the answer is "the snapshot again" far more often
than it is "the chunk URL".

The constant rests on a measurement rather than on reasoning about one. The
Chromium smoke times a fresh worker from `new Worker` to `ready` and logs it:
**5.8, 6.2, 7.8, 9.6 and 23.2 ms across five runs, against a 3000 ms window**. That is
one engine on a desktop, the runs spread by a factor of four between themselves
on an idle machine, and a phone may be an order of magnitude slower again —
which is why the window is made _safe_ rather than merely long, below, and why a
window that expires is not treated as a verdict.

The order is the point (George R1 P1). Judging the blob only once it had failed
an encode meant the discovering job was the job that died for it — a failed
Share, or a sweep segment recorded as failed — and the fallback arrived only for
whoever came next. Worse, a mute blob rejected as `EncoderStalledError`, which
the Finished sweep reads as a wedged worker: it names the clip poison, spends its
one drain pass and ends the run, and the health store latches `failing` past the
three-strike threshold — a false "this phone cannot make recordings smaller"
while a working worker was one construction away (George R1 P2-4). With the
handshake that job cannot exist, so `onStall` carries no branch for it.

**That is a narrower claim than "a stall is never blob-shaped"** (George R3 P3).
Proof is about the bytes, not about a handle: once the blob has answered once,
every later construction skips the handshake, so an OOM that drops the handle
under memory pressure can be replaced by one that never answers either — and
`onStall` will read that as a stall, because on the evidence available there it
_is_ one, indistinguishable from the same worker dying mid-encode. The sweep will
treat it accordingly. That is a residual of #166's design rather than something
the snapshot introduced (a chunk-built worker in the same state gets the same
verdict), it is pinned by the "still reports a real stall on a PROVEN blob as a
stall" test, and the comment at `onStall` now says exactly this rather than
claiming the case away.

An **abort** during the handshake deliberately judges nothing: that is the app
stopping the job, not evidence about the blob, and no PCM was transferred, so
there is not even an in-flight encode for `terminate()` to stop.

**Silence is not a verdict, and the timer that measures it is #166's timer**
(George R2 P2). The handshake first shipped with a bare `setTimeout`, in the one
module that contains `onStall` precisely because a bare timeout cannot tell a
dead worker from a frozen one — and the window it guards is worse-placed than it
looks, since `ready` is posted at the FOOT of `mp3.worker.ts`, after the whole
lamejs IIFE has evaluated, and the moment it is most likely open is a launch
sweep encoding on a blob worker that a cancelled Share just re-warmed: exactly
when a translator puts the phone down. It now carries the same three guards as
the silence deadline — never judge while `pageHidden()`, grant one fresh window
after a possible freeze (seeded from the current state, so a handshake that
begins while already hidden is safe), and re-arm for the remainder rather than
trip early.

And one expiry no longer revokes the blob. It used to, for the life of the page,
leaving `snapshotStarted` true so nothing refetched — which on a page that has
lived across a deploy sends every later encode to a purged chunk URL: #192
re-opened by its own guard, the same shape as the proof bug above. An `error`
event and a synchronous `new Worker(blob)` throw still discard, because those
say the platform CANNOT run these bytes; silence only says "not yet". A visible
timeout costs another window and nothing else, and `SNAPSHOT_MUTE_STRIKES` = 2
bounds the cost of being wrong twice.

**And the fallback is another blob, not the chunk URL** (George R3 P2). Round 3's
first cut stepped aside onto `encoderChunkUrl` for the timed-out job while
keeping the snapshot — which reads as conservative and is the opposite. The chunk
URL is not a neutral place to retry: on a page that has lived across a deploy —
the only page a snapshot is _for_ — it is precisely the URL
`cleanupOutdatedCaches` deleted. A blob that is merely slow (lamejs still
evaluating, a WebView throttling a worker without ever setting `document.hidden`)
would put the discovering job on the dead URL with a chapter's PCM already
transferred: `EncoderFailedError`, a Share that must re-gather from IndexedDB,
and — after a second such job hit the strike limit — every later encode on the
purged chunk until the health store latches `failing`. #192, re-opened by its own
guard, in the one environment it exists for.

The only thing that ever sends a construction to the chunk URL is the snapshot
being gone — the strikes, an `error` event, or the synchronous
`new Worker(blob)` throw. Those last two say this platform cannot run these
bytes, which is a claim about the blob and says nothing either way about whether
the chunk is still cached; silence says neither. The "prefer the chunk this once"
argument is gone from `workerScriptUrl` entirely: there is no longer any caller
that wants one.

**And a timeout keeps the handle, rather than rebuilding from the snapshot**
(George R4 P2) — the same lesson as R3, one level down, and the reason round 5
exists. Round 3's fix aimed the fallback at another blob instead of the chunk
URL, which is right about _which script_ and was still wrong about _which
worker_: `dropEncoderWorker` terminates. `SNAPSHOT_MUTE_STRIKES` is written for
the blob that is SLOW rather than mute, and two windows spent on two fresh
handles are two first windows, not a doubled budget — the replacement starts
evaluating ~170 kB of lamejs from zero and is killed at the same mark, so the
throttled WebView the constant names was never actually given more time. Strikes
are about the bytes, and they can only add up on a handle that keeps running. So
a timeout now re-arms `awaitWorkerReady` on the same worker; `error` and the
synchronous throw still drop and rebuild at once; and the strike that reaches the
limit is what discards the snapshot, which is also what lets the rebuild after it
be chunk-built.

The budget a caller should assume is therefore
`SNAPSHOT_MUTE_STRIKES × ENCODER_READY_TIMEOUT_MS` — six seconds — and it is per
**page**, not per call: strikes never reset, so a page that finds a mute blob
pays those windows once across all its encodes, though a single `encodeMp3` may
pay all of them if it is the call that finds it. `finish-transcode.ts`'s sweep
holds the lane with a clip loaded for that wait, and Share Book holds it across
chapters, so the number belongs in the module header those callers read
(George R4 P3-4) and not only here.

**The abort is re-asked, not only listened for** (George R2 P3). An abort that
has already fired is never delivered again, and every settle path below the
handshake listens rather than asks. If `ready` won the race with an abort, the
handshake's own listener was already detached and nothing rejected the job: the
continuation posted a chapter's PCM and held the app's single encoder lane for a
share whose menu was closed. Two checks cover it, and deliberately only two —
`encodeInWorker`'s entry, which is what stops a job the caller abandoned between
taking the lane and reaching `encodeMp3` from constructing a worker at all, and
the first statement of `runEncodeOnWorker`, next to the `postMessage` it
protects. A third, written after the handshake `await`, was removed: nothing but
a synchronous call separates it from the second, so it shadowed it and left
neither one killable by mutation.

A **synchronous** `new Worker(blob)` throw is a verdict too (George R1 P2-3). A
CSP with `worker-src 'self'`, or a WebView that throws on `blob:`, never reaches
the error event, so the snapshot stayed set and every later construction threw on
the same blob while the chunk URL went untried. `encoderWorker` now discards and
retries once on the chunk URL, which also covers `warmEncoder`'s swallowing
catch.

**Proof lives on the snapshot, not on the worker handle** (George R1 P2-2). It
was on the handle first, and dropping the handle cleared it — so a proven blob
worker that OOMed came back unproven, and if the device was still under memory
pressure the replacement's failure revoked a blob that had already been observed
running, sending the next construction to a chunk URL a deploy had deleted: #192
re-opened by its own guard. Proof is recorded by a durable `message` listener on
ANY message — `ready`, a heartbeat, a result, even the worker reporting an encode
error — because all four are the script executing, and cleared only where the
snapshot itself is.

Everything about the snapshot is best-effort. A failed fetch, an absent `fetch`,
`Blob` or `createObjectURL`, and a synchronous `new Worker` throw all leave the
codec on the direct chunk URL. Nothing is logged: a snapshot that could not be
taken is not a condition the translator or the sweep can act on.

Unit-tested in Node (`tests/mp3-codec.test.ts`) by stubbing `fetch`, `Blob` and
the object-URL pair. What those tests pin is the **decision** — which URL each
worker is built from, when the snapshot is taken, and when a snapshot is thrown
away — not that a real blob worker runs the real chunk; that is the Chromium
smoke's job, below. Mutation-proven, each mutation restored afterwards: building
always from the chunk URL kills eighteen tests; skipping the `ready` handshake
kills eight; and dropping the production gate, the once-only fetch guard, the
error arm of the guard, the retry after a synchronous
construction throw, the classic-worker choice, or proof-on-the-snapshot each
kills exactly the tests named for it. Letting an
abort during the handshake discard the snapshot kills the abort test; judging
the handshake while the page is hidden, refusing a fresh window after a freeze,
setting `SNAPSHOT_MUTE_STRIKES` to 1, and never discarding on silence at all
each kill the test named for them. So does each of the three abort re-checks,
separately — `encodeInWorker`'s entry, `awaitWorkerReady`'s, and
`runEncodeOnWorker`'s — which is the reason there are three and not four: a
fourth, written after the handshake `await`, shadowed one of these and made
neither killable. Restoring round 3's step-aside onto the chunk URL on a
handshake timeout kills four, and terminating the handle between two strikes —
round 4's behaviour, two first windows rather than one accumulated budget —
kills five, including the one that encodes through a slow blob while the chunk
URL is gone. The worker's own
`ready` ping has no Node coverage by construction — removing it is caught by the
Chromium spec below, which is where it is proven.

**Verified in a real browser**, which #192 did not expect to be possible — the
issue was written before the headless-Chromium smoke (#251) landed.
`e2e/browser-boundary-smoke.spec.ts` loads the app, waits for the snapshot's own
`fetch` of the chunk to land — asked of the page's resource timeline, so the
whole spec reads one clock — then fails every later request for the hashed chunk
— the purge, simulated the only way a test can — aborts an in-flight encode to
force the rebuild, and encodes.
A real MP3 comes back from a worker built entirely from the blob — a CLASSIC
blob worker, since round 2 — and the rebuild issued no new chunk request. The
gate fails in the other state, which is what makes it a gate (#270): with the
snapshot ignored and the rebuild back on the chunk URL, the rebuild goes to the
network and the spec fails on the request count. Removing the worker's `ready`
ping fails it the same way, which is what proves that half.

**Still not device-verified, and the distinction matters.** What Chromium now
proves is that a blob-built worker runs the real chunk and that a rebuild does
not touch the network. What it does NOT prove is the trigger: the real
`cleanupOutdatedCaches` purge chain still needs a device with **two deployed
builds** to observe, and iOS Safari and Android WebView have run none of this.
Folded into the on-device pass (#245 / #263).

One trap for whoever runs that spec locally: `captureWorkerSnapshot` is gated on
`import.meta.env.PROD`, which Vite derives from `NODE_ENV`. A shell that exports
`NODE_ENV=development` compiles the whole snapshot path out of **every** build,
`--mode e2e` included, and the spec then times out waiting for a fetch that can
never happen. CI sets no `NODE_ENV`, so it does not hit this; the spec's poll now
says so in its failure message.
