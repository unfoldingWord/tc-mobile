// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveScope } from "@/components/live-scope";
import type { CaptureContext, ContextSide } from "@/lib/audio/capture-context";
import type { CaptureScope } from "@/lib/audio/capture-peaks";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";

/**
 * #1189: the bars `LiveScope` paints while an APPEND records are drawn at the
 * committed clip's display gain — the factor the idle `Waveform` drew that
 * clip at a tap earlier — so tapping Record does not shrink the audio already
 * there, and the new audio is drawn on the same scale beside it. A first take
 * (no context) stays at absolute level (#359).
 *
 * Mounts the real component and reads the paint through a recording 2D
 * context: the layout-phase peek paint is what this observes, so no frame of
 * the rAF loop has to run. jsdom lays nothing out, so the canvas's css size is
 * stubbed.
 */

const W = 400;
const H = 200;
const MID = H / 2;

interface Rect {
  style: string;
  h: number;
}

let root: Root;
let container: HTMLDivElement;
let rects: Rect[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  rects = [];
  const fake = {
    fillStyle: "",
    setTransform() {},
    clearRect() {},
    fillRect(_x: number, _y: number, _w: number, h: number) {
      rects.push({ style: String(fake.fillStyle), h });
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    fake as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(W);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(H);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A quiet level, the #358 Moto G shape: every column peaks at ±`level`. */
const LEVEL = 0.05;
/** The display gain a clip peaking at `LEVEL` is fitted to (0.9 / 0.05). */
const FITTED = 18;

function scope(): CaptureScope {
  // Four columns, the last two real.
  return {
    min: Float32Array.of(0, 0, -LEVEL, -LEVEL),
    max: Float32Array.of(0, 0, LEVEL, LEVEL),
    count: 2,
  };
}

function side(): ContextSide {
  return {
    min: Float32Array.of(-LEVEL, -LEVEL),
    max: Float32Array.of(LEVEL, LEVEL),
    count: 2,
  };
}

/** One fine bucket per column at the scope's nominal 60 Hz prior. */
function context(gain: number): CaptureContext {
  return {
    before: side(),
    after: side(),
    samplesPerBucket: CANONICAL_SAMPLE_RATE / 60,
    gain,
  };
}

/** Heights of the audio bars painted, in paint order (the head is excluded). */
function barHeights(ctx: CaptureContext | null): number[] {
  act(() =>
    root.render(
      createElement(LiveScope, {
        readScope: scope,
        peekScope: scope,
        active: true,
        context: ctx,
        label: "live",
      })
    )
  );
  // The record head is the last rect, full height, in the record colour.
  const head = rects.at(-1)!;
  expect(head.h).toBe(H);
  return rects.filter((r) => r.style !== head.style).map((r) => r.h);
}

describe("LiveScope draws an append on the committed clip's scale (#1189)", () => {
  it("scales the existing clip AND the new audio by the context's gain", () => {
    const heights = barHeights(context(FITTED));
    // 2 before + 2 after + 2 ring columns.
    expect(heights).toHaveLength(6);
    for (const h of heights) expect(h).toBeCloseTo(2 * LEVEL * FITTED * MID, 3);
  });

  it("keeps a first take (no context) at absolute level", () => {
    const heights = barHeights(null);
    expect(heights).toHaveLength(2);
    for (const h of heights) expect(h).toBeCloseTo(2 * LEVEL * MID, 3);
  });

  it("clamps a new take louder than the fit to the canvas", () => {
    const loud: CaptureScope = {
      min: Float32Array.of(0, 0, -0.5, -0.5),
      max: Float32Array.of(0, 0, 0.5, 0.5),
      count: 2,
    };
    act(() =>
      root.render(
        createElement(LiveScope, {
          readScope: () => loud,
          peekScope: () => loud,
          active: true,
          context: context(FITTED),
          label: "live",
        })
      )
    );
    const head = rects.at(-1)!;
    const ring = rects.filter((r) => r.style !== head.style).slice(-2);
    for (const r of ring) expect(r.h).toBeCloseTo(H, 3);
  });
});
