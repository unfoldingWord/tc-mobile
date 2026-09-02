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
 * The protocol is one request, one response, then the worker is discarded —
 * no queue, no reuse, no progress stream (nothing consumes one yet; when the
 * share panel grows a real meter, add it then). The PCM arrives as a transferred
 * `ArrayBuffer` (moved, not copied) and the MP3 goes back the same way, so a
 * chapter's audio is never held twice across the two threads.
 */

import { encodeMp3 } from "@/lib/audio/mp3";
import type { EncodeRequest, EncodeResponse } from "./mp3-codec";

addEventListener("message", (event: MessageEvent<EncodeRequest>) => {
  const { buffer, byteOffset, length } = event.data;
  let response: EncodeResponse;
  let transfer: Transferable[] = [];
  try {
    const mp3 = encodeMp3(new Int16Array(buffer, byteOffset, length));
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
