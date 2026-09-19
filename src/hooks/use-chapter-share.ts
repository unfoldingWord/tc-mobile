import { useCallback } from "react";

import { withEncoder } from "./mp3-codec";
import {
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
  useShareFlow,
} from "./share-flow";
import type { ShareProgress } from "./share-progress";
import { exportChapterMp3 } from "@/lib/export/chapter";
import type { ChapterId } from "@/types/domain";

export interface UseChapterShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /** See {@link UseShareFlow.sendUnconfirmed}. */
  readonly sendUnconfirmed: boolean;
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
  /** The modal timeline over the flow (#491). See {@link UseShareFlow.progress}. */
  readonly progress: ShareProgress;
  /** End an outcome flash early (a tap on it). */
  dismissProgress: () => void;
}

/**
 * Share a chapter as one concatenated MP3 to the OS share sheet (B7, A4). A thin
 * wrapper over {@link useShareFlow}: tap 1 builds the chapter MP3 into a File, and
 * the shared flow owns the two-gesture state machine and the OS share handoff —
 * `navigator.share` in a browser, Capacitor's Share plugin inside the native
 * shell, where the WebView may expose no Web Share at all (#336, George R6 P3).
 * The whole build runs on the app's single encoder lane (`withEncoder`,
 * B8): the encode is in the worker, the flow's abort signal reaches it (closing
 * the menu mid-encode stops the work), and it never overlaps a Finished
 * transcode's PCM.
 */
export function useChapterShare(): UseChapterShare {
  const {
    status,
    error,
    sendUnconfirmed,
    missing,
    prepare: run,
    send,
    reset,
    progress,
    dismissProgress,
  } = useShareFlow();

  const prepare = useCallback(
    (chapterId: ChapterId, filename: string): Promise<void> =>
      run((isCurrent, signal) =>
        withEncoder(signal, async (codec) => {
          const result = await exportChapterMp3(chapterId, codec, isCurrent);
          // exportChapterMp3 returns null both for an empty chapter and for a run
          // cancelled during the gather (its shouldEncode check). `isCurrent`
          // distinguishes them: still live means genuinely nothing to share.
          if (result === null) return isCurrent() ? "nothing" : null;
          // No copy: the worker hands back a right-sized ArrayBuffer-backed view,
          // which `File` accepts directly.
          const file = new File([result.mp3], filename, { type: "audio/mpeg" });
          return { file, missing: result.missing };
        })
      ),
    [run]
  );

  return {
    status,
    error,
    sendUnconfirmed,
    missing,
    prepare,
    send,
    reset,
    progress,
    dismissProgress,
  };
}
