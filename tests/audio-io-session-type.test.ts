import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WebKit's Audio Session API (`navigator.audioSession`, MDN:
 * https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type, W3C
 * explainer: https://github.com/w3c/audio-session/blob/main/explainer.md) is
 * what lets playback stay audible through the iPhone silent switch (#1111):
 * setting `.type = "playback"` tells WebKit to route the page's audio the
 * way a music or podcast app is routed, instead of following the ringer the
 * way its own `"auto"`/`"ambient"` default does.
 *
 * This module is Safari/WebKit-only as of this writing (16.4+ for the
 * property at all; no other engine implements it). Every setter in
 * `hooks/audio-io.ts` must therefore be a silent no-op on every OTHER
 * engine — Chrome, Firefox, Android's WebView — never a throw. That is what
 * `loadAudioIo(undefined)` below exercises: a fresh module with a bare
 * `navigator` object carrying no `audioSession` property at all, the exact
 * shape those engines expose.
 *
 * `vi.resetModules()` + a dynamic import gives each case its own module
 * instance, mirroring `tests/audio-context-resume.test.ts`'s
 * `loadAudioIo` — `audio-io.ts` reads `navigator` lazily on each call, so
 * nothing here actually needs a fresh module per case, but matching the
 * existing convention keeps this file readable beside that one.
 */

async function loadAudioIo(audioSession?: { type: string }) {
  vi.resetModules();
  vi.stubGlobal("navigator", audioSession ? { audioSession } : {});
  return import("@/hooks/audio-io");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasAudioSessionApi", () => {
  it("is true when navigator.audioSession exists", async () => {
    const { hasAudioSessionApi } = await loadAudioIo({ type: "auto" });
    expect(hasAudioSessionApi()).toBe(true);
  });

  it("is false on an engine with no navigator.audioSession", async () => {
    const { hasAudioSessionApi } = await loadAudioIo(undefined);
    expect(hasAudioSessionApi()).toBe(false);
  });
});

describe("setPlaybackAudioSession", () => {
  it('declares the session type "playback"', async () => {
    const audioSession = { type: "auto" };
    const { setPlaybackAudioSession } = await loadAudioIo(audioSession);
    setPlaybackAudioSession();
    expect(audioSession.type).toBe("playback");
  });

  it('repairs a session a recording left on "play-and-record"', async () => {
    // The exact handoff #1111 relies on: setPlaybackAudioSession is called on
    // every Play (see the playSamples wiring test below) specifically so a
    // session left declared for recording is corrected without
    // use-recorder.ts needing its own "recording just ended" hook.
    const audioSession = { type: "play-and-record" };
    const { setPlaybackAudioSession } = await loadAudioIo(audioSession);
    setPlaybackAudioSession();
    expect(audioSession.type).toBe("playback");
  });

  it("is a no-op — never throws — with no navigator.audioSession", async () => {
    const { setPlaybackAudioSession } = await loadAudioIo(undefined);
    expect(() => setPlaybackAudioSession()).not.toThrow();
  });
});

describe("setRecordAudioSession", () => {
  it('declares the session type "play-and-record"', async () => {
    const audioSession = { type: "playback" };
    const { setRecordAudioSession } = await loadAudioIo(audioSession);
    setRecordAudioSession();
    expect(audioSession.type).toBe("play-and-record");
  });

  it("is a no-op — never throws — with no navigator.audioSession", async () => {
    const { setRecordAudioSession } = await loadAudioIo(undefined);
    expect(() => setRecordAudioSession()).not.toThrow();
  });
});

/**
 * The predicate/setter tests above prove the DECISION; this proves the
 * WIRING — that `playSamples` actually calls `setPlaybackAudioSession` on
 * every Play, not just that the setter itself writes the right value
 * (Frank R1 P2 on `tests/audio-context-resume.test.ts` is the precedent for
 * why both are needed: a predicate test alone stays green if the call site
 * that is supposed to use it is deleted).
 *
 * A minimal fake `AudioContext`, already `"running"` so no resume race is in
 * play — this test is about the session-type call, not the resume path
 * `tests/audio-context-resume.test.ts` already covers.
 */
class FakeBufferSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  constructor(private readonly onStart: () => void) {}
  connect(): void {}
  start(): void {
    // The test's whole claim lives here: read the session type at the exact
    // moment the source starts, not after `playSamples` has returned. Reading
    // `audioSession.type` only from the OUTSIDE, after the `await` below, would
    // pass even if `setPlaybackAudioSession` ran after `start()` — nothing
    // else changes the type afterward, so an end-state assertion cannot tell
    // "before" from "after" (Frank R1 P3 on #1116).
    this.onStart();
  }
  stop(): void {}
}

class FakeAudioContext {
  state = "running";
  constructor(private readonly onSourceStart: () => void) {}
  get currentTime(): number {
    return 0;
  }
  get destination(): unknown {
    return {};
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    return { duration: length / sampleRate, copyToChannel(): void {} };
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this.onSourceStart);
  }
}

describe("playSamples — declares playback on every Play (#1111)", () => {
  it("has already set navigator.audioSession.type to playback by the time the source starts", async () => {
    vi.resetModules();
    const audioSession = { type: "play-and-record" };
    let typeAtSourceStart: string | undefined;
    vi.stubGlobal("window", {
      AudioContext: function () {
        return new FakeAudioContext(() => {
          typeAtSourceStart = audioSession.type;
        });
      },
    });
    vi.stubGlobal("navigator", { audioSession });

    const { playSamples } = await import("@/hooks/audio-io");
    await playSamples(new Int16Array([1, 2, 3, 4]), {
      isStillCurrent: () => true,
    });

    expect(typeAtSourceStart).toBe("playback");
  });
});
