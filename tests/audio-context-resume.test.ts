import { afterEach, describe, expect, it, vi } from "vitest";

import { contextNeedsResume } from "@/hooks/audio-io";

/**
 * `contextNeedsResume` is the one audibility decision extracted from the browser-
 * only audio boundary so it can be tested in Node. The regression it guards: a
 * context in WebKit's `"interrupted"` state (iOS enters it on a call / route
 * change / backgrounding) must be resumed, or every later playback is silent
 * with no error. The pre-fix guard only handled `"suspended"`, so the
 * `"interrupted"` case is the mutation that must fail if the fix is removed.
 */
describe("contextNeedsResume", () => {
  it("resumes a suspended context", () => {
    expect(contextNeedsResume("suspended")).toBe(true);
  });

  it("resumes an interrupted context — iOS's non-standard fourth state", () => {
    expect(contextNeedsResume("interrupted")).toBe(true);
  });

  it("leaves a running context alone", () => {
    expect(contextNeedsResume("running")).toBe(false);
  });

  it("does not resume a closed context — resume() would reject", () => {
    expect(contextNeedsResume("closed")).toBe(false);
  });
});

/**
 * The predicate above proves the DECISION; these prove the WIRING — that
 * `resumeAudioContext` and `playSamples` actually act on it (Frank R1 P2: the
 * predicate test alone would stay green if `resumeAudioContext` were reverted to
 * an inline `=== "suspended"`, or the `playSamples` supersession bail deleted).
 *
 * A minimal fake `AudioContext` stands in for the browser: `audio-io.ts` reads
 * `window.AudioContext` lazily and caches one shared context, so each case
 * resets the module registry and installs a fresh fake whose `resume()` and
 * source construction are observable.
 */
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = 0;
  connect(): void {}
  start(): void {
    this.started++;
  }
  stop(): void {}
}

class FakeAudioContext {
  resumeCalls = 0;
  sourcesCreated: FakeBufferSource[] = [];
  constructor(public state: string) {}
  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    return { duration: length / sampleRate, copyToChannel(): void {} };
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sourcesCreated.push(source);
    return source;
  }
}

/** Fresh module (so the shared context is null) wired to this fake context. */
async function loadAudioIo(ctx: FakeAudioContext) {
  vi.resetModules();
  vi.stubGlobal("window", {
    // `new` on a function returning an object yields that object, so every
    // `getAudioContext()` gets this one observable fake.
    AudioContext: function () {
      return ctx;
    },
  });
  return import("@/hooks/audio-io");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resumeAudioContext — wiring", () => {
  it("resumes an interrupted context (the iOS silent-playback fix)", async () => {
    const ctx = new FakeAudioContext("interrupted");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
  });

  it("resumes a suspended context", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(1);
  });

  it("does not touch a running context", async () => {
    const ctx = new FakeAudioContext("running");
    const { resumeAudioContext } = await loadAudioIo(ctx);
    await resumeAudioContext();
    expect(ctx.resumeCalls).toBe(0);
  });
});

describe("playSamples — supersession guard (#104)", () => {
  const samples = new Int16Array([1, 2, 3, 4]);

  it("builds and starts no source when superseded during the resume await", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { playSamples } = await loadAudioIo(ctx);
    const handle = await playSamples(samples, { isStillCurrent: () => false });
    // Nothing reached ctx.destination — no source was even created.
    expect(ctx.sourcesCreated).toHaveLength(0);
    expect(handle.duration).toBe(0);
  });

  it("honours a Stop that arrives DURING the buffer fill (George R4 G-1)", async () => {
    // The windowed fill (#175) is synchronous and scales with the clip: about
    // 600 `copyToChannel` calls for ten minutes. A tap on Stop during it cannot
    // run until the fill yields. If nothing between the fill and
    // `source.start()` yields, the Stop is handled only AFTER the source
    // started, and `settle` then kills it: the start-then-stop click #104
    // exists to prevent. A re-check with no yield before it would be dead code,
    // because nothing can change in the same task. So the tap is modelled the
    // way the platform delivers it — a task queued while the fill runs — and
    // the claim is superseded only when that task runs.
    const ctx = new FakeAudioContext("running");
    let superseded = false;
    ctx.createBuffer = (
      _channels: number,
      length: number,
      sampleRate: number
    ) => ({
      duration: length / sampleRate,
      copyToChannel(): void {
        setTimeout(() => {
          superseded = true;
        }, 0);
      },
    });
    const { playSamples } = await loadAudioIo(ctx);

    const handle = await playSamples(samples, {
      isStillCurrent: () => !superseded,
    });

    expect(ctx.sourcesCreated.every((s) => s.started === 0)).toBe(true);
    expect(handle.duration).toBe(0);
  });

  it("builds and starts a source when the claim is still current", async () => {
    const ctx = new FakeAudioContext("suspended");
    const { playSamples } = await loadAudioIo(ctx);
    await playSamples(samples, { isStillCurrent: () => true });
    expect(ctx.sourcesCreated).toHaveLength(1);
    expect(ctx.sourcesCreated[0]!.started).toBe(1);
  });
});
