import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EraseConfirm } from "@/components/erase-confirm";
import type { Peaks } from "@/types/audio";
import { render } from "./render";
import { Icon, type IconName } from "@/components/icon";

/**
 * EraseConfirm's `preview` prop (#979, the "Play what will be lost" row —
 * the O4 13/G5 remainder left after #1022 built the badge and button).
 *
 * The workbench's `vConfirm()` draws a waveform-and-transport row between
 * the title and the two buttons; the row is entirely absent for a caller
 * that passes no `preview`, which is every existing caller today (the book
 * Delete, the failure log's Clear, and the recorder's own record-again call
 * site — see the prop's own docblock in `erase-confirm.tsx` for why the
 * last one is not wired yet).
 *
 * Mounted with `createRoot` in a jsdom window, not `tests/render.ts`: the
 * dialog portals to `<body>`, which `renderToStaticMarkup` cannot render —
 * the same reason `erase-confirm-glyph.test.ts` does the same. `render.ts`
 * is still what draws the reference `Icon` markup the assertions compare
 * against.
 */

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" }
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no canvas 2D context; `Waveform`'s draw effect already bails
  // out on a null context (its own early return), so this just silences the
  // "not implemented" noise rather than standing in for a real draw.
  vi.spyOn(
    dom.window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockReturnValue(null);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

/** The inner markup the `Icon` component draws for `name`. */
function iconInner(name: IconName): string {
  const svg = render(createElement(Icon, { name })).querySelector("svg");
  expect(svg, name).not.toBeNull();
  return svg!.innerHTML;
}

const base = {
  open: true,
  title: "Erase this recording?",
  confirmLabel: "Erase",
  cancelLabel: "Cancel",
  onConfirm: () => {},
  onCancel: () => {},
};

const peaks: Peaks = {
  min: new Float32Array([-0.4]),
  max: new Float32Array([0.4]),
  samplesPerBucket: 100,
};

function mountBare() {
  return act(async () => {
    root.render(createElement(EraseConfirm, base));
  });
}

async function mountWithPreview(
  extra: {
    peaks?: Peaks | null;
    playing?: boolean;
    onTogglePlay?: () => void;
  } = {}
) {
  await act(async () => {
    root.render(
      createElement(EraseConfirm, {
        ...base,
        preview: {
          // `extra.peaks` is deliberately checked for `undefined`, not `??`:
          // a case passing `{ peaks: null }` means "no take to preview", and
          // `??` would collapse that back to the fixture (its own trap —
          // caught here, not in the component, when this suite was first run
          // red).
          peaks: extra.peaks === undefined ? peaks : extra.peaks,
          playing: extra.playing ?? false,
          onTogglePlay: extra.onTogglePlay ?? (() => {}),
          playLabel: "Play what will be lost",
          pauseLabel: "Pause",
        },
      })
    );
  });
  const panel = document.querySelector(".confirm-panel");
  expect(panel, "the dialog is up").not.toBeNull();
  return panel!;
}

describe("EraseConfirm's preview row (#979)", () => {
  it("renders no preview row when the caller passes none — every existing caller", async () => {
    await mountBare();
    expect(document.querySelector(".confirm-preview")).toBeNull();
  });

  it("renders the row when the caller passes preview, with the idle Play control", async () => {
    const panel = await mountWithPreview({ playing: false });
    const row = panel.querySelector(".confirm-preview");
    expect(row).not.toBeNull();
    const play = row!.querySelector<HTMLButtonElement>(".confirm-preview-play");
    expect(play).not.toBeNull();
    expect(play!.getAttribute("aria-label")).toBe("Play what will be lost");
    expect(play!.querySelector("svg")!.innerHTML).toBe(iconInner("play"));
    expect(play!.disabled).toBe(false);
  });

  it("swaps to the pause icon and label while the preview is sounding", async () => {
    const panel = await mountWithPreview({ playing: true });
    const play = panel.querySelector<HTMLButtonElement>(
      ".confirm-preview-play"
    );
    expect(play!.getAttribute("aria-label")).toBe("Pause");
    expect(play!.querySelector("svg")!.innerHTML).toBe(iconInner("pause"));
  });

  it("disables Play when there is nothing to preview", async () => {
    const panel = await mountWithPreview({ peaks: null });
    const play = panel.querySelector<HTMLButtonElement>(
      ".confirm-preview-play"
    );
    expect(play!.disabled).toBe(true);
  });

  it("calls the caller's onTogglePlay when Play is tapped, and nothing else", async () => {
    const onTogglePlay = vi.fn();
    const panel = await mountWithPreview({ onTogglePlay });
    const play = panel.querySelector<HTMLButtonElement>(
      ".confirm-preview-play"
    );
    await act(async () => play!.click());
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("leaves Cancel/Erase and focus landing exactly as the no-preview case, with preview present", async () => {
    const panel = await mountWithPreview();
    const cancel = panel.querySelector<HTMLButtonElement>(".confirm-cancel");
    expect(document.activeElement).toBe(cancel);
    const buttons = [...panel.querySelectorAll("button")];
    // Cancel, the new Play control, then Erase — three now that preview is
    // present; this pins the count so a future change to the row cannot
    // silently add or drop a focusable control without a test noticing.
    expect(buttons).toHaveLength(3);
  });
});
