// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlayheadOverlay } from "@/components/playhead-overlay";

/**
 * #377. When `active` goes false, `PlayheadOverlay` must hide its line in the
 * layout phase of that same commit — the phase `LiveScope` paints its canvas
 * in (`src/components/live-scope.tsx`, `useLayoutEffect`) — rather than in a
 * passive effect. React documents `useLayoutEffect` as firing before the
 * browser repaints (https://react.dev/reference/react/useLayoutEffect), and
 * `useEffect` as possibly running after the paint
 * (https://react.dev/reference/react/useEffect).
 *
 * This is a defensive invariant for a reviewer-diagnosed paint-order seam
 * (Resume during an append's preview), not a reproduction of it: both the
 * `active` flip and the observation point are built inside this test, so it
 * pins the component's contract and guards no caller. The observation point
 * is the harness parent's own `useLayoutEffect` — a read taken in the layout
 * phase of the commit that flips `active`.
 */

let root: Root;
let container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
const cancelled: number[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextId = 1;
  cancelled.length = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelled.push(id);
    frames.delete(id);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Run every pending frame once (each tick re-registers the next). */
function runFrames() {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(0);
}

function line(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  if (!el) throw new Error("PlayheadOverlay rendered no line");
  return el;
}

/** Opacity as read at the harness's layout phase, one entry per commit. */
const atLayout: string[] = [];

function Harness({ active }: { active: boolean }) {
  useLayoutEffect(() => {
    atLayout.push(line().style.opacity);
  }, [active]);
  return createElement(PlayheadOverlay, {
    readElapsedMs: () => 500,
    active,
    durationMs: 1000,
    startFraction: 0,
    endFraction: 1,
  });
}

it("hides the line in the same commit's layout phase that sets active=false", () => {
  atLayout.length = 0;
  act(() => root.render(createElement(Harness, { active: true })));
  act(() => runFrames());
  // Precondition: the line is up and positioned while sounding.
  expect(line().style.opacity).toBe("1");

  act(() => root.render(createElement(Harness, { active: false })));

  // Two commits observed: the mount (before any frame ran) and the flip.
  expect(atLayout).toHaveLength(2);
  expect(atLayout[1]).toBe("0");
  expect(line().style.opacity).toBe("0");
});

it("cancels the running frame loop when active goes false, so no later tick shows it again", () => {
  act(() => root.render(createElement(Harness, { active: true })));
  act(() => runFrames());
  const running = [...frames.keys()];
  expect(running).toHaveLength(1);

  act(() => root.render(createElement(Harness, { active: false })));

  expect(cancelled).toEqual(running);
  expect(frames.size).toBe(0);
  expect(line().style.opacity).toBe("0");
});

/**
 * #954 residue item 2 (named on PR #1781). A hidden line must not keep the
 * last frame's `left`: that position came from the audio clock, so where a
 * hidden line rested depended on when the last frame fell, and the style-diff
 * self-compare read it as a difference between two runs of the same build.
 * The hidden state is the never-played state — no inline `left` at all — so
 * it is the same in every run and the same as before the first Play.
 */
function Positioned({
  active,
  read,
  startFraction = 0,
  endFraction = 1,
}: {
  active: boolean;
  read: () => number | null;
  startFraction?: number;
  endFraction?: number;
}) {
  return createElement(PlayheadOverlay, {
    readElapsedMs: read,
    active,
    durationMs: 1000,
    startFraction,
    endFraction,
  });
}

it("drops the last frame's left when active goes false", () => {
  const read = () => 437;
  act(() => root.render(createElement(Positioned, { active: true, read })));
  act(() => runFrames());
  // Precondition: the line was placed by a frame.
  expect(line().style.left).not.toBe("");
  expect(line().style.opacity).toBe("1");

  act(() => root.render(createElement(Positioned, { active: false, read })));

  expect(line().style.opacity).toBe("0");
  expect(line().style.left).toBe("");
});

it("drops the left on the null hide sentinel, before active goes false", () => {
  let ms: number | null = 437;
  const read = () => ms;
  act(() => root.render(createElement(Positioned, { active: true, read })));
  act(() => runFrames());
  expect(line().style.left).not.toBe("");

  ms = null;
  act(() => runFrames());

  expect(line().style.opacity).toBe("0");
  expect(line().style.left).toBe("");
});

it("drops the left when the position leaves a swapped view", () => {
  let ms = 500;
  const read = () => ms;
  // View 0.4–0.6: 500 ms of 1000 is on screen, 900 ms is past its right edge.
  act(() =>
    root.render(
      createElement(Positioned, {
        active: true,
        read,
        startFraction: 0.4,
        endFraction: 0.6,
      })
    )
  );
  act(() => runFrames());
  expect(line().style.opacity).toBe("1");
  expect(line().style.left).not.toBe("");

  ms = 900;
  act(() => runFrames());

  expect(line().style.opacity).toBe("0");
  expect(line().style.left).toBe("");
});

it("a new audition places the line before it shows it, from the hidden state", () => {
  let ms = 437;
  const read = () => ms;
  act(() => root.render(createElement(Positioned, { active: true, read })));
  act(() => runFrames());
  act(() => root.render(createElement(Positioned, { active: false, read })));

  ms = 120;
  act(() => root.render(createElement(Positioned, { active: true, read })));
  // Before the first frame of the new audition: still hidden, no position.
  expect(line().style.opacity).toBe("0");
  expect(line().style.left).toBe("");

  act(() => runFrames());
  expect(line().style.opacity).toBe("1");
  expect(line().style.left).toBe("min(12%, 100% - 2px)");
});
