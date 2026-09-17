import { useCallback, useRef, useState } from "react";

import { clearSegmentTake } from "@/lib/storage/books";
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
 * promise a tap handler drops — and `onErased` fires only on success, so a
 * caller reloads or closes only when the row has actually changed.
 */
export async function performErase(
  segmentId: SegmentId,
  onErased?: () => void
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Only the STORE op is fallible-and-reportable. Once `clearSegmentTake`
  // commits, the audio is irreversibly gone, so the result is success no matter
  // what the notification does — a throwing `onErased` (a reload that failed,
  // say) must NOT report "could not erase" and invite a retry against a segment
  // that is already cleared (Frank R-B6). So `onErased` runs outside this guard.
  try {
    await clearSegmentTake(segmentId);
  } catch (cause) {
    console.error("Erasing a segment failed", cause);
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
  // The delete has committed. A notification failure is logged, never folded
  // back into the erase result.
  try {
    onErased?.();
  } catch (cause) {
    console.error("Post-erase notification failed", cause);
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
  /** The live guard, for a caller that must read the CURRENT moment rather
   *  than last render's `erasing` (George round 2 P3-4, #393): system Back now
   *  calls `SegmentsScreen.dismissOverlay` → `closeErase` directly, bypassing
   *  `EraseConfirm`'s own Cancel/Escape path — the same reason
   *  `EraseConfirm` itself reads `inFlightRef` rather than `busy` for Escape. */
  isErasing: () => boolean;
  /** The reason the last erase failed, or null. Set on failure, cleared when the next erase starts. */
  error: string | null;
}

/**
 * Both Erase entry points (#32, D-TWO-ENTRIES) — the recorder menu and the
 * Segments-row overflow menu — call this hook, so the erase is one
 * implementation behind one confirm.
 */
export function useEraseSegment(
  options: { onErased?: () => void } = {}
): UseEraseSegment {
  const { onErased } = options;
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
  // A stable identity, matching `erase` (also `useCallback`) — an inline
  // arrow at the return site below would give a caller's `useImperativeHandle`
  // deps a new function every render for no reason.
  const isErasing = useCallback(() => erasingRef.current, []);

  const erase = useCallback(
    async (segmentId: SegmentId): Promise<EraseResult> => {
      // Refused, not failed: the first tap owns the outcome (see EraseResult).
      if (erasingRef.current) return "busy";
      erasingRef.current = true;
      setErasing(true);
      setError(null);
      try {
        const result = await performErase(segmentId, onErased);
        if (!result.ok) setError(result.error);
        return result.ok ? "ok" : "failed";
      } finally {
        // Releases the guard rather than dropping state, so it is safe in
        // `finally`; a guard left set would lock out every later erase.
        erasingRef.current = false;
        setErasing(false);
      }
    },
    [onErased]
  );

  return { erase, erasing, isErasing, error };
}
