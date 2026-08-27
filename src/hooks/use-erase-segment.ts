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
  try {
    await clearSegmentTake(segmentId);
    onErased?.();
    return { ok: true };
  } catch (cause) {
    console.error("Erasing a segment failed", cause);
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export interface UseEraseSegment {
  /** Erase the segment's audio. Resolves `true` on success, `false` on failure or while another erase is in flight. */
  erase(segmentId: SegmentId): Promise<boolean>;
  /** True while an erase is in flight — the confirm/menu disables its Erase button on this. */
  erasing: boolean;
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

  const erase = useCallback(
    async (segmentId: SegmentId): Promise<boolean> => {
      if (erasingRef.current) return false;
      erasingRef.current = true;
      setErasing(true);
      setError(null);
      try {
        const result = await performErase(segmentId, onErased);
        if (!result.ok) setError(result.error);
        return result.ok;
      } finally {
        // Releases the guard rather than dropping state, so it is safe in
        // `finally`; a guard left set would lock out every later erase.
        erasingRef.current = false;
        setErasing(false);
      }
    },
    [onErased]
  );

  return { erase, erasing, error };
}
