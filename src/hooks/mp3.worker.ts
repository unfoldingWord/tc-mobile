/**
 * The MP3 encoder's Web Worker (B8, #34).
 *
 * `encodeMp3` is CPU-bound pure JS: a 15-minute chapter takes seconds, and on
 * the main thread that is seconds of frozen UI — a share the translator cannot
 * dismiss, a Finished tick that locks the list. Here it runs off the main
 * thread, and because a worker can be `terminate()`d it is also ABORTABLE, which
 * a synchronous call never was. `hooks/mp3-codec.ts` owns this worker's
 * lifetime; nothing else posts to it.
 *
 * This is also the encoder's licence boundary (ADR 0003, obligation 1): Vite
 * bundles this file and its lamejs import as their own chunk, so the LGPL
 * encoder sits behind one message interface rather than inside the app bundle.
 *
 * The protocol opens with one `ready`, then per request a throttled stream of
 * `progress` HEARTBEATS and one `done`/`error`. `ready` is posted once, at the
 * foot of this module, and it says the only thing a client cannot otherwise
 * learn without giving the worker work: THIS SCRIPT RAN. `hooks/mp3-codec.ts`
 * builds workers from a blob snapshot of this chunk (#192) and cannot test that
 * blob any other way — a snapshot that will not parse fires `error`, but one
 * truncated on a statement boundary is valid JS with no `message` listener, and
 * that one is silent forever. Waiting for `ready` before handing over a
 * chapter's PCM is what lets the client fall back to the chunk URL with the
 * audio still in its hands. The heartbeat is not a UI meter (nothing consumes a
 * meter yet); it is the client's liveness signal — `hooks/mp3-codec.ts` bounds
 * every encode by how long the worker stays SILENT, and each heartbeat resets
 * that window so a long encode is not judged stalled while a wedged one still is
 * (#166). `hooks/mp3-codec.ts` keeps ONE worker warm and reuses it across
 * encodes, serialised so only one request is ever in flight (#182); this handler
 * holds no state between messages — every value is built inside the callback —
 * which is what makes that reuse safe. The PCM arrives as a transferred
 * `ArrayBuffer` (moved, not copied) and the MP3 goes back the same way, so a
 * chapter's audio is never held twice across the two threads.
 */

import { encodeMp3 } from "@/lib/audio/mp3";
import type { EncodeRequest, EncodeResponse } from "./mp3-codec";

/**
 * Post a progress heartbeat at most this often. `encodeMp3` calls `onProgress`
 * once per 1152-sample frame — thousands of times for a chapter — so throttle it
 * to a steady pulse the client's silence deadline can watch without flooding the
 * message channel. Well under `ENCODER_SILENCE_TIMEOUT_MS`, so a healthy encode
 * always beats the window.
 *
 * Exported so the bound against `ENCODER_SILENCE_TIMEOUT_MS` is a test and not
 * a comment (George round-2 P3-3): the two constants live in different modules,
 * and if the pulse ever drifted up to the window a healthy encode would be
 * judged stalled and killed.
 */
export const PROGRESS_HEARTBEAT_MS = 500;

addEventListener("message", (event: MessageEvent<EncodeRequest>) => {
  const { buffer, byteOffset, length } = event.data;
  let response: EncodeResponse;
  let transfer: Transferable[] = [];
  try {
    let lastHeartbeatAt = 0;
    const mp3 = encodeMp3(new Int16Array(buffer, byteOffset, length), {
      onProgress: (fraction) => {
        const now = Date.now();
        if (now - lastHeartbeatAt < PROGRESS_HEARTBEAT_MS) return;
        lastHeartbeatAt = now;
        // Delivered to the main thread as the encode runs (the busy worker does
        // not block the idle main thread from receiving), which is what keeps the
        // silence deadline fed. Carries no result; the `done` below has the MP3.
        const beat: EncodeResponse = { kind: "progress", fraction };
        postMessage(beat);
      },
    });
    response = { kind: "done", mp3: mp3.buffer };
    transfer = [mp3.buffer];
  } catch (cause) {
    // Surfaced as data, not thrown: an uncaught throw here reaches the client
    // only as an opaque `ErrorEvent`, and the caller needs the reason.
    response = {
      kind: "error",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  // The options form of `postMessage` — the one signature shared by the worker
  // scope and the Window typings this file is compiled under (the DOM lib has
  // no `DedicatedWorkerGlobalScope`), so no cast of `self` is needed.
  postMessage(response, { transfer });
});

// AFTER the listener is registered, never before. The client treats `ready` as
// permission to hand over a chapter's PCM, and a `ready` posted ahead of the
// listener would invite a request this worker is not yet able to answer.
//
// Posted unconditionally rather than only for blob workers: this module cannot
// know which URL it was built from, and a client that does not care simply
// takes it as one more sign of life.
const ready: EncodeResponse = { kind: "ready" };
postMessage(ready);
