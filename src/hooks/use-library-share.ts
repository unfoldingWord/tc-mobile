import { useCallback, useMemo, useState } from "react";

import { withEncoder } from "./mp3-codec";
import {
  type ShareError,
  type ShareGestures,
  type ShareOutcome,
  type ShareSurface,
  useShareFlow,
} from "./share-flow";
import type { ShareGap, ShareProgress, ShareSettled } from "./share-progress";
import {
  readStorageEstimate,
  storageEstimateSourceOf,
} from "./use-storage-pressure";
import {
  InsufficientStorageError,
  estimateLibraryZipBytes,
  exportLibraryZip,
  roomForExport,
} from "@/lib/export/book";

/**
 * The gap a library share's `partial` outcome carries, in the library's own
 * units and under the hook's own names. Deliberately NOT a {@link ShareGap}:
 * that shape's `missing`/`partial`/`partialChapters` mean, for a book, whole
 * chapters / segments / chapters-with-a-gap, and its one wording path
 * (`shareGapText`) says so. Carried as its own shape, the library's counts
 * cannot be handed to that path by mistake: it is a type error, not a false
 * "2 chapters could not be included" when 2 BOOKS were left out.
 */
interface LibraryShareGap {
  /** Whole books left out: not one of their chapters had audio. */
  readonly missingBooks: number;
  /** Chapters inside included books that did not ship whole. */
  readonly incompleteChapters: number;
  /** How many distinct included books hold those chapters. */
  readonly incompleteBooks: number;
}

/**
 * {@link ShareProgress} with every `gap` in {@link LibraryShareGap} units. The
 * phases, timings and settles are the flow's own, unchanged.
 */
type LibraryShareProgress =
  | Extract<ShareProgress, { phase: "hidden" }>
  | (Omit<Extract<ShareProgress, { phase: "busy" }>, "pending"> & {
      readonly pending: {
        readonly settled: ShareSettled | null;
        readonly gap?: LibraryShareGap;
      } | null;
    })
  | (Omit<Extract<ShareProgress, { phase: "outcome" }>, "gap"> & {
      readonly gap?: LibraryShareGap;
    });

function libraryGap(gap: ShareGap): LibraryShareGap {
  return {
    missingBooks: gap.missing,
    incompleteChapters: gap.partial,
    incompleteBooks: gap.partialChapters,
  };
}

/**
 * Re-express the flow's progress in library units. The flow is armed with the
 * library's counts in its `missing`/`partial`/`partialChapters` slots (see the
 * mapping in `prepare` below), so this is a rename at the one place those
 * counts leave the hook, not a conversion.
 */
function toLibraryProgress(progress: ShareProgress): LibraryShareProgress {
  switch (progress.phase) {
    case "hidden":
      return progress;
    case "busy": {
      const { pending } = progress;
      if (pending === null) return { ...progress, pending: null };
      const { gap, ...rest } = pending;
      return {
        ...progress,
        pending: gap ? { ...rest, gap: libraryGap(gap) } : rest,
      };
    }
    case "outcome": {
      const { gap, ...rest } = progress;
      return gap ? { ...rest, gap: libraryGap(gap) } : rest;
    }
    default: {
      const unhandled: never = progress;
      return unhandled;
    }
  }
}

export interface UseLibraryShare
  extends
    Omit<ShareSurface, "error" | "progress">,
    ShareGestures<ShareError | "storage"> {
  /**
   * The modal timeline, as {@link ShareSurface.progress} — except that a
   * `partial` outcome's gap is a {@link LibraryShareGap}, never a
   * {@link ShareGap}.
   */
  readonly progress: LibraryShareProgress;
  /**
   * {@link ShareSurface.missing} here counts whole BOOKS left out: not one of
   * their chapters had audio. 0 until a prepare succeeds.
   */
  readonly missing: number;
  /**
   * Chapters inside included books that did not ship whole — left out, or
   * shipped with segments missing (`exportLibraryZip`'s `incompleteChapters`).
   * 0 until a prepare succeeds.
   */
  readonly incompleteChapters: number;
  /** How many distinct included books hold {@link incompleteChapters}. */
  readonly incompleteBooks: number;
  /**
   * Tap 1: check there is room, then encode every book into one zip, one folder
   * per book, and stash the File for the send gesture. `zipFilename` names the
   * archive, `nameBook` each book's folder and `nameChapter` each MP3 inside it
   * — all translator-facing copy from the caller. Never rejects — a reason
   * surfaces through `error`:
   *
   * - `"nothing"`: no book holds any recorded audio. A clean no-op, not a
   *   failure: no encode runs and nothing is written to the failure log.
   * - `"storage"`: the phone reported too little free space for the archive
   *   (`roomForExport`). Checked BEFORE any encode, so nothing was built and
   *   nothing is left behind; the refusal is in the failure log.
   * - the rest as {@link ShareError}.
   *
   * See {@link UseShareFlow.prepare} (`share-flow.ts`, #860) for how the native
   * route chains into `send()`.
   */
  prepare: (
    zipFilename: string,
    nameBook: (bookName: string) => string,
    nameChapter: (bookName: string, chapterNumber: number) => string
  ) => Promise<ShareOutcome | null>;
}

/**
 * Share your work (#987): every book on the phone as one zip to the OS share
 * sheet, for the storage warning's button (#948). A thin wrapper over
 * {@link useShareFlow}, like `useBookShare`: the shared flow owns the
 * two-gesture machine, the progress modal and the OS handoff, and a failed
 * build reaches the failure funnel through the flow's own `"share-prepare"`
 * report — so this adds no new reporting site.
 *
 * What it adds is the order of work. First the archive's size is estimated
 * from clip metadata and checked against `navigator.storage.estimate()`
 * (`roomForExport`); only then does the build take the app's single encoder
 * lane (`withEncoder`) and run `exportLibraryZip`, the same chapter loop Share
 * Book uses. A short reading throws `InsufficientStorageError` from the build,
 * which the flow reports and settles as `failed`; this hook surfaces that one
 * failure as `"storage"` so a caller can word it differently. That is the
 * `ShareGestures<E>` seam `useFailureLogShare` already uses for `"restart"`.
 *
 * An unknown reading (no API, a refused call, nonsense figures) does NOT
 * block: refusing on a question the browser would not answer would block the
 * share everywhere that API is missing. A write that runs out of room anyway
 * fails through the same flow and funnel.
 */
export function useLibraryShare(): UseLibraryShare {
  const {
    status,
    error: flowError,
    sendUnconfirmed,
    missing,
    partial: incompleteChapters,
    partialChapters: incompleteBooks,
    prepare: run,
    send,
    progress,
    ownsScreen,
    dismissProgress,
    reset: resetFlow,
  } = useShareFlow();
  // Set by the build the moment it refuses for space, cleared by every new
  // prepare and by reset. Read only together with the flow's own `failed`, so
  // it can never outlive the error it refines.
  const [storageShort, setStorageShort] = useState(false);

  const prepare = useCallback(
    (
      zipFilename: string,
      nameBook: (bookName: string) => string,
      nameChapter: (bookName: string, chapterNumber: number) => string
    ): Promise<ShareOutcome | null> => {
      setStorageShort(false);
      return run(async (isCurrent, signal) => {
        const bytes = await estimateLibraryZipBytes(isCurrent);
        if (bytes === null) return null;
        // No audio anywhere: nothing to check room for, nothing to encode.
        if (bytes === 0) return isCurrent() ? "nothing" : null;
        const reading = await readStorageEstimate(
          storageEstimateSourceOf(globalThis)
        );
        if (!isCurrent()) return null;
        if (
          reading !== null &&
          roomForExport(reading.usage, reading.quota, bytes) === "short"
        ) {
          setStorageShort(true);
          // `roomForExport` answers "short" only for two real byte counts.
          const { usage = 0, quota = 0 } = reading;
          throw new InsufficientStorageError(bytes, usage, quota);
        }
        return withEncoder(signal, async (codec) => {
          const result = await exportLibraryZip(
            nameBook,
            nameChapter,
            codec,
            isCurrent
          );
          // null for a library with no resolvable audio AND for a run
          // cancelled part-way; `isCurrent` tells them apart.
          if (result === null) return isCurrent() ? "nothing" : null;
          // Stream chunks straight into `File` as parts, as Share Book does:
          // no archive-sized buffer is assembled here.
          const file = new File([...result.chunks], zipFilename, {
            type: "application/zip",
          });
          // The flow's count slots carry the LIBRARY's units here — books,
          // chapters, books — not Share Book's chapters/segments/chapters.
          // They leave this hook only renamed: as `missing`/
          // `incompleteChapters`/`incompleteBooks` above, and as a
          // `LibraryShareGap` in `progress` (`toLibraryProgress`), never as a
          // ShareGap a book-scope wording would misread.
          return {
            file,
            missing: result.missing,
            partial: result.incompleteChapters,
            partialChapters: result.incompleteBooks,
          };
        });
      });
    },
    [run]
  );

  const reset = useCallback(() => {
    setStorageShort(false);
    resetFlow();
  }, [resetFlow]);

  // One object per flow transition, so a consumer comparing identities sees
  // the same "nothing changed" the flow's own `progress` gives it.
  const libraryProgress = useMemo(
    () => toLibraryProgress(progress),
    [progress]
  );

  return {
    status,
    error: storageShort && flowError === "failed" ? "storage" : flowError,
    sendUnconfirmed,
    missing,
    incompleteChapters,
    incompleteBooks,
    prepare,
    send,
    reset,
    progress: libraryProgress,
    ownsScreen,
    dismissProgress,
  };
}
