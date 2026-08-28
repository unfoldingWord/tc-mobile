import { useCallback, useRef, useState } from "react";

import { exportChapterMp3 } from "@/lib/export/chapter";
import type { ChapterId } from "@/types/domain";

/**
 * Why a share did not proceed. A CODE, not a message — the screen maps it to a
 * translator-facing string, so this browser-boundary hook stays free of UI copy.
 * `nothing`: the chapter has no recorded audio to share. `failed`: encoding, the
 * share sheet, or an unsupported browser.
 */
type ShareError = "nothing" | "failed";

export interface UseChapterShare {
  /** Encoding-then-handoff is in flight; the control should read busy. */
  readonly sharing: boolean;
  readonly error: ShareError | null;
  /**
   * Encode the chapter to one MP3 and hand it to the OS share sheet. Never
   * rejects — a reason surfaces through `error`. A user who dismisses the share
   * sheet is not a failure and clears silently.
   */
  shareChapter: (chapterId: ChapterId, filename: string) => Promise<void>;
  clearError: () => void;
}

/**
 * Share a chapter as one concatenated MP3 to the OS share sheet (B7, A4).
 *
 * The encode runs on the main thread for now — B8 (#34) moves `encodeMp3` to a
 * Web Worker, at which point the `onProgress` this deliberately ignores can
 * drive a real bar. Until then a long chapter briefly janks; the `sharing` flag
 * is a busy state, not a progress meter, because a synchronous encode cannot
 * repaint mid-loop.
 */
export function useChapterShare(): UseChapterShare {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<ShareError | null>(null);
  // Synchronous re-entry guard: a second tap before the first render commits
  // must not start a second encode.
  const busyRef = useRef(false);

  const shareChapter = useCallback(
    async (chapterId: ChapterId, filename: string): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setSharing(true);
      // Yield once so the busy state paints before a synchronous encode blocks
      // the main thread (the gather awaits also yield, but a tiny chapter can
      // return before the browser paints).
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        const result = await exportChapterMp3(chapterId);
        if (!result) {
          setError("nothing");
          return;
        }
        // Copy into a plain ArrayBuffer-backed view: `encodeMp3` returns
        // `Uint8Array<ArrayBufferLike>`, which `BlobPart` rejects because it
        // could (in principle) be SharedArrayBuffer-backed. A fresh copy is the
        // cast-free way to give `File` a buffer it accepts.
        const bytes = new Uint8Array(result.mp3);
        const file = new File([bytes], filename, { type: "audio/mpeg" });
        const canShareFiles =
          typeof navigator.share === "function" &&
          (typeof navigator.canShare !== "function" ||
            navigator.canShare({ files: [file] }));
        if (!canShareFiles) {
          setError("failed");
          return;
        }
        await navigator.share({ files: [file], title: filename });
      } catch (cause) {
        // Dismissing the share sheet rejects with AbortError — expected, not a
        // failure to alarm a translator with.
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        console.error("Sharing the chapter failed", cause);
        setError("failed");
      } finally {
        setSharing(false);
        busyRef.current = false;
      }
    },
    []
  );

  const clearError = useCallback(() => setError(null), []);

  return { sharing, error, shareChapter, clearError };
}
