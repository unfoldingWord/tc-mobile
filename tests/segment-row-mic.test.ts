import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecorderToolbar } from "@/components/recorder-toolbars";
import type { RecorderToolbarProps } from "@/components/recorder-toolbars";
import { SegmentRow } from "@/components/segment-row";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { one, render } from "./render";

/**
 * #1217: an unrecorded row's control is a microphone that opens the recorder,
 * not a copy of the recorder's red Record button.
 *
 * Markup only: the harness has no cascade, so the gray fill and red outline
 * are read from the class the control carries, and nothing here has been run
 * on a phone.
 */
const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

afterEach(() => {
  design.current = "current";
});

const base: Row = {
  segmentId: "segment-3" as SegmentId,
  ordinal: 3,
  label: null,
  hasClip: true,
  finished: false,
  clipId: "clip-3" as ClipId,
  peaks: null,
  durationMs: 1000,
};
const empty: Row = { ...base, hasClip: false, clipId: null, durationMs: null };

function renderRow(look: Design, row: Row, onOpenRecorder = () => {}) {
  design.current = look;
  return render(
    createElement(SegmentRow, {
      row,
      playing: false,
      playbackElapsedMs: 0,
      onPlay: () => {},
      onOpenRecorder,
      onSetFinished: () => {},
      onErase: () => {},
      onDeleteSegment: () => {},
      onRename: () => Promise.resolve(true),
    })
  );
}

/** The Record glyph is one filled circle; the microphone is a capsule + stand. */
const isRecordGlyph = (svg: Element) =>
  svg.querySelector("circle") !== null && svg.querySelector("rect") === null;
const isMicGlyph = (svg: Element) =>
  svg.querySelector("rect") !== null && svg.querySelector("circle") === null;

describe("the unrecorded row's control (#1217)", () => {
  it.each<Design>(["current", "o4"])(
    "is the microphone, not the Record button, in the %s look",
    (look) => {
      const container = renderRow(look, empty);
      const control = one(
        container,
        `button[aria-label="${strings.openRecorderSegment(3)}"]`
      );
      expect(control.classList.contains("control--mic")).toBe(true);
      expect(control.classList.contains("control--record")).toBe(false);
      const svg = one(control, "svg");
      expect(isMicGlyph(svg)).toBe(true);
      expect(isRecordGlyph(svg)).toBe(false);
      expect(container.querySelector(".control--record")).toBeNull();
    }
  );

  it("names what a tap does: it opens the recorder, it does not record", () => {
    const label = strings.openRecorderSegment(3);
    expect(label).toMatch(/recorder/i);
    expect(label).not.toMatch(/^record\b/i);
  });

  it("still opens the recorder in one tap-target, and a recorded row keeps Play", () => {
    const container = renderRow("current", empty);
    expect(container.querySelectorAll(".control--mic")).toHaveLength(1);
    const recorded = renderRow("current", base);
    expect(recorded.querySelector(".control--mic")).toBeNull();
    expect(recorded.querySelector(".control--play")).not.toBeNull();
  });
});

describe("the recorder's own Record button is unchanged (#1217)", () => {
  it("is still the red record variant with the filled-circle glyph", () => {
    const noop = () => {};
    const ref = { current: null };
    const props: RecorderToolbarProps = {
      mode: "record",
      recording: false,
      recordRef: ref,
      rerecordRef: ref,
      rerecordDisabled: false,
      rerecordHint: null,
      recordInert: false,
      isClosing: false,
      hasView: true,
      playingBuffer: false,
      dragging: false,
      idleEditable: true,
      playSource: null,
      playDisabled: false,
      editToolbarDisabled: false,
      editToolbarHint: null,
      undoBlocked: null,
      redoBlocked: null,
      zoom: 1,
      windowControlsInert: false,
      guidedRecord: false,
      onRecordButton: noop,
      onPlayButton: noop,
      onEnterEdit: noop,
      onAuditionButton: noop,
      onToggleZoom: noop,
      onUndo: noop,
      onRedo: noop,
      openMenu: noop,
      onExitEdit: noop,
      onRerecord: noop,
    };
    const bar = render(createElement(RecorderToolbar, props));
    const record = one(bar, `button[aria-label="${strings.record}"]`);
    expect(record.classList.contains("control--record")).toBe(true);
    expect(record.classList.contains("control--mic")).toBe(false);
    expect(isRecordGlyph(one(record, "svg"))).toBe(true);
  });
});
