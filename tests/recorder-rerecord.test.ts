// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

/**
 * Wipe and record again, without leaving the recorder (#592).
 *
 * The real `Recorder`, the real erase hook, the real confirm and the real
 * editor are mounted; the store's `clearSegmentTake` and the segment loader
 * are replaced at their boundary, as `tests/recorder-erase-back.test.ts` does.
 * `reloads` stands in for the store after the erase: the loader hands back the
 * empty segment the erase left, so the sheet has to rebuild itself over it.
 *
 * What this cannot see is a phone: no layout, no real pointer, no microphone,
 * and `stopRecording` is a fake. Whether a translator finds the control is the
 * training observation (#249), not this file.
 */
const storage = vi.hoisted(() => ({ clear: vi.fn() }));
// `@/lib/storage/takes`, not `books`: `clearSegmentTake` moved out of the
// repository in #160 L-16, and a mock left on the old path intercepts nothing.
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));

interface TestView {
  bookName: string;
  chapterNumber: number;
  ordinal: number;
  segmentLabel: string | null;
  finished: boolean;
  hasClip: boolean;
  peaks: null;
  lengthSamples: number;
  samples: Int16Array | null;
}
const recorded: TestView = {
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
const erased: TestView = {
  ...recorded,
  hasClip: false,
  lengthSamples: 0,
  samples: null,
};
const boundary = vi.hoisted(() => ({
  view: null as unknown,
  reloads: [] as unknown[],
  // When set, the next reload waits on this instead of resolving at once.
  gate: null as Promise<void> | null,
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
  boundary.reloads = [];
  boundary.gate = null;
  boundary.reload.mockReset();
  boundary.reload.mockImplementation(async () => {
    if (boundary.gate) await boundary.gate;
    boundary.view = boundary.reloads.shift() ?? boundary.view;
    return boundary.view;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const captured = new Int16Array([7, 8, 9]);

async function setup() {
  const ref = createRef<RecorderHandle>();
  const saveRecording = vi.fn().mockResolvedValue(true);
  const saveEditedSegment = vi.fn().mockResolvedValue(true);
  const onExit = vi.fn();
  const audio: { -readonly [K in keyof UseAudioSession]: UseAudioSession[K] } =
    {
      playingId: null,
      playingBuffer: false,
      playbackElapsedMs: 0,
      playbackRanOut: false,
      recorderState: "idle",
      elapsedMs: 0,
      supported: true,
      error: null,
      recorderError: null,
      meterFailed: false,
      playTake: vi.fn(),
      playBuffer: vi.fn(),
      stopBuffer: vi.fn(),
      readPlaybackPosition: () => null,
      startRecording: vi.fn(),
      stopRecording: vi.fn(async () => {
        audio.recorderState = "idle";
        return { samples: captured, blob: null, error: null };
      }),
      retryDecode: vi.fn(),
      leave: vi.fn(),
      primeAudioContext: vi.fn(),
      readLevel: () => 0,
      readMeterAvailable: () => true,
      readScope: () => null,
      peekScope: () => null,
    };
  const render = async () =>
    act(async () =>
      root.render(
        createElement(Recorder, {
          ref,
          segmentId: "segment" as SegmentId,
          audio,
          saveRecording,
          saveEditedSegment,
          clipboard: null,
          onClipboardChange: vi.fn(),
          databaseUnreachable: false,
          onExit,
          onRequestBack: () => {
            void ref.current?.requestClose();
          },
        })
      )
    );
  await render();
  return { ref, audio, render, saveRecording, saveEditedSegment, onExit };
}

/** The one button whose accessible name starts with `label`. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (b) =>
      b.getAttribute("aria-label") === label ||
      b.getAttribute("aria-label")?.startsWith(`${label}. `)
  );
  expect(found, label).toHaveLength(1);
  return found[0]!;
}
function barRerecord(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.recorder-toolbar.pair button[aria-label^="${strings.rerecord}"]`
  );
  expect(found, "the bar's re-record control").not.toBeNull();
  return found!;
}
const confirmDialog = () =>
  document.querySelector(`[aria-label="${strings.eraseConfirmTitle}"]`);

it("the bar control opens the erase confirm, erases once, and leaves the sheet ready to record", async () => {
  const s = await setup();
  boundary.reloads = [erased];

  const control = barRerecord();
  control.focus();
  await act(async () => control.click());
  expect(confirmDialog()).not.toBeNull();
  expect(storage.clear).not.toHaveBeenCalled();

  await act(async () => button(strings.eraseConfirm).click());

  // One erase, through the shared hook, against this segment.
  expect(storage.clear).toHaveBeenCalledExactlyOnceWith("segment");
  expect(boundary.reload).toHaveBeenCalledOnce();
  // Still in the recorder: nothing asked App to leave.
  expect(s.onExit).not.toHaveBeenCalled();
  expect(confirmDialog()).toBeNull();
  // Ready to record: the record bar, a live Record, and nothing left to erase.
  expect(container.querySelector(".recorder-toolbar.pair")).not.toBeNull();
  const record = button(strings.record);
  expect(record.disabled).toBe(false);
  expect(record.getAttribute("aria-disabled")).toBeNull();
  expect(barRerecord().getAttribute("aria-label")).toBe(
    `${strings.rerecord}. ${strings.nothingStored}`
  );
  expect(barRerecord().getAttribute("aria-disabled")).toBe("true");
  // Focus follows the next act, not the control that has just gone inert.
  expect(document.activeElement).toBe(record);
});

it("after the erase, Back writes nothing and still tells the list to reload", async () => {
  const s = await setup();
  boundary.reloads = [erased];
  await act(async () => barRerecord().click());
  await act(async () => button(strings.eraseConfirm).click());

  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(true);
  });
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.saveEditedSegment).not.toHaveBeenCalled();
  expect(s.onExit).toHaveBeenCalledExactlyOnceWith(true);
});

it("holds the confirm and refuses Back while the sheet re-reads the erased segment", async () => {
  const s = await setup();
  boundary.reloads = [erased];
  let release!: () => void;
  boundary.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await act(async () => barRerecord().click());
  await act(async () => button(strings.eraseConfirm).click());
  expect(storage.clear).toHaveBeenCalledOnce();
  expect(boundary.reload).toHaveBeenCalledOnce();

  // The erase has landed; the sheet has not yet rebuilt over it. A Back here
  // must not dismiss the confirm and hand Record the pre-erase buffer.
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(false);
  });
  expect(confirmDialog()).not.toBeNull();
  // …and the confirm's own Erase stays busy across the re-read.
  expect(button(strings.eraseConfirm).disabled).toBe(true);
  expect(s.onExit).not.toHaveBeenCalled();

  await act(async () => release());
  expect(confirmDialog()).toBeNull();
  expect(s.onExit).not.toHaveBeenCalled();
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.saveEditedSegment).not.toHaveBeenCalled();
});

it("a Finished mark made before the erase does not ride the next take", async () => {
  const s = await setup();
  boundary.reloads = [erased];
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.markFinished(1)).click());
  await act(async () => button(strings.menuClose).click());
  await act(async () => barRerecord().click());
  await act(async () => button(strings.eraseConfirm).click());
  expect(storage.clear).toHaveBeenCalledOnce();

  s.audio.recorderState = "recording";
  await s.render();
  boundary.reloads = [recorded];
  await act(async () => button(strings.stop).click());

  expect(s.saveRecording).toHaveBeenCalledOnce();
  // (segmentId, existing, recorded, insertionOffset, finished)
  expect(s.saveRecording.mock.calls[0]![2]).toBe(captured);
  expect(s.saveRecording.mock.calls[0]![3]).toBe(0);
  expect(s.saveRecording.mock.calls[0]![4]).toBe(false);
});

it("the edit-mode menu's Erase lands in record mode, ready to record", async () => {
  const s = await setup();
  boundary.reloads = [erased];
  await act(async () => button(strings.enterEdit).click());
  expect(container.querySelector(".recorder-toolbar.edit")).not.toBeNull();
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
  await act(async () => button(strings.eraseConfirm).click());

  expect(storage.clear).toHaveBeenCalledExactlyOnceWith("segment");
  expect(s.onExit).not.toHaveBeenCalled();
  expect(container.querySelector(".recorder-toolbar.edit")).toBeNull();
  expect(container.querySelector(".recorder-toolbar.pair")).not.toBeNull();
  expect(button(strings.record).disabled).toBe(false);
});

it("a failed erase keeps the take and the sheet, and drops the confirm", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  storage.clear.mockRejectedValue(new Error("quota"));
  const s = await setup();
  await act(async () => barRerecord().click());
  await act(async () => button(strings.eraseConfirm).click());

  expect(storage.clear).toHaveBeenCalledOnce();
  expect(boundary.reload).not.toHaveBeenCalled();
  expect(s.onExit).not.toHaveBeenCalled();
  expect(confirmDialog()).toBeNull();
  // The take is still there, so the control still offers to erase it.
  expect(barRerecord().getAttribute("aria-label")).toBe(strings.rerecord);
  expect(barRerecord().disabled).toBe(false);
});
