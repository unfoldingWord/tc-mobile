import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FailureReport } from "@/hooks/report-failure";

/**
 * A throwing `MediaStreamTrack.stop()` must not skip the tracks after it
 * (#479).
 *
 * `cancel()` reaches `releaseStream()`, and `leave()`'s contract is that the
 * microphone is released synchronously and totally. A bare
 * `getTracks().forEach((t) => t.stop())` breaks that on the first throw: the
 * later tracks stay live and the throw escapes the caller. `stopTracks` in
 * `src/hooks/audio-io.ts` is the loop `releaseStream`, `abandonStream` and the
 * level tap's `close()` go through.
 *
 * `MediaStreamTrack.stop()` is not specified to throw, and no engine has been
 * seen to throw there. These cases build the throwing track themselves, so they
 * pin a contract of the helper and of the level tap's `close()`; they do not
 * show any real path reaching it. The last block is a source-text gate, because
 * `releaseStream` and `abandonStream` are `useCallback`s inside `useRecorder()`
 * and cannot be called from this Node suite.
 */

class FakeTrack {
  stopped = 0;
  constructor(private readonly failure?: Error) {}
  stop(): void {
    this.stopped++;
    if (this.failure) throw this.failure;
  }
}

class FakeStream {
  constructor(
    private readonly tracks: FakeTrack[],
    private readonly cloneTracks: FakeTrack[] = []
  ) {}
  clone(): FakeStream {
    return new FakeStream(this.cloneTracks);
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeAudioContext {
  state = "running";
  get destination(): unknown {
    return new FakeNode();
  }
  createMediaStreamSource(): FakeNode {
    return new FakeNode();
  }
  createAnalyser(): FakeNode & { fftSize: number } {
    return Object.assign(new FakeNode(), { fftSize: 1024 });
  }
  createGain(): FakeNode & { gain: { value: number } } {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
}

async function load() {
  vi.resetModules();
  const ctx = new FakeAudioContext();
  vi.stubGlobal("window", {
    AudioContext: function () {
      return ctx;
    },
  });
  const audioIo = await import("@/hooks/audio-io");
  const { subscribeToFailures } = await import("@/hooks/report-failure");
  const reports: FailureReport[] = [];
  const stopSink = subscribeToFailures((r) => reports.push(r));
  return { audioIo, reports, stopSink };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stopTracks — every track is stopped even when one throws (#479)", () => {
  it("stops the later tracks when the first stop() throws, reports it, and does not rethrow", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { audioIo, reports, stopSink } = await load();
    const failure = new Error("track stop failed");
    const tracks = [new FakeTrack(failure), new FakeTrack(), new FakeTrack()];
    const stream = new FakeStream(tracks) as unknown as MediaStream;

    expect(() =>
      audioIo.stopTracks(stream, "recorder-release-track")
    ).not.toThrow();
    stopSink();

    expect(tracks.map((t) => t.stopped)).toEqual([1, 1, 1]);
    expect(reports).toEqual([
      { context: "recorder-release-track", cause: failure },
    ]);
  });

  it("reports each throwing track once, under the caller's context", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { audioIo, reports, stopSink } = await load();
    const first = new Error("first");
    const third = new Error("third");
    const tracks = [
      new FakeTrack(first),
      new FakeTrack(),
      new FakeTrack(third),
    ];

    audioIo.stopTracks(
      new FakeStream(tracks) as unknown as MediaStream,
      "some-context"
    );
    stopSink();

    expect(tracks.map((t) => t.stopped)).toEqual([1, 1, 1]);
    expect(reports.map((r) => [r.context, r.cause])).toEqual([
      ["some-context", first],
      ["some-context", third],
    ]);
  });

  it("reports nothing when no track throws", async () => {
    const { audioIo, reports, stopSink } = await load();
    const tracks = [new FakeTrack(), new FakeTrack()];

    audioIo.stopTracks(
      new FakeStream(tracks) as unknown as MediaStream,
      "recorder-release-track"
    );
    stopSink();

    expect(tracks.map((t) => t.stopped)).toEqual([1, 1]);
    expect(reports).toEqual([]);
  });
});

describe("the level tap's close() stops every cloned track (#479)", () => {
  it("stops the later clone tracks when the first throws, and close() does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { audioIo, reports, stopSink } = await load();
    const failure = new Error("clone stop failed");
    const clones = [new FakeTrack(failure), new FakeTrack()];
    const tap = audioIo.createLevelTap(
      new FakeStream([new FakeTrack()], clones) as unknown as MediaStream
    );

    expect(() => tap.close()).not.toThrow();
    stopSink();

    expect(clones.map((t) => t.stopped)).toEqual([1, 1]);
    expect(reports).toEqual([
      { context: "recorder-tap-clone-stop", cause: failure },
    ]);
  });
});

describe("use-recorder's stream-release helpers go through stopTracks (#479)", () => {
  // Comments stripped so the gate reads code, not prose about code.
  // `tests/recorder-resume-race.test.ts` records that this file has no `//`
  // or `/*` inside a string literal, so the strip cannot misfire.
  const code = readFileSync(
    new URL("../src/hooks/use-recorder.ts", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  /** The body of `const <name> = useCallback(...)`, brace-counted. */
  const callbackBody = (name: string): string => {
    const start = code.indexOf(`const ${name} = useCallback`);
    expect(start, `${name} declaration`).toBeGreaterThan(-1);
    const open = code.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) return code.slice(open, i + 1);
    }
    throw new Error(`${name}'s closing brace not found`);
  };

  it("releaseStream stops the shared stream through stopTracks", () => {
    const body = callbackBody("releaseStream");
    expect(body).not.toMatch(/\.stop\s*\(\s*\)/);
    expect(body).toMatch(
      /if\s*\(\s*stream\s*\)\s*stopTracks\(\s*stream,\s*"recorder-release-track"\s*\)/
    );
  });

  it("abandonStream stops its own stream through stopTracks", () => {
    const body = callbackBody("abandonStream");
    expect(body).not.toMatch(/\.stop\s*\(\s*\)/);
    expect(body).toMatch(
      /stopTracks\(\s*stream,\s*"recorder-release-track"\s*\)/
    );
  });
});
