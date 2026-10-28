import { describe, expect, it, vi, type Mock } from "vitest";

import {
  ChapterClipMissingError,
  createChapterPlayer,
  type ChapterClip,
  type ChapterPlayerDeps,
  type ChapterPlayState,
} from "@/hooks/chapter-player";
import {
  createChapterQueue,
  type ChapterQueueDeps,
  type PlaylistCandidate,
} from "@/lib/audio/chapter-queue";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { createAudioSession, type AudioSession } from "@/lib/audio/session";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The chapter player (#1468 slice b): one chapter queue held against the real
 * floor arbiter (`lib/audio/session.ts`, pure), with every browser seam —
 * the clip read, `playSamples`, the gap timer, the context claim — injected.
 * Each race is call order in Node. What this cannot show: that clips chain on
 * a phone, the audible gap, or iOS starting clip 2..N outside a tap (#1470).
 */

const CH_A = "chapter-a" as ChapterId;
const CH_B = "chapter-b" as ChapterId;
const seg = (s: string) => s as SegmentId;

async function flush(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function playable(id: string, seconds = 2, chapter = CH_A): PlaylistCandidate {
  return {
    segmentId: seg(id),
    startChapterId: chapter,
    audio: { kind: "playable", frames: seconds * CANONICAL_SAMPLE_RATE },
  };
}

interface FakeHandle {
  id: string;
  offset: number;
  stop: Mock<() => void>;
  elapsed: () => number;
  end: () => void;
}

/** A world of fakes around a real session; `log` records call order. */
function world(
  chapters: Record<string, PlaylistCandidate[]>,
  opts: {
    session?: AudioSession;
    loadFails?: Set<string>;
    missing?: Set<string>;
    createQueue?: ChapterPlayerDeps["createQueue"];
  } = {}
) {
  const session = opts.session ?? createAudioSession();
  const log: string[] = [];
  const reports: { context: string; cause: unknown }[] = [];
  const states: ChapterPlayState[] = [];
  const handles: FakeHandle[] = [];
  let playGate: Promise<void> | null = null;
  let stopThrows: unknown = null;
  let claims = 0;
  const deps: ChapterPlayerDeps = {
    session,
    claim: () => {
      const t = session.claim("take");
      if (t !== null) claims++;
      return t;
    },
    candidates: (id) => Promise.resolve(chapters[id] ?? []),
    loadClip: (id): Promise<ChapterClip> => {
      log.push(`load:${id}`);
      if (opts.missing?.has(id)) {
        return Promise.reject(new ChapterClipMissingError(`gone ${id}`));
      }
      if (opts.loadFails?.has(id)) {
        return Promise.reject(new Error(`bad ${id}`));
      }
      return Promise.resolve({
        samples: Object.assign(new Int16Array(1), { tag: id }),
        source: "stored-pcm",
      });
    },
    playSamples: async (samples, o) => {
      const id = (samples as Int16Array & { tag: string }).tag;
      if (playGate) await playGate;
      log.push(`play:${id}@${o.offsetSeconds}`);
      const h: FakeHandle = {
        id,
        offset: o.offsetSeconds,
        stop: vi.fn<() => void>(() => {
          log.push(`stop:${id}`);
          if (stopThrows !== null) throw stopThrows;
        }),
        elapsed: () => o.offsetSeconds + 0.5,
        end: () => o.onEnded(),
      };
      handles.push(h);
      return h;
    },
    wait: () => {
      log.push("gap");
      return Promise.resolve();
    },
    primeContext: () => log.push("prime"),
    claimSharedContext: () => {
      log.push("hold");
      return () => log.push("unhold");
    },
    report: (cause, context) => reports.push({ context, cause }),
    onChange: (s) => states.push(s),
    createQueue: opts.createQueue,
  };
  const player = createChapterPlayer(deps);
  return {
    session,
    player,
    log,
    reports,
    states,
    handles,
    claims: () => claims,
    /** Every handle's stop throws `cause` from now on. */
    failStops: (cause: unknown) => {
      stopThrows = cause;
    },
    gatePlay: () => {
      let open!: () => void;
      playGate = new Promise<void>((r) => {
        open = r;
      });
      return () => {
        playGate = null;
        open();
      };
    },
    /** End the last sounding clip on its own. */
    endLast: async () => {
      handles.at(-1)?.end();
      await flush();
    },
  };
}

describe("chapter player: the floor and the order", () => {
  it("plays every clip in order with a gap, then gives the floor back", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });

    w.player.play(CH_A);
    expect(w.player.state()).toMatchObject({
      chapterId: CH_A,
      status: "loading",
    });
    await flush();
    expect(w.session.live).toBe("take");
    expect(w.player.state().status).toBe("playing");
    await w.endLast();
    await w.endLast();

    expect(w.log.filter((l) => /^(play|gap)/.test(l))).toEqual([
      "play:s1@0",
      "gap",
      "play:s2@0",
    ]);
    expect(w.player.state()).toEqual({
      chapterId: null,
      status: "idle",
      pausedFraction: null,
    });
    expect(w.session.live).toBeNull();
    expect(w.player.progress()).toBeNull();
    // The context hold from the tap is released once the run is over.
    expect(w.log.filter((l) => l === "unhold")).toHaveLength(1);
  });

  it("is refused under a live microphone and changes nothing", async () => {
    const w = world({ [CH_A]: [playable("s1")] });
    w.session.claim("mic");

    w.player.play(CH_A);
    await flush();

    expect(w.log).toEqual([]);
    expect(w.states).toEqual([]);
    expect(w.session.live).toBe("mic");
  });

  it("another claim mid-clip stops the sound and starts nothing after", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });
    w.player.play(CH_A);
    await flush();

    // What `claimFloor` does for a row's Play: claim, then clear the chapter.
    w.session.claim("take");
    w.player.clear();
    await w.endLast();
    await flush();

    expect(w.handles[0]?.stop).toHaveBeenCalledTimes(1);
    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual(["play:s1@0"]);
    expect(w.player.state().status).toBe("idle");
    // The new holder keeps the floor.
    expect(w.session.live).toBe("take");
  });

  it("anything that stops the floor stops the chapter at once, without a clear", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });
    w.player.play(CH_A);
    await flush();

    // The arbiter stops the guard the chapter settled as its live handle.
    w.session.stopAll();
    expect(w.handles[0]?.stop).toHaveBeenCalledTimes(1);
    await w.endLast();

    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual(["play:s1@0"]);
    expect(w.player.state().status).toBe("idle");
  });

  it("stop ends the chapter, releases the floor, and nothing starts after", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });
    w.player.play(CH_A);
    await flush();

    w.player.stop();
    await w.endLast();

    expect(w.handles[0]?.stop).toHaveBeenCalledTimes(1);
    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual(["play:s1@0"]);
    expect(w.session.live).toBeNull();
    expect(w.player.state().status).toBe("idle");
  });
});

describe("chapter player: pause, resume, replace", () => {
  it("pause keeps the place and releases the floor; play resumes there on a fresh claim", async () => {
    const w = world({ [CH_A]: [playable("s1", 4), playable("s2")] });
    w.player.play(CH_A);
    await flush();

    w.player.pause();
    await flush();

    expect(w.session.live).toBeNull();
    const paused = w.player.state();
    expect(paused.status).toBe("paused");
    expect(paused.pausedFraction).toBeGreaterThan(0);
    expect(w.player.progress()).toBe(paused.pausedFraction);

    w.player.play(CH_A);
    await flush();

    expect(w.claims()).toBe(2);
    expect(w.session.live).toBe("take");
    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual([
      "play:s1@0",
      "play:s1@0.5",
    ]);
    expect(w.player.state().status).toBe("playing");
  });

  it("a second play of the chapter that is playing does nothing", async () => {
    const w = world({ [CH_A]: [playable("s1")] });
    w.player.play(CH_A);
    await flush();
    w.player.play(CH_A);
    await flush();

    expect(w.claims()).toBe(1);
    expect(w.handles[0]?.stop).not.toHaveBeenCalled();
  });

  it("playing another chapter replaces a playing one", async () => {
    const w = world({
      [CH_A]: [playable("a1")],
      [CH_B]: [playable("b1", 2, CH_B)],
    });
    w.player.play(CH_A);
    await flush();

    w.player.play(CH_B);
    await flush();

    expect(w.handles[0]?.stop).toHaveBeenCalledTimes(1);
    expect(w.player.state()).toMatchObject({
      chapterId: CH_B,
      status: "playing",
    });
  });

  it("playing another chapter forgets a paused one", async () => {
    const w = world({
      [CH_A]: [playable("a1", 4)],
      [CH_B]: [playable("b1", 2, CH_B)],
    });
    w.player.play(CH_A);
    await flush();
    w.player.pause();
    await flush();

    w.player.play(CH_B);
    await flush();
    await w.endLast();
    // Back to A: from its start, not from where it was paused.
    w.player.play(CH_A);
    await flush();

    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual([
      "play:a1@0",
      "play:b1@0",
      "play:a1@0",
    ]);
  });

  it("a floor claim by something else forgets a paused chapter", async () => {
    const w = world({ [CH_A]: [playable("s1", 4)] });
    w.player.play(CH_A);
    await flush();
    w.player.pause();
    await flush();

    w.session.claim("take");
    w.player.clear();

    expect(w.player.state().status).toBe("idle");
    expect(w.player.progress()).toBeNull();
  });

  it("pause while the playlist is still being read ends the chapter", async () => {
    let finish!: (c: PlaylistCandidate[]) => void;
    const session = createAudioSession();
    const player = createChapterPlayer({
      ...baseDeps(session),
      candidates: () =>
        new Promise<PlaylistCandidate[]>((r) => {
          finish = r;
        }),
    });
    player.play(CH_A);
    player.pause();
    finish([playable("s1")]);
    await flush();

    expect(player.state().status).toBe("idle");
    expect(session.live).toBeNull();
  });
});

/** Minimal deps over a session, for tests that override one seam. */
function baseDeps(session: AudioSession): ChapterPlayerDeps {
  return {
    session,
    claim: () => session.claim("take"),
    candidates: () => Promise.resolve([]),
    loadClip: () =>
      Promise.resolve({ samples: new Int16Array(1), source: "stored-pcm" }),
    playSamples: () => Promise.resolve({ stop: () => {}, elapsed: () => 0 }),
    wait: () => Promise.resolve(),
    primeContext: () => {},
    claimSharedContext: () => () => {},
    report: () => {},
    onChange: () => {},
  };
}

describe("chapter player: failures reach the funnel", () => {
  it("reports each broken member once under playback-dangling, unrecorded ones never", async () => {
    const w = world({
      [CH_A]: [
        playable("s1"),
        {
          segmentId: seg("u"),
          startChapterId: CH_A,
          audio: { kind: "unrecorded" },
        },
        {
          segmentId: seg("x"),
          startChapterId: CH_A,
          audio: { kind: "broken" },
        },
      ],
    });
    w.player.play(CH_A);
    await flush();

    expect(w.reports.map((r) => r.context)).toEqual(["playback-dangling"]);
    expect(String(w.reports[0]?.cause)).toContain("x");
    expect(w.log.filter((l) => l.startsWith("load:"))).toEqual(["load:s1"]);
  });

  it("a clip that fails to load is skipped and reported once under playback-take", async () => {
    const w = world(
      { [CH_A]: [playable("s1"), playable("s2")] },
      { loadFails: new Set(["s1"]) }
    );
    w.player.play(CH_A);
    await flush();

    expect(w.reports.map((r) => r.context)).toEqual(["playback-take"]);
    expect(w.log.filter((l) => l.startsWith("play:"))).toEqual(["play:s2@0"]);
  });

  it("a recording gone since the playlist was read reports under playback-dangling", async () => {
    const w = world(
      { [CH_A]: [playable("s1"), playable("s2")] },
      { missing: new Set(["s1"]) }
    );
    w.player.play(CH_A);
    await flush();

    expect(w.reports.map((r) => r.context)).toEqual(["playback-dangling"]);
  });

  it("every clip failing ends the chapter failed, with the floor given back", async () => {
    const w = world(
      { [CH_A]: [playable("s1"), playable("s2")] },
      { loadFails: new Set(["s1", "s2"]) }
    );
    w.player.play(CH_A);
    await flush();

    expect(w.player.state()).toEqual({
      chapterId: CH_A,
      status: "failed",
      pausedFraction: null,
    });
    expect(w.log.some((l) => l.startsWith("play:"))).toBe(false);
    expect(w.session.live).toBeNull();
  });

  it("a chapter whose members are all broken ends failed, not idle (#1747)", async () => {
    const broken = (id: string): PlaylistCandidate => ({
      segmentId: seg(id),
      startChapterId: CH_A,
      audio: { kind: "broken" },
    });
    const w = world({
      [CH_A]: [
        broken("x"),
        {
          segmentId: seg("u"),
          startChapterId: CH_A,
          audio: { kind: "unrecorded" },
        },
        broken("y"),
      ],
    });
    w.player.play(CH_A);
    await flush();

    expect(w.player.state()).toEqual({
      chapterId: CH_A,
      status: "failed",
      pausedFraction: null,
    });
    expect(w.reports.map((r) => r.context)).toEqual([
      "playback-dangling",
      "playback-dangling",
    ]);
    expect(w.session.live).toBeNull();
    expect(w.log.filter((l) => l === "unhold")).toHaveLength(1);
  });

  it("a playlist read that rejects is reported, and the floor given back", async () => {
    const session = createAudioSession();
    const reports: string[] = [];
    const player = createChapterPlayer({
      ...baseDeps(session),
      candidates: () => Promise.reject(new Error("idb")),
      report: (_c, context) => reports.push(context),
    });
    player.play(CH_A);
    await flush();

    expect(reports).toEqual(["chapter-play"]);
    expect(player.state().status).toBe("failed");
    expect(session.live).toBeNull();
  });

  it("carry-over 1: a throwing release rejects the run, and the rejection reaches the funnel", async () => {
    const real = createAudioSession();
    const boom = new Error("release threw");
    const session: AudioSession = {
      get live() {
        return real.live;
      },
      claim: (k) => real.claim(k),
      isCurrent: (t) => real.isCurrent(t),
      settle: (t, h) => real.settle(t, h),
      release: () => {
        throw boom;
      },
      stopAll: () => real.stopAll(),
    };
    const w = world({ [CH_A]: [playable("s1")] }, { session });
    w.player.play(CH_A);
    await flush();

    await w.endLast();

    expect(w.reports).toEqual([{ context: "chapter-play", cause: boom }]);
    expect(w.player.state().status).toBe("idle");
  });

  it("carry-over 5: a hand-off that lands after pause, whose stop throws, reaches the funnel", async () => {
    const w = world({ [CH_A]: [playable("s1")] });
    const open = w.gatePlay();
    w.player.play(CH_A);
    await flush();

    w.player.pause();
    const lateStop = new Error("late stop");
    // The clip's handle arrives only now, after the run settled, and its
    // stop throws.
    w.failStops(lateStop);
    open();
    await flush();

    expect(w.reports.some((r) => r.cause === lateStop)).toBe(true);
    expect(w.reports.find((r) => r.cause === lateStop)?.context).toBe(
      "playback-take"
    );
  });
});

describe("chapter player: the slice (a) contract carry-overs", () => {
  it("carry-over 6: release drops this claim only, harmless once the floor moved", async () => {
    let captured: ChapterQueueDeps<ChapterClip> | null = null;
    const w = world(
      { [CH_A]: [playable("s1")] },
      {
        createQueue: (entries, deps) => {
          captured = deps;
          return createChapterQueue(entries, deps);
        },
      }
    );
    w.player.play(CH_A);
    await flush();
    const newer = w.session.claim("take");

    (captured as ChapterQueueDeps<ChapterClip> | null)?.release();

    expect(newer).not.toBeNull();
    expect(w.session.isCurrent(newer as number)).toBe(true);
    expect(w.session.live).toBe("take");
    // And the floor check names this claim, not "a take holds the floor".
    expect(
      (captured as ChapterQueueDeps<ChapterClip> | null)?.isCurrent()
    ).toBe(false);
  });

  it("carry-over 7: an empty chapter claims once per play and gives each claim back", async () => {
    const w = world({ [CH_A]: [] });

    w.player.play(CH_A);
    await flush();
    w.player.play(CH_A);
    await flush();

    expect(w.claims()).toBe(2);
    expect(w.session.live).toBeNull();
    expect(w.player.state().status).toBe("idle");
  });

  it("carry-over 4 (accepted): a clip that never ends holds the floor until Stop, which frees it", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });
    w.player.play(CH_A);
    await flush(200);

    // No end ever arrives: no watchdog advances or ends it.
    expect(w.player.state().status).toBe("playing");
    expect(w.session.live).toBe("take");

    w.player.stop();
    expect(w.handles[0]?.stop).toHaveBeenCalledTimes(1);
    expect(w.session.live).toBeNull();
  });

  it("progress is null when idle and inside 0..1 while playing", async () => {
    const w = world({ [CH_A]: [playable("s1"), playable("s2")] });
    expect(w.player.progress()).toBeNull();
    w.player.play(CH_A);
    await flush();

    const p = w.player.progress();
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThan(0);
    expect(p as number).toBeLessThan(1);
  });

  it.each([
    ["a NaN", Number.NaN],
    ["an infinite", Number.POSITIVE_INFINITY],
    ["a negative", -CANONICAL_SAMPLE_RATE],
  ])(
    "%s frame count never makes progress NaN (#1747)",
    async (_label, frames) => {
      const w = world({
        [CH_A]: [
          {
            segmentId: seg("s1"),
            startChapterId: CH_A,
            audio: { kind: "playable", frames },
          },
          playable("s2"),
        ],
      });
      w.player.play(CH_A);
      await flush();

      // The clip with no usable length still plays.
      expect(w.log.filter((l) => l.startsWith("play:"))).toEqual(["play:s1@0"]);
      const during = w.player.progress();
      expect(Number.isFinite(during)).toBe(true);
      expect(during as number).toBeGreaterThanOrEqual(0);
      expect(during as number).toBeLessThanOrEqual(1);

      await w.endLast();
      const after = w.player.progress();
      expect(Number.isFinite(after)).toBe(true);
      expect(after as number).toBeGreaterThanOrEqual(0);
      expect(after as number).toBeLessThanOrEqual(1);
    }
  );
});
