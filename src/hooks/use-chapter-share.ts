import { useCallback } from "react";

import {
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
  useShareFlow,
} from "./share-flow";
import { exportChapterMp3 } from "@/lib/export/chapter";
import type { ChapterId } from "@/types/domain";

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
   * Tap 1: encode the chapter to one MP3 and stash the File for the send gesture.
   * Never rejects — a reason surfaces through `error`.
   */
  prepare: (chapterId: ChapterId, filename: string) => Promise<void>;
  /** Tap 2: hand the stashed File to the OS share sheet. See {@link useShareFlow}. */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (menu close, unmount). */
  reset: () => void;
}

/**
 * Share a chapter as one concatenated MP3 to the OS share sheet (B7, A4). A thin
 * wrapper over {@link useShareFlow}: tap 1 builds the chapter MP3 into a File, and
 * the shared flow owns the two-gesture state machine and the `navigator.share`
 * handoff.
 */
export function useChapterShare(): UseChapterShare {
  const { status, error, missing, prepare: run, send, reset } = useShareFlow();

  const prepare = useCallback(
    (chapterId: ChapterId, filename: string): Promise<void> =>
      run(async (isCurrent) => {
        const result = await exportChapterMp3(chapterId, {}, isCurrent);
        // exportChapterMp3 returns null both for an empty chapter and for a run
        // cancelled during the gather (its shouldEncode check). `isCurrent`
        // distinguishes them: still live means genuinely nothing to share.
        if (result === null) return isCurrent() ? "nothing" : null;
        // Copy into a plain ArrayBuffer-backed view: `encodeMp3` returns
        // `Uint8Array<ArrayBufferLike>`, which `BlobPart` rejects because it could
        // (in principle) be SharedArrayBuffer-backed. A fresh copy is the cast-free
        // way to give `File` a buffer it accepts.
        const bytes = new Uint8Array(result.mp3);
        const file = new File([bytes], filename, { type: "audio/mpeg" });
        return { file, missing: result.missing };
      }),
    [run]
  );

  return { status, error, missing, prepare, send, reset };
}
