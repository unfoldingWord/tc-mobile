import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentRow } from "@/components/segment-row";
import { strings } from "@/lib/strings";
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
  label: null,
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
        onRename: vi.fn(),
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

/**
 * #606 / #601: #618 rests the dot at the start after a run-out, but the dot
 * can still reach the end by other paths, and a Play from there starts a
 * source with no audio behind it: a silent Play, and the start #606's
 * reporter tied a shriek to (not confirmed as its cause). So a Play with the
 * dot at, or within a sliver of, the end sounds the take from the start.
 */
async function pressKey(key: string) {
  const slider = document.querySelector('[role="slider"]');
  expect(slider).not.toBeNull();
  await act(async () => {
    slider!.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true })
    );
  });
}

it("plays from the start when the dot has been moved to the very end (#606)", async () => {
  await show(false, 0);
  for (let i = 0; i < 20; i++) await pressKey("ArrowRight");

  expect(dotPercent()).toBe(100);
  await tapPlay();
  expect(onPlay).toHaveBeenCalledWith(0);
});

it("plays from the start when a hand stop left the dot within a sliver of the end (#606)", async () => {
  await show(false, 0);
  await show(true, 0);
  // A Stop that lands on the last elapsed tick, before `onEnded` reports a
  // run-out, is a hand stop: the dot rests where it reached.
  await show(true, 970);
  await show(false, 0);

  expect(dotPercent()).toBe(97);
  await tapPlay();
  expect(onPlay).toHaveBeenCalledWith(0);
});

it("still plays on from a rest short of the tail window (#606)", async () => {
  await show(false, 0);
  await show(true, 0);
  await show(true, 800);
  await show(false, 0);

  expect(dotPercent()).toBe(80);
  await tapPlay();
  expect(onPlay).toHaveBeenCalledWith(0.8);
});
