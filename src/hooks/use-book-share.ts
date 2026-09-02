import { useCallback } from "react";

import { withEncoder } from "./mp3-codec";
import {
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
  useShareFlow,
} from "./share-flow";
import { exportBookZip } from "@/lib/export/book";
import type { BookId } from "@/types/domain";

export interface UseBookShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /**
   * Chapters with no resolvable audio, left out of the zip prepared by tap 1.
   * Zero until a prepare succeeds. Surfaced so a book with empty chapters does
   * not export "as if whole" without saying so.
   */
  readonly missing: number;
  /**
   * Tap 1: encode the book's chapters and archive them into one zip, stashing the
   * File for the send gesture. `zipFilename` names the archive; `nameChapter`
   * names each MP3 inside it (both are translator-facing copy from the screen).
   * Never rejects — a reason surfaces through `error`.
   */
  prepare: (
    bookId: BookId,
    zipFilename: string,
    nameChapter: (chapterNumber: number) => string
  ) => Promise<void>;
  /** Tap 2: hand the stashed File to the OS share sheet. See {@link useShareFlow}. */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (menu close, unmount). */
  reset: () => void;
}

/**
 * Share a book as one zip of per-chapter MP3s to the OS share sheet (B7, A4). A
 * thin wrapper over {@link useShareFlow}: tap 1 builds the zip into a File, and
 * the shared flow owns the two-gesture state machine and the `navigator.share`
 * handoff. The whole build holds the app's single encoder lane (`withEncoder`,
 * B8) so its chapter-at-a-time peak is never joined by a Finished transcode's
 * PCM; each chapter encodes in the worker and the flow's abort signal reaches it.
 */
export function useBookShare(): UseBookShare {
  const { status, error, missing, prepare: run, send, reset } = useShareFlow();

  const prepare = useCallback(
    (
      bookId: BookId,
      zipFilename: string,
      nameChapter: (chapterNumber: number) => string
    ): Promise<void> =>
      run((isCurrent, signal) =>
        withEncoder(signal, async (codec) => {
          const result = await exportBookZip(
            bookId,
            nameChapter,
            codec,
            isCurrent
          );
          // exportBookZip returns null for a book with no audio AND for a run
          // cancelled during the gather. `isCurrent` distinguishes them: still live
          // means genuinely nothing to share.
          if (result === null) return isCurrent() ? "nothing" : null;
          // The archive arrives as fflate's stream chunks and goes to `File` as
          // parts — the browser assembles the Blob, so no archive-sized buffer is
          // ever allocated here (B8; the ~2x peak George flagged on #114). The
          // spread copies the list of references, not the bytes.
          const file = new File([...result.chunks], zipFilename, {
            type: "application/zip",
          });
          return { file, missing: result.missing };
        })
      ),
    [run]
  );

  return { status, error, missing, prepare, send, reset };
}
