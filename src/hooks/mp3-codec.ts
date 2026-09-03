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
 * durable `error` listener and rebuilt on the next encode. Decoding is
 * `decodeAudioData` behind `hooks/audio-io.ts`, the single Web Audio boundary.
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

/** The one message the worker answers with. */
export type EncodeResponse =
  | { readonly kind: "done"; readonly mp3: ArrayBuffer }
  | { readonly kind: "error"; readonly message: string };

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
 * re-warms a fresh one, so a cancelled share does not end the #182 protection
 * (round-1 R2). The URL is re-fetched only on a drop-and-rebuild, never on the
 * common reuse path.
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
    // Detach THIS job's handlers on settle, leaving the worker warm for reuse.
    // Dropping a dead worker is the durable `error` listener's job (see
    // `encoderWorker`); an abort drops and re-warms it (below).
    const release = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
    };
    const onAbort = () => {
      // Stop the in-flight encode NOW — only terminate can — then re-warm, so a
      // cancelled share does not leave the next encode depending on a chunk URL a
      // service-worker update may have purged (R2).
      release();
      dropEncoderWorker();
      warmEncoder();
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      release();
      const response = event.data;
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
