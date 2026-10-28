import { useState } from "react";

import {
  claimSharedContext,
  decodeMp3ToCanonical,
  playSamples,
  resumeAudioContext,
} from "./audio-io";
import {
  CHAPTER_IDLE,
  ChapterClipMissingError,
  createChapterPlayer,
  type ChapterClip,
  type ChapterPlayer,
  type ChapterPlayState,
} from "./chapter-player";
import { fitMp3Decode } from "@/lib/audio/mp3-align";
import type { AudioSession } from "@/lib/audio/session";
import { chapterPlayCandidates } from "@/lib/storage/books";
import { danglingReason, loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentId } from "@/types/domain";

/**
 * One segment's clip for chapter play, decoded to canonical PCM: the same
 * read and MP3 decode `playTake` does. A pointer that broke after the
 * playlist was read throws `ChapterClipMissingError`, which the player logs
 * under `"playback-dangling"`.
 */
async function loadChapterClip(segmentId: SegmentId): Promise<ChapterClip> {
  const audio = await loadSegmentClip(segmentId);
  if (audio.kind !== "resolved") {
    throw new ChapterClipMissingError(
      `Nothing to play for this segment: ${danglingReason(audio) ?? "it has no recording"}`
    );
  }
  if (audio.clip.encoding === "pcm") {
    return { samples: audio.clip.samples, source: "stored-pcm" };
  }
  const decoded = await decodeMp3ToCanonical(audio.clip.mp3);
  return {
    samples: fitMp3Decode(decoded, audio.clip.mp3, audio.clip.meta.frameCount),
    source: "stored-mp3",
  };
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The one chapter player for `useAudioSession`, wired to the real seams
 * (`chapter-player.ts` has the contract). `claim` and `report` are the
 * session's own, passed in so the floor and the funnel stay single.
 * Both must be stable: the player is built once, on the first render.
 */
export function useChapterPlay(
  session: AudioSession,
  claim: () => number | null,
  report: (cause: unknown, context: string) => void
): { readonly state: ChapterPlayState; readonly player: ChapterPlayer } {
  const [state, setState] = useState<ChapterPlayState>(CHAPTER_IDLE);
  const [player] = useState(() =>
    // Imports are read at call time, not here: a test that mocks one of
    // these modules without the export would otherwise fail on mount.
    createChapterPlayer({
      session,
      claim,
      candidates: (chapterId) => chapterPlayCandidates(chapterId),
      loadClip: loadChapterClip,
      playSamples: (samples, options) => playSamples(samples, options),
      wait,
      primeContext: () => {
        void resumeAudioContext().catch((cause: unknown) => {
          console.error("Could not resume the audio context", cause);
          report(cause, "chapter-play");
        });
      },
      claimSharedContext: () => claimSharedContext(),
      report,
      onChange: setState,
    })
  );
  return { state, player };
}
