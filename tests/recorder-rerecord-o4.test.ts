// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "@/components/icon";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import type { SegmentId } from "@/types/domain";
import { render } from "./render";

/**
 * O4 G5, "Record again" (#979, #1022, #1028): the record bar's bin opens the
 * 13 confirm with the workbench's record dot, "Record again" and "Keep it".
 * One tap on the confirm clears the segment and then starts the next take
 * through the sheet's one start path (`onRecordButton` -> `audio.startRecording`),
 * only if the clear landed. The ⋮ menu's Clear opens the 13 dialog, eraser and
 * all, and starts nothing.
 *
 * The harness is `tests/recorder-rerecord.test.ts`'s — the real `Recorder`,
 * the real erase hook and the real confirm, with the store and the segment
 * loader replaced at their boundary. `audio.startRecording` is a fake: the
 * microphone, the iOS gesture rule and the resume bounds are the on-device
 * question (#245), not this file's.
 *
 * What this cannot see: the cascade (whether `o4/dialogs.css` wins on a real
 * page), layout, and anything on a phone.
 */

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

let rerender: () => Promise<void> = async () => {};
async function setup() {
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
    takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
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
  rerender = async () => act(async () => root.render(createElement(Host)));
  await rerender();
  return audio;
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

describe("the record-again confirm (G5, #979)", () => {
  it("the bar's bin opens it with the record dot, Record again and Keep it", async () => {
    await setup();
    await act(async () => barRerecord().click());
    const d = dialog();
    expect(d.badge).toBe(iconInner("record"));
    expect(d.confirmIcon).toBe(iconInner("record"));
    expect(d.confirm.getAttribute("aria-label")).toBe(
      strings.recordAgainConfirm
    );
    expect(d.cancel.getAttribute("aria-label")).toBe(strings.recordAgainKeep);
    expect(d.cancel.querySelector("svg")!.innerHTML).toBe(iconInner("back"));
    expect(d.panel.classList.contains("confirm-panel-record")).toBe(true);
    // Destructive: focus still lands on the safe answer.
    expect(document.activeElement).toBe(d.cancel);
  });

  it("its confirm clears through the shared hook, then starts one take", async () => {
    const audio = await setup();
    boundary.reloads = [erased];
    await act(async () => barRerecord().click());
    await act(async () => dialog().confirm.click());
    expect(storage.clear).toHaveBeenCalledExactlyOnceWith("segment");
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(audio.startRecording).toHaveBeenCalledOnce();
    // Clear first, then start: the order is the whole contract.
    expect(storage.clear.mock.invocationCallOrder[0]).toBeLessThan(
      (audio.startRecording as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!
    );
  });

  it("starts nothing until the clear has settled", async () => {
    let settle!: () => void;
    storage.clear.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    const audio = await setup();
    boundary.reloads = [erased];
    await act(async () => barRerecord().click());
    await act(async () => dialog().confirm.click());
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(audio.startRecording).not.toHaveBeenCalled();
    await act(async () => settle());
    expect(audio.startRecording).toHaveBeenCalledOnce();
  });

  it("a failed clear is reported as erase-segment and starts nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    storage.clear.mockRejectedValue(new Error("quota"));
    const reports: FailureReport[] = [];
    const off = subscribeToFailures((r) => reports.push(r));
    const audio = await setup();
    await act(async () => barRerecord().click());
    await act(async () => dialog().confirm.click());
    off();
    expect(reports.map((r) => r.context)).toEqual(["erase-segment"]);
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(audio.startRecording).not.toHaveBeenCalled();
    // ...and the failed clear does not leave a start owed to a later render.
    await rerender();
    expect(audio.startRecording).not.toHaveBeenCalled();
  });

  it("a start that fails after the clear leaves the segment cleared and shows the existing mic panel", async () => {
    const audio = await setup();
    boundary.reloads = [erased];
    (audio.startRecording as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        const mutable = audio as {
          recorderError: string | null;
          error: string | null;
        };
        mutable.recorderError = "Microphone blocked";
        mutable.error = "Microphone blocked";
      }
    );
    await act(async () => barRerecord().click());
    await act(async () => dialog().confirm.click());
    await rerender();
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(audio.startRecording).toHaveBeenCalledOnce();
    // State in place, no text toast: the full-body panel with the refusal.
    expect(document.querySelector(".o4-err")).not.toBeNull();
    expect(document.querySelector(".o4-err-sub")?.textContent).toBe(
      "Microphone blocked"
    );
  });

  it("a second tap during the sequence does nothing", async () => {
    let settle!: () => void;
    storage.clear.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    const audio = await setup();
    boundary.reloads = [erased];
    await act(async () => barRerecord().click());
    const confirm = dialog().confirm;
    // Two activations in one turn, before any await has resolved.
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    await act(async () => settle());
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(audio.startRecording).toHaveBeenCalledOnce();
  });

  it("the ⋮ menu's Clear clears and starts no take", async () => {
    const audio = await setup();
    boundary.reloads = [erased];
    await openFromMenu();
    await act(async () => dialog().confirm.click());
    expect(storage.clear).toHaveBeenCalledOnce();
    expect(audio.startRecording).not.toHaveBeenCalled();
  });

  it("the ⋮ menu's Clear still opens the 13 dialog: eraser badge, Clear", async () => {
    await setup();
    await openFromMenu();
    const d = dialog();
    expect(d.badge).toBe(iconInner("eraser"));
    expect(d.confirmIcon).toBe(iconInner("eraser"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.eraseConfirm);
  });

  it("a cancelled record-again does not leak its look into a later ⋮ Clear", async () => {
    await setup();
    await act(async () => barRerecord().click());
    await act(async () => dialog().cancel.click());
    expect(document.querySelector(".confirm-panel")).toBeNull();
    await openFromMenu();
    const d = dialog();
    expect(d.badge).toBe(iconInner("eraser"));
    expect(d.confirm.getAttribute("aria-label")).toBe(strings.eraseConfirm);
  });
});
