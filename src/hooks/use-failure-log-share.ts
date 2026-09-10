import { useCallback, useEffect, useRef, useState } from "react";

import { formatFailureLog } from "@/lib/failure-text";
import { readFailures } from "@/lib/storage/failures";
import {
  classifyShareError,
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
} from "./share-flow";

export interface UseFailureLogShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /**
   * Tap 1: read the log, render it, and arm the send gesture. Never rejects —
   * a reason surfaces through `error`.
   */
  prepare: () => Promise<void>;
  /** Tap 2: hand the armed payload to the OS share sheet. Must be called
   * straight from a user gesture — `navigator.share` runs with no await
   * before it, so the activation the tap granted is still live. */
  send: () => Promise<ShareOutcome>;
  /** Drop anything armed and return to idle (panel close, unmount). */
  reset: () => void;
}

/**
 * Carry the failure log off the phone (#205).
 *
 * The log is durable, which makes it retrievable by a maintainer holding the
 * phone. That is not the situation the October training is: the phone is in a
 * translator's hand in Nairobi and the maintainer is not in the room. So the
 * log needs the same exit every recording has — the OS share sheet, which on
 * both platforms reaches mail, a messaging app, or a file the facilitator can
 * collect later, with no network of our own and no telemetry.
 *
 * ── Why this does NOT reuse `useShareFlow` (George #5, round 1) ──
 *
 * It did, and that was the bug. `useShareFlow` is a FILE share: it gates on
 * `navigator.canShare({ files: [file] })` and, when that is false, sets
 * `error: "failed"` and never arms tap 2. That gate is right for an MP3 or a
 * zip. For `text/plain` it is a different capability question with a different
 * answer — iOS has historically not accepted every type in a file share — and
 * `canShare` is a standing refusal that no number of retries changes. The
 * failure mode was therefore: the one exit the log has refuses, permanently, on
 * the platform this ships to first. That the MP3 and zip shares pass their gate
 * is not evidence a text file passes its own.
 *
 * So the log gets its own two-gesture flow, which is small because the log is
 * cheap to build, and which **falls back to `navigator.share({ text })`** when a
 * file share is not on offer. Sharing text rather than a file is worse — the
 * recipient gets a message body instead of an attachment — and it is
 * incomparably better than an exit that does not open.
 *
 * The two-gesture split is kept for the reason `share-flow.ts` documents: iOS
 * revokes a tap's activation the moment the call stack awaits, and tap 1 here
 * awaits an IndexedDB open, which on a cold start is arbitrarily slow.
 *
 * `classifyShareError` is reused rather than reimplemented — the
 * `AbortError`-vs-`NotAllowedError`-with-activation reading is subtle and there
 * should be one copy of it.
 */
export function useFailureLogShare(): UseFailureLogShare {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [error, setError] = useState<ShareError | null>(null);
  /**
   * What tap 1 armed. A ref, not state, so `send` reads it synchronously inside
   * the gesture — before any render — and the `navigator.share` call keeps the
   * activation the tap granted.
   *
   * `kind` records which shape the platform accepted at prepare time, so tap 2
   * does no capability work of its own.
   */
  const armed = useRef<
    { kind: "file"; file: File } | { kind: "text"; text: string } | null
  >(null);
  /** Invalidates an in-flight prepare (panel close, unmount). */
  const runId = useRef(0);
  /** Re-entry guard for tap 2: one share in flight at a time. */
  const sending = useRef(false);

  useEffect(
    () => () => {
      runId.current += 1;
    },
    []
  );

  const prepare = useCallback(async (): Promise<void> => {
    if (armed.current !== null) return;
    // Fail before the read, not after: a browser with no Web Share at all
    // cannot share this in any shape, and saying so now is cheaper than saying
    // so after an IndexedDB open.
    if (typeof navigator.share !== "function") {
      setError("failed");
      return;
    }
    const id = (runId.current += 1);
    const current = () => id === runId.current;
    setError(null);
    setStatus("preparing");
    try {
      const entries = await readFailures();
      if (!current()) return;
      // The panel only renders Send while the log is non-empty, so an empty
      // read means it was cleared between the render and the tap.
      if (entries.length === 0) {
        setError("nothing");
        setStatus("idle");
        return;
      }
      const text = formatFailureLog(entries, __APP_VERSION__);
      const file = new File([text], failureLogFilename(), {
        type: "text/plain",
      });
      // Prefer the file — an attachment a facilitator can forward intact. Fall
      // back to text only when the platform will not take this file.
      const canShareFile =
        typeof navigator.canShare !== "function" ||
        navigator.canShare({ files: [file] });
      if (canShareFile) {
        armed.current = { kind: "file", file };
      } else if (
        typeof navigator.canShare !== "function" ||
        navigator.canShare({ text })
      ) {
        armed.current = { kind: "text", text };
      } else {
        // Neither shape is on offer. Nothing a retry can change, so this is a
        // failure the panel should show rather than a button that loops.
        setError("failed");
        setStatus("idle");
        return;
      }
      setStatus("ready");
    } catch (cause) {
      if (!current()) return;
      console.error("Preparing the failure-log share failed", cause);
      setError("failed");
      setStatus("idle");
    }
  }, []);

  const send = useCallback(async (): Promise<ShareOutcome> => {
    // A share is already in flight: leave the payload armed so a double-tap
    // cannot open a second share whose rejection drops the first's.
    if (sending.current) return "retry";
    const payload = armed.current;
    if (payload === null) {
      // Reachable only through a guard hole (ready with nothing armed); surface
      // it rather than no-op behind a button that does nothing.
      setError("failed");
      setStatus("idle");
      return "failed";
    }
    sending.current = true;
    const id = runId.current;
    const current = () => id === runId.current;
    // Read immediately before `share`: whether activation is live decides how a
    // NotAllowedError reads. See `classifyShareError`.
    const hadActivation = navigator.userActivation?.isActive ?? false;
    try {
      // Invoked synchronously — an async function runs to its first await, and
      // this call IS that boundary, so the tap's activation is still valid.
      await navigator.share(
        payload.kind === "file"
          ? { files: [payload.file] }
          : { text: payload.text }
      );
      if (!current()) return "superseded";
      armed.current = null;
      setStatus("idle");
      return "sent";
    } catch (cause) {
      const outcome = classifyShareError(cause, hadActivation);
      // Activation was spent — keep the payload armed and stay `ready` so
      // another tap can hand it over. Not a failure to show anyone.
      if (outcome === "retry") return "retry";
      if (!current()) return "superseded";
      if (outcome === "failed") console.error("Sharing the log failed", cause);
      armed.current = null;
      setStatus("idle");
      if (outcome === "failed") setError("failed");
      return outcome;
    } finally {
      sending.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    armed.current = null;
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, prepare, send, reset };
}

/**
 * The shared file's name.
 *
 * Dated and version-stamped, because a facilitator collecting these from a
 * roomful of phones ends up with a folder of them and "log.txt" nine times over
 * is not a folder anyone can use. Colons are stripped from the ISO timestamp —
 * they are illegal in a filename on Windows, where these will be read.
 */
function failureLogFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `tc-mobile-log-${__APP_VERSION__}-${stamp}.txt`;
}
