import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentRow } from "@/components/segment-row";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { SegmentRow as Row } from "@/types/view";
import type { SegmentId, ClipId } from "@/types/domain";

/**
 * The row menu's Edit opens the recorder IN EDIT MODE (#286 item 2): it passes
 * `"edit"` to `onOpenRecorder`, and every other way the row opens the sheet
 * passes nothing, so those still open it in record mode. What the sheet does
 * with `"edit"` is `e2e/recorder-open-in-edit.spec.ts`'s half.
 *
 * Both looks, because each draws its own Edit (the O4 tile, the current
 * look's menu row). The design is picked by mocking `useDesign()`, as
 * `tests/o4-menus-chapter-segment.test.ts` does.
 */
const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

let dom: JSDOM;
let root: Root;
const recorded: Row = {
  segmentId: "segment" as SegmentId,
  ordinal: 1,
  label: null,
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
const onOpenRecorder = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  // Canvas pixels are outside what this pins.
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

async function render(row: Row) {
  await act(async () => {
    root.render(
      createElement(SegmentRow, {
        row,
        playing: false,
        playbackElapsedMs: 0,
        onPlay: vi.fn(),
        onOpenRecorder,
        onSetFinished: vi.fn(),
        onErase: vi.fn(),
        onDeleteSegment: vi.fn(),
        onRename: vi.fn(),
      })
    );
  });
}

function button(label: string, within: ParentNode = document): HTMLElement {
  const found = [...within.querySelectorAll("button")].filter(
    (b) => b.getAttribute("aria-label") === label
  );
  expect(found, label).toHaveLength(1);
  return found[0]!;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
}

describe.each(["current", "o4"] as const)("%s look", (look) => {
  beforeEach(() => {
    design.current = look;
  });

  it("the menu's Edit opens the recorder in edit mode", async () => {
    await render(recorded);
    await click(button(strings.segmentMenu(1)));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await click(button(strings.editSegment(1, null), dialog!));
    expect(onOpenRecorder).toHaveBeenCalledTimes(1);
    expect(onOpenRecorder).toHaveBeenCalledWith("edit");
  });

  it("the row itself opens it in record mode, with no click event passed as the entry", async () => {
    await render(recorded);
    const open = document.querySelector<HTMLButtonElement>("button.row-open");
    expect(open).not.toBeNull();
    await click(open!);
    expect(onOpenRecorder).toHaveBeenCalledTimes(1);
    expect(onOpenRecorder.mock.calls[0]).toEqual([]);
  });

  it("an empty row's Record opens it in record mode", async () => {
    await render(empty);
    await click(button(strings.openRecorderSegment(1)));
    expect(onOpenRecorder).toHaveBeenCalledTimes(1);
    expect(onOpenRecorder.mock.calls[0]).toEqual([]);
  });
});
