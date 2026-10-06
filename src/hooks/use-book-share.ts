import { useCallback, useRef, useState } from "react";

import { spoolArchive } from "./archive-spool";
import { withEncoder } from "./mp3-codec";
import {
  type ShareError,
  type ShareGestures,
  type ShareOutcome,
  type ShareSurface,
  useShareFlow,
} from "./share-flow";
import { readShareEnvironment, selectShareRoute } from "./share-target";
import { exportBookZip } from "@/lib/export/book";
import {
  resolveBookChapters,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import { getClipMeta } from "@/lib/storage/clips";
import type { BookId } from "@/types/domain";

/**
 * Does any chapter of the book hold a clip with frames? Metadata only, no
 * clip read, over the same resolution `estimateLibraryZipBytes` walks.
 */
async function bookHasAudio(bookId: BookId): Promise<boolean> {
  const { chapters } = await resolveBookChapters(bookId);
  for (const chapter of chapters) {
    const { clipIds } = await resolveChapterClipIds(chapter.id);
    for (const clipId of clipIds) {
      const meta = await getClipMeta(clipId);
      if (meta && meta.frameCount > 0) return true;
    }
  }
  return false;
}

/**
 * {@link ShareError} plus `"appOnly"`: a browser whose Web Share refuses the
 * zip — Android Chrome's allowlist has no `application/zip` (#272). Sharing a
 * book there works in the app (DRI, 2026-10-06), so this is a pointer to it,
 * not a failure.
 */
export type BookShareError = ShareError | "appOnly";

/** The archive's MIME type — what the browser's share check is asked about. */
const ZIP_TYPE = "application/zip";

export interface UseBookShare
  extends Omit<ShareSurface, "error">, ShareGestures<BookShareError> {
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
   * names each MP3 inside it from the chapter's number and its own name, `null`
   * when it has none (both are translator-facing copy from the screen).
   * Never rejects — a reason surfaces through `error`. `"appOnly"` is decided
   * BEFORE any encode, so a browser that will refuse the zip does not build
   * one first.
   *
   * See {@link UseShareFlow.prepare} (`share-flow.ts`, #860): on the native
   * route this chains straight into `send()` and resolves to its outcome; on
   * the web route it resolves `null` and leaves the flow at `ready`.
   */
  prepare: (
    bookId: BookId,
    zipFilename: string,
    nameChapter: (chapterNumber: number, chapterName: string | null) => string
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
    error: flowError,
    sendUnconfirmed,
    missing,
    partial: partialSegments,
    partialChapters,
    prepare: run,
    send,
    progress,
    ownsScreen,
    dismissProgress,
    reset: resetFlow,
  } = useShareFlow();
  // Set when tap 1 finds the browser will refuse the zip, cleared by every
  // new prepare and by reset, like `useLibraryShare`'s `storageShort`.
  const [appOnly, setAppOnly] = useState(false);
  // Bumped by every prepare and by reset: a metadata read that lands after
  // either is stale and must not set `appOnly` back over the newer state.
  const checkRef = useRef(0);

  const prepare = useCallback(
    (
      bookId: BookId,
      zipFilename: string,
      nameChapter: (chapterNumber: number, chapterName: string | null) => string
    ): Promise<ShareOutcome | null> => {
      // Asked before the encode, with an empty File standing in for the zip:
      // the flow's own pre-encode gate has no file to ask about, but Share
      // Book's name and type are known now. Should a browser answer the real
      // File differently, the flow's post-encode check still refuses it as
      // `failed`. `selectShareRoute` takes the native route first, so inside
      // the shell this never asks the WebView (#347); a browser with no Web
      // Share keeps the flow's own `failed`.
      const env = readShareEnvironment();
      const probe = new File([], zipFilename, { type: ZIP_TYPE });
      const check = (checkRef.current += 1);
      if (env.webShare && selectShareRoute(env, probe) === "unsupported") {
        // A book with no audio is not app-only: the app cannot share it
        // either (George, #1332 r1 Medium). Read from metadata, so the
        // refusing browser still pays no encode. A read that throws goes to
        // the flow as a failed build, which reports it.
        return bookHasAudio(bookId).then(
          (hasAudio) => {
            if (check !== checkRef.current) return null;
            setAppOnly(hasAudio);
            return hasAudio
              ? null
              : run(() => Promise.resolve("nothing" as const));
          },
          (cause: unknown) =>
            check === checkRef.current ? run(() => Promise.reject(cause)) : null
        );
      }
      setAppOnly(false);
      return run((isCurrent, signal, onStep) =>
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
            ZIP_TYPE
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
      );
    },
    [run]
  );

  const reset = useCallback(() => {
    checkRef.current += 1;
    setAppOnly(false);
    resetFlow();
  }, [resetFlow]);

  return {
    status,
    error: appOnly ? "appOnly" : flowError,
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
