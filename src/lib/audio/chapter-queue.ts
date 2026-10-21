/**
 * The chapter play queue: one chapter's recorded segments, in order, with the
 * same half-second of silence the shared chapter MP3 puts between them, and a
 * pause that remembers where it was (#1468, slice (a) — the driver only).
 *
 * Why a driver and not a loop over `playTake`: each `playTake` re-claims the
 * floor, re-runs the context-resume race and re-reads the clip. A queue holds
 * ONE floor claim for the whole chapter and starts each clip itself, so what
 * it needs from the world is four injected seams — `load`, `play`, `wait` and
 * `isCurrent` — plus a `release` for the floor. With those injected the file
 * is pure and DOM-free, and every race (a supersede mid-load, a pause inside
 * the gap, a stop whose last `onEnded` still fires) is call order in Node.
 *
 * Joining the chapter into one buffer was rejected for memory (about 16 MB per
 * minute at peak), so exactly one clip is decoded while another is prefetched.
 * Nothing decoded is kept across a pause: the queue holds a position, and a
 * resume reloads one clip.
 *
 * What this module does NOT do: claim the floor, resume the audio context,
 * decode MP3, write the failure log, or touch React. The hook slice wires
 * `load`/`play` to `audio-io`, reports `onFailure` and `broken` through
 * `reportFailure`, and owns the hidden-page pause. `isCurrent` is read after
 * each load, hand-off and gap, NOT while a clip is sounding: when the floor
 * moves mid-clip the hook must call `supersede()` (or `pause()`/`stop()`),
 * which stops the sound at once. A resume is a fresh claim, which the hook
 * swaps in before calling `resume()`. A seam that throws outside `load`/`play`
 * (`onFailure`, `wait`, `isCurrent`, `release`, a handle's `stop`) rejects the
 * run promise with that cause after stopping the sound and releasing the floor
 * at most once — including a `release` thrown from `pause()` or `stop()`, which
 * return normally and leave that rejection as the error's one channel.
 *
 * Which segments belong to a chapter is the caller's accessor
 * (`chapter.segmentIds` today). `buildChapterPlaylist` is the one place that
 * turns that membership into a playlist, and it applies R6 (DRI, 2026-10-19:
 * "The chapter it starts in; it plays and exports there"): a segment that
 * crosses a chapter plays in the chapter it starts in, once.
 */

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { SEGMENT_GAP_SECONDS } from "@/lib/export/chapter";
import type { ChapterId, SegmentId } from "@/types/domain";

/** What a probe of one segment's audio found, without reading any samples. */
type PlaylistAudio =
  | { readonly kind: "playable"; readonly frames: number }
  /** Never recorded: skipped without a sound and without a log row. */
  | { readonly kind: "unrecorded" }
  /** A pointer that goes nowhere: skipped, reported once by the caller. */
  | { readonly kind: "broken" };

export interface PlaylistCandidate {
  readonly segmentId: SegmentId;
  /** The chapter this segment STARTS in (R6). */
  readonly startChapterId: ChapterId;
  readonly audio: PlaylistAudio;
}

export interface PlaylistEntry {
  readonly segmentId: SegmentId;
  /** Original PCM length, whatever the stored encoding (`ClipMeta.frameCount`). */
  readonly frames: number;
}

export interface ChapterPlaylist {
  readonly entries: readonly PlaylistEntry[];
  /** Segments whose pointer is broken, each once, for the failure log. */
  readonly broken: readonly SegmentId[];
}

/**
 * The playable list for `chapterId` from the chapter's membership, in the
 * order given. A segment already seen, or one that starts in another chapter,
 * is not played here, so a cross-chapter segment is heard once, in its start
 * chapter.
 */
export function buildChapterPlaylist(
  chapterId: ChapterId,
  candidates: readonly PlaylistCandidate[]
): ChapterPlaylist {
  const seen = new Set<SegmentId>();
  const entries: PlaylistEntry[] = [];
  const broken: SegmentId[] = [];
  for (const c of candidates) {
    if (c.startChapterId !== chapterId) continue;
    if (seen.has(c.segmentId)) continue;
    seen.add(c.segmentId);
    if (c.audio.kind === "playable") {
      entries.push({ segmentId: c.segmentId, frames: c.audio.frames });
    } else if (c.audio.kind === "broken") {
      broken.push(c.segmentId);
    }
  }
  return { entries, broken };
}

/** What `play` hands back; `playSamples`' handle satisfies it. */
export interface QueueHandle {
  stop: () => void;
  /**
   * Position within the clip, in seconds from the start of the segment —
   * independent of the offset this start used — clamped to its duration.
   * `playSamples`' handle returns `offset + (currentTime - startedAt)`.
   */
  elapsed: () => number;
}

export interface ChapterQueueDeps<Samples = Int16Array> {
  /** Load and decode one clip. Rejecting counts as a failed clip. */
  load: (segmentId: SegmentId) => Promise<Samples>;
  /**
   * Start one clip at `offsetSeconds`. `onEnded` fires when it ends on its
   * own. Throwing or rejecting counts as a failed clip.
   */
  play: (
    samples: Samples,
    offsetSeconds: number,
    onEnded: () => void
  ) => QueueHandle | Promise<QueueHandle>;
  /** Resolve after `ms`. */
  wait: (ms: number) => Promise<void>;
  /** False once anything else has taken the floor. */
  isCurrent: () => boolean;
  /**
   * Give the floor back. Called when the queue is done with it. Must not call
   * back into this queue: a `play()` from inside it would orphan the run.
   */
  release: () => void;
  /** One clip could not be loaded or played; it is skipped. Once per clip. */
  onFailure: (segmentId: SegmentId, cause: unknown) => void;
}

type ChapterQueueState = "idle" | "loading" | "playing" | "gap" | "paused";

type ChapterQueueOutcome =
  /** Every clip was attempted and at least one sounded (or none failed). */
  | "finished"
  /** Nothing to play. */
  | "empty"
  /** Every clip failed; nothing sounded. */
  | "failed"
  | "paused"
  | "stopped"
  /** Something else took the floor. The queue stopped and did not release it. */
  | "superseded";

interface QueuePosition {
  readonly index: number;
  readonly offsetSeconds: number;
}

export interface ChapterQueue {
  /**
   * Start from the first clip. While a run is active, returns that run;
   * while paused, resolves "paused" and keeps the place.
   */
  play: () => Promise<ChapterQueueOutcome>;
  /** Stop the sound and keep the place; releases the floor. Null if not running. */
  pause: () => QueuePosition | null;
  /**
   * Continue from the remembered place. While a run is active, returns that
   * run; when idle, resolves "stopped" (nothing to continue).
   */
  resume: () => Promise<ChapterQueueOutcome>;
  /** End the queue and forget the place; releases the floor if held. */
  stop: () => void;
  /**
   * Something else took the floor: stop the sound now, end the run as
   * "superseded", and do NOT release (the floor is no longer ours).
   */
  supersede: () => void;
  state: () => ChapterQueueState;
  /** 0..1 through the chapter, or null when idle. Pulled, never pushed. */
  progress: () => number | null;
}

type Fetched<S> = { ok: true; samples: S } | { ok: false; cause: unknown };

export function createChapterQueue<Samples = Int16Array>(
  entries: readonly PlaylistEntry[],
  deps: ChapterQueueDeps<Samples>
): ChapterQueue {
  const n = entries.length;
  const lengths = entries.map((e) => e.frames / CANONICAL_SAMPLE_RATE);
  const lenAt = (i: number) => lengths[i] ?? 0;
  const entryAt = (i: number): PlaylistEntry => {
    const e = entries[i];
    if (!e) throw new Error(`chapter queue: no clip ${i}`);
    return e;
  };
  // Where each clip starts on the chapter's own timeline, gaps included.
  const starts: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    starts.push(total);
    total += lenAt(i) + (i < n - 1 ? SEGMENT_GAP_SECONDS : 0);
  }

  let phase: ChapterQueueState = "idle";
  let runId = 0;
  let index = 0;
  let clipOffset = 0;
  let handle: QueueHandle | null = null;
  let pausedAt: QueuePosition | null = null;
  let pausedFraction: number | null = null;
  let anyPlayed = false;
  let failed = 0;
  const reported = new Set<SegmentId>();
  /** Settles the active run from outside the loop (pause, stop, supersede). */
  let haltRun: {
    resolve: (o: ChapterQueueOutcome) => void;
    reject: (cause: unknown) => void;
  } | null = null;
  /** The active run's promise; null when idle or paused. */
  let run: Promise<ChapterQueueOutcome> | null = null;
  let wake: (() => void) | null = null;

  const at = (i: number, within: number) =>
    total <= 0 ? null : Math.min(1, ((starts[i] ?? 0) + within) / total);

  function progress(): number | null {
    if (phase === "idle") return null;
    if (phase === "paused") return pausedFraction;
    if (phase === "gap") return at(index, lenAt(index));
    if (phase === "playing" && handle) {
      const e = Math.min(Math.max(handle.elapsed(), 0), lenAt(index));
      return at(index, e);
    }
    return at(index, Math.min(clipOffset, lenAt(index)));
  }

  async function fetchClip(i: number): Promise<Fetched<Samples>> {
    try {
      return { ok: true, samples: await deps.load(entryAt(i).segmentId) };
    } catch (cause) {
      return { ok: false, cause };
    }
  }

  function skip(i: number, cause: unknown): void {
    failed++;
    if (reported.has(entryAt(i).segmentId)) return;
    reported.add(entryAt(i).segmentId);
    deps.onFailure(entryAt(i).segmentId, cause);
  }

  function reset(): void {
    phase = "idle";
    handle = null;
    pausedAt = null;
    pausedFraction = null;
    haltRun = null;
    wake = null;
    run = null;
  }

  /** The floor moved: stop our sound, do not release theirs. */
  function superseded(): void {
    handle?.stop();
    runId++;
    const halt = haltRun;
    reset();
    halt?.resolve("superseded");
  }

  /**
   * Give the floor back for pause/stop, then settle the halted run. Their
   * `runId++` has already cut the loop off, so if `release` throws, the run
   * promise is the only place left to report it: it rejects with the cause,
   * and the hook that awaits it reports it (lib/ has no funnel of its own).
   */
  function releaseAndSettle(
    halt: typeof haltRun,
    outcome: ChapterQueueOutcome
  ): void {
    try {
      deps.release();
    } catch (cause) {
      if (!halt) throw cause;
      halt.reject(cause);
      return;
    }
    halt?.resolve(outcome);
  }

  function begin(from: QueuePosition): Promise<ChapterQueueOutcome> {
    const id = ++runId;
    const p = new Promise<ChapterQueueOutcome>((resolve, reject) => {
      haltRun = { resolve, reject };
      loop(id, from).then(
        (outcome) => {
          // A run that was halted from outside has already resolved.
          if (id === runId && outcome !== null) resolve(outcome);
        },
        (cause: unknown) => {
          // A seam threw. A run pause/stop/supersede ended has settled already.
          if (id !== runId) return;
          runId++;
          // `reset()` runs before the final release, so a throwing release
          // is not called twice.
          const held = phase !== "idle";
          const faults: unknown[] = [cause];
          try {
            handle?.stop();
          } catch (stopCause) {
            faults.push(stopCause);
          }
          reset();
          if (held) {
            try {
              deps.release();
            } catch (releaseCause) {
              faults.push(releaseCause);
            }
          }
          reject(
            faults.length === 1
              ? cause
              : new AggregateError(
                  faults,
                  "chapter queue: a seam threw, then cleanup threw"
                )
          );
        }
      );
    });
    run = p;
    return p;
  }

  /**
   * Returns an outcome when the run ends by itself, or null when pause/stop
   * halted it (they resolve the run themselves).
   */
  async function loop(
    id: number,
    from: QueuePosition
  ): Promise<ChapterQueueOutcome | null> {
    /** True when this run must not go on; settles the supersede case. */
    const halted = (): boolean => {
      if (id !== runId) return true;
      if (deps.isCurrent()) return false;
      superseded();
      return true;
    };

    let offset = from.offsetSeconds;
    let pending: Promise<Fetched<Samples>> = fetchClip(from.index);
    for (let i = from.index; i < n; i++) {
      index = i;
      clipOffset = offset;
      phase = "loading";
      handle = null;
      const loaded = await pending;
      if (halted()) return null;
      pending = i + 1 < n ? fetchClip(i + 1) : pending;
      if (!loaded.ok) {
        skip(i, loaded.cause);
        offset = 0;
        continue;
      }

      let ended!: () => void;
      const done = new Promise<void>((r) => {
        ended = r;
      });
      let h: QueueHandle;
      try {
        h = await deps.play(loaded.samples, offset, () => {
          if (id === runId) ended();
        });
      } catch (cause) {
        if (halted()) return null;
        skip(i, cause);
        offset = 0;
        continue;
      }
      let stale: boolean;
      try {
        stale = halted();
      } catch (cause) {
        // `h` is not `handle` yet, so the fault path cannot reach it.
        h.stop();
        throw cause;
      }
      if (stale) {
        h.stop();
        return null;
      }
      handle = h;
      phase = "playing";
      // It sounded, even if a pause cuts it short before `onEnded`.
      anyPlayed = true;
      wake = ended;
      await done;
      wake = null;
      if (halted()) return null;
      handle = null;
      offset = 0;

      if (i + 1 < n) {
        phase = "gap";
        await deps.wait(SEGMENT_GAP_SECONDS * 1000);
        if (halted()) return null;
      }
    }

    reset();
    deps.release();
    if (n > 0 && !anyPlayed && failed > 0) return "failed";
    return "finished";
  }

  return {
    play() {
      if (phase === "paused") return Promise.resolve("paused");
      if (run) return run;
      if (n === 0) {
        deps.release();
        return Promise.resolve("empty");
      }
      anyPlayed = false;
      failed = 0;
      reported.clear();
      return begin({ index: 0, offsetSeconds: 0 });
    },

    pause() {
      if (phase === "idle" || phase === "paused") return null;
      const fraction = progress();
      let pos: QueuePosition;
      if (phase === "gap") {
        pos = { index: index + 1, offsetSeconds: 0 };
      } else if (phase === "playing" && handle) {
        const e = Math.min(Math.max(handle.elapsed(), 0), lenAt(index));
        pos = { index, offsetSeconds: e };
      } else {
        pos = { index, offsetSeconds: clipOffset };
      }
      handle?.stop();
      handle = null;
      runId++;
      run = null;
      const halt = haltRun;
      haltRun = null;
      wake?.();
      wake = null;
      phase = "paused";
      pausedAt = pos;
      pausedFraction = fraction;
      releaseAndSettle(halt, "paused");
      return pos;
    },

    resume() {
      if (run) return run;
      if (phase !== "paused" || !pausedAt) return Promise.resolve("stopped");
      const from = pausedAt;
      pausedAt = null;
      return begin(from);
    },

    stop() {
      if (phase === "idle") return;
      const wasPaused = phase === "paused";
      handle?.stop();
      runId++;
      const halt = haltRun;
      wake?.();
      reset();
      if (wasPaused) halt?.resolve("stopped");
      else releaseAndSettle(halt, "stopped");
    },

    supersede() {
      // Paused or idle, the queue holds no floor and no sound.
      if (phase === "idle" || phase === "paused") return;
      wake?.();
      superseded();
    },

    state: () => phase,
    progress,
  };
}
