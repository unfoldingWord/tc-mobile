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
import type { AudioCodec } from "@/types/audio";

/** The one message the client posts: a view onto canonical PCM, transferred. */
export interface EncodeRequest {
  readonly buffer: ArrayBuffer;
  readonly byteOffset: number;
  readonly length: number;
}

/**
 * The messages the worker sends back. `progress` is a liveness HEARTBEAT (#166),
 * throttled by the worker (`mp3.worker.ts`): it carries no result and the encode
 * keeps waiting, but each one tells the client the worker is still alive so a
 * long encode is not judged stalled. `done`/`error` settle the encode.
 */
export type EncodeResponse =
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
 * Is the page currently hidden (locked, backgrounded)? Guarded so the encoder
 * also runs under Node tests and inside a Worker, where `document` is absent.
 * DOM, which is why the deadline lives in `hooks/` and never in `lib/`.
 */
function pageHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/**
 * Call `onResume` whenever the page becomes visible again. Returns an
 * unsubscribe. A no-op where `document` is absent (Node, Worker).
 */
function subscribeResume(onResume: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (!document.hidden) onResume();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
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
 * drop-and-rebuild — after an abort, or a crash — DOES re-fetch the hashed URL,
 * so it restores the warm worker only while that chunk is still fetchable; a
 * rebuild after a service-worker update has purged the chunk fails to the
 * durable listener and surfaces on the next encode. Closing that post-purge
 * window fully needs the worker snapshotted to a purge-immune source (#192).
 */
let sharedWorker: Worker | null = null;

function encoderWorker(): Worker {
  if (!sharedWorker) {
    // Vite resolves this to the worker's own chunk (lamejs inside it) and the
    // PWA precache picks that chunk up with the rest of `dist/assets`.
    const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), {
      type: "module",
    });
    // Durable, for the worker's whole life: a load failure or a between-encodes
    // crash arrives here even when no per-job `onerror` is attached, so the dead
    // handle is dropped instead of reused (R1). `addEventListener` survives a
    // job's `onerror =` assignment; the guard stops an old worker's late error
    // from dropping a newer one.
    worker.addEventListener("error", () => {
      if (sharedWorker === worker) dropEncoderWorker();
    });
    sharedWorker = worker;
  }
  return sharedWorker;
}

/** Terminate and forget the shared worker; the next encode recreates it. */
function dropEncoderWorker(): void {
  sharedWorker?.terminate();
  sharedWorker = null;
}

/**
 * Terminate a wedged/aborted worker and re-establish a warm one — the recovery an
 * abort and a stall SHARE (`encodeInWorker`). `terminate()` is the only thing
 * that stops an in-flight encode NOW, and re-warming restores the reusable handle
 * so the next encode does not depend on a chunk URL a service-worker update may
 * have purged (R2). A stalled worker is recovered exactly as an abort is (#166).
 */
function recoverEncoderWorker(): void {
  dropEncoderWorker();
  warmEncoder();
}

/**
 * Warm the encoder worker so a later encode does not depend on a chunk URL a
 * service-worker update may have purged (#182).
 *
 * Best-effort: a no-op where `Worker` is absent, and a rare synchronous
 * construction throw is swallowed here. An asynchronous load failure is NOT
 * swallowed silently — it fires the durable `error` listener, which drops the
 * handle so the next encode rebuilds and reports the failure through its own
 * `onerror`. Call it once from the app shell at startup, while the running
 * build's precache still holds the worker chunk; it is also called after an
 * abort to re-establish the warm worker.
 */
export function warmEncoder(): void {
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
 * cannot start (e.g. its chunk is not in the offline cache), and with a plain
 * error where `Worker` does not exist at all (see the header: no inline fallback,
 * on purpose).
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
 */
function encodeInWorker(
  samples: Int16Array,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    if (typeof Worker === "undefined") {
      reject(
        new Error("This browser cannot encode MP3: no Web Worker support")
      );
      return;
    }
    let worker: Worker;
    try {
      worker = encoderWorker();
    } catch (cause) {
      // `new Worker` rarely throws synchronously (a SecurityError, say). An async
      // load failure is NOT this path — it arrives as an `error` event, handled
      // by the durable listener (which drops the handle) and this job's `onerror`
      // below (which rejects it).
      dropEncoderWorker();
      reject(cause);
      return;
    }

    // The silence heartbeat (#166). `lastMessageAt` is the last sign of life from
    // the worker; the timer measures how long it has been quiet, NOT how long the
    // encode has run — so a page freeze, which stops the worker too, cannot make
    // a suspended encode look stalled.
    let lastMessageAt = Date.now();
    let stallTimer: ReturnType<typeof setTimeout>;
    const armStall = (ms: number) => {
      stallTimer = setTimeout(onStall, ms);
    };
    // A resumed page gets a FRESH window before it can be judged: the freeze that
    // silenced the worker was not a stall. (visibilitychange is DOM — hooks/.)
    const stopResume = subscribeResume(() => {
      lastMessageAt = Date.now();
    });

    // Detach THIS job's handlers and stop its heartbeat on settle, leaving the
    // worker warm for reuse. Dropping a dead worker is the durable `error`
    // listener's job (see `encoderWorker`); an abort and a stall drop + re-warm.
    const release = () => {
      clearTimeout(stallTimer);
      stopResume();
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
      teardownAndRecover();
      reject(abortReason(signal!));
    };
    function onStall(): void {
      // A hidden page cannot be judged — its worker is frozen too — so never trip
      // while hidden; re-arm and wait for the resume (which resets the window).
      if (pageHidden()) {
        armStall(ENCODER_SILENCE_TIMEOUT_MS);
        return;
      }
      // Late but not yet silent enough (a heartbeat landed, or the page just
      // resumed): re-arm for the remainder rather than trip.
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
      try {
        teardownAndRecover();
      } catch (recoverError) {
        console.error(
          "Recovering the encoder after a stall failed",
          recoverError
        );
      }
      reject(new EncoderStalledError(ENCODER_SILENCE_TIMEOUT_MS));
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      const response = event.data;
      // A progress heartbeat is a sign of life, not a result: reset the silence
      // window and keep waiting for done/error.
      if (response.kind === "progress") {
        lastMessageAt = Date.now();
        return;
      }
      release();
      if (response.kind === "done") resolve(new Uint8Array(response.mp3));
      else reject(new Error(`MP3 encoding failed: ${response.message}`));
    };
    worker.onerror = (event) => {
      // Reject this in-flight job; the durable listener drops the dead worker.
      release();
      // `ErrorEvent.error` is the thrown value when the script threw; a script
      // that failed to load has only a message (often empty), so say so.
      reject(
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "The MP3 encoder worker failed to start")
      );
    };

    armStall(ENCODER_SILENCE_TIMEOUT_MS);

    const request: EncodeRequest = {
      buffer: samples.buffer as ArrayBuffer,
      byteOffset: samples.byteOffset,
      length: samples.length,
    };
    worker.postMessage(request, [request.buffer]);
  });
}

function abortReason(signal: AbortSignal): unknown {
  return (
    (signal.reason as unknown) ??
    new DOMException("MP3 encoding was cancelled", "AbortError")
  );
}
