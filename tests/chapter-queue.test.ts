import { describe, expect, it } from "vitest";

import {
  buildChapterPlaylist,
  createChapterQueue,
  type ChapterQueueDeps,
  type PlaylistCandidate,
  type QueueHandle,
} from "@/lib/audio/chapter-queue";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { SEGMENT_GAP_SECONDS } from "@/lib/export/chapter";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The queue driver is pure: every clock, load and sound is injected, so each
 * race below is call order in Node. What this cannot cover: that
 * `playSamples` really chains clips on a phone, the audible gap, and the iOS
 * behaviour of starting clip 2..N outside a tap (the hook slice and the device
 * pass, #1468 / #1470).
 */

const RATE = CANONICAL_SAMPLE_RATE;
const sec = (s: number) => Math.round(s * RATE);

/** Let queued microtasks run, including promise chains several deep. */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakePlay {
  segmentId: string;
  samples: Int16Array;
  offsetSeconds: number;
  stops: number;
  elapsed: number;
  end: () => void;
}

/** A load result is a distinct Int16Array per segment so order is observable. */
function harness(opts?: {
  failLoad?: Set<string>;
  failPlay?: Set<string>;
  manualLoad?: boolean;
  manualWait?: boolean;
}) {
  const events: string[] = [];
  const plays: FakePlay[] = [];
  const failures: Array<{ segmentId: string; cause: unknown }> = [];
  const loads = new Map<string, Deferred<Int16Array>>();
  const waits: Array<{ ms: number; release: () => void }> = [];
  let current = true;
  let releases = 0;
  const bySamples = new Map<Int16Array, string>();

  const deps: ChapterQueueDeps = {
    load(segmentId) {
      events.push(`load:${segmentId}`);
      if (opts?.failLoad?.has(segmentId)) {
        return Promise.reject(new Error(`load ${segmentId}`));
      }
      const samples = new Int16Array(1);
      bySamples.set(samples, segmentId);
      if (opts?.manualLoad) {
        const d = deferred<Int16Array>();
        loads.set(segmentId, d);
        return d.promise.then((s) => {
          bySamples.set(s, segmentId);
          return s;
        });
      }
      return Promise.resolve(samples);
    },
    play(samples, offsetSeconds, onEnded): QueueHandle {
      const segmentId = bySamples.get(samples) ?? "?";
      events.push(`play:${segmentId}@${offsetSeconds}`);
      if (opts?.failPlay?.has(segmentId)) throw new Error(`play ${segmentId}`);
      const rec: FakePlay = {
        segmentId,
        samples,
        offsetSeconds,
        stops: 0,
        elapsed: offsetSeconds,
        end: () => onEnded(),
      };
      plays.push(rec);
      return {
        stop() {
          rec.stops++;
        },
        elapsed: () => rec.elapsed,
      };
    },
    wait(ms) {
      events.push(`wait:${ms}`);
      if (opts?.manualWait) {
        const d = deferred<void>();
        waits.push({ ms, release: () => d.resolve() });
        return d.promise;
      }
      return Promise.resolve();
    },
    isCurrent: () => current,
    release: () => {
      releases++;
      events.push("release");
    },
    onFailure: (segmentId, cause) => failures.push({ segmentId, cause }),
  };
  return {
    deps,
    events,
    plays,
    failures,
    loads,
    waits,
    supersede: () => {
      current = false;
    },
    get releases() {
      return releases;
    },
  };
}

/** Index a list the test knows is long enough. */
function nth<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`no item ${i}`);
  return v;
}

const entries = (...spec: Array<[string, number]>) =>
  spec.map(([segmentId, seconds]) => ({
    segmentId: segmentId as SegmentId,
    frames: sec(seconds),
  }));

/** Drive a queue to the end of every clip with no waits in the way. */
async function endCurrent(h: ReturnType<typeof harness>) {
  await flush();
  h.plays[h.plays.length - 1]?.end();
  await flush();
}

describe("buildChapterPlaylist", () => {
  const ch = (n: string) => n as ChapterId;
  const cand = (
    id: string,
    startChapterId: string,
    audio: PlaylistCandidate["audio"]
  ): PlaylistCandidate => ({
    segmentId: id as SegmentId,
    startChapterId: ch(startChapterId),
    audio,
  });

  it("keeps the given order and drops never-recorded segments silently", () => {
    const list = buildChapterPlaylist(ch("c1"), [
      cand("a", "c1", { kind: "playable", frames: 10 }),
      cand("b", "c1", { kind: "unrecorded" }),
      cand("c", "c1", { kind: "playable", frames: 30 }),
    ]);
    expect(list.entries).toEqual([
      { segmentId: "a", frames: 10 },
      { segmentId: "c", frames: 30 },
    ]);
    expect(list.broken).toEqual([]);
  });

  it("reports each broken pointer once and does not play it", () => {
    const list = buildChapterPlaylist(ch("c1"), [
      cand("a", "c1", { kind: "broken" }),
      cand("a", "c1", { kind: "broken" }),
      cand("b", "c1", { kind: "playable", frames: 5 }),
    ]);
    expect(list.entries.map((e) => e.segmentId)).toEqual(["b"]);
    expect(list.broken).toEqual(["a"]);
  });

  it("R6: a segment that crosses a chapter plays in the chapter it starts in, once", () => {
    // `x` is listed by both chapters; it starts in c1.
    const x = cand("x", "c1", { kind: "playable", frames: 7 });
    const c1 = buildChapterPlaylist(ch("c1"), [
      cand("a", "c1", { kind: "playable", frames: 1 }),
      x,
      x,
    ]);
    const c2 = buildChapterPlaylist(ch("c2"), [
      x,
      cand("d", "c2", { kind: "playable", frames: 2 }),
    ]);
    expect(c1.entries.map((e) => e.segmentId)).toEqual(["a", "x"]);
    expect(c2.entries.map((e) => e.segmentId)).toEqual(["d"]);
  });

  it("an empty list has nothing to play", () => {
    expect(buildChapterPlaylist(ch("c1"), []).entries).toEqual([]);
  });
});

describe("createChapterQueue", () => {
  it("uses the same gap as the shared chapter MP3", async () => {
    const h = harness();
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    const run = q.play();
    await endCurrent(h);
    expect(h.events).toContain(`wait:${SEGMENT_GAP_SECONDS * 1000}`);
    await endCurrent(h);
    await run;
  });

  it("plays every clip once, in order, loading the next while one sounds", async () => {
    const h = harness();
    const q = createChapterQueue(entries(["a", 1], ["b", 1], ["c", 1]), h.deps);
    const run = q.play();
    await flush();
    // b was requested before a ended: the prefetch.
    expect(h.events.indexOf("load:b")).toBeGreaterThan(-1);
    expect(h.events.indexOf("load:b")).toBeLessThan(
      h.events.indexOf("play:a@0") + 3
    );
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a"]);
    await endCurrent(h);
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "b"]);
    await endCurrent(h);
    await endCurrent(h);
    expect(await run).toBe("finished");
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "b", "c"]);
    // gap between clips, none after the last
    expect(h.events.filter((e) => e.startsWith("wait:"))).toHaveLength(2);
  });

  it("waits for the gap before the next clip starts", async () => {
    const h = harness({ manualWait: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    void q.play();
    await endCurrent(h);
    expect(h.waits).toHaveLength(1);
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a"]);
    nth(h.waits, 0).release();
    await flush();
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "b"]);
  });

  it("does not start a clip before it has loaded", async () => {
    const h = harness({ manualLoad: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    void q.play();
    await flush();
    expect(h.plays).toHaveLength(0);
    h.loads.get("a")?.resolve(new Int16Array(3));
    await flush();
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a"]);
    nth(h.plays, 0).end();
    await flush();
    // b's load is still pending: nothing may play.
    expect(h.plays).toHaveLength(1);
    h.loads.get("b")?.resolve(new Int16Array(4));
    await flush();
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "b"]);
    expect(nth(h.plays, 1).samples).toHaveLength(4);
  });

  it("an empty queue plays nothing and says so", async () => {
    const h = harness();
    const q = createChapterQueue([], h.deps);
    expect(await q.play()).toBe("empty");
    expect(h.plays).toHaveLength(0);
    expect(h.releases).toBe(1);
    expect(q.progress()).toBeNull();
  });

  it("pause keeps the index and offset, stops the sound and releases the floor", async () => {
    const h = harness();
    const q = createChapterQueue(entries(["a", 4], ["b", 4]), h.deps);
    const run = q.play();
    await flush();
    nth(h.plays, 0).elapsed = 1.5;
    const pos = q.pause();
    expect(pos).toEqual({ index: 0, offsetSeconds: 1.5 });
    expect(nth(h.plays, 0).stops).toBe(1);
    expect(h.releases).toBe(1);
    expect(await run).toBe("paused");
    expect(q.state()).toBe("paused");
    // the ended callback of a stopped source must not advance the queue
    nth(h.plays, 0).end();
    await flush();
    expect(h.plays).toHaveLength(1);
  });

  it("resume continues the same clip from the remembered offset", async () => {
    const h = harness();
    const q = createChapterQueue(entries(["a", 4], ["b", 4]), h.deps);
    void q.play();
    await flush();
    nth(h.plays, 0).elapsed = 2.25;
    q.pause();
    const run = q.resume();
    await flush();
    expect(h.plays).toHaveLength(2);
    expect(nth(h.plays, 1).segmentId).toBe("a");
    expect(nth(h.plays, 1).offsetSeconds).toBe(2.25);
    await endCurrent(h);
    await endCurrent(h);
    expect(await run).toBe("finished");
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "a", "b"]);
  });

  it("a pause inside the gap resumes at the start of the next clip", async () => {
    const h = harness({ manualWait: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    void q.play();
    await endCurrent(h);
    expect(h.waits).toHaveLength(1);
    expect(q.pause()).toEqual({ index: 1, offsetSeconds: 0 });
    // the gap timer firing afterwards must start nothing
    nth(h.waits, 0).release();
    await flush();
    expect(h.plays).toHaveLength(1);
    void q.resume();
    await flush();
    expect(h.plays.map((p) => `${p.segmentId}@${p.offsetSeconds}`)).toEqual([
      "a@0",
      "b@0",
    ]);
  });

  it("a pause before the clip has started sounding keeps its start point", async () => {
    const h = harness({ manualLoad: true });
    const q = createChapterQueue(entries(["a", 4]), h.deps);
    void q.play();
    await flush();
    expect(q.pause()).toEqual({ index: 0, offsetSeconds: 0 });
    h.loads.get("a")?.resolve(new Int16Array(1));
    await flush();
    expect(h.plays).toHaveLength(0);
  });

  it("supersede while a clip is loading starts nothing", async () => {
    const h = harness({ manualLoad: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    const run = q.play();
    await flush();
    h.supersede();
    h.loads.get("a")?.resolve(new Int16Array(1));
    await flush();
    expect(h.plays).toHaveLength(0);
    expect(await run).toBe("superseded");
    // the floor now belongs to someone else: do not release it
    expect(h.releases).toBe(0);
  });

  it("supersede while the clip is being handed to the player stops that clip", async () => {
    // `playSamples` is async: the handle arrives after a context resume and a
    // buffer fill. A claim taken in that window must not leave it sounding.
    const h = harness();
    const arrive = deferred<QueueHandle>();
    const stops: number[] = [];
    const handle: QueueHandle = { stop: () => stops.push(1), elapsed: () => 0 };
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), {
      ...h.deps,
      play: () => arrive.promise,
    });
    const run = q.play();
    await flush();
    h.supersede();
    arrive.resolve(handle);
    await flush();
    expect(stops).toHaveLength(1);
    expect(await run).toBe("superseded");
    expect(h.events.filter((e) => e.startsWith("load:"))).toEqual([
      "load:a",
      "load:b",
    ]);
    expect(h.releases).toBe(0);
  });

  it("supersede during the gap starts nothing", async () => {
    const h = harness({ manualWait: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    const run = q.play();
    await endCurrent(h);
    h.supersede();
    nth(h.waits, 0).release();
    await flush();
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a"]);
    expect(await run).toBe("superseded");
  });

  it("stop ends the queue: the sound stops and no clip starts after", async () => {
    const h = harness({ manualWait: true });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    const run = q.play();
    await flush();
    q.stop();
    expect(nth(h.plays, 0).stops).toBe(1);
    expect(await run).toBe("stopped");
    expect(h.releases).toBe(1);
    nth(h.plays, 0).end();
    await flush();
    expect(h.plays).toHaveLength(1);
    expect(q.progress()).toBeNull();
    expect(q.state()).toBe("idle");
  });

  it("releases the floor when the last clip ends, and progress resets", async () => {
    const h = harness();
    const q = createChapterQueue(entries(["a", 1]), h.deps);
    const run = q.play();
    await endCurrent(h);
    expect(await run).toBe("finished");
    expect(h.releases).toBe(1);
    expect(q.progress()).toBeNull();
    expect(q.state()).toBe("idle");
  });

  it("skips a clip that fails to load, logging it once, and carries on", async () => {
    const h = harness({ failLoad: new Set(["b"]) });
    const q = createChapterQueue(entries(["a", 1], ["b", 1], ["c", 1]), h.deps);
    const run = q.play();
    await endCurrent(h);
    await endCurrent(h);
    expect(await run).toBe("finished");
    expect(h.plays.map((p) => p.segmentId)).toEqual(["a", "c"]);
    expect(h.failures.map((f) => f.segmentId)).toEqual(["b"]);
    // a skipped clip adds no second gap of silence
    expect(h.events.filter((e) => e.startsWith("wait:"))).toHaveLength(1);
  });

  it("skips a clip whose play throws, logging it once", async () => {
    const h = harness({ failPlay: new Set(["a"]) });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    const run = q.play();
    await endCurrent(h);
    expect(await run).toBe("finished");
    expect(h.plays.map((p) => p.segmentId)).toEqual(["b"]);
    expect(h.failures.map((f) => f.segmentId)).toEqual(["a"]);
  });

  it("every clip failing ends failed with no sound", async () => {
    const h = harness({ failLoad: new Set(["a", "b"]) });
    const q = createChapterQueue(entries(["a", 1], ["b", 1]), h.deps);
    expect(await q.play()).toBe("failed");
    expect(h.plays).toHaveLength(0);
    expect(h.failures).toHaveLength(2);
    expect(h.releases).toBe(1);
    expect(q.state()).toBe("idle");
  });

  describe("progress", () => {
    it("is null before play", () => {
      const q = createChapterQueue(entries(["a", 1]), harness().deps);
      expect(q.progress()).toBeNull();
    });

    it("is exact from frame counts and gaps, whatever the encoding", async () => {
      // frames are the original PCM length for PCM and MP3 clips alike
      const h = harness();
      const q = createChapterQueue(entries(["a", 4], ["b", 6]), h.deps);
      void q.play();
      await flush();
      const total = 4 + SEGMENT_GAP_SECONDS + 6;
      nth(h.plays, 0).elapsed = 2;
      expect(q.progress()).toBeCloseTo(2 / total, 10);
      nth(h.plays, 0).elapsed = 99; // a handle clamps; so must we
      expect(q.progress()).toBeCloseTo(4 / total, 10);
      await endCurrent(h);
      nth(h.plays, 1).elapsed = 3;
      expect(q.progress()).toBeCloseTo(
        (4 + SEGMENT_GAP_SECONDS + 3) / total,
        10
      );
    });

    it("never moves backward while playing, across the gap", async () => {
      const h = harness({ manualWait: true });
      const q = createChapterQueue(entries(["a", 2], ["b", 2]), h.deps);
      void q.play();
      await flush();
      const seen: number[] = [];
      for (const e of [0, 0.5, 1, 1.9, 2]) {
        nth(h.plays, 0).elapsed = e;
        seen.push(q.progress() as number);
      }
      nth(h.plays, 0).end();
      await flush();
      seen.push(q.progress() as number);
      nth(h.waits, 0).release();
      await flush();
      for (const e of [0, 1, 2]) {
        nth(h.plays, 1).elapsed = e;
        seen.push(q.progress() as number);
      }
      for (let i = 1; i < seen.length; i++) {
        expect(nth(seen, i)).toBeGreaterThanOrEqual(nth(seen, i - 1));
      }
      expect(nth(seen, seen.length - 1)).toBeCloseTo(1, 10);
    });

    it("holds its value while paused", async () => {
      const h = harness();
      const q = createChapterQueue(entries(["a", 4]), h.deps);
      void q.play();
      await flush();
      nth(h.plays, 0).elapsed = 1;
      q.pause();
      nth(h.plays, 0).elapsed = 3; // a dead handle must not move it
      expect(q.progress()).toBeCloseTo(0.25, 10);
    });
  });
});
