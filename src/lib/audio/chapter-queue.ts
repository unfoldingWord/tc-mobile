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
 * `reportFailure`, and owns the hidden-page pause. `isCurrent` is read on
 * every step, so the hook can make it read the live floor token; a resume is a
 * fresh claim, which the hook swaps in before calling `resume()`.
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
  /** Seconds since this clip started sounding, clamped to its duration. */
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
  /** Give the floor back. Called when the queue is done with it. */
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
  /** Start from the first clip. A no-op unless idle. */
  play: () => Promise<ChapterQueueOutcome>;
  /** Stop the sound and keep the place; releases the floor. Null if not running. */
  pause: () => QueuePosition | null;
  /** Continue from the remembered place. A no-op unless paused. */
  resume: () => Promise<ChapterQueueOutcome>;
  /** End the queue and forget the place; releases the floor if held. */
  stop: () => void;
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
  let haltRun: ((o: ChapterQueueOutcome) => void) | null = null;
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
  }

  function begin(from: QueuePosition): Promise<ChapterQueueOutcome> {
    const id = ++runId;
    return new Promise<ChapterQueueOutcome>((resolve) => {
      haltRun = resolve;
      void loop(id, from).then((outcome) => {
        // A run that was halted from outside has already resolved.
        if (id === runId && outcome !== null) resolve(outcome);
      });
    });
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
      // Someone else holds the floor: stop our sound, do not release theirs.
      handle?.stop();
      runId++;
      const halt = haltRun;
      reset();
      halt?.("superseded");
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
      if (halted()) {
        h.stop();
        return null;
      }
      handle = h;
      phase = "playing";
      wake = ended;
      await done;
      wake = null;
      if (halted()) return null;
      anyPlayed = true;
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
      if (phase !== "idle") return Promise.resolve("stopped");
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
      const halt = haltRun;
      haltRun = null;
      wake?.();
      wake = null;
      phase = "paused";
      pausedAt = pos;
      pausedFraction = fraction;
      deps.release();
      halt?.("paused");
      return pos;
    },

    resume() {
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
      if (!wasPaused) deps.release();
      halt?.("stopped");
    },

    state: () => phase,
    progress,
  };
}
