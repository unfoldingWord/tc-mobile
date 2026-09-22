import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentRow } from "@/components/segment-row";
import { strings } from "@/components/strings";
import type { SegmentRow as Row } from "@/types/view";
import type { SegmentId, ClipId } from "@/types/domain";

/**
 * Where the row's scrub dot rests once a take stops sounding, and what offset
 * the next Play therefore asks for (#601).
 *
 * The two endings are not the same fact. A hand stop is a place the translator
 * chose, so the dot stays there and Play resumes from it. A take that RAN OUT
 * chose nothing — resting at the end leaves an offset with no audio behind it,
 * so every further Play is a silent no-op until the dot is dragged back.
 *
 * `playTake`'s `onEnded` fires on a run-out and never on a hand stop
 * (`hooks/audio-io.ts` sets `stopped` before `source.stop()`), which is why the
 * session can tell the row which one happened and the row cannot work it out
 * alone: both arrive here as `playing` going false.
 *
 * Scope: this mounts the row and hands it the prop the screen passes. That the
 * SESSION sets that prop only on `onEnded` is not reached from here —
 * `useAudioSession` mounts the recorder, so it needs a microphone and an
 * AudioContext — and nothing else in `tests/` covers it either.
 */

let dom: JSDOM;
let root: Root;
const onPlay = vi.fn();
const row: Row = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  hasClip: true,
  finished: false,
  clipId: "clip" as ClipId,
  peaks: null,
  durationMs: 1000,
};

beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  // Canvas pixels are outside this scrub-position regression.
  vi.spyOn(
    dom.window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockReturnValue(null);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

/** One commit of the row, as the Segments screen would hand it over. */
async function show(
  playing: boolean,
  playbackElapsedMs: number,
  ranOut = false
) {
  await act(async () => {
    root.render(
      createElement(SegmentRow, {
        row,
        playing,
        playbackElapsedMs,
        ranOut,
        onPlay,
        onOpenRecorder: vi.fn(),
        onSetFinished: vi.fn(),
        onErase: vi.fn(),
      })
    );
  });
}

/** The dot's resting place, as the slider reports it: 0–100. */
function dotPercent(): number {
  const slider = document.querySelector('[role="slider"]');
  expect(slider).not.toBeNull();
  return Number(slider!.getAttribute("aria-valuenow"));
}

async function tapPlay() {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === strings.playSegment(row.ordinal)
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("rests the dot at the start when the take runs out, so the next Play sounds it again", async () => {
  await show(false, 0);
  await show(true, 0);
  // The dot is pushed on a ~60 ms interval, so the last elapsed a run-out
  // reports is a tick short of the duration, never exactly it.
  await show(true, 970);
  // The session clears its elapsed as it reports the end (`setPlaying(null)`).
  await show(false, 0, true);

  expect(dotPercent()).toBe(0);
  await tapPlay();
  expect(onPlay).toHaveBeenCalledWith(0);
});

it("leaves the dot where a hand stop reached, and plays on from there", async () => {
  await show(false, 0);
  await show(true, 0);
  await show(true, 500);
  await show(false, 0);

  expect(dotPercent()).toBe(50);
  await tapPlay();
  expect(onPlay).toHaveBeenCalledWith(0.5);
});
