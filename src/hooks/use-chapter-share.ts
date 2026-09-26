import { useCallback } from "react";

import { withEncoder } from "./mp3-codec";
import {
  type ShareOutcome,
  type ShareSurface,
  useShareFlow,
} from "./share-flow";
import { exportChapterMp3, withEncodeSteps } from "@/lib/export/chapter";
import type { ChapterId } from "@/types/domain";

export interface UseChapterShare extends ShareSurface {
  /**
   * Tap 1: encode the chapter to one MP3 and stash the File for the send gesture.
   * Never rejects — a reason surfaces through `error`.
   *
   * The only member not on {@link ShareSurface}, which is the point: what a
   * share hook DIFFERS in is what it takes to build the file. `missing` here
   * counts segments with no resolvable audio, left out of that file — so a
   * chapter with gaps does not export "as if whole" without saying so.
   *
   * See {@link UseShareFlow.prepare} (`share-flow.ts`, #860): on the native
   * route this chains straight into `send()` and resolves to its outcome; on
   * the web route it resolves `null` and leaves the flow at `ready`.
   */
  prepare: (
    chapterId: ChapterId,
    filename: string
  ) => Promise<ShareOutcome | null>;
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
    ownsScreen,
    dismissProgress,
  } = useShareFlow();

  const prepare = useCallback(
    (chapterId: ChapterId, filename: string): Promise<ShareOutcome | null> =>
      run((isCurrent, signal, onStep) =>
        // `withEncodeSteps` (#996) hands the export a codec and an `onStep`
        // that put the encode on the same count as the segments: the count
        // reads its total only once the MP3 exists. The inner `onStep` is that
        // wrapped reporter, deliberately shadowing the flow's own.
        withEncoder(
          signal,
          withEncodeSteps(onStep, isCurrent, async (codec, onStep) => {
            const result = await exportChapterMp3(
              chapterId,
              codec,
              isCurrent,
              onStep
            );
            // exportChapterMp3 returns null both for an empty chapter and for a run
            // cancelled during the gather (its shouldEncode check). `isCurrent`
            // distinguishes them: still live means genuinely nothing to share.
            if (result === null) return isCurrent() ? "nothing" : null;
            // No copy: the worker hands back a right-sized ArrayBuffer-backed view,
            // which `File` accepts directly.
            const file = new File([result.mp3], filename, {
              type: "audio/mpeg",
            });
            return { file, missing: result.missing };
          })
        )
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
    ownsScreen,
    dismissProgress,
  };
}
