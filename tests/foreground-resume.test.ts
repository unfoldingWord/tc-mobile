import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `armForegroundResume` is the foreground re-arm that keeps the VU meter honest
 * mid-take (#76): returning from an iOS backgrounding or an OS interruption can
 * leave the shared `AudioContext` `"suspended"`/`"interrupted"`, so the tap reads
 * zeros a translator sees as a dead mic even though capture is fine. On a return
 * to a `"visible"` document while recording it resumes the context, covering
 * the background → foreground return with capture still live.
 *
 * These cases call the module function directly with a fake document and a
 * mocked audio-context resume. They exercise the recording/visibility guards
 * and listener cleanup, without mounting the `useRecorder` effect or testing
 * background capture and audio-context recovery on a device.
 */

const { resumeAudioContext } = vi.hoisted(() => ({
  resumeAudioContext: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

// `use-recorder` pulls its whole audio boundary from `@/hooks/audio-io`. Only
// `resumeAudioContext` is exercised here; the rest must merely resolve as imports
// (none is called at module load or by `armForegroundResume`).
vi.mock("@/hooks/audio-io", () => ({
  resumeAudioContext,
  createLevelTap: vi.fn(),
  decodeToCanonical: vi.fn(),
  isRecordingSupported: () => true,
  pickMimeType: () => undefined,
}));

import { armForegroundResume } from "@/hooks/use-recorder";

/** A minimal `document` standing in for the browser: records listeners so a test
 *  can fire a `visibilitychange` and count what is still registered. */
function makeDocument(visibilityState: DocumentVisibilityState) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState,
    addEventListener(type: string, cb: () => void) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(
        cb
      );
    },
    removeEventListener(type: string, cb: () => void) {
      listeners.get(type)?.delete(cb);
    },
    fire(type: string) {
      for (const cb of listeners.get(type) ?? []) cb();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resumeAudioContext.mockClear();
});

describe("armForegroundResume", () => {
  it("arms nothing while not recording — idle/paused/processing have no meter to rescue", () => {
    const doc = makeDocument("visible");
    vi.stubGlobal("document", doc);

    armForegroundResume(false);

    expect(doc.listenerCount("visibilitychange")).toBe(0);
    // A later foreground return must do nothing: no listener, no resume.
    doc.fire("visibilitychange");
    expect(resumeAudioContext).not.toHaveBeenCalled();
  });

  it("resumes the context on a foreground return while recording", () => {
    const doc = makeDocument("visible");
    vi.stubGlobal("document", doc);

    armForegroundResume(true);
    expect(doc.listenerCount("visibilitychange")).toBe(1);

    doc.fire("visibilitychange");
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("does not resume while the document is still hidden", () => {
    const doc = makeDocument("hidden");
    vi.stubGlobal("document", doc);

    armForegroundResume(true);
    // The event fires on both directions of the transition; a hidden document is
    // the app leaving the foreground, not returning to it — nothing to re-arm.
    doc.fire("visibilitychange");
    expect(resumeAudioContext).not.toHaveBeenCalled();
  });

  it("removes the listener on cleanup — no resume after the take ends", () => {
    const doc = makeDocument("visible");
    vi.stubGlobal("document", doc);

    const cleanup = armForegroundResume(true);
    cleanup();

    expect(doc.listenerCount("visibilitychange")).toBe(0);
    doc.fire("visibilitychange");
    expect(resumeAudioContext).not.toHaveBeenCalled();
  });
});
