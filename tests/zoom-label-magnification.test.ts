import { createElement, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import {
  RecorderToolbar,
  type RecorderToolbarProps,
} from "@/components/recorder-toolbars";
import { table as es } from "@/lib/i18n/es";

import { render } from "./render";

/**
 * #1594: the zoom toggle's accessible name says the MAGNIFICATION, never which
 * part of the segment is on screen. Zoom and pan are independent, so at the
 * sheet's opening state whole zoom shows [0.5L, 1.5L] and "the whole segment"
 * would be false. The toolbar is rendered at both zoom levels so the names are
 * read as the JSX emits them. The French and Portuguese tables already word
 * these as scale and are untouched.
 */

const noop = () => {};
const buttonRef = { current: null } as RefObject<HTMLButtonElement | null>;

function zoomName(zoom: number): string {
  const props = {
    mode: "edit",
    recording: false,
    recordRef: buttonRef,
    rerecordRef: buttonRef,
    rerecordDisabled: false,
    rerecordHint: null,
    recordInert: false,
    guidedRecord: false,
    isClosing: false,
    playingBuffer: false,
    dragging: false,
    idleEditable: true,
    playSource: null,
    playDisabled: false,
    editToolbarDisabled: false,
    editToolbarHint: null,
    undoBlocked: null,
    redoBlocked: null,
    zoom,
    windowControlsInert: false,
    onRecordButton: noop,
    onPlayButton: noop,
    onEnterEdit: noop,
    onAuditionButton: noop,
    onToggleZoom: noop,
    onUndo: noop,
    onRedo: noop,
    onExitEdit: noop,
    onRerecord: noop,
  } as unknown as RecorderToolbarProps;
  const container = render(createElement(RecorderToolbar, props));
  const names = [...container.querySelectorAll("button")]
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((n) => /zoom/i.test(n));
  expect(names).toHaveLength(1);
  return names[0] as string;
}

describe("zoom labels name the magnification, not the extent (#1594)", () => {
  it("English at whole zoom", () => {
    expect(zoomName(1)).toBe("Zoomed out. Zoom in to a quarter.");
  });

  it("English at quarter zoom", () => {
    expect(zoomName(4)).toBe("Zoomed in to a quarter. Zoom out.");
  });

  it("Spanish no longer says the whole segment is visible", () => {
    expect(es.zoomAtWhole).toBe("Vista alejada. Acerca la vista a un cuarto.");
    expect(es.zoomAtQuarter).toBe(
      "Vista acercada a un cuarto. Aleja la vista."
    );
  });
});
