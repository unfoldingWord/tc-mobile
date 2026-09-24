// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useRecorderViewport,
  type RecorderViewport,
} from "@/hooks/use-recorder-viewport";

/**
 * The recorder's viewport (#160, L-1) — specifically its WIRING.
 *
 * `effectivePan` and `viewportWindow` are pure and already table-tested in
 * `lib/audio/viewport`. What was never checked is that the component's two
 * outputs are wired to the right ones: #346's P1 was exactly a wiring mistake —
 * a zoom's re-centred view pan reaching the record path — and reintroducing it
 * at the setter left the whole suite green.
 *
 * So these assert the divergence itself: with a zoom pan open in edit mode,
 * `pan` (drawn) and `insertionPan` (spliced at) must not be the same number.
 * That is the one claim the pure tests cannot make, because neither function
 * knows what the other is for.
 */

const CENTER = 0.5;
const LENGTH = 1000;
/** The caller's zoom-out level. `recorder.tsx` passes its own `ZOOM_WHOLE`. */
const WHOLE = 1;

let root: Root;
let host: HTMLDivElement;
let api: RecorderViewport;

function mount(
  mode: "record" | "edit",
  selectionActive: boolean,
  initialZoom = WHOLE
) {
  function Harness() {
    const vp = useRecorderViewport(
      mode,
      selectionActive,
      LENGTH,
      CENTER,
      initialZoom
    );
    useEffect(() => {
      api = vp;
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useRecorderViewport", () => {
  it("rests at the end of the buffer with nothing set (F7, append-ready)", () => {
    // The rest is observed through what the hook ANSWERS, not through the raw
    // offset — which it deliberately does not return. Both answers are the
    // buffer end, which is what "append-ready" means.
    mount("record", false);
    expect(api.pan).toBe(LENGTH);
    expect(api.insertionPan).toBe(LENGTH);
  });

  it("returns no raw offset to read — only the setter, `pan` and `insertionPan`", () => {
    // The boundary itself, asserted rather than asserted-about. #346's P1 was
    // one value serving as both the view and the record point; a consumer that
    // cannot reach the raw offset cannot reintroduce it by reading the wrong
    // one. The compile-time half is in the PR (a `vp.panState` read is TS2339);
    // this is the runtime half, so the field cannot come back unnoticed.
    mount("record", false);
    expect(Object.keys(api).sort()).toEqual([
      "insertionPan",
      "pan",
      "setPanState",
      "setZoom",
      "setZoomPan",
      "win",
      "windowAt",
      "zoom",
      "zoomPan",
    ]);
  });

  it("draws and splices at the same place once a drag sets the pan", () => {
    mount("record", false);
    act(() => api.setPanState(400));
    expect(api.pan).toBe(400);
    expect(api.insertionPan).toBe(400);
  });

  it("SPLITS the two when a zoom re-centres an open selection (#346)", () => {
    // The defect this separation exists to prevent, asserted as a difference
    // rather than as prose: the view moves, the splice point does not. With
    // one value for both, the next recording would land at 250 — mid-clip —
    // instead of appending at the drag's 400.
    mount("edit", true);
    act(() => {
      api.setPanState(400);
      api.setZoomPan(250);
    });

    expect(api.pan).toBe(250); // drawn where the zoom put the view
    expect(api.insertionPan).toBe(400); // spliced where the translator left it
  });

  it("ignores a zoom pan in RECORD mode, where there is no selection to keep", () => {
    mount("record", false);
    act(() => {
      api.setPanState(400);
      api.setZoomPan(250);
    });
    expect(api.pan).toBe(400);
    expect(api.insertionPan).toBe(400);
  });

  it("ignores a zoom pan in edit mode with NO selection open", () => {
    mount("edit", false);
    act(() => {
      api.setPanState(400);
      api.setZoomPan(250);
    });
    expect(api.pan).toBe(400);
  });

  it("clamps a pan past the end of a shortened buffer", () => {
    // What a cut does: `working` gets shorter than an older `panState`. The
    // clamp is upper-only, so the rest position follows the new end.
    mount("record", false);
    act(() => api.setPanState(LENGTH + 500));
    expect(api.pan).toBe(LENGTH);
    expect(api.insertionPan).toBe(LENGTH);
  });

  it("opens at the zoom its CALLER names, not a level of its own", () => {
    // The initial zoom is an argument because `ZOOM_WHOLE` lives in
    // `components/` and `hooks/` may not import it (the onion). A literal here
    // would be a second copy with no link to the first: the caller's zoom-out
    // control writes `ZOOM_WHOLE`, so if that constant moved, a fresh open and
    // every later zoom-to-whole would disagree, and neither would look wrong
    // on its own. This pins that the argument is what the hook opens at.
    mount("record", false, 4);
    expect(api.zoom).toBe(4);
    expect(api.win.visibleSamples).toBe(LENGTH / 4);
  });

  it("narrows the window as the zoom goes in, around the drawn pan", () => {
    mount("record", false);
    act(() => api.setPanState(500));
    expect(api.win.visibleSamples).toBe(LENGTH);

    act(() => api.setZoom(4));
    expect(api.win.visibleSamples).toBe(LENGTH / 4);
    expect(api.win.centerlineSample).toBe(500);
  });

  it("answers for a pan it is not currently at, at the current zoom", () => {
    // `windowAt` is what seeds a selection from the INSERTION pan while the
    // view sits somewhere else — so it must read the zoom, not the pan.
    mount("edit", true);
    act(() => {
      api.setPanState(400);
      api.setZoomPan(250);
      api.setZoom(4);
    });
    expect(api.win.centerlineSample).toBe(250);
    expect(api.windowAt(api.insertionPan).centerlineSample).toBe(400);
    expect(api.windowAt(api.insertionPan).visibleSamples).toBe(LENGTH / 4);
  });
});
