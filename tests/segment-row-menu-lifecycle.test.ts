import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentRow } from "@/components/segment-row";
import { strings } from "@/lib/strings";
import type { SegmentRow as Row } from "@/types/view";
import type { SegmentId, ClipId } from "@/types/domain";

let dom: JSDOM;
let root: Root;
let mounted: boolean;
const recorded: Row = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  hasClip: true,
  finished: false,
  clipId: "clip" as ClipId,
  peaks: null,
  durationMs: 1000,
};
const empty: Row = {
  ...recorded,
  hasClip: false,
  clipId: null,
  durationMs: null,
};
const onMenuOpen = vi.fn();
const onMenuClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  // Canvas pixels are outside this menu/layer lifecycle regression.
  vi.spyOn(
    dom.window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockReturnValue(null);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
async function render(row: Row, close = onMenuClose) {
  await act(async () => {
    root.render(
      createElement(SegmentRow, {
        row,
        playing: false,
        playbackElapsedMs: 0,
        onPlay: vi.fn(),
        onOpenRecorder: vi.fn(),
        onSetFinished: vi.fn(),
        onErase: vi.fn(),
        onMenuOpen,
        onMenuClose: close,
      })
    );
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === label
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("releases an open menu when the same row loses its clip, using the committed callback", async () => {
  await render(recorded);
  await click(strings.segmentMenu(1));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(onMenuOpen).toHaveBeenCalledTimes(1);
  const currentClose = vi.fn();
  await render(empty, currentClose);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(currentClose).toHaveBeenCalledTimes(1);
  expect(onMenuClose).not.toHaveBeenCalled();
  await render(empty, currentClose);
  await render(recorded, currentClose);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount());
  mounted = false;
  expect(currentClose).toHaveBeenCalledTimes(1);
});
it("does not report a close for an initially empty or already closed row", async () => {
  await render(empty);
  await render(recorded);
  await render(empty);
  expect(onMenuClose).not.toHaveBeenCalled();
});
it("does not release or re-register an open menu on callback changes, but releases it on unmount", async () => {
  await render(recorded);
  await click(strings.segmentMenu(1));
  const currentClose = vi.fn();
  await render(recorded, currentClose);
  expect(currentClose).not.toHaveBeenCalled();
  expect(onMenuOpen).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  mounted = false;
  expect(currentClose).toHaveBeenCalledTimes(1);
  expect(onMenuClose).not.toHaveBeenCalled();
});
it("does not report a second close when a dismissed menu loses its clip", async () => {
  await render(recorded);
  await click(strings.segmentMenu(1));
  await click(strings.menuClose);
  expect(onMenuClose).toHaveBeenCalledTimes(1);
  await render(empty);
  expect(onMenuClose).toHaveBeenCalledTimes(1);
});
