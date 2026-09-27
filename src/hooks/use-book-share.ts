import { useCallback } from "react";

import { spoolArchive } from "./archive-spool";
import { withEncoder } from "./mp3-codec";
import {
  type ShareOutcome,
  type ShareSurface,
  useShareFlow,
} from "./share-flow";
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
   * How many distinct included chapters hold {@link partialSegments} (#446) —
   * what lets the gap Notice name a chapter count the sum cannot. Zero until a
   * prepare succeeds.
   */
  readonly partialChapters: number;
  /**
   * Tap 1: encode the book's chapters and archive them into one zip, stashing the
   * File for the send gesture. `zipFilename` names the archive; `nameChapter`
   * names each MP3 inside it (both are translator-facing copy from the screen).
   * Never rejects — a reason surfaces through `error`.
   *
   * See {@link UseShareFlow.prepare} (`share-flow.ts`, #860): on the native
   * route this chains straight into `send()` and resolves to its outcome; on
   * the web route it resolves `null` and leaves the flow at `ready`.
   */
  prepare: (
    bookId: BookId,
    zipFilename: string,
    nameChapter: (chapterNumber: number) => string
  ) => Promise<ShareOutcome | null>;
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
    partialChapters,
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
    ): Promise<ShareOutcome | null> =>
      run((isCurrent, signal, onStep) =>
        withEncoder(signal, async (codec) => {
          // The zip streams into a spool as it is built (#1003): an OPFS file
          // where the browser has one, memory where it does not
          // (`archive-spool.ts`). `onStep`: chapters archived of the book's
          // total (#986).
          const spooled = await spoolArchive(
            (sink) =>
              exportBookZip(
                bookId,
                nameChapter,
                codec,
                sink,
                isCurrent,
                onStep
              ),
            zipFilename,
            "application/zip"
          );
          // exportBookZip returns null for a book with no audio AND for a run
          // cancelled during the gather. `isCurrent` distinguishes them: still live
          // means genuinely nothing to share.
          if (spooled === null) return isCurrent() ? "nothing" : null;
          const { result, file, release } = spooled;
          // `release` goes to the flow with the File: the flow drops the spool
          // once the File is staged, shared, dismissed or abandoned.
          return {
            file,
            release,
            missing: result.missing,
            partial: result.partialSegments,
            partialChapters: result.partialChapters,
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
    partialChapters,
    prepare,
    send,
    reset,
    progress,
    ownsScreen,
    dismissProgress,
  };
}
