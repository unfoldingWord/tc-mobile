// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "@/components/icon";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/components/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

import { one, render as renderStatic } from "./render";

/**
 * #621: the recorder's overflow drawer (Edit / Mark finished / Erase) opens
 * from a ≡ and keeps it — no painted "More" heading, and the dismiss control
 * wears the same `menu` glyph the opener does, in the same top-right corner,
 * instead of a left-pointing chevron on a drawer that docks on the right.
 * The rule is #608's, and `Menu`'s `hamburger` prop is how a caller opts in;
 * what this file pins is that the RECORDER's call site passes it. The header
 * itself is proved in `menu-hamburger-header.test.ts`.
 *
 * Rendered through the real `Recorder`, not `Menu` alone, because a test on
 * `Menu` would only re-prove #608. Same harness shape as
 * `recorder-erase-back.test.ts`: paint and audio acquisition are mocked, the
 * recorder, its menu and the strings stay real.
 */

const view = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: 4,
  samples: new Int16Array([1, 2, 3, 4]),
};
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: vi.fn().mockResolvedValue(view),
    setFinished: vi.fn(),
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
  expect(found, label).toBeDefined();
  return found!;
}

/** The `d` of the one path an `Icon` of this name draws. */
function glyphPath(name: IconName): string {
  return one(renderStatic(createElement(Icon, { name })), "path").getAttribute(
    "d"
  )!;
}

/** Every non-empty text run a sighted user could read inside `el`. */
function paintedText(el: Element): string[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const runs: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    if (text) runs.push(text);
  }
  return runs;
}

async function openMenu(): Promise<Element> {
  const ref = createRef<RecorderHandle>();
  const audio: UseAudioSession = {
    playingId: null,
    playingBuffer: false,
    playbackElapsedMs: 0,
    playbackRanOut: false,
    recorderState: "idle",
    elapsedMs: 0,
    supported: true,
    error: null,
    recorderError: null,
    meterFailed: false,
    playTake: vi.fn(),
    playBuffer: vi.fn(),
    stopBuffer: vi.fn(),
    readPlaybackPosition: () => null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    retryDecode: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  };
  await act(async () =>
    root.render(
      createElement(Recorder, {
        ref,
        segmentId: "segment" as SegmentId,
        audio,
        saveRecording: vi.fn(),
        saveEditedSegment: vi.fn(),
        clipboard: null,
        onClipboardChange: vi.fn(),
        databaseUnreachable: false,
        onExit: vi.fn(),
        onRequestBack: () => {
          void ref.current?.requestClose();
        },
      })
    )
  );
  await act(async () => button(strings.recorderMenuOpen).click());
  const panel = drawer();
  expect(panel).not.toBeNull();
  return panel!;
}

/** The drawer's panel — NOT the first `role="dialog"`, which is the sheet. */
const drawer = () => document.querySelector(".menu-panel");

describe("the recorder's ≡ drawer header (#621)", () => {
  it("paints no 'More' heading, while the dialog keeps that name for a screen reader", async () => {
    const panel = await openMenu();

    expect(panel.getAttribute("aria-label")).toBe(strings.recorderMenuTitle);
    expect(panel.querySelector(".t-title")).toBeNull();
    expect(paintedText(panel)).not.toContain(strings.recorderMenuTitle);
  });

  it("dismisses with the ≡ glyph that opened it — not a chevron — and a tap on it closes the drawer", async () => {
    const panel = await openMenu();

    const dismiss = button(strings.menuClose);
    expect(panel.contains(dismiss)).toBe(true);
    expect(one(dismiss, "path").getAttribute("d")).toBe(glyphPath("menu"));
    expect(one(dismiss, "path").getAttribute("d")).not.toBe(glyphPath("back"));

    await act(async () => dismiss.click());
    expect(drawer()).toBeNull();
  });
});
