// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import type { SegmentId } from "@/types/domain";

/**
 * The record-again confirm's "Play what will be lost" row — #979's last
 * remainder after #1022 (badge/button) and #1054 (the row itself, built for
 * `segments-screen.tsx`'s segment Erase and left as follow-up here, blocked
 * on #810). #810 has merged, so this is the recorder's own wiring: the same
 * `EraseConfirmPreview` object `segments-screen.tsx` builds from
 * `SegmentsAudio.playTake`/`playingId`, built here from `RecorderAudio`'s own
 * `playBuffer`/`playingBuffer` — this sheet holds one take in memory, not a
 * list of rows, so there is no id to compare against.
 *
 * The harness is `tests/recorder-rerecord-o4.test.ts`'s: the real `Recorder`,
 * the real erase hook and the real confirm, with the store and the segment
 * loader replaced at their boundary.
 *
 * What this cannot see: the cascade (whether `o4/dialogs.css` wins on a real
 * page), the drawn waveform bars (`Waveform` is mocked out, the same way
 * `recorder-rerecord-o4.test.ts` does, since jsdom has no canvas 2D context),
 * or anything on a phone.
 */

const storage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));

const recorded = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  segmentLabel: null,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: 1000,
  samples: new Int16Array(1000).fill(5),
};
const boundary = vi.hoisted(() => ({
  view: null as unknown,
  reload: vi.fn(),
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: boundary.reload,
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  storage.clear.mockReset();
  storage.clear.mockResolvedValue(undefined);
  boundary.view = recorded;
  boundary.reload.mockReset();
  boundary.reload.mockResolvedValue(recorded);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function setup(playingBuffer = false) {
  const ref = createRef<RecorderHandle>();
  const audio: UseAudioSession = {
    playingId: null,
    playingBuffer,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    recorderState: "idle",
    elapsedMs: 0,
    supported: true,
    error: null,
    recorderError: null,
    meterFailed: false,
    takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
    playTake: vi.fn(),
    playBuffer: vi.fn(),
    stopBuffer: vi.fn(),
    readPlaybackPosition: () => null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(async () => ({
      samples: new Int16Array(0),
      blob: null,
      error: null,
    })),
    retryDecode: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  };
  function Host() {
    return createElement(Recorder, {
      ref,
      segmentId: "segment" as SegmentId,
      audio,
      erase: useEraseSegment(),
      saveRecording: vi.fn().mockResolvedValue(true),
      saveEditedSegment: vi.fn().mockResolvedValue(true),
      clipboard: null,
      onClipboardChange: vi.fn(),
      databaseUnreachable: false,
      onExit: vi.fn(),
      onRequestBack: () => {
        void ref.current?.requestClose();
      },
    });
  }
  await act(async () => root.render(createElement(Host)));
  return { ref, audio };
}

/** The one button whose accessible name is exactly `label`. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
  expect(found, label).not.toBeUndefined();
  return found!;
}
function barRerecord(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.recorder-toolbar.pair button[aria-label^="${strings.rerecord}"]`
  );
  expect(found, "the bar's re-record control").not.toBeNull();
  return found!;
}
async function openFromMenu() {
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
}
const previewRow = () => document.querySelector(".confirm-preview");

describe("the record-again confirm's 'Play what will be lost' row (#979 remainder)", () => {
  it("renders no row when opened via the ⋮ menu's Erase (not the bin)", async () => {
    await setup();
    await openFromMenu();
    expect(document.querySelector(".confirm-panel")).not.toBeNull();
    expect(previewRow()).toBeNull();
  });

  it("renders the row, idle, when opened from the bin", async () => {
    await setup();
    await act(async () => barRerecord().click());
    expect(previewRow()).not.toBeNull();
    expect(button(strings.eraseConfirmPreviewPlay)).not.toBeUndefined();
  });

  it("labels the row Pause when the buffer is already sounding", async () => {
    await setup(true);
    await act(async () => barRerecord().click());
    expect(button(strings.eraseConfirmPreviewPause)).not.toBeUndefined();
  });

  it("Play sounds the working buffer from its start, mirroring segments' playTake(row, 0)", async () => {
    const { audio } = await setup();
    await act(async () => barRerecord().click());
    await act(async () => button(strings.eraseConfirmPreviewPlay).click());
    expect(audio.playBuffer).toHaveBeenCalledTimes(1);
    const call = (audio.playBuffer as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [buf, offset] = call as [Int16Array, number, unknown];
    expect(Array.from(buf)).toEqual(Array.from(recorded.samples));
    expect(offset).toBe(0);
  });

  it("Pause stops the buffer instead of starting a second play", async () => {
    const { audio } = await setup(true);
    await act(async () => barRerecord().click());
    (audio.stopBuffer as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => button(strings.eraseConfirmPreviewPause).click());
    expect(audio.stopBuffer).toHaveBeenCalledTimes(1);
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });
});

describe("playback stops when the confirm closes, either button or Back (#979 remainder)", () => {
  it("Cancel stops it", async () => {
    const { audio } = await setup(true);
    await act(async () => barRerecord().click());
    (audio.stopBuffer as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => button(strings.eraseCancel).click());
    expect(audio.stopBuffer).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".confirm-panel")).toBeNull();
  });

  it("Erase stops it", async () => {
    // Pre-existing behaviour (`onConfirmErase`'s own `stopPlayback()`, plus
    // `onExitEdit`'s on the success path this fixture takes) — not a count
    // this PR's code controls, so "at least once" is the honest assertion.
    const { audio } = await setup(true);
    await act(async () => barRerecord().click());
    (audio.stopBuffer as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => button(strings.eraseConfirm).click());
    expect(audio.stopBuffer).toHaveBeenCalled();
  });

  it("Play cannot start while the erase is in flight, so a failed erase leaves nothing sounding", async () => {
    // Frank round 1 on #1074: `closing` latches only after a successful
    // erase, and the failure branch closes the confirm without a stop.
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reject!: (cause: unknown) => void;
    storage.clear.mockReturnValue(
      new Promise((_, rej) => {
        reject = rej;
      })
    );
    const { audio } = await setup();
    await act(async () => barRerecord().click());
    await act(async () => button(strings.eraseConfirm).click());
    await act(async () => button(strings.eraseConfirmPreviewPlay).click());
    expect(audio.playBuffer).not.toHaveBeenCalled();
    await act(async () => reject(new Error("store failed")));
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });

  it("a system Back stops it", async () => {
    const { ref, audio } = await setup(true);
    await act(async () => barRerecord().click());
    (audio.stopBuffer as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      expect(await ref.current!.requestClose()).toBe(false);
    });
    expect(audio.stopBuffer).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".confirm-panel")).toBeNull();
  });
});

// The clipboard-discard guard (`confirmFor !== "clip"`) is checked against the
// source in tests/recorder-record-again-preview-gate.test.ts, in the Node
// environment `readFileSync`/`URL` need — this file's jsdom pragma is why
// that check lives apart, the same split `tests/recorder-discard-clip.test.ts`
// already draws for the identical reason (see that file's own docblock).
