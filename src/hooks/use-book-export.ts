import { useCallback, useEffect, useRef } from "react";

import { spoolArchive } from "./archive-spool";
import { reportFailure } from "./report-failure";
import {
  type BundleGatherParams,
  gatherBundleInput,
} from "@/lib/export/bundle/gather";
import { writeBundleZip } from "@/lib/export/bundle/write";
import type { BookId } from "@/types/domain";

/** The MIME type of a Scripture Bundle zip. */
const BUNDLE_MIME = "application/zip";

/** What a bundle build needs beyond the book: the caller's wording and stamps. */
export type BookBundleParams = BundleGatherParams & {
  /** The File's name, including its extension. */
  readonly filename: string;
};

/** Where a book's bundle build ended. */
export type BookBundleOutcome =
  /** `file` is the bundle; the caller owns `release` and calls it once. */
  | {
      readonly kind: "ready";
      readonly file: File;
      readonly release: () => Promise<void>;
      /** Audio ingredients in the bundle. */
      readonly audio: number;
      /** Segments with no audio ingredient (never recorded, or clip gone). */
      readonly missing: number;
    }
  /** The book is gone, or none of its segments has audio: nothing to share. */
  | { readonly kind: "empty" }
  /** `shouldContinue` said stop; nothing was kept. */
  | { readonly kind: "cancelled" }
  /** A read, write or zip error, reported as `"book-export-bundle"`. */
  | { readonly kind: "failed" };

/**
 * Build one book's Scripture Bundle into a spool and return it as a File
 * (#1457, ADR 0014). Never rejects: a failure is reported to the failure
 * funnel under `"book-export-bundle"` and comes back as `failed`.
 *
 * The File is read from the spool (`archive-spool.ts`), so the caller must
 * `release` a `ready` outcome when it is done with it. On every other outcome
 * the spool is already released.
 *
 * Browser-only and unrun on a phone: the OPFS spool, the share sheet and the
 * decode of the zip by another app are outside what Node tests reach.
 */
export async function buildBookBundle(
  bookId: BookId,
  params: BookBundleParams,
  shouldContinue: () => boolean = () => true
): Promise<BookBundleOutcome> {
  try {
    const { filename, ...gatherParams } = params;
    const input = await gatherBundleInput(bookId, gatherParams);
    if (input === null) return { kind: "empty" };
    if (!shouldContinue()) return { kind: "cancelled" };
    const spooled = await spoolArchive(
      (sink) => writeBundleZip(input, sink, shouldContinue),
      filename,
      BUNDLE_MIME
    );
    if (spooled === null) return { kind: "cancelled" };
    const { result, file, release } = spooled;
    if (result.audio === 0) {
      await release();
      return { kind: "empty" };
    }
    return {
      kind: "ready",
      file,
      release,
      audio: result.audio,
      missing: result.missing,
    };
  } catch (cause) {
    reportFailure(cause, "book-export-bundle");
    return { kind: "failed" };
  }
}

/**
 * Build a book's Scripture Bundle for the share path. A run is cancelled by a
 * newer `build`, by `cancel` or by unmount; a cancelled run's spool is
 * released before it returns, and a run that finishes after that is released
 * here too, so no File is left for a screen that is gone.
 */
export function useBookExport(): {
  build: (
    bookId: BookId,
    params: BookBundleParams
  ) => Promise<BookBundleOutcome>;
  cancel: () => void;
} {
  const run = useRef(0);
  const cancel = useCallback(() => {
    run.current++;
  }, []);
  useEffect(() => cancel, [cancel]);
  const build = useCallback(
    async (
      bookId: BookId,
      params: BookBundleParams
    ): Promise<BookBundleOutcome> => {
      const mine = ++run.current;
      const outcome = await buildBookBundle(
        bookId,
        params,
        () => run.current === mine
      );
      if (outcome.kind === "ready" && run.current !== mine) {
        await outcome.release();
        return { kind: "cancelled" };
      }
      return outcome;
    },
    []
  );
  return { build, cancel };
}
