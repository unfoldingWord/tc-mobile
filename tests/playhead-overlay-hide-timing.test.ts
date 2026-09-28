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
