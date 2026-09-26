// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "@/components/icon";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import type { SegmentId } from "@/types/domain";
import { render } from "./render";

/**
 * O4 G5, "Record again asks first" (#979): the record bar's bin opens the
 * 13 confirm with a record badge and a "Record again" button carrying the
 * record dot. The ≡ menu's Erase opens the same dialog as 13, bin and all,
 * and with the switch off both openers show today's dialog.
 *
 * The harness is `tests/recorder-rerecord.test.ts`'s — the real `Recorder`,
 * the real erase hook and the real confirm, with the store and the segment
 * loader replaced at their boundary — plus `useDesign()` mocked so each case
 * picks its look (`tests/recorder-menu-o4.test.ts` is the pattern).
 *
 * What this cannot see: the cascade (whether `o4/dialogs.css` wins on a real
 * page), layout, and anything on a phone.
 */
const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const storage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));

const recorded = {
  bookName: "Book",
  chapterNumber: 1,
  ordinal: 1,
  segmentLabel: null,
  finished: false,
  hasClip: true,
  peaks: null,
  lengthSamples: 1000,
  samples: new Int16Array(1000).fill(5),
};
const erased = { ...recorded, hasClip: false, lengthSamples: 0, samples: null };
const boundary = vi.hoisted(() => ({
  view: null as unknown,
  reloads: [] as unknown[],
  reload: vi.fn(),
}));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: boundary.view,
    error: null,
    retrying: false,
    retry: vi.fn(),
    reload: boundary.reload,
    setFinished: vi.fn().mockResolvedValue(undefined),
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
  design.current = "o4";
  storage.clear.mockReset();
  storage.clear.mockResolvedValue(undefined);
  boundary.view = recorded;
  boundary.reloads = [];
  boundary.reload.mockReset();
  boundary.reload.mockImplementation(async () => {
    boundary.view = boundary.reloads.shift() ?? boundary.view;
    return boundary.view;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function setup(look: Design) {
  design.current = look;
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
    stopRecording: vi.fn(async () => ({
      samples: new Int16Array(0),
      blob: null,
      error: null,
    })),
    retryDecode: vi.fn(),
    leave: vi.fn(),
    primeAudioContext: vi.fn(),
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
  };
  const Host = () =>
    createElement(Recorder, {
      ref,
      segmentId: "segment" as SegmentId,
      audio,
      erase: useEraseSegment(),
      saveRecording: vi.fn().mockResolvedValue(true),
      saveEditedSegment: vi.fn().mockResolvedValue(true),
      clipboard: null,
      onClipboardChange: vi.fn(),
      databaseUnreachable: false,
      onExit: vi.fn(),
      onRequestBack: () => {
        void ref.current?.requestClose();
      },
    });
  await act(async () => root.render(createElement(Host)));
}

/** The one button whose accessible name is `label` or starts `label. `. */
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (b) =>
      b.getAttribute("aria-label") === label ||
      b.getAttribute("aria-label")?.startsWith(`${label}. `)
  );
  expect(found, label).toHaveLength(1);
  return found[0]!;
}
function barRerecord(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(
    `.recorder-toolbar.pair button[aria-label^="${strings.rerecord}"]`
  );
  expect(found, "the bar's re-record control").not.toBeNull();
  return found!;
}
async function openFromMenu() {
  await act(async () => button(strings.recorderMenuOpen).click());
  await act(async () => button(strings.eraseSegment).click());
}

/** The inner markup the `Icon` component draws for `name`. */
function iconInner(name: IconName): string {
  const svg = render(createElement(Icon, { name })).querySelector("svg");
  expect(svg, name).not.toBeNull();
  return svg!.innerHTML;
}

/** The open confirm: its panel, badge icon, and confirm button. */
function dialog() {
  const panel = document.querySelector<HTMLElement>(".confirm-panel");
  expect(panel, "the confirm is up").not.toBeNull();
  const buttons = panel!.querySelectorAll<HTMLButtonElement>(
    ".confirm-actions > button"
  );
  expect(buttons).toHaveLength(2);
  return {
    panel: panel!,
    badge: panel!.querySelector("svg.confirm-glyph")!.innerHTML,
    cancel: buttons[0]!,
    confirm: buttons[1]!,
    confirmIcon: buttons[1]!.querySelector("svg")!.innerHTML,
  };
}

describe("the record-again confirm with the switch on (G5, #979)", () => {
  it("the bar's bin opens it with the record badge and a Record again button", async () => {
    await setup("o4");
    await act(async () => barRerecord().click());
    const d = dialog();
    expect(d.badge).toBe(iconInner("record"));
    expect(d.confirmIcon).toBe(iconInner("record"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.rerecordConfirm);
    // Keep stays the 13 control, and focus still lands on it.
    expect(d.cancel.getAttribute("aria-label")).toBe(strings.eraseCancel);
    expect(d.cancel.querySelector("svg")!.innerHTML).toBe(iconInner("back"));
    expect(document.activeElement).toBe(d.cancel);
  });

  it("Record again still erases through the shared hook", async () => {
    await setup("o4");
    boundary.reloads = [erased];
    await act(async () => barRerecord().click());
    await act(async () => button(strings.rerecordConfirm).click());
    expect(storage.clear).toHaveBeenCalledExactlyOnceWith("segment");
    expect(document.querySelector(".confirm-panel")).toBeNull();
  });

  it("the ≡ menu's Erase still opens the 13 dialog: bin badge, Erase", async () => {
    await setup("o4");
    await openFromMenu();
    const d = dialog();
    expect(d.badge).toBe(iconInner("trash"));
    expect(d.confirmIcon).toBe(iconInner("trash"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.eraseConfirm);
  });

  it("a cancelled record-again does not leak its look into a later ≡ Erase", async () => {
    await setup("o4");
    await act(async () => barRerecord().click());
    await act(async () => dialog().cancel.click());
    expect(document.querySelector(".confirm-panel")).toBeNull();
    await openFromMenu();
    const d = dialog();
    expect(d.badge).toBe(iconInner("trash"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.eraseConfirm);
  });
});

describe("the record-again confirm with the switch off (unchanged)", () => {
  it("the bar's bin opens today's dialog: bin badge, bin button, Erase", async () => {
    await setup("current");
    await act(async () => barRerecord().click());
    const d = dialog();
    expect(d.badge).toBe(iconInner("trash"));
    expect(d.confirmIcon).toBe(iconInner("trash"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.eraseConfirm);
  });

  it("the bar's bin and the ≡ Erase open byte-identical dialogs", async () => {
    await setup("current");
    await act(async () => barRerecord().click());
    const fromBar = dialog().panel.outerHTML;
    await act(async () => dialog().cancel.click());
    await openFromMenu();
    expect(dialog().panel.outerHTML).toBe(fromBar);
  });
});
