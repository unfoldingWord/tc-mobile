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
 * The tap that ends a recording commits it, in place (#614, Option A).
 *
 * This is the behaviour the requirements owner decided on 2026-09-22, and it is
 * the one thing about #614 that no pure module can answer: `panGesture` and
 * `liveScopeShown` can only say what the stage does once the take is committed,
 * not that the second Record tap is what commits it. Before this, that tap was
 * `audio.pauseRecording()` and the splice happened on Back or on entering edit.
 *
 * The harness is `tests/recorder-superseded-writes.test.ts`'s: the real
 * `Recorder`, with the segment and editor hooks mocked at their boundary, so the
 * event wiring, the capture classifier and the persistence call all run. What it
 * cannot reach is the audio hook graph itself — `stopRecording` is a fake, and
 * whether a real MediaRecorder hands back the take is the on-device question,
 * not this one.
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
/**
 * The segment as the sheet sees it, and what a reload hands back next.
 *
 * A commit RE-READS the segment before it does anything else with it, so a case
 * about what happens after a take lands has to be able to say what landed.
 * `reloads` is a queue the real store's growth stands in for: arm it with the
 * post-splice view and the commit sees the segment it just wrote, exactly as it
 * would against IndexedDB. Empty (every case but the last) it is inert and the
 * sheet re-reads the same view.
 */
const boundary = vi.hoisted(() => ({
  editor: {} as SegmentEditor,
  view: null as { samples: Int16Array; lengthSamples: number } | null,
  reloads: [] as Array<{ samples: Int16Array; lengthSamples: number }>,
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn(async () => {
      boundary.view = boundary.reloads.shift() ?? boundary.view;
      return boundary.view;
    }),
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
  boundary.reloads = [];
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

it("the tap that ends a recording splices the take into the segment", async () => {
  const s = await setup();
  s.audio.recorderState = "recording";
  await s.render();

  // The control names the act. It read "Pause" until #614, over a tap that did
  // not end the take; a translator who cannot read has only the glyph and the
  // spoken name, so both had to move with the behaviour.
  await s.click(strings.stop);

  expect(s.audio.stopRecording).toHaveBeenCalledOnce();
  // Spliced at the locked insertion offset, into the WORKING buffer, with the
  // draft mark a plain re-record defaults to. This is the whole of the fix: on
  // the pre-#614 tree this tap called `pauseRecording` and nothing was saved
  // until Back or an Edit entry.
  expect(s.saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    captured,
    0,
    false
  );
});

it("stays in the sheet, in record mode, on the committed audio", async () => {
  const s = await setup();
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.stop);
  await s.render();

  // NOT an exit: a Stop is not a Back. Before #614 the only way to commit was
  // to leave (or to enter edit), which is what made "scroll the take you just
  // recorded" impossible — the reported bug.
  expect(s.onExit).not.toHaveBeenCalled();
  // NOT edit mode either: `commitTake("stay")` and `commitTake("edit")` share
  // one path, and passing the wrong one here would open the edit toolbar on a
  // plain Stop. The pill is the mode marker a sighted non-reader has (D2).
  expect(document.body.textContent).not.toContain(strings.modepillEditing);
  // Back at idle: the control is Record again, ready to append at the line.
  expect(s.button(strings.record)).toBeDefined();
  expect(s.button(strings.stop)).toBeUndefined();
});

it("commits a take the mic was taken from, with no tap at all (#59)", async () => {
  const s = await setup();
  // `use-recorder` freezes an interrupted take at `processing` with its chunks
  // intact. That used to sit there until Back — a second uncommitted-take
  // state, reachable without touching any control. It commits through the same
  // path now, so an interruption and a Stop leave the same segment behind.
  s.audio.recorderState = "processing";
  await s.render();

  expect(s.audio.stopRecording).toHaveBeenCalledOnce();
  expect(s.saveRecording).toHaveBeenCalledWith(
    "segment",
    original,
    captured,
    0,
    false
  );
  expect(s.onExit).not.toHaveBeenCalled();
});

it("does not re-commit a take that a Back is already committing", async () => {
  const s = await setup();
  s.audio.recorderState = "recording";
  await s.render();

  // Back and the interruption effect read the same `closing.current` latch. A
  // `processing` that a commit is already inside must not start a second one:
  // the second `stopRecording` would return nothing and the take's samples
  // would be spliced twice or lost, depending on which resolved last.
  await act(async () => {
    const closed = s.ref.current!.requestClose();
    s.audio.recorderState = "processing";
    await closed;
  });
  await s.render();

  expect(s.audio.stopRecording).toHaveBeenCalledOnce();
  expect(s.saveRecording).toHaveBeenCalledOnce();
});

it("leaves the line at the end of the take, so the next Record appends", async () => {
  // The condition the requirements owner attached to Option A: "append by
  // moving the playhead to the end and hitting Record again". With the sheet no
  // longer closing between takes, SOMETHING has to place the line, and this is
  // the end-to-end version of `panAfterCommit`'s own table — not where the pan
  // state went, but where the NEXT take actually splices.
  const s = await setup();
  // What the segment looks like once take 1 lands: the 4-sample clip with the
  // 3-sample capture appended at its end (the sheet opens at the F7 rest).
  const grown = new Int16Array([...original, ...captured]);
  boundary.reloads = [{ samples: grown, lengthSamples: grown.length }];

  // Take 1, started by a real Record tap so the insertion offset is locked the
  // way it is in the app — at the line, which rests at the end.
  await s.click(strings.record);
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.stop);
  await s.render();
  expect(s.saveRecording).toHaveBeenLastCalledWith(
    "segment",
    original,
    captured,
    original.length,
    false
  );

  // `useSegmentEditor` rebases on the committed samples; the mock is told to do
  // the same, so the second take's splice base is the grown buffer.
  boundary.editor = {
    ...boundary.editor,
    working: grown,
    workingLength: grown.length,
  };
  await s.render();

  // Take 2, with NO drag in between — that is the whole claim.
  await s.click(strings.record);
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.stop);

  // Offset 7: the end of the 7-sample clip, i.e. an APPEND after take 1 rather
  // than an insert in front of it. Two mutations die here and nowhere else —
  // leaving the pan at the offset take 1 started from (the second take then
  // splices at 4, BEFORE take 1's audio), and not writing the pan at all.
  expect(s.saveRecording).toHaveBeenLastCalledWith(
    "segment",
    grown,
    captured,
    grown.length,
    false
  );
});

it("a Stop whose decode failed stays in place when Try again succeeds", async () => {
  // Frank R1 P2. The recovery panel's retry used to read ONE boolean, "was this
  // an Edit-entry commit?", and treat every false as a Back — so a Stop whose
  // first decode failed, recovered by Try again, exited to Segments. Stop is not
  // a Back: the take it recovers belongs to the segment the translator is still
  // in. The destination now has three answers, and this is the one the boolean
  // could not express.
  const s = await setup();
  const grown = new Int16Array([...original, ...captured]);
  boundary.reloads = [{ samples: grown, lengthSamples: grown.length }];

  // The first decode fails but the container bytes survive — the #165 "hold"
  // verdict, the take's only copy.
  const bytes = new Blob(["kept"]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: null, blob: bytes, error: null };
  });
  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.stop);
  await s.render();

  // The panel owns the body; nothing has been saved and nothing has exited.
  expect(s.saveRecording).not.toHaveBeenCalled();
  expect(s.onExit).not.toHaveBeenCalled();

  s.audio.retryDecode = vi
    .fn()
    .mockResolvedValue({ samples: captured, error: null });
  await s.click(strings.takeRecoverRetry);
  await s.render();

  expect(s.saveRecording).toHaveBeenCalledOnce();
  // The whole point: still here, still in record mode, with the panel gone.
  expect(s.onExit).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(strings.modepillEditing);
  expect(s.button(strings.record)).toBeDefined();
});

it("an Edit-entry recovery still reaches edit mode, and a Back's still exits", async () => {
  // The other two destinations, so the three-way discriminator is pinned in
  // every arm rather than only the new one. Same held-bytes shape as above.
  const s = await setup();
  boundary.reloads = [{ samples: original, lengthSamples: original.length }];
  const bytes = new Blob(["kept"]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: null, blob: bytes, error: null };
  });
  s.audio.retryDecode = vi
    .fn()
    .mockResolvedValue({ samples: captured, error: null });

  s.audio.recorderState = "recording";
  await s.render();
  await s.click(strings.enterEdit);
  await s.render();
  await s.click(strings.takeRecoverRetry);
  await s.render();

  expect(s.onExit).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(strings.modepillEditing);
});

it("a Back's recovery exits to Segments, unchanged", async () => {
  const s = await setup();
  const bytes = new Blob(["kept"]);
  s.audio.stopRecording = vi.fn(async () => {
    s.audio.recorderState = "idle";
    return { samples: null, blob: bytes, error: null };
  });
  s.audio.retryDecode = vi
    .fn()
    .mockResolvedValue({ samples: captured, error: null });

  s.audio.recorderState = "recording";
  await s.render();
  await act(async () => {
    expect(await s.ref.current!.requestClose()).toBe(false);
  });
  await s.render();
  await s.click(strings.takeRecoverRetry);
  await s.render();

  expect(s.onExit).toHaveBeenCalledOnce();
});
