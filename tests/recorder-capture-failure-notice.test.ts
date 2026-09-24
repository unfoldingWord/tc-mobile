// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentEditor } from "@/hooks/use-segment-editor";
import type { SegmentId } from "@/types/domain";

/**
 * A `CaptureFailure` code reaches the screen as its sentence, on each of the
 * three routes a stop can take (#169).
 *
 * Since the hooks emit codes rather than prose, three sites in `recorder.tsx`
 * word them — `close()`'s `stay`, the Edit-commit path's `notice`, and the
 * recovery panel's failed retry. Every one of those is a single
 * `captureFailureText(...)` wrap, which `tsc` accepts whether or not it is
 * there: `stopError` and `heldRetryError` are `string | null`, and a bare
 * `"silence"` IS a string. So the compiler cannot tell a worded code from an
 * unworded one, and without these cases the three sites are pinned by nothing
 * — a missing wrap paints the raw code at a translator.
 *
 * The three shapes are the ones the QA round on #700 asked to be exercised
 * apart: a zero-byte capture, a stop-flush throw, and a non-empty undecodable
 * capture whose bytes are held. They differ in more than their sentence —
 * whether bytes survive, and whether the exit is the sheet staying open, edit
 * mode, or the recovery panel — so each is driven through its own route rather
 * than asserted on a shared one.
 *
 * Harness: `tests/recorder-stop-commits.test.ts`'s, which is
 * `tests/recorder-superseded-writes.test.ts`'s — the real `Recorder` with the
 * segment and editor hooks mocked at their boundary, so the event wiring and
 * the capture classifier run. `stopRecording` is a fake; whether a real
 * MediaRecorder produces these three outcomes is the on-device question, not
 * this one.
 */
const original = new Int16Array([1, 2, 3, 4]);
const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: original.length,
  samples: original,
};
const boundary = vi.hoisted(() => ({
  editor: {} as SegmentEditor,
  view: null as { samples: Int16Array; lengthSamples: number } | null,
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn(async () => boundary.view),
    setFinished: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/use-segment-editor", () => ({
  useSegmentEditor: () => boundary.editor,
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
  boundary.view = view;
  boundary.editor = {
    working: original,
    workingLength: original.length,
    peaks: null,
    hasEdits: false,
    selection: null,
    selectionActive: false,
    canCut: false,
    canPaste: false,
    canUndo: false,
    canRedo: false,
    error: false,
    openSelection: vi.fn(),
    closeSelection: vi.fn(),
    setSelection: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function setup() {
  const ref = createRef<RecorderHandle>();
  const saveRecording = vi.fn().mockResolvedValue(true);
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
        return { samples: null, blob: null, error: null };
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
          saveEditedSegment: vi.fn().mockResolvedValue(true),
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
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label
    );
  const click = async (label: string) =>
    act(async () => {
      const target = button(label);
      expect(target, label).toBeDefined();
      target!.click();
    });
  await render();
  return { ref, audio, render, button, click, saveRecording, onExit };
}

/**
 * The words, read from the table rather than typed here. Which sentence each
 * code maps to is `tests/capture-failure-copy.test.ts`'s claim; these cases
 * only assert that the mapping is APPLIED on the way to the screen, so
 * repeating the sentence would make a wording edit fail in two places and
 * tempt the next reader to loosen one of them.
 */
const NO_CODE_ON_SCREEN = ["silence", "undecodable", "unfinished"];

/**
 * Neither the raw code nor an empty Notice, whichever way a wrap went missing.
 *
 * Scoped to the `.notice` nodes rather than read off `document.body` (George R2
 * finding 2). A whole-document substring hunt for "silence" / "undecodable" /
 * "unfinished" is the right pin today and a trap tomorrow: a later label that
 * legitimately contains one of those words would fail all three cases at once,
 * and the natural repair is to delete the assertion — the #529 shape, in the
 * direction AGENTS.md warns about. A Notice is also where a missing wrap would
 * actually paint the code, so scoping makes the positive half stronger too: it
 * now proves the sentence reached a Notice, not merely that it is somewhere on
 * the page.
 */
function expectWorded(sentence: string) {
  const notices = [...document.querySelectorAll(".notice")];
  // Floor: an empty list would make the negative assertions below pass by
  // looping over nothing, which is how this case would go quiet if the Notice
  // stopped rendering at all.
  expect(notices.length).toBeGreaterThan(0);
  const text = notices.map((node) => node.textContent ?? "").join(" ");
  expect(text).toContain(sentence);
  for (const code of NO_CODE_ON_SCREEN) expect(text).not.toContain(code);
}

it("a zero-byte capture keeps the sheet open with its sentence, not its code", async () => {
  const s = await setup();
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    // No samples, no bytes: `classifyCapture` reads this as `notice`, and
    // `planClose` as `stay` — the sheet does NOT exit on audio that cannot be
    // recorded again.
    return { samples: null, blob: null, error: "silence" as const };
  });
  s.audio.recorderState = "recording";
  await s.render();

  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(false);
  });
  await s.render();

  expect(s.onExit).not.toHaveBeenCalled();
  expect(s.saveRecording).not.toHaveBeenCalled();
  expectWorded(strings.captureSilence);
});

it("a stop-flush throw reaching the Edit-commit path shows its sentence", async () => {
  // The engine failed to hand the capture over (#485): an empty seal, so the
  // same `notice` verdict as above but a different code and a different route
  // into the component — `onEnterEdit`'s own stop, not `close()`'s.
  const s = await setup();
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: null, blob: null, error: "unfinished" as const };
  });
  s.audio.recorderState = "recording";
  await s.render();

  await s.click(strings.enterEdit);
  await s.render();

  expect(s.onExit).not.toHaveBeenCalled();
  expectWorded(strings.captureUnfinished);
});

it("a held take whose re-decode fails again says so under Try again, and is still held", async () => {
  // The third shape: bytes DID survive, so `classifyCapture` holds them ahead
  // of the error and the stop's own code never reaches a Notice at all — the
  // recovery panel takes the screen instead. The code that gets worded here is
  // the RETRY's, which is the only route `RetryDecodeResult.error` has to a
  // screen.
  const s = await setup();
  const bytes = new Blob(["kept"]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: null, blob: bytes, error: "undecodable" as const };
  });
  s.audio.retryDecode = vi
    .fn()
    .mockResolvedValue({ samples: null, error: "undecodable" as const });
  s.audio.recorderState = "recording";
  await s.render();

  await s.click(strings.stop);
  await s.render();
  // The panel is up and the bytes are the take's only copy.
  expect(s.button(strings.takeRecoverRetry)).toBeDefined();

  await s.click(strings.takeRecoverRetry);
  await s.render();

  expectWorded(strings.captureUndecodable);
  // A failed retry NEVER drops the held take (#165, George R3 G-1): the panel
  // stays, with Try again and the share/discard exits still on it.
  expect(s.button(strings.takeRecoverRetry)).toBeDefined();
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.onExit).not.toHaveBeenCalled();
});
