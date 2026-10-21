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
 * swaps in before calling `resume()`.
 *
 * Every way a run ends — natural end, `pause()`, `stop()`, `supersede()`, a
 * false `isCurrent`, a seam that throws — goes through one settler, `endRun`.
 * It first makes the run dead (a late `onEnded`, wait or hand-off starts
 * nothing), then tries each call that can throw (a handle's `stop`, `release`)
 * on its own, then settles the run promise exactly once: with the outcome when
 * nothing threw, otherwise rejected with the cause (an `AggregateError` when
 * several threw). It releases the floor at most once, and never after the
 * floor was lost (`supersede()`, or `isCurrent` false). `pause()` and `stop()`
 * return normally even then; the run's rejection is the error's one channel.
 * The one throw with no run left to reject — the stop of a clip whose hand-off
 * arrived after `pause()`/`stop()` had settled the run — goes to `onFailure`.
 * A throwing or non-finite `elapsed()` falls back to the clip's start offset,
 * in `pause()` and in `progress()` alike.
 *
 * Calling back into the queue: `onFailure` may call `pause()`, `stop()` or
 * `supersede()` from inside it; the loop checks its run id after it and goes
 * no further on an ended run. `release` and `isCurrent` must not call back.
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
  /** False once anything else has taken the floor. Must not call back. */
  isCurrent: () => boolean;
  /**
   * Give the floor back. Called when the queue is done with it. Must not call
   * back into this queue: a `play()` from inside it would orphan the run.
   */
  release: () => void;
  /**
   * One clip could not be loaded or played, and is skipped; or a clip that
   * arrived after its run had ended could not be stopped. Once per clip.
   * May call `pause()`, `stop()` or `supersede()` on this queue.
   */
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

  /**
   * Where the current clip is, clamped to its length. A non-finite
   * `elapsed()` falls back to where the clip started; a throwing one does
   * too, and its cause goes to `faults`.
   */
  function withinClip(faults: unknown[]): number {
    let e = clipOffset;
    if (phase === "playing" && handle) {
      try {
        const v = handle.elapsed();
        if (Number.isFinite(v)) e = v;
      } catch (cause) {
        faults.push(cause);
      }
    }
    return Math.min(Math.max(e, 0), lenAt(index));
  }

  function progress(): number | null {
    if (phase === "idle") return null;
    if (phase === "paused") return pausedFraction;
    if (phase === "gap") return at(index, lenAt(index));
    // A pull for display: a throwing `elapsed()` falls back here and is not
    // reported. The same throw reaches the run promise through `pause()`.
    return at(index, withinClip([]));
  }

  async function fetchClip(i: number): Promise<Fetched<Samples>> {
    try {
      return { ok: true, samples: await deps.load(entryAt(i).segmentId) };
    } catch (cause) {
      return { ok: false, cause };
    }
  }

  /** Hand one clip's failure to the caller, once per clip. */
  function report(i: number, cause: unknown): void {
    if (reported.has(entryAt(i).segmentId)) return;
    reported.add(entryAt(i).segmentId);
    deps.onFailure(entryAt(i).segmentId, cause);
  }

  function skip(i: number, cause: unknown): void {
    failed++;
    report(i, cause);
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

  /** Stop one sound; a throw is collected, never escapes. */
  function tryStop(h: QueueHandle | null, faults: unknown[]): void {
    if (!h) return;
    try {
      h.stop();
    } catch (cause) {
      faults.push(cause);
    }
  }

  /** Give the floor back; a throw is collected, never escapes. */
  function tryRelease(faults: unknown[]): void {
    try {
      deps.release();
    } catch (cause) {
      faults.push(cause);
    }
  }

  function faultOf(faults: readonly unknown[]): unknown {
    return faults.length === 1
      ? faults[0]
      : new AggregateError(faults, "chapter queue: more than one call threw");
  }

  /**
   * The one way a run ends. Commits first — the run id moves and the run's
   * state is taken — so nothing below can leave it live; then each call that
   * can throw is tried on its own; then the run settles exactly once.
   * `release` is false when the floor is no longer ours (`floorLost`).
   */
  function endRun(
    outcome: ChapterQueueOutcome,
    opts: {
      release: boolean;
      faults?: unknown[];
      /** A handle that arrived but was never stored as `handle`. */
      arriving?: QueueHandle;
      paused?: { pos: QueuePosition; fraction: number | null };
    }
  ): void {
    runId++;
    const sounding = handle;
    const halt = haltRun;
    const wakeLoop = wake;
    reset();
    if (opts.paused) {
      phase = "paused";
      pausedAt = opts.paused.pos;
      pausedFraction = opts.paused.fraction;
    }
    const faults = opts.faults ?? [];
    tryStop(sounding, faults);
    if (opts.arriving !== sounding) tryStop(opts.arriving ?? null, faults);
    // The loop wakes into a dead run and returns.
    wakeLoop?.();
    if (opts.release) tryRelease(faults);
    if (!halt) {
      // No run to settle (a stop while paused: nothing sounds, no floor held).
      // Should a call still have thrown, the caller is the only channel left.
      if (faults.length > 0) throw faultOf(faults);
      return;
    }
    if (faults.length > 0) halt.reject(faultOf(faults));
    else halt.resolve(outcome);
  }

  /** The floor moved: stop our sound, do not release theirs. */
  function superseded(arriving?: QueueHandle): void {
    endRun("superseded", { release: false, arriving });
  }

  function begin(from: QueuePosition): Promise<ChapterQueueOutcome> {
    const id = ++runId;
    const p = new Promise<ChapterQueueOutcome>((resolve, reject) => {
      haltRun = { resolve, reject };
      void loop(id, from).catch((cause: unknown) => {
        if (id !== runId) {
          // This run was already ended and settled, and nothing of it is left
          // to stop or release; there is no promise left to reject. Only a
          // seam the ended run had in flight can land here (a cut-off wait,
          // or `onFailure` throwing while reporting a late stop below).
          return;
        }
        // Still this run: a lost floor would have ended it through
        // `superseded()` first, so the floor is ours to give back.
        endRun("stopped", { release: true, faults: [cause] });
      });
    });
    run = p;
    return p;
  }

  /** Plays from `from` to the end; every ending goes through `endRun`. */
  async function loop(id: number, from: QueuePosition): Promise<void> {
    /** True when this run must not go on; ends it if the floor moved. */
    const halted = (arriving?: QueueHandle): boolean => {
      if (id !== runId) return true;
      if (deps.isCurrent()) return false;
      superseded(arriving);
      return true;
    };

    let offset = from.offsetSeconds;
    let pending: Promise<Fetched<Samples>> = fetchClip(from.index);
    for (let i = from.index; i < n; i++) {
      // `onFailure` (in `skip`) may have ended this run from inside it.
      if (id !== runId) return;
      index = i;
      clipOffset = offset;
      phase = "loading";
      handle = null;
      const loaded = await pending;
      if (halted()) return;
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
        if (halted()) return;
        skip(i, cause);
        offset = 0;
        continue;
      }
      if (id !== runId) {
        // pause()/stop() settled this run while the clip was on its way, so
        // a throwing stop has no run left to reject: report it as this clip's.
        try {
          h.stop();
        } catch (cause) {
          report(i, cause);
        }
        return;
      }
      let stale: boolean;
      try {
        stale = halted(h);
      } catch (cause) {
        // Make the fault path's `endRun` stop it.
        handle = h;
        throw cause;
      }
      if (stale) return;
      handle = h;
      phase = "playing";
      // It sounded, even if a pause cuts it short before `onEnded`.
      anyPlayed = true;
      wake = ended;
      await done;
      if (halted()) return;
      wake = null;
      handle = null;
      offset = 0;

      if (i + 1 < n) {
        phase = "gap";
        await deps.wait(SEGMENT_GAP_SECONDS * 1000);
        if (halted()) return;
      }
    }

    // The same check for a failure on the last clip, which leaves the loop.
    if (id !== runId) return;
    endRun(n > 0 && !anyPlayed && failed > 0 ? "failed" : "finished", {
      release: true,
    });
  }

  return {
    play() {
      if (phase === "paused") return Promise.resolve("paused");
      if (run) return run;
      if (n === 0) {
        const faults: unknown[] = [];
        tryRelease(faults);
        return faults.length > 0
          ? Promise.reject(faultOf(faults))
          : Promise.resolve("empty");
      }
      anyPlayed = false;
      failed = 0;
      reported.clear();
      return begin({ index: 0, offsetSeconds: 0 });
    },

    pause() {
      if (phase === "idle" || phase === "paused") return null;
      const faults: unknown[] = [];
      let pos: QueuePosition;
      let fraction: number | null;
      if (phase === "gap") {
        pos = { index: index + 1, offsetSeconds: 0 };
        fraction = at(index, lenAt(index));
      } else {
        const e = withinClip(faults);
        pos = { index, offsetSeconds: e };
        fraction = at(index, e);
      }
      endRun("paused", { release: true, faults, paused: { pos, fraction } });
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
      // Paused, the floor was already given back.
      endRun("stopped", { release: phase !== "paused" });
    },

    supersede() {
      // Paused or idle, the queue holds no floor and no sound.
      if (phase === "idle" || phase === "paused") return;
      superseded();
    },

    state: () => phase,
    progress,
  };
}
