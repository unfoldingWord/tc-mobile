import { useCallback, useRef, useState } from "react";

import { deleteSegment as deleteSegmentInStore } from "@/lib/storage/books";
import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import type { SegmentId } from "@/types/domain";

/**
 * Delete a segment — the row itself, not only its audio (#590).
 *
 * The recorder ≡ menu is the one entry point today (the Segments-row overflow
 * menu's own delete, #997, is a different, narrower action — "Remove this
 * segment" on a never-recorded row only, deferred by the DRI past the training
 * build — so this hook is not shared the way `useEraseSegment` is). Built the
 * same shape anyway: the store call — `lib/storage/books.ts`'s `deleteSegment`,
 * one atomic transaction that removes the row, its take/clip and renumbers the
 * rest (#590) — lives in a plain async function so it is exercised in Node
 * against the real store, and the hook is a thin React wrapper over it holding
 * only the one piece of state a caller needs: an in-flight guard, readable both
 * for render (`deleting`) and synchronously (`isDeleting()`) for the same
 * reason `useEraseSegment`'s `isErasing()` exists — a system Back arrives on a
 * `popstate` with no render in between, so a state value read there can be one
 * render stale and let a Back tear the confirm down over a delete that is
 * already committing (`docs/design/back-navigation.md`, invariant 4).
 *
 * No cross-screen sharing is needed while there is one caller, so unlike
 * `useEraseSegment` this is not mounted once in `App` — `recorder.tsx` calls it
 * directly. If a second entry point ever calls into the SAME action (not #997's
 * narrower one), lift it the way #160 L-12 lifted erase, for the same reason.
 */

/**
 * The actual delete, minus React. Never rejects — a failure is caught,
 * reported to the funnel under `"segment-delete"` (the same context
 * `hooks/use-chapter-segments.ts`'s optimistic list delete already reports
 * under; both are this one store operation, from two different presentation
 * layers), and returned as a `strings`-mapped KEY (#172), never the raw store
 * message.
 */
export async function performDeleteSegment(
  segmentId: SegmentId
): Promise<{ ok: true } | { ok: false; key: FailureKey }> {
  try {
    await deleteSegmentInStore(segmentId);
  } catch (cause) {
    // One row per real failure (#456); console.error kept beside it.
    console.error("Deleting a segment failed", cause);
    reportFailure(cause, "segment-delete");
    return {
      ok: false,
      key: failureKey(cause, "deleteSegmentFailed"),
    };
  }
  return { ok: true };
}

export interface UseDeleteSegment {
  /** Delete the segment's row. `"ok"` on success (idempotent — an
   *  already-gone segment resolves `"ok"` too, `lib/storage/books.ts`'s own
   *  no-op), `{ failed: key }` on a store error. */
  deleteSegment(segmentId: SegmentId): Promise<"ok" | { failed: FailureKey }>;
  /** True while a delete is in flight — the confirm disables its Delete
   *  button on this. */
  deleting: boolean;
  /** The same in-flight fact as {@link deleting}, read LIVE — see this
   *  module's docblock for why a Back handler needs the synchronous read
   *  rather than last render's `deleting`. Identity-stable (`useCallback([])`)
   *  for the same reason `useEraseSegment`'s `isErasing` is. */
  isDeleting: () => boolean;
}

export function useDeleteSegment(): UseDeleteSegment {
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const isDeleting = useCallback(() => deletingRef.current, []);

  const deleteSegment = useCallback(
    async (segmentId: SegmentId): Promise<"ok" | { failed: FailureKey }> => {
      deletingRef.current = true;
      setDeleting(true);
      try {
        const result = await performDeleteSegment(segmentId);
        return result.ok ? "ok" : { failed: result.key };
      } finally {
        // Releases the guard in `finally`, mirroring `useEraseSegment`: a
        // guard left set would lock out every later delete.
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    []
  );

  return { deleteSegment, deleting, isDeleting };
}
