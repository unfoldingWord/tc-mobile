import { useCallback } from "react";

import { withEncoder } from "./mp3-codec";
import { type ShareSurface, useShareFlow } from "./share-flow";
import { exportBookZip } from "@/lib/export/book";
import type { BookId } from "@/types/domain";

export interface UseBookShare extends ShareSurface {
  /**
   * Segments missing INSIDE chapters that DID make it into the zip — the
   * roll-up of each included chapter's own gap (#116). Zero until a prepare
   * succeeds. Distinct from {@link ShareSurface.missing}, which here counts
   * whole chapters left out entirely; a book can carry both at once, which is
   * why this one is Share Book's alone and not on the shared surface.
   */
  readonly partialSegments: number;
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
}

/**
 * Share a book as one zip of per-chapter MP3s to the OS share sheet (B7, A4). A
 * thin wrapper over {@link useShareFlow}: tap 1 builds the zip into a File, and
 * the shared flow owns the two-gesture state machine and the OS share handoff —
 * `navigator.share` in a browser, Capacitor's Share plugin inside the native
 * shell, where the WebView may expose no Web Share at all (#336, George R6 P3).
 * The whole build holds the app's single encoder lane (`withEncoder`,
 * B8) so its chapter-at-a-time peak is never joined by a Finished transcode's
 * PCM; each chapter encodes in the worker and the flow's abort signal reaches it.
 */
export function useBookShare(): UseBookShare {
  const {
    status,
    error,
    sendUnconfirmed,
    missing,
    partial: partialSegments,
    prepare: run,
    send,
    progress,
    ownsScreen,
    dismissProgress,
    reset,
  } = useShareFlow();

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
          return {
            file,
            missing: result.missing,
            partial: result.partialSegments,
          };
        })
      ),
    [run]
  );

  return {
    status,
    error,
    sendUnconfirmed,
    missing,
    partialSegments,
    prepare,
    send,
    reset,
    progress,
    ownsScreen,
    dismissProgress,
  };
}
