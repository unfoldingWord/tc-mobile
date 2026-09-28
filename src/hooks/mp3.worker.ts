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
 * audio still in its hands. The heartbeat's `fraction` also moves Share
 * Chapter's step count through the encode (#996, `withEncodeSteps` in
 * `lib/export/chapter.ts`), but its first job is the client's liveness
 * signal — `hooks/mp3-codec.ts` bounds
 * every encode by how long the worker stays SILENT, and each heartbeat resets
 * that window so a long encode is not judged stalled while a wedged one still is
 * (#166). `hooks/mp3-codec.ts` keeps ONE worker warm and reuses it across
 * encodes, serialised so only one request is ever in flight (#182). A whole
 * encode holds no state between messages — every value is built inside the
 * callback — which is what makes that reuse safe. The one exception is the
 * versioned STREAM protocol (#1003 part b): `stream-open`, `stream-chunk`s,
 * then `stream-finish` or `stream-cancel`, each chunk answered with a
 * `stream-ack` once encoded. Its session is the only state this module keeps
 * between messages; it lives only within one `withEncoder` turn (the client
 * binds a stream to one worker and one lane holder), an `open` replaces any
 * session a cancelled share left behind, and `terminate()` — abort, stall,
 * crash — takes it with the worker. The PCM arrives as a transferred
 * `ArrayBuffer` (moved, not copied) and the MP3 goes back the same way, so a
 * chapter's audio is never held twice across the two threads.
 */

import {
  type Mp3StreamEncoder,
  createMp3StreamEncoder,
  encodeMp3,
} from "@/lib/audio/mp3";
import { errorMessage } from "@/lib/failure-text";
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

/** A progress callback that posts a throttled heartbeat (see above). */
function heartbeat(): (fraction: number) => void {
  let lastHeartbeatAt = 0;
  return (fraction) => {
    const now = Date.now();
    if (now - lastHeartbeatAt < PROGRESS_HEARTBEAT_MS) return;
    lastHeartbeatAt = now;
    // Delivered to the main thread as the encode runs (the busy worker does
    // not block the idle main thread from receiving), which is what keeps the
    // silence deadline fed. Carries no result; the `done` has the MP3.
    const beat: EncodeResponse = { kind: "progress", fraction };
    postMessage(beat);
  };
}

/** The open stream session, if any (#1003 part b). See the header. */
let stream: Mp3StreamEncoder | null = null;

/** What one request is answered with, or `null` for none (`stream-cancel`). */
type Answer = {
  readonly response: EncodeResponse;
  readonly transfer: Transferable[];
} | null;

function answer(request: EncodeRequest): Answer {
  if (!("kind" in request)) {
    const mp3 = encodeMp3(
      new Int16Array(request.buffer, request.byteOffset, request.length),
      { onProgress: heartbeat() }
    );
    return {
      response: { kind: "done", mp3: mp3.buffer },
      transfer: [mp3.buffer],
    };
  }
  if (request.v !== 1)
    throw new Error(
      `Unsupported MP3 stream protocol version: ${String(request.v)}`
    );
  const ack: Answer = { response: { kind: "stream-ack" }, transfer: [] };
  switch (request.kind) {
    case "stream-open":
      stream = createMp3StreamEncoder();
      return ack;
    case "stream-chunk":
      if (!stream) throw new Error("No MP3 stream is open");
      stream.write(
        new Int16Array(request.buffer, request.byteOffset, request.length),
        heartbeat()
      );
      return ack;
    case "stream-finish": {
      if (!stream) throw new Error("No MP3 stream is open");
      const open = stream;
      stream = null;
      const mp3 = open.finish();
      return {
        response: { kind: "done", mp3: mp3.buffer },
        transfer: [mp3.buffer],
      };
    }
    case "stream-cancel":
      stream = null;
      return null;
  }
}

addEventListener("message", (event: MessageEvent<EncodeRequest>) => {
  let reply: Answer;
  try {
    reply = answer(event.data);
  } catch (cause) {
    // A failed stream step ends its session: the encoder's state after a
    // throw is not one a later chunk may build on.
    if ("kind" in event.data) stream = null;
    // Surfaced as data, not thrown: an uncaught throw here reaches the client
    // only as an opaque `ErrorEvent`, and the caller needs the reason.
    reply = {
      response: { kind: "error", message: errorMessage(cause) },
      transfer: [],
    };
  }
  if (reply === null) return;
  // The options form of `postMessage` — the one signature shared by the worker
  // scope and the Window typings this file is compiled under (the DOM lib has
  // no `DedicatedWorkerGlobalScope`), so no cast of `self` is needed.
  postMessage(reply.response, { transfer: reply.transfer });
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
