/**
 * The browser's `AudioCodec` (B8, #34): MP3 encoding in a Web Worker, MP3
 * decoding through Web Audio — reached ONLY through `withEncoder`, the app's
 * single encoder lane.
 *
 * `lib/` takes the codec as a parameter (`AudioCodec`) and never touches either
 * API; this module is where the two are filled in. Encoding runs in ONE warm
 * worker, kept alive for reuse (#182) and serialised by `withEncoder`; an abort
 * terminates it — a real stop, the encode ends mid-loop and its memory goes with
 * the worker — then re-warms a fresh one, and a worker that dies is dropped by a
 * durable `error` listener and rebuilt on the next encode. Every encode is also
 * bounded by a SILENCE deadline (#166): the worker posts a throttled progress
 * heartbeat as it encodes, and a worker that goes quiet — no progress, no done,
 * no error — past `ENCODER_SILENCE_TIMEOUT_MS` is judged stalled (killed under
 * memory pressure, a chunk that never loads), then terminated and re-warmed the
 * same way an abort is, so the encode rejects with an `EncoderStalledError` and
 * the lane is released instead of held for the life of the page. It measures
 * silence, NOT elapsed wall-clock, so an iOS lock/background freeze — which
 * suspends page and worker together — cannot false-kill a suspended encode.
 * Decoding is `decodeAudioData` behind `hooks/audio-io.ts`, the single Web Audio
 * boundary.
 *
 * EVERY worker, warm or rebuilt, is constructed from a blob SNAPSHOT of the
 * worker chunk taken at warmup, so no rebuild depends on a URL a service-worker
 * update has purged (#192). That matters precisely because the three recoveries
 * above — abort, stall and crash — all `terminate()` and rebuild, and a rebuild
 * can come hours after the update.
 *
 * AND IT SAYS SO. #166's other half: every encode's outcome moves an
 * {@link EncoderHealth} store this module owns, which the Books shelf draws one
 * line from. It lives here rather than in a caller because this is the one place
 * every encode passes — see the store's own note for the three ways a
 * caller-side count was wrong.
 *
 * ONE lane. A Finished transcode and a Share are each "one chapter or segment
 * of PCM at a time" on their own, but nothing stopped them running together —
 * one segment's PCM in a worker plus a whole chapter's in another (round-1
 * George G1). `withEncoder` serialises every encode-bearing job in the app: the
 * sweep takes the lane before it even loads a clip, a share holds it for its
 * whole build. Peak is one job's audio, whichever job that is.
 *
 * NO inline fallback. An earlier draft fell back to `encodeMp3` on the main
 * thread where `Worker` was absent; that static import kept lamejs in the app
 * bundle AND duplicated it into the worker chunk (round-1 George G2, verified
 * against `dist/`). Every target phone has `Worker`. Where it is missing the
 * encode rejects with a clear error, and lamejs ships in the worker chunk only —
 * which is the boundary ADR 0003 asks for.
 *
 * Browser-only, by construction. The pure encoder is `lib/audio/mp3.ts`, tested
 * in Node; the export and transcode paths that consume this codec are tested in
 * Node against `tests/support.ts`'s codec; the lane's serialisation is tested in
 * Node (`tests/encoder-lane.test.ts`) with work that never reaches a worker.
 * What only a browser verifies: the worker round-trip, the transfer, the abort.
 */

import { decodeMp3ToCanonical } from "./audio-io";
import { reportFailure } from "./report-failure";
// The BUILT worker chunk's URL. `?worker&url` is the only form that yields it
// outside a `new Worker(new URL(...))` literal: a bare
// `new URL("./mp3.worker.ts", import.meta.url)` makes Vite inline the raw `.ts`
// SOURCE as a `data:video/mp2t;base64,…` URI, which is un-runnable (#192,
// observed in `dist/` on PR #187). This is now the module's ONLY reference to
// the worker file, so exactly one chunk is emitted and lamejs is not duplicated
// (round-1 George G2).
import encoderChunkUrl from "./mp3.worker.ts?worker&url";
import type { AudioCodec } from "@/types/audio";

/** The one message the client posts: a view onto canonical PCM, transferred. */
export interface EncodeRequest {
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;
  readonly length: number;
}

/**
 * The messages the worker sends back.
 *
 * `ready` is posted once, when the worker script has run (#192): it settles
 * nothing and belongs to no job, and it is the only evidence that a blob built
 * from the snapshot actually EXECUTES, short of giving it a chapter's PCM.
 * `progress` is a liveness HEARTBEAT (#166), throttled by the worker
 * (`mp3.worker.ts`): it carries no result and the encode keeps waiting, but each
 * one tells the client the worker is still alive so a long encode is not judged
 * stalled. `done`/`error` settle the encode.
 */
export type EncodeResponse =
  | { readonly kind: "ready" }
  | { readonly kind: "progress"; readonly fraction: number }
  | { readonly kind: "done"; readonly mp3: ArrayBuffer }
  | { readonly kind: "error"; readonly message: string };

/**
 * The encoder stopped working: a worker that neither answered nor errored within
 * its deadline, so the lane was released and a fresh worker warmed (#166). A
 * DISTINCT type — killed under memory pressure, or a chunk that never loaded — so
 * a caller can tell a wedged encoder from a one-off encode error and surface "the
 * encoder has stopped working" rather than treat it as a transient failure.
 */
export class EncoderStalledError extends Error {
  constructor(timeoutMs: number) {
    super(
      `The MP3 encoder did not respond within ${timeoutMs} ms; it was restarted`
    );
    this.name = "EncoderStalledError";
  }
}

/**
 * The encoder itself failed an encode, in the ordinary way: the worker reported
 * an error, died, would not start, or does not exist on this browser (#166).
 *
 * Carries PROVENANCE, which is the whole point (Frank R4 P2). A caller that sees
 * a failure while `encoderHealth()` reads `failing` must still be able to tell
 * "the encoder failed again" from "a storage read failed while the encoder
 * happened to be unhealthy" — only the first earns a "restart the app" line.
 * The worker's own words are kept in the message, and the original thrown
 * value, when there was one, in `cause`.
 */
export class EncoderFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EncoderFailedError";
  }
}

/**
 * How long the worker may stay SILENT — no progress heartbeat, no done, no error
 * — before the encode is judged stalled (#166).
 *
 * A heartbeat, not a wall-clock budget: `mp3.worker.ts` posts throttled progress
 * as it encodes and each one resets this window, so a long or a slow-but-
 * progressing encode never trips — only a worker that has stopped answering
 * entirely does (which never returns, so any finite window catches it). Fixed,
 * not proportional to the audio's length: once silence is what's measured, length
 * no longer matters. Generous enough to absorb a slow device's scheduling and the
 * worker's own progress-throttle interval.
 */
export const ENCODER_SILENCE_TIMEOUT_MS = 15_000;

/**
 * How long an UNPROVEN snapshot-built worker may take to say `ready` before the
 * snapshot is judged unusable and the codec falls back to the chunk URL (#192).
 *
 * Nothing else waits on this. It is paid at most once per snapshot — the first
 * encode on a blob-built worker, before any PCM is handed over — and never again
 * once that blob has answered anything, because proof latches on the snapshot.
 * A chunk-built worker never waits at all.
 *
 * Short on purpose, and deliberately NOT `ENCODER_SILENCE_TIMEOUT_MS`. This
 * measures script load and evaluation of a ~170 KB zero-import IIFE from an
 * in-memory blob — no network, no decode, no encode — so seconds are already
 * generous for a slow phone, whereas waiting fifteen of them is exactly the hole
 * in storage relief (#12) that finding P2-4 is about.
 */
export const ENCODER_READY_TIMEOUT_MS = 3_000;

/**
 * Is the page currently hidden (locked, backgrounded)? Guarded so the encoder
 * also runs under Node tests and inside a Worker, where `document` is absent.
 * DOM, which is why the deadline lives in `hooks/` and never in `lib/`.
 */
function pageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/**
 * Call `onChange` on every visibility transition (both directions). Returns an
 * unsubscribe. A no-op where `document` is absent (Node, Worker).
 */
function subscribeVisibility(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * Whether this phone's encoder is working — #166's other half, "surface an
 * encoder that has stopped working".
 *
 * `failing` never means audio was lost. It means the one thing that turns PCM
 * into MP3 is not doing it, so the storage relief D3/#12 exists for has quietly
 * stopped and Share will fail too — invisible from where a translator stands
 * unless something says so.
 */
export type EncoderHealth = "ok" | "failing";

/**
 * How many consecutive ordinary encode failures it takes to say so.
 *
 * Not 1: one encode can fail for reasons that are not the encoder's — a device
 * momentarily out of memory, one malformed buffer — and a screen that reports
 * each one is a screen nobody reads. A STALL does not go through this count at
 * all; see `noteEncoderStalled`.
 *
 * Exported so the tests drive the threshold rather than re-state it.
 */
export const ENCODER_FAILURE_THRESHOLD = 3;

/**
 * The health lives HERE, in the encoder, and not in any caller.
 *
 * The first cut counted failures inside the Finished sweep, and both reviewers
 * took that apart from opposite ends in one round. A stall ends the sweep run
 * (#290), so a wedged worker yields one failure per run and a page gets one
 * launch sweep — three-in-a-row could never accumulate, and the indicator could
 * not reach the exact failure the deadline exists for (George P1). Share is the
 * app's other encode-bearing job, so a stall there moved nothing and a Share
 * that encoded fine never cleared a line the sweep had put up (George P2-3). And
 * a `loadSegmentClip` or `commitTranscode` throw was counted as "this phone
 * cannot encode", which is a false diagnosis with a useless recovery attached
 * (Frank P2 and George P2-4, independently — the round's one convergence).
 *
 * Deciding it at `encodeInWorker`'s own outcomes makes all three structural
 * rather than remembered: every encode in the app is on this lane, nothing that
 * is not an encode can move the state, and no caller has to report anything.
 */
let consecutiveFailures = 0;
let health: EncoderHealth = "ok";
/**
 * A SET, unlike `report-failure.ts`'s single slot: that module has one slot on
 * purpose (a second consumer of the same failures is a second place to keep in
 * sync), whereas this is a plain store any screen may read, and React's
 * `useSyncExternalStore` subscribes and unsubscribes freely — twice over on a
 * StrictMode mount.
 */
const healthListeners = new Set<(health: EncoderHealth) => void>();

/** The encoder's current health. The `getSnapshot` half of the store. */
export function encoderHealth(): EncoderHealth {
  return health;
}

/**
 * Watch the encoder's health. Returns the unsubscribe.
 *
 * Called on CHANGE only, so a screen draws one line for the condition rather
 * than re-announcing it per failed encode — which matters because the `Notice`
 * it drives is announced to a screen reader.
 */
export function subscribeToEncoderHealth(
  listener: (health: EncoderHealth) => void
): () => void {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

function publishHealth(next: EncoderHealth): void {
  if (next === health) return;
  health = next;
  // A copy, so a listener that unsubscribes from inside its own callback does
  // not mutate the set being iterated.
  for (const listener of [...healthListeners]) {
    try {
      listener(next);
    } catch (cause) {
      // Never swallowed: this store's entire purpose is that a silent failure
      // stops being silent.
      reportFailure(cause, "encoder-health");
    }
  }
}

/**
 * An encode produced bytes. The encoder demonstrably works, so the count goes to
 * zero and the condition is over — whoever asked for the encode. A Share that
 * succeeds clears a line the Finished sweep put up, because the claim on screen
 * is about the phone, not about the job (George P2-3).
 */
function noteEncodeSucceeded(): void {
  consecutiveFailures = 0;
  publishHealth("ok");
}

/** One ordinary encode failure: the worker threw, or died. */
function noteEncodeFailed(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= ENCODER_FAILURE_THRESHOLD)
    publishHealth("failing");
}

/**
 * A stall is the CONDITION, not evidence towards it.
 *
 * Fifteen seconds of a worker answering neither a heartbeat, a result nor an
 * error is already the finding the threshold would be accumulating towards, and
 * waiting for two more of them is waiting for runs that do not come: the sweep
 * ends its run on a stall (#290) and a page gets one launch sweep (George P1).
 * The count is taken to the threshold rather than the flag set alone, so a later
 * success has one thing to clear.
 */
function noteEncoderStalled(): void {
  consecutiveFailures = ENCODER_FAILURE_THRESHOLD;
  publishHealth("failing");
}

/** The tail of the lane: resolves when the job currently holding it is done. */
let lane: Promise<void> = Promise.resolve();

/**
 * Run `work` with the codec, on the app's single encoder lane.
 *
 * Waits for whatever job holds the lane, then runs `work` and releases. `signal`
 * aborts the wait (rejecting with the signal's reason) and any encode `work`
 * starts through the codec; a job that never got the lane releases nothing, and
 * a job that did releases only when its own work has settled — so the lane
 * never admits two jobs at once, whatever aborts. Rejections propagate to the
 * caller; the lane itself is unaffected by them.
 */
export async function withEncoder<T>(
  signal: AbortSignal | undefined,
  work: (codec: AudioCodec) => Promise<T>
): Promise<T> {
  const previous = lane;
  let release!: () => void;
  lane = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await untilSettled(previous, signal);
    return await work({
      encodeMp3: (samples) => encodeInWorker(samples, signal),
      decodeMp3: decodeMp3ToCanonical,
    });
  } finally {
    // Release only once the job ahead has finished too: an abort while still
    // WAITING must not hand the lane to the next job while the previous one is
    // mid-encode. When `work` ran, `previous` is already settled and this fires
    // on the next microtask.
    void previous.then(release, release);
  }
}

/** Resolve when `previous` settles; reject early if `signal` aborts first. */
function untilSettled(
  previous: Promise<void>,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void previous.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

/**
 * The one encoder worker, created on first need and kept WARM for reuse.
 *
 * The old design made a worker per encode and terminated it on settle, so every
 * encode re-fetched `mp3.worker-<hash>.js` by URL. With the PWA on `autoUpdate`
 * + `cleanupOutdatedCaches`, a new service worker purges the old hashed chunk out
 * from under the still-open page — so the next Finished transcode or Share failed
 * silently once a second build had shipped (#182). A live worker holds its code
 * for the page's lifetime and never re-fetches, so keeping one warm is the fix:
 * `warmEncoder` constructs it at startup while the running build's precache still
 * holds the chunk, and every encode reuses it.
 *
 * Reuse is safe for exactly two reasons: the worker's message handler is
 * stateless (a fresh `encodeMp3` per message, `mp3.worker.ts`), and `withEncoder`
 * serialises every encode onto one lane — so the shared worker is never handling
 * two jobs, or carrying two `onmessage` handlers, at once.
 *
 * A dead worker must never be left as a reusable handle. `new Worker` never
 * throws on a script-load failure — it reports it asynchronously as an `error`
 * event — and a worker can also die between encodes, while no per-job `onerror`
 * is attached. So `encoderWorker` attaches a DURABLE `error` listener that drops
 * the handle whenever the worker errors, warm or busy; otherwise the next encode
 * would `postMessage` into a worker that never answers and wedge the lane for the
 * life of the page (round-1 R1). An abort must stop the in-flight encode NOW,
 * which only `terminate()` can do, so it drops the worker and immediately
 * re-warms a fresh one (round-1 R2). The common reuse path fetches nothing. A
 * drop-and-rebuild — after an abort, or a crash — used to re-fetch the hashed
 * chunk URL, which is exactly the URL a service-worker update purges. An abort
 * can come hours after the update (the translator opens Share and cancels), so
 * the rebuild could not race the purge, and the encoder was dead for the rest of
 * the page's life (#192). Every worker is now built from `workerScriptUrl()`: a
 * BLOB snapshot of the chunk, taken at warmup while the chunk is still
 * fetchable, which no cache eviction can reach. The direct chunk URL remains the
 * fallback for as long as the snapshot has not been taken, or could not be.
 */
let sharedWorker: Worker | null = null;

/**
 * Whether the live `sharedWorker` came from the blob snapshot, and whether it
 * has said `ready` yet.
 *
 * BOTH belong to the handle and are cleared when it is dropped. Proof that the
 * blob itself runs does NOT — see `snapshotProven`.
 */
let workerFromSnapshot = false;
let workerReady = false;

/**
 * The blob snapshot of the worker chunk, the one attempt to take it, and
 * whether a worker built from it has ever answered anything.
 *
 * The blob worker has never run on a phone, so it ships with a self-healing
 * guard rather than on faith: a snapshot-built worker that FAILS WITHOUT EVER
 * HAVING ANSWERED is treated as a bad snapshot and thrown away, so the next
 * rebuild falls back to the chunk URL and the encoder degrades to the #182
 * behaviour instead of bricking. Once a worker built from this blob has answered
 * anything, the blob is PROVEN to run on this browser, and a later failure is
 * the device's, not the snapshot's.
 *
 * Proof lives on the SNAPSHOT, not on the handle (George R1 P2-2). It was on the
 * handle first, and `dropEncoderWorker` cleared it — so a proven blob worker
 * that OOMed mid-encode came back unproven, and if the device was still under
 * memory pressure the replacement's failure revoked a blob that had already been
 * observed running. The next construction then went to `encoderChunkUrl`, which
 * on a page that has lived across a deploy is exactly the URL that is gone:
 * #192 re-opened by the guard that exists to close it. The blob either runs on
 * this browser or it does not, and one success settles that for the page.
 *
 * "Fails" is BOTH ways a worker can fail, because #166's silence deadline added
 * a second one after #192's shape was written. An `error` event is the snapshot
 * that will not parse or load — a wrong format, a CSP that forbids blob workers.
 * The other is the snapshot that loads and then answers NOTHING: a truncated
 * fetch ending on a statement boundary is valid JS with no `message` listener,
 * and it errors never and goes silent forever. `ready` is what catches that one,
 * and catches it before a chapter's PCM has been handed over — see
 * `awaitWorkerReady`.
 */
let snapshotUrl: string | null = null;
let snapshotStarted = false;
let snapshotProven = false;

/** The script every worker is built from: the snapshot if we have one. */
function workerScriptUrl(): string {
  return snapshotUrl ?? encoderChunkUrl;
}

/**
 * `new Worker`, with the right module-ness for the URL (George R1 P1).
 *
 * The CHUNK URL keeps `{ type: "module" }`: in dev Vite serves `mp3.worker.ts`
 * as a real ES module with live imports, and only a module worker can run it.
 *
 * The BLOB is classic. The snapshot is production-only and the production chunk
 * is a zero-import IIFE — verified against `dist/`, `(function(){"use strict";…`
 * — so there is nothing for module semantics to do, while declaring `module`
 * asks the platform to parse a blob as an ES module and to honour whatever
 * module-worker restrictions it applies to `blob:`. Classic is the weaker claim
 * and the one that matches the bytes.
 */
function constructWorker(url: string, fromSnapshot: boolean): Worker {
  return fromSnapshot ? new Worker(url) : new Worker(url, { type: "module" });
}

function encoderWorker(): Worker {
  if (!sharedWorker) {
    let fromSnapshot = snapshotUrl !== null;
    let worker: Worker;
    try {
      worker = constructWorker(workerScriptUrl(), fromSnapshot);
    } catch (cause) {
      // A SYNCHRONOUS throw is the platform refusing this URL outright — a CSP
      // with `worker-src 'self'`, a WebView that throws on `blob:` (George R1
      // P2-3). The error-event arm never sees it, so without this the snapshot
      // stayed set and every later construction threw on the same blob while the
      // chunk URL — possibly still cached — was never tried.
      if (!fromSnapshot) throw cause;
      discardWorkerSnapshot();
      fromSnapshot = false;
      worker = constructWorker(encoderChunkUrl, false);
    }
    // Durable, for the worker's whole life: a load failure or a between-encodes
    // crash arrives here even when no per-job `onerror` is attached, so the dead
    // handle is dropped instead of reused (R1). `addEventListener` survives a
    // job's `onerror =` assignment; the guard stops an old worker's late error
    // from dropping a newer one.
    worker.addEventListener("error", () => {
      if (sharedWorker !== worker) return;
      discardUnprovenSnapshot();
      dropEncoderWorker();
    });
    // Also durable, and the ONE place proof is recorded. Any message will do —
    // `ready`, a heartbeat, a result, even the worker reporting an encode error
    // — because all four are this script executing. Keeping it here rather than
    // in the per-job `onmessage` means a `ready` that lands while the worker is
    // idle counts, which is the common case for a warm worker.
    worker.addEventListener("message", () => {
      if (sharedWorker !== worker) return;
      workerReady = true;
      if (workerFromSnapshot) snapshotProven = true;
    });
    sharedWorker = worker;
    workerFromSnapshot = fromSnapshot;
    workerReady = false;
  }
  return sharedWorker;
}

/**
 * Forget and terminate the shared worker; the next encode recreates it.
 *
 * FORGET FIRST (#291, George R3 P3-3). With terminate-then-null, a `terminate()`
 * that threw left the handle in place: the recovery never reached its re-warm,
 * and the next encode posted into a worker that could no longer answer and
 * stalled for another full window. `terminate()` is specified not to throw, so
 * this is defensive — but a throw here is still reported rather than swallowed,
 * and never lets the dead handle survive.
 */
function dropEncoderWorker(): void {
  const worker = sharedWorker;
  sharedWorker = null;
  workerFromSnapshot = false;
  workerReady = false;
  // `snapshotProven` is deliberately NOT cleared: it is a fact about the blob,
  // which outlives every handle built from it (George R1 P2-2).
  try {
    worker?.terminate();
  } catch (cause) {
    reportFailure(cause, "encoder-recover");
  }
}

/**
 * Terminate a wedged/aborted worker and re-establish a warm one — the recovery an
 * abort and a stall SHARE (`encodeInWorker`). `terminate()` is the only thing
 * that stops an in-flight encode NOW, and re-warming restores the reusable handle
 * so the next encode does not depend on a chunk URL a service-worker update may
 * have purged (R2). A stalled worker is recovered exactly as an abort is (#166).
 *
 * It does NOT judge the snapshot. An abort is US killing a healthy worker, and
 * the re-warm is meant to come from the snapshot; the durable `error` listener
 * is the one path that calls `discardUnprovenSnapshot` first.
 */
function recoverEncoderWorker(): void {
  dropEncoderWorker();
  warmEncoder();
}

/**
 * The self-healing half of #192: a snapshot-built worker that failed without the
 * blob ever having answered is a snapshot this browser cannot run, so throw it
 * away.
 *
 * Call it BEFORE `dropEncoderWorker`, which clears `workerFromSnapshot`. A no-op
 * for a chunk-built worker — there is no snapshot to blame — and for a proven
 * blob, where discarding on an ordinary later crash would re-expose #192 after a
 * single OOM.
 */
function discardUnprovenSnapshot(): void {
  if (workerFromSnapshot && !snapshotProven) discardWorkerSnapshot();
}

/** Throw away a snapshot that cannot run, and stop trying to take another. */
function discardWorkerSnapshot(): void {
  if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
  snapshotUrl = null;
  // The only place proof is cleared, because it is the only place the thing it
  // is about stops existing.
  snapshotProven = false;
  // `snapshotStarted` stays true: re-fetching the same chunk would produce the
  // same unusable blob.
}

/**
 * Has the blob snapshot been taken? For the #251 smoke's readiness probe only
 * (George R1 P3-5).
 *
 * The spec must not simulate the purge until the snapshot EXISTS, and it used to
 * wait on a resource-timing entry for the chunk fetch — which fires when the
 * response arrives, one `response.text()` and one `createObjectURL` before
 * `snapshotUrl` is assigned, and which cannot see a non-ok response at all. This
 * is the state itself rather than a proxy for it.
 *
 * Tree-shaken out of a production build: `src/app/e2e-harness.ts` is its only
 * importer and `vite.config.ts` marks that file external for every mode but
 * `"e2e"`.
 */
export function encoderSnapshotTaken(): boolean {
  return snapshotUrl !== null;
}

/**
 * Take the blob snapshot of the worker chunk, once, at warmup (#192).
 *
 * Production only. In dev the chunk is served as an unbundled module with its
 * own imports, so a blob copy of it would resolve nothing — and dev has no
 * service worker purging assets out from under the page, which is the whole
 * problem this solves.
 *
 * Best-effort and asynchronous: the fetch happens in the background while the
 * warm worker (built from the direct URL) is already running, so nothing waits
 * on it. A failure leaves `snapshotUrl` null and the codec on the #182
 * behaviour. The snapshot is kept for the page's lifetime — that is the point —
 * and revoked only when `discardWorkerSnapshot` rejects it.
 */
function captureWorkerSnapshot(): void {
  if (snapshotStarted) return;
  snapshotStarted = true;
  if (!import.meta.env.PROD) return;
  if (
    typeof fetch !== "function" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    return;
  void fetch(encoderChunkUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error(`worker chunk fetch failed: ${response.status}`);
      return response.text();
    })
    .then((source) => {
      snapshotUrl = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" })
      );
    })
    .catch(() => {
      // Best-effort by design: the direct chunk URL stays in use. Nothing is
      // logged — a snapshot that could not be taken is not itself a failure the
      // translator or the sweep can act on, and the encoder still works until an
      // update purges the chunk.
    });
}

/**
 * Warm the encoder worker so a later encode does not depend on a chunk URL a
 * service-worker update may have purged (#182), and snapshot that chunk so a
 * REBUILD does not either (#192).
 *
 * Best-effort: a no-op where `Worker` is absent, and a rare synchronous
 * construction throw is swallowed here. An asynchronous load failure is NOT
 * swallowed silently — it fires the durable `error` listener, which drops the
 * handle so the next encode rebuilds and reports the failure through its own
 * `onerror`. Call it once from the app shell at startup, while the running
 * build's precache still holds the worker chunk; it is also called after an
 * abort to re-establish the warm worker.
 *
 * The snapshot is taken on every call but acts only once, and it is taken even
 * when the construction below throws — a browser that refuses `new Worker` here
 * may still fetch, and the snapshot is what a later attempt will need.
 */
export function warmEncoder(): void {
  captureWorkerSnapshot();
  if (typeof Worker === "undefined") return;
  try {
    encoderWorker();
  } catch {
    // A synchronous construction throw is optional to surface; the first encode
    // reports any real failure.
  }
}

/**
 * Encode canonical PCM to MP3 in the shared worker.
 *
 * CONSUMES `samples`: its backing `ArrayBuffer` is transferred to the worker and
 * is detached (length 0) on this thread afterwards. That is the point — a
 * chapter's PCM is tens of MB and must not exist twice — so every caller hands
 * over a buffer it is finished with: the export's gathered buffer, the sweep's
 * loaded clip after its peaks are taken. A view onto a larger buffer transfers
 * the whole buffer and the worker encodes only the view's range.
 *
 * A successful encode leaves the worker alive for the next one. `signal` aborts:
 * the worker is terminated, dropped and re-warmed, and the promise rejects with
 * the signal's reason (an `AbortError` by default). Rejects with the encoder's own
 * error if it throws inside the worker, with the load error if the worker script
 * cannot start (neither the blob snapshot nor the chunk could be run), and with
 * a plain error where `Worker` does not exist at all (see the header: no inline
 * fallback, on purpose).
 *
 * Every encode is bounded by a SILENCE deadline (#166). The worker posts a
 * throttled progress heartbeat while it encodes; each message — progress, done or
 * error — resets the window. A worker silent past `ENCODER_SILENCE_TIMEOUT_MS`
 * while the page is VISIBLE is judged stalled and torn down through the SAME
 * teardown an abort uses (terminate + re-warm), rejecting with an
 * {@link EncoderStalledError} so the lane is released rather than held for the life
 * of the page. Silence rather than elapsed time is what makes an iOS lock/
 * background freeze safe: the freeze suspends page and worker together, so the
 * timer is not judged while `document.hidden`, and a resume grants a fresh window.
 *
 * An encode on an UNPROVEN blob-built worker waits for its `ready` first, and a
 * blob that does not answer is thrown away and the job re-run on a chunk-built
 * worker — in THIS turn, with the PCM still in hand (George R1 P1). A caller
 * never sees that happen; it costs at most `ENCODER_READY_TIMEOUT_MS`, once per
 * snapshot.
 */
async function encodeInWorker(
  samples: Int16Array,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  if (signal?.aborted) throw abortReason(signal);
  if (typeof Worker === "undefined") {
    // A phone with no `Worker` cannot encode, ever. Counted like any other
    // encode failure rather than special-cased: three attempts and the shelf
    // says the phone cannot make recordings smaller, which is exactly true.
    noteEncodeFailed();
    throw new EncoderFailedError(
      "This browser cannot encode MP3: no Web Worker support"
    );
  }

  let worker = obtainWorker();
  // #192's HANDSHAKE, and the reason a bad snapshot costs nobody an encode.
  //
  // Only an unproven blob waits, so this is at most one wait per page and a
  // chunk-built worker never pays it. What it buys is the ORDER: the blob is
  // judged before `postMessage` transfers a chapter's PCM into it, so a snapshot
  // that turns out not to run is discarded, the worker rebuilt from the chunk
  // URL, and THIS job simply runs there. Before the handshake the first encode
  // on a bad blob was the job that died for it — a failed Share, or a sweep
  // segment recorded as failed — and the fallback only arrived for whoever came
  // next (George R1 P1).
  if (workerFromSnapshot && !snapshotProven && !workerReady) {
    await awaitWorkerReady(worker, signal);
    if (!workerReady) {
      discardUnprovenSnapshot();
      dropEncoderWorker();
      worker = obtainWorker();
    }
  }
  return runEncodeOnWorker(worker, samples, signal);
}

/**
 * The shared worker, or an {@link EncoderFailedError} — the preamble every
 * encode shares.
 *
 * `new Worker` rarely throws synchronously (a SecurityError, say), and
 * `encoderWorker` already retries such a throw once on the chunk URL when the
 * first attempt was the blob's. Reaching the `catch` means BOTH failed. An async
 * load failure is NOT this path — it arrives as an `error` event, handled by the
 * durable listener (which drops the handle) and the job's `onerror` (which
 * rejects it).
 */
function obtainWorker(): Worker {
  try {
    return encoderWorker();
  } catch (cause) {
    dropEncoderWorker();
    noteEncodeFailed();
    throw new EncoderFailedError(
      `The MP3 encoder worker could not be created: ${messageOf(cause)}`,
      { cause }
    );
  }
}

/**
 * Wait until `worker` has answered ANYTHING, errored, or spent
 * `ENCODER_READY_TIMEOUT_MS` (#192). Rejects only on abort.
 *
 * It resolves no value: the caller reads `workerReady`, which the durable
 * message listener owns, so a message that lands in the gap between this
 * resolving and the caller looking is still counted. A worker that errors has
 * already been discarded and dropped by the durable `error` listener before this
 * returns.
 */
function awaitWorkerReady(
  worker: Worker,
  signal: AbortSignal | undefined
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (workerReady) {
      resolve();
      return;
    }
    let done = false;
    // Declared before `timer` and reading it from the closure: every caller is
    // an event or the timer itself, so none can run before the synchronous
    // block below has assigned it.
    const detach = () => {
      done = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onSettle);
      worker.removeEventListener("error", onSettle);
      signal?.removeEventListener("abort", onAbort);
    };
    function onSettle(): void {
      if (done) return;
      detach();
      resolve();
    }
    function onAbort(): void {
      if (done) return;
      detach();
      reject(abortReason(signal!));
    }
    worker.addEventListener("message", onSettle);
    worker.addEventListener("error", onSettle);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(onSettle, ENCODER_READY_TIMEOUT_MS);
  });
}

/** Run one encode on `worker`, with the silence deadline armed (#166). */
function runEncodeOnWorker(
  worker: Worker,
  samples: Int16Array,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    // The silence heartbeat (#166). `lastMessageAt` is the last sign of life from
    // the worker; the timer measures how long it has been quiet, NOT how long the
    // encode has run — so a page freeze, which stops the worker too, cannot make
    // a suspended encode look stalled.
    let lastMessageAt = Date.now();
    // Set the instant the page HIDES — before any freeze can suspend JS — and
    // cleared only when a fresh window is granted (a resume, or a heartbeat). It
    // makes the resume safe against event ORDERING (Frank R2 P2): an overdue timer
    // that runs on restoration BEFORE the `visibilitychange` handler would see
    // `document.hidden` already false and a stale `lastMessageAt`, and wrongly
    // trip. Because this latch was set at hide time, `onStall` grants a fresh
    // window instead of trusting the un-measurable elapsed silence, whichever of
    // the two runs first. SEEDED from the current state: an encode that begins
    // while the page is ALREADY hidden gets no hide transition, so the latch would
    // otherwise stay false and the same resume race would trip it (Frank R2 P2 #2).
    let mightHaveFrozen = pageHidden();
    let stallTimer: ReturnType<typeof setTimeout>;
    /**
     * This job is over — resolved, rejected, aborted or torn down.
     *
     * `clearTimeout` cannot un-queue a callback the platform has ALREADY
     * dispatched, so a stall timer that came due in the same turn as `done`
     * still runs after `release()`. Without this flag it read a stale
     * `lastMessageAt`, judged the finished encode stalled, and tore down the
     * shared worker that the NEXT encode was by then using — losing a whole
     * Share Book, which runs every chapter through one `withEncoder` turn
     * (George R3 P2). Every callback below is a no-op once it is set, and
     * `armStall` refuses to arm, so a settled job owns nothing.
     */
    let settled = false;
    const armStall = (ms: number) => {
      if (settled) return;
      // Clear first: every arm REPLACES the pending window rather than adding
      // a second timer, which is what lets a heartbeat reset the deadline.
      clearTimeout(stallTimer);
      stallTimer = setTimeout(onStall, ms);
    };
    // Both directions: hiding arms the freeze latch (before suspension), showing
    // grants a fresh window. (visibilitychange is DOM — hooks/.)
    const stopVisibility = subscribeVisibility(() => {
      if (pageHidden()) {
        mightHaveFrozen = true;
      } else {
        mightHaveFrozen = false;
        lastMessageAt = Date.now();
      }
    });

    // Detach THIS job's handlers and stop its heartbeat on settle, leaving the
    // worker warm for reuse. Dropping a dead worker is the durable `error`
    // listener's job (see `encoderWorker`); an abort and a stall drop + re-warm.
    const release = () => {
      settled = true;
      clearTimeout(stallTimer);
      stopVisibility();
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
    };
    // An abort and a stall are the SAME recovery: stop the in-flight encode NOW
    // (only terminate can) and re-warm. Only the rejection reason differs.
    const teardownAndRecover = () => {
      release();
      recoverEncoderWorker();
    };
    const onAbort = () => {
      // Already finished: an abort that lands after the result is not this
      // job's to act on, and tearing down here would hit a later job's worker.
      if (settled) return;
      teardownAndRecover();
      reject(abortReason(signal!));
    };
    function onStall(): void {
      // Dispatched before this job settled, running after it. Nothing to judge
      // and, above all, nothing to terminate (George R3 P2).
      if (settled) return;
      // A hidden page cannot be judged — its worker is frozen too — so never trip
      // while hidden; re-arm and wait for the resume (which resets the window).
      if (pageHidden()) {
        armStall(ENCODER_SILENCE_TIMEOUT_MS);
        return;
      }
      // Resumed after a possible freeze: the elapsed silence spans a suspension
      // we cannot measure, so grant a fresh window rather than trust it — even
      // when this overdue timer beat the `visibilitychange` handler to the resume
      // (Frank R2 P2). One fresh window per freeze; a worker still silent after it
      // trips on the next pass.
      if (mightHaveFrozen) {
        mightHaveFrozen = false;
        lastMessageAt = Date.now();
        armStall(ENCODER_SILENCE_TIMEOUT_MS);
        return;
      }
      // Late but not yet silent enough (a heartbeat landed just before): re-arm
      // for the remainder rather than trip.
      const silence = Date.now() - lastMessageAt;
      if (silence < ENCODER_SILENCE_TIMEOUT_MS) {
        armStall(ENCODER_SILENCE_TIMEOUT_MS - silence);
        return;
      }
      // Silent past the window while visible: the worker has stopped. Recover it
      // the same way an abort does, then reject. The recovery is GUARDED so a
      // terminate that itself throws still lets us reject and release the lane —
      // never a hung lane (P3b) — with the failure logged to a channel rather than
      // swallowed.
      // A stall here is ALWAYS a real one — never a bad blob snapshot wearing
      // #166's clothes (George R1 P2-4).
      //
      // That used to need deciding. An unproven blob could be handed a chapter's
      // PCM, go silent, and reject as `EncoderStalledError` fifteen seconds
      // later — which the Finished sweep reads as a wedged worker: it names the
      // clip poison (`finish-transcode.ts`), spends its one drain pass and ends
      // the run, and the health store latches `failing` past the three-strike
      // threshold. A false "this phone cannot make recordings smaller", while
      // the chunk-URL worker was one construction away.
      //
      // `encodeInWorker`'s `ready` handshake removes the case rather than
      // classifying it: a snapshot-built worker reaching this function has
      // already answered, so `snapshotProven` is true here by construction, and
      // an unproven blob never carries a job at all. There is deliberately no
      // branch for it — a branch nothing can reach is a claim nothing can test.
      try {
        teardownAndRecover();
      } catch (recoverError) {
        // To the app's ONE sink, not the console (George R1 P3-5): sweep
        // failures were moved there for #167/#188, and this would otherwise be
        // the last encoder-adjacent failure that never reaches the #205 funnel.
        reportFailure(recoverError, "encoder-recover");
      }
      noteEncoderStalled();
      reject(new EncoderStalledError(ENCODER_SILENCE_TIMEOUT_MS));
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      if (settled) return;
      // Proof that the script runs is NOT recorded here — the durable `message`
      // listener in `encoderWorker` owns it, so a `ready` that lands while the
      // worker is idle counts too.
      const response = event.data;
      // `ready` belongs to the worker, not to this job: it says the script ran
      // and nothing about the encode. Treated exactly like a heartbeat — reset
      // the window and keep waiting — because a `ready` from a worker rebuilt
      // inside this very job can arrive after the handlers below are attached.
      if (response.kind === "ready") {
        lastMessageAt = Date.now();
        if (!pageHidden()) mightHaveFrozen = false;
        armStall(ENCODER_SILENCE_TIMEOUT_MS);
        return;
      }
      // A progress heartbeat is a sign of life, not a result: reset the silence
      // window and keep waiting for done/error. The freeze latch is cleared
      // only while the page is VISIBLE — a beat then means the worker is running
      // now. A beat delivered while HIDDEN (queued just before an iOS freeze;
      // Android keeping the worker briefly alive) says nothing about the
      // suspension that may still follow it, and clearing the latch there would
      // let the overdue timer trip on the resume-order race the latch exists to
      // close (George R1 F1). The hide handler set it; only a visible resume,
      // or `onStall` granting its one fresh window, may drop it.
      if (response.kind === "progress") {
        lastMessageAt = Date.now();
        if (!pageHidden()) mightHaveFrozen = false;
        // RESET the window rather than leave the old timer running. Without
        // this the deadline fired on a fixed ~15 s grid for the whole encode
        // and re-armed for the remainder — the right verdict, but a live timer
        // racing `done` over and over. Re-arming means a progressing encode
        // never reaches `onStall`, so only the final window can race at all.
        armStall(ENCODER_SILENCE_TIMEOUT_MS);
        return;
      }
      release();
      if (response.kind === "done") {
        noteEncodeSucceeded();
        resolve(new Uint8Array(response.mp3));
      } else {
        noteEncodeFailed();
        reject(
          new EncoderFailedError(`MP3 encoding failed: ${response.message}`)
        );
      }
    };
    worker.onerror = (event) => {
      // A worker error after this job settled belongs to whoever owns the
      // worker now; the durable listener drops a dead handle either way.
      if (settled) return;
      // Reject this in-flight job; the durable listener drops the dead worker.
      release();
      // A worker that dies IS the encoder failing — a script that will not load,
      // a crash mid-encode — so it counts like an encode that threw.
      noteEncodeFailed();
      // `ErrorEvent.error` is the thrown value when the script threw; a script
      // that failed to load has only a message (often empty), so say so. Either
      // way the rejection is TYPED as the encoder's, with the original kept as
      // `cause` and its words kept in the message (Frank R4 P2).
      const thrown: unknown = event.error;
      reject(
        new EncoderFailedError(
          thrown instanceof Error
            ? thrown.message
            : event.message || "The MP3 encoder worker failed to start",
          thrown instanceof Error ? { cause: thrown } : undefined
        )
      );
    };

    armStall(ENCODER_SILENCE_TIMEOUT_MS);

    const request: EncodeRequest = {
      buffer: samples.buffer as ArrayBuffer,
      byteOffset: samples.byteOffset,
      length: samples.length,
    };
    try {
      worker.postMessage(request, [request.buffer]);
    } catch (cause) {
      // A synchronous `postMessage` failure (a detached buffer, an
      // InvalidStateError) rejects this promise — but the executor throw would
      // NOT unwind the timer and listeners armed just above. Left armed, the
      // stall timer fires ~15 s later and terminates whatever worker is current
      // by THEN — an unrelated encode's (Frank R2 P2). Release this job first,
      // then reject. The worker itself is left warm: the message failed, not the
      // worker.
      //
      // Deliberately NOT counted against the encoder's health: a detached buffer
      // or an `InvalidStateError` posting the request is this caller handing over
      // something it should not have, and the encoder never saw it.
      release();
      reject(cause);
    }
  });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function abortReason(signal: AbortSignal): unknown {
  return (
    (signal.reason as unknown) ??
    new DOMException("MP3 encoding was cancelled", "AbortError")
  );
}
