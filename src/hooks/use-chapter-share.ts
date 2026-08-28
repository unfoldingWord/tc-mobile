import { useCallback, useEffect, useRef, useState } from "react";

import { exportChapterMp3 } from "@/lib/export/chapter";
import type { ChapterId } from "@/types/domain";

/**
 * Why a share did not proceed. A CODE, not a message — the screen maps it to a
 * translator-facing string, so this browser-boundary hook stays free of UI copy.
 * `nothing`: the chapter has no recorded audio to share. `failed`: encoding, the
 * share sheet, or an unsupported browser.
 */
type ShareError = "nothing" | "failed";

/**
 * The two-gesture share flow.
 *
 * `idle`: nothing prepared. `preparing`: tap 1's encode is in flight (busy).
 * `ready`: a File is stashed and the send gesture (tap 2) is armed.
 *
 * Two gestures are not a nicety — they are the platform contract. iOS grants a
 * tap a short user-activation window and revokes it the moment the call stack
 * awaits. Encoding a chapter walks IndexedDB and runs a synchronous MP3 encode,
 * far past that window, so a `navigator.share` after the encode is refused with
 * `NotAllowedError` and the sheet never opens. The same rule
 * `use-audio-session.ts` already obeys for `resumeAudioContext`. So tap 1
 * encodes and stashes the File, and tap 2 — a fresh activation — hands it to the
 * sheet with no await before the call.
 */
type ShareStatus = "idle" | "preparing" | "ready";

/** What a send gesture resolved to, so the caller can react (e.g. close a menu). */
export type ShareOutcome = "sent" | "dismissed" | "retry" | "failed";

/**
 * How to treat a `navigator.share` rejection.
 *
 * `dismissed`: the user closed the sheet (`AbortError`) — expected, not a
 * failure to alarm a translator with. `retry`: the platform refused the
 * activation (`NotAllowedError`) — the prepared File still stands, so a fresh
 * tap can hand it over; surfacing this as "failed" would send the translator
 * back to re-encode a chapter that is already sitting ready. `failed`: anything
 * else is a real error.
 */
export function classifyShareError(cause: unknown): ShareOutcome {
  if (cause instanceof DOMException) {
    if (cause.name === "AbortError") return "dismissed";
    if (cause.name === "NotAllowedError") return "retry";
  }
  return "failed";
}

export interface UseChapterShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /**
   * Segments with no resolvable audio, left out of the file prepared by tap 1.
   * Zero until a prepare succeeds. Surfaced so a chapter with gaps does not
   * export "as if whole" without saying so.
   */
  readonly missing: number;
  /**
   * Tap 1: encode the chapter to one MP3 and stash the File for the send
   * gesture. Never rejects — a reason surfaces through `error`.
   */
  prepare: (chapterId: ChapterId, filename: string) => Promise<void>;
  /**
   * Tap 2: hand the stashed File to the OS share sheet. MUST be called straight
   * from a user gesture: it calls `navigator.share` with no await before it, so
   * the activation the platform requires is still live. The caller must not
   * await anything before `send()` inside the same gesture. Resolves to the
   * outcome once the sheet settles.
   */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (menu close, unmount). */
  reset: () => void;
}

/**
 * Share a chapter as one concatenated MP3 to the OS share sheet (B7, A4), as a
 * two-gesture flow — see {@link ShareStatus} for why one gesture cannot work.
 *
 * The encode runs on the main thread for now — B8 (#34) moves `encodeMp3` to a
 * Web Worker, at which point `preparing` can carry a real progress bar. Until
 * then a long chapter briefly janks during `preparing`; it is a busy state, not
 * a meter, because a synchronous encode cannot repaint mid-loop.
 */
export function useChapterShare(): UseChapterShare {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [error, setError] = useState<ShareError | null>(null);
  const [missing, setMissing] = useState(0);
  // The File prepared by tap 1, waiting for the send gesture. A ref, not state,
  // so `send` reads it synchronously inside the gesture — before any render —
  // and the `navigator.share` call keeps the activation the tap granted.
  const fileRef = useRef<File | null>(null);
  // Set on unmount so a prepare that resolves after the screen is gone (Back
  // mid-encode) does not `setState` or reach a share sheet on a dead screen.
  const cancelledRef = useRef(false);
  // Re-entry guard for tap 1: a second tap before the first render commits must
  // not start a second encode.
  const preparingRef = useRef(false);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    []
  );

  const prepare = useCallback(
    async (chapterId: ChapterId, filename: string): Promise<void> => {
      // Already encoding, or a File is already armed: ignore. (The screen hides
      // the prepare control while `ready`, so this is a re-entry backstop.)
      if (preparingRef.current || fileRef.current !== null) return;
      preparingRef.current = true;
      setError(null);
      setMissing(0);
      setStatus("preparing");
      // Yield once so `preparing` paints before the synchronous encode blocks
      // the main thread (the gather awaits also yield, but a tiny chapter can
      // return before the browser paints).
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        const result = await exportChapterMp3(chapterId);
        if (cancelledRef.current) return;
        if (!result) {
          setError("nothing");
          setStatus("idle");
          return;
        }
        // Copy into a plain ArrayBuffer-backed view: `encodeMp3` returns
        // `Uint8Array<ArrayBufferLike>`, which `BlobPart` rejects because it
        // could (in principle) be SharedArrayBuffer-backed. A fresh copy is the
        // cast-free way to give `File` a buffer it accepts.
        const bytes = new Uint8Array(result.mp3);
        const file = new File([bytes], filename, { type: "audio/mpeg" });
        const canShareFiles =
          typeof navigator.share === "function" &&
          (typeof navigator.canShare !== "function" ||
            navigator.canShare({ files: [file] }));
        if (!canShareFiles) {
          setError("failed");
          setStatus("idle");
          return;
        }
        fileRef.current = file;
        setMissing(result.missing);
        setStatus("ready");
      } catch (cause) {
        if (cancelledRef.current) return;
        console.error("Preparing the chapter to share failed", cause);
        setError("failed");
        setStatus("idle");
      } finally {
        preparingRef.current = false;
      }
    },
    []
  );

  const send = useCallback(async (): Promise<ShareOutcome> => {
    const file = fileRef.current;
    if (file === null) return "failed";
    // `navigator.share` is invoked synchronously here: an async function runs to
    // its first await, and this call IS that boundary, so no work precedes it and
    // the tap's user activation is still valid.
    try {
      await navigator.share({ files: [file], title: file.name });
      // Shared. Drop the File — a later flow re-encodes, since a fresh take may
      // have changed the chapter since this one was prepared.
      fileRef.current = null;
      if (!cancelledRef.current) {
        setStatus("idle");
        setMissing(0);
      }
      return "sent";
    } catch (cause) {
      const outcome = classifyShareError(cause);
      if (outcome === "retry") {
        // Activation was spent — keep the File stashed and stay `ready` so
        // another tap can hand it over. Not a failure the translator should see.
        return "retry";
      }
      // Dismissed or a real failure: the flow is over. Drop the File.
      fileRef.current = null;
      if (outcome === "failed")
        console.error("Sharing the chapter failed", cause);
      if (!cancelledRef.current) {
        setStatus("idle");
        setMissing(0);
        if (outcome === "failed") setError("failed");
      }
      return outcome;
    }
  }, []);

  const reset = useCallback(() => {
    fileRef.current = null;
    preparingRef.current = false;
    setStatus("idle");
    setError(null);
    setMissing(0);
  }, []);

  return { status, error, missing, prepare, send, reset };
}
