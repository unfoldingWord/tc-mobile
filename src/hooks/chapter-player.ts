/**
 * Chapter play against the real floor (#1468, slice (b)): one chapter queue
 * (`lib/audio/chapter-queue.ts`, slice (a)) held under one floor claim, with
 * its failures sent to the failure log.
 *
 * This file holds no browser reference. Every seam — the playlist read, the
 * clip read, `playSamples`, the gap timer, the context claim — is injected,
 * so `tests/chapter-player.test.ts` drives it in Node against the real
 * arbiter (`lib/audio/session.ts`). `use-chapter-play.ts` wires the real
 * seams, and `use-audio-session.ts` owns the one instance.
 *
 * How the floor is held. `play()` claims the floor once and settles a guard
 * as the floor's live handle. Any other claim, and `leave()`'s `stopAll`,
 * stops that guard, and the guard calls the queue's `supersede()`: the
 * sounding clip stops at once, the run ends "superseded", and the queue does
 * not release a floor that is no longer its own. A pause releases the floor;
 * resuming is a fresh claim and a fresh guard.
 *
 * The slice (a) carry-overs, numbered as on #1468, decided here:
 *
 * 1. The run's rejection (a throwing `release`, or a throwing `stop` on the
 *    way out) is reported under `"chapter-play"`, its only channel. Nothing
 *    here releases again on a rejection.
 * 2. `isCurrent` is `session.isCurrent(token)`, a number comparison that
 *    cannot throw. Were it to, the queue's fault path releases, which is safe
 *    by 6: the floor cannot move without the guard ending the run first, and
 *    a release with a moved token does nothing.
 * 3, 8. Re-entry: `onFailure` here only reports, `release` only clears the
 *    arbiter (it never stops the guard) and `isCurrent` only compares, so
 *    none of them calls back into the queue.
 * 4. A clip that goes silent mid-buffer without ending holds the floor. This
 *    is ACCEPTED, with no watchdog: `onEnded` is `playSamples`' only end
 *    signal, and a timer guessing an end could cut off a clip that is still
 *    playing. The recovery is pause, stop, a page hide, navigation or any
 *    other Play. The device pass (#1470) covers the incoming-call case.
 * 5. A clip that arrives after its run settled and whose `stop` throws comes
 *    back through `onFailure`, reported under `"playback-take"`.
 * 6. `release` is claim-scoped: `session.release(token)` drops this claim
 *    only, and does nothing once the token has moved.
 * 7. Every `play()` makes its own claim, an empty chapter included, so the
 *    queue's release on an empty run gives back exactly that claim.
 *
 * The context hold (`claimSharedContext`) taken in the tap is kept until the
 * run settles, not just until the first clip: a context dropped in a gap
 * would make the next clip build a fresh one outside any gesture. A drop
 * asked for meanwhile (a headset change) lands when the chapter pauses, stops
 * or ends.
 */

import {
  buildChapterPlaylist,
  createChapterQueue,
  type ChapterQueue,
  type ChapterQueueDeps,
  type PlaylistCandidate,
  type QueueHandle,
} from "@/lib/audio/chapter-queue";
import type { AudioSession } from "@/lib/audio/session";
import type { ChapterId, SegmentId } from "@/types/domain";
import type { ProbeSource } from "./audio-probe";

type ChapterPlayStatus = "idle" | "loading" | "playing" | "paused" | "failed";

export interface ChapterPlayState {
  /** The chapter this state is about; null when idle. */
  readonly chapterId: ChapterId | null;
  readonly status: ChapterPlayStatus;
  /** 0..1 through the chapter where the pause left it; null unless paused. */
  readonly pausedFraction: number | null;
}

export const CHAPTER_IDLE: ChapterPlayState = {
  chapterId: null,
  status: "idle",
  pausedFraction: null,
};

/** One clip, decoded to canonical PCM, and which stored form it came from. */
export interface ChapterClip {
  readonly samples: Int16Array;
  readonly source: ProbeSource;
}

/** The clip read found no audio behind the segment (a broken pointer). */
export class ChapterClipMissingError extends Error {
  override name = "ChapterClipMissingError";
}

export interface ChapterPlayerDeps {
  session: AudioSession;
  /**
   * Claim the floor for chapter play and clear what the outgoing holder left
   * on screen, but not this player. Null when refused (a live microphone).
   */
  claim: () => number | null;
  /** The chapter's members in order (`chapterPlayCandidates`). */
  candidates: (chapterId: ChapterId) => Promise<readonly PlaylistCandidate[]>;
  loadClip: (segmentId: SegmentId) => Promise<ChapterClip>;
  playSamples: (
    samples: Int16Array,
    options: {
      offsetSeconds: number;
      onEnded: () => void;
      isStillCurrent: () => boolean;
      source: ProbeSource;
    }
  ) => Promise<QueueHandle>;
  wait: (ms: number) => Promise<void>;
  /** Resume the audio context; called inside the tap. */
  primeContext: () => void;
  claimSharedContext: () => () => void;
  report: (cause: unknown, context: string) => void;
  onChange: (state: ChapterPlayState) => void;
  /** Tests only: observe the deps the queue is given. */
  createQueue?: typeof createChapterQueue<ChapterClip>;
}

export interface ChapterPlayer {
  /** Play, or resume a paused chapter. A no-op while it already plays. */
  play: (chapterId: ChapterId) => void;
  /** Stop the sound, keep the place, release the floor. */
  pause: () => void;
  /** End the chapter and forget the place. */
  stop: () => void;
  /** Something else took the floor: forget the chapter quietly. */
  clear: () => void;
  /** 0..1 through the chapter, or null when idle. Pulled, never pushed. */
  progress: () => number | null;
  state: () => ChapterPlayState;
}

interface Entry {
  readonly chapterId: ChapterId;
  queue: ChapterQueue | null;
  token: number;
}

export function createChapterPlayer(deps: ChapterPlayerDeps): ChapterPlayer {
  const newQueue = deps.createQueue ?? createChapterQueue<ChapterClip>;
  let state = CHAPTER_IDLE;
  let current: Entry | null = null;

  function set(next: ChapterPlayState): void {
    if (
      next.chapterId === state.chapterId &&
      next.status === state.status &&
      next.pausedFraction === state.pausedFraction
    ) {
      return;
    }
    state = next;
    deps.onChange(next);
  }

  /** Drop the current chapter: its queue stops, releasing a floor it holds. */
  function forget(): void {
    const old = current;
    current = null;
    if (!old) return;
    if (!old.queue) {
      deps.session.release(old.token);
      return;
    }
    try {
      old.queue.stop();
    } catch (cause) {
      deps.report(cause, "chapter-play");
    }
  }

  /** The guard the arbiter stops when anything else takes the floor. */
  const guard = (queue: ChapterQueue) => ({ stop: () => queue.supersede() });

  /** Bring the state in line with the queue once a run settles. */
  function reconcile(entry: Entry, failed: boolean): void {
    const queue = entry.queue;
    if (current !== entry || !queue) return;
    const s = queue.state();
    if (s === "paused") {
      set({
        chapterId: entry.chapterId,
        status: "paused",
        pausedFraction: queue.progress(),
      });
      return;
    }
    // A newer run of this queue (a resume) owns the state now.
    if (s !== "idle") return;
    current = null;
    set(
      failed
        ? { chapterId: entry.chapterId, status: "failed", pausedFraction: null }
        : CHAPTER_IDLE
    );
  }

  function follow(
    entry: Entry,
    run: Promise<string>,
    unhold: () => void
  ): void {
    run
      .then(
        (outcome) => reconcile(entry, outcome === "failed"),
        (cause: unknown) => {
          deps.report(cause, "chapter-play");
          reconcile(entry, false);
        }
      )
      .finally(unhold);
  }

  function queueDeps(entry: Entry): ChapterQueueDeps<ChapterClip> {
    return {
      load: (segmentId) => deps.loadClip(segmentId),
      play: async (clip, offsetSeconds, onEnded) => {
        const token = entry.token;
        const handle = await deps.playSamples(clip.samples, {
          offsetSeconds,
          onEnded,
          isStillCurrent: () => deps.session.isCurrent(token),
          source: clip.source,
        });
        if (current === entry && deps.session.isCurrent(token)) {
          set({
            chapterId: entry.chapterId,
            status: "playing",
            pausedFraction: null,
          });
        }
        return handle;
      },
      wait: (ms) => deps.wait(ms),
      isCurrent: () => deps.session.isCurrent(entry.token),
      release: () => deps.session.release(entry.token),
      onFailure: (_segmentId, cause) =>
        deps.report(
          cause,
          cause instanceof ChapterClipMissingError
            ? "playback-dangling"
            : "playback-take"
        ),
    };
  }

  async function start(entry: Entry, unhold: () => void): Promise<void> {
    let candidates: readonly PlaylistCandidate[];
    try {
      candidates = await deps.candidates(entry.chapterId);
    } catch (cause) {
      unhold();
      if (current !== entry) return;
      deps.report(cause, "chapter-play");
      current = null;
      deps.session.release(entry.token);
      set({
        chapterId: entry.chapterId,
        status: "failed",
        pausedFraction: null,
      });
      return;
    }
    if (current !== entry || !deps.session.isCurrent(entry.token)) {
      unhold();
      if (current === entry) {
        current = null;
        set(CHAPTER_IDLE);
      }
      return;
    }
    const playlist = buildChapterPlaylist(entry.chapterId, candidates);
    for (const segmentId of playlist.broken) {
      deps.report(
        new Error(
          `Nothing to play for segment ${segmentId} in chapter play: its recording is not in the database`
        ),
        "playback-dangling"
      );
    }
    const queue = newQueue(playlist.entries, queueDeps(entry));
    entry.queue = queue;
    deps.session.settle(entry.token, guard(queue));
    follow(entry, queue.play(), unhold);
  }

  return {
    play(chapterId) {
      const same = current?.chapterId === chapterId ? current : null;
      const paused = same?.queue?.state() === "paused";
      // Already playing, or still reading its playlist: nothing to do.
      if (same && !paused) return;

      const token = deps.claim();
      if (token === null) return;
      deps.primeContext();
      const unhold = deps.claimSharedContext();

      if (same?.queue && paused) {
        same.token = token;
        deps.session.settle(token, guard(same.queue));
        set({ chapterId, status: "loading", pausedFraction: null });
        follow(same, same.queue.resume(), unhold);
        return;
      }

      forget();
      const entry: Entry = { chapterId, queue: null, token };
      current = entry;
      set({ chapterId, status: "loading", pausedFraction: null });
      void start(entry, unhold);
    },

    pause() {
      const entry = current;
      if (!entry) return;
      // Hidden before the playlist arrived: there is no place to keep yet.
      if (!entry.queue) {
        forget();
        set(CHAPTER_IDLE);
        return;
      }
      if (entry.queue.pause() === null) return;
      set({
        chapterId: entry.chapterId,
        status: "paused",
        pausedFraction: entry.queue.progress(),
      });
    },

    stop() {
      forget();
      set(CHAPTER_IDLE);
    },

    clear() {
      // The claim that called this has already stopped the guard, so only
      // the bookkeeping and a paused place are left to drop.
      forget();
      set(CHAPTER_IDLE);
    },

    progress: () => current?.queue?.progress() ?? null,
    state: () => state,
  };
}
