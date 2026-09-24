import { useCallback, useRef, useState } from "react";

import { errorMessage } from "@/lib/failure-text";
import { clearSegmentTake } from "@/lib/storage/takes";
import { reportFailure } from "./report-failure";
import type { SegmentId } from "@/types/domain";

/**
 * Erase a segment's audio — the one implementation both entry points share.
 *
 * D-TWO-ENTRIES: the recorder menu and the Segments-row overflow menu both call
 * this hook, so "erase" is written once. D-ERASE-OP: the whole operation is
 * `clearSegmentTake`, which already deletes the take and its clip atomically,
 * reference-counts the clip, and returns the segment to "not-started" with
 * `activeTakeId` null (G4: the audio goes, the row stays). This hook adds no
 * store logic; it wraps that op with the small amount of state the two menus
 * need — a double-tap guard and a caught, surfaced error — and stays
 * presentation-free. The confirm dialog and the copy live in `components/`.
 */

/**
 * The actual erase, minus React.
 *
 * The work lives here as a plain async function so it is exercised in Node
 * against the real store (the onion's reason for existing): the hook below is a
 * thin state wrapper over it, not a second copy of the logic. A failure is
 * caught and reported as a reason string — never swallowed, never a rejected
 * promise a tap handler drops.
 *
 * It took an `onErased` callback until #160 (L-12) and no caller ever passed
 * one — both screens learn the row changed by their own route, the recorder by
 * closing dirty and the list by acting on the result of its own `erase` call.
 * Four tests kept the parameter looking alive, which is knip's blind spot #1
 * at parameter granularity: a thing only a test reaches still reads as used.
 * It went with them.
 */
export async function performErase(
  segmentId: SegmentId
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await clearSegmentTake(segmentId);
  } catch (cause) {
    // One row per real failure (#456); console.error kept beside it.
    console.error("Erasing a segment failed", cause);
    reportFailure(cause, "erase-segment");
    return {
      ok: false,
      error: errorMessage(cause),
    };
  }
  return { ok: true };
}

/**
 * The outcome of a call to `erase`.
 *
 * `"busy"` is distinct from `"failed"` on purpose: a double-tap's second call is
 * refused by the in-flight guard, and a caller must NOT treat that refusal as a
 * result and dismiss its confirmation — the first call is still running and owns
 * the outcome. Conflating the two let a second tap tear the dialog down mid-erase
 * (Frank + George converged, B6). Callers act on `"ok"`/`"failed"` and ignore
 * `"busy"`.
 */
type EraseResult = "ok" | "failed" | "busy";

export interface UseEraseSegment {
  /** Erase the segment's audio. `"ok"` on success, `"failed"` on a store error,
   *  `"busy"` when another erase is already in flight (ignore it — not a result). */
  erase(segmentId: SegmentId): Promise<EraseResult>;
  /** True while an erase is in flight — the confirm/menu disables its Erase button on this. */
  erasing: boolean;
  /**
   * The same in-flight fact as {@link erasing}, read LIVE (#452 PR4, the
   * design's F4). `erasing` is last render's answer and is what paints the
   * confirm's busy Control; this reads the ref `erase` flips synchronously, and
   * is what the erase confirm's `Layer.busy()` must call — a system Back
   * arrives on a `popstate` with no render in between, so a state value read
   * there can be one render stale and let a Back tear the dialog down over a
   * `clearSegmentTake` that is already committing (invariant 4,
   * `docs/design/back-navigation.md`; `lib/nav/layer-stack.ts`'s `Layer`).
   *
   * Identity-stable (`useCallback([])`), because a `Layer`'s `busy` is
   * captured when the overlay opens and called much later.
   */
  isErasing: () => boolean;
  /** The reason the last erase failed, or null. Set on failure, cleared when the next erase starts. */
  error: string | null;
}

/**
 * Both Erase entry points (#32, D-TWO-ENTRIES) — the recorder menu and the
 * Segments-row overflow menu — call this hook, so the erase is one
 * implementation behind one confirm.
 */
export function useEraseSegment(): UseEraseSegment {
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The live in-flight guard, readable synchronously.
   *
   * `erasing` is last render's value; two taps in one frame both read it false.
   * The ref answers for the current moment, so the second tap is refused before
   * it can fire a second `clearSegmentTake` against a row the first is clearing.
   */
  const erasingRef = useRef(false);
  // The live read of that same ref, for `Layer.busy()` (see `isErasing`'s
  // docblock). Mirrors `useBooks`' `isDeleting` exactly, including the empty
  // dependency array that keeps its identity stable for the life of the hook.
  const isErasing = useCallback(() => erasingRef.current, []);

  const erase = useCallback(
    async (segmentId: SegmentId): Promise<EraseResult> => {
      // Refused, not failed: the first tap owns the outcome (see EraseResult).
      if (erasingRef.current) return "busy";
      erasingRef.current = true;
      setErasing(true);
      setError(null);
      try {
        const result = await performErase(segmentId);
        if (!result.ok) setError(result.error);
        return result.ok ? "ok" : "failed";
      } finally {
        // Releases the guard rather than dropping state, so it is safe in
        // `finally`; a guard left set would lock out every later erase.
        erasingRef.current = false;
        setErasing(false);
      }
    },
    []
  );

  return { erase, erasing, isErasing, error };
}
