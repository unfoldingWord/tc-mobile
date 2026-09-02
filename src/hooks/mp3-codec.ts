/**
 * The browser's `AudioCodec` (B8, #34): MP3 encoding in a Web Worker, MP3
 * decoding through Web Audio.
 *
 * `lib/` takes the codec as a parameter (`AudioCodec`) and never touches either
 * API; this module is where the two are filled in. Encoding spawns one worker per
 * job and terminates it when the job settles, so an abort is a real stop — the
 * encode ends mid-loop and its memory goes with the worker — rather than a
 * result nobody reads. Decoding is `decodeAudioData` behind `hooks/audio-io.ts`,
 * the single Web Audio boundary.
 *
 * Browser-only, by construction: there is no Node path through here. The
 * pure encoder it drives is `lib/audio/mp3.ts`, tested in Node; the export and
 * transcode paths that consume this codec are tested in Node against
 * `tests/support.ts`'s codec. What this file adds — the worker round-trip, the
 * transfer, the abort — is verified in a browser and on device, not here.
 */

import { encodeMp3 } from "@/lib/audio/mp3";
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

/**
 * Encode canonical PCM to MP3 off the main thread.
 *
 * CONSUMES `samples`: its backing `ArrayBuffer` is transferred to the worker and
 * is detached (length 0) on this thread afterwards. That is the point — a
 * chapter's PCM is tens of MB and must not exist twice — so every caller hands
 * over a buffer it is finished with: the export's gathered buffer, the sweep's
 * loaded clip after its peaks are taken. A view onto a larger buffer transfers
 * the whole buffer and the worker encodes only the view's range.
 *
 * `signal` aborts: the worker is terminated and the promise rejects with the
 * signal's reason (an `AbortError` by default). Rejects with the encoder's own
 * error if it throws inside the worker, and with the load error if the worker
 * script itself cannot start (e.g. its chunk is not in the offline cache).
 *
 * Where `Worker` does not exist at all the encode runs inline on this thread —
 * the pre-B8 behaviour, blocking but correct — rather than refusing to share.
 */
export function encodeMp3OffThread(
  samples: Int16Array,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof Worker === "undefined") {
    return signal?.aborted
      ? Promise.reject(abortReason(signal))
      : Promise.resolve(encodeMp3(samples));
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    // Vite resolves this to the worker's own chunk (lamejs inside it) and the
    // PWA precache picks that chunk up with the rest of `dist/assets`.
    const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), {
      type: "module",
    });
    // Every exit path terminates the worker: a settled job has no further use
    // for it, and an aborted one must stop encoding NOW, not at the next check.
    const settle = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      settle();
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      settle();
      const response = event.data;
      if (response.kind === "done") resolve(new Uint8Array(response.mp3));
      else reject(new Error(`MP3 encoding failed: ${response.message}`));
    };
    worker.onerror = (event) => {
      settle();
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

/**
 * The browser's codec, for the export and transcode paths in `lib/`. `signal`
 * aborts any encode in flight through it (a share the translator dismissed, a
 * screen that unmounted); decoding is not abortable and is short.
 */
export function createAudioCodec(signal?: AbortSignal): AudioCodec {
  return {
    encodeMp3: (samples) => encodeMp3OffThread(samples, signal),
    decodeMp3: decodeMp3ToCanonical,
  };
}
