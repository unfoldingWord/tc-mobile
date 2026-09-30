import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecorderToolbar,
  type RecorderToolbarProps,
} from "@/components/recorder-toolbars";
import { Icon } from "@/components/icon";
import { Recorder } from "@/components/recorder";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

import { render } from "./render";
import { mountInteractive, type InteractiveMount } from "./interactive-mount";
import { cssRule, declarationValue, restingErase } from "./support";

// Hoisted mocks for the interactive header render below (`vi.mock` runs
// before this module's own top-level code, so these must live here, not
// inside the `describe` that uses them — nesting them silently reorders
// their execution relative to the imports above, per Vitest's own mocking
// guide).
const recorderSegmentBoundary = vi.hoisted(() => ({ view: null as unknown }));
vi.mock("@/hooks/use-recorder-segment", () => ({
  useRecorderSegment: () => ({
    view: recorderSegmentBoundary.view,
    error: null,
    retrying: false,
    retry: () => {},
    reload: async () => recorderSegmentBoundary.view,
    setFinished: async () => {},
  }),
}));
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

/**
 * #1243 (the requirements owner, 2026-09-30, reversing #863): the recorder's
 * ⋮ menu opener stays in the header's top right in BOTH modes — same glyph,
 * same place, same menu — and the edit toolbar carries no ⋮ of its own. The
 * edit-mode marker moves inside the waveform window's top right as plain,
 * non-interactive text reading "Editing".
 *
 * #1252 (the requirements owner, 2026-09-30): the edit-mode "Done" tile is
 * removed from that menu, so "Done" keeps one meaning (mark finished), and
 * the edit toggle (#557) shows scissors to enter and ✕ while editing; the ✕
 * is the way out. The scissors in edit mode then mean only Cut.
 *
 * `RecorderToolbar` (`recorder-toolbars.tsx`) is presentational and goes
 * through `./render`'s static harness. The header and the stage live inside
 * `recorder.tsx`, which mounts the whole audio hook graph and swaps mode on a
 * click, so they go through `./interactive-mount` instead: the REAL
 * `Recorder`, with only the segment load and the three canvas/level
 * components mocked. Nothing here sounds a buffer, so no rAF loop starts.
 *
 * What this file does NOT cover: where the marker actually lands on a screen.
 * Neither harness has layout or a cascade (#197); the corner is pinned as the
 * declared CSS values at the end of this file, and has not been checked on a
 * phone.
 *
 * The "more" glyph (`icon.tsx`) draws three `<circle>` elements and no
 * `<path>`; "menu" (≡) draws one `<path>` and no `<circle>`. Counting both is
 * what makes a revert to ≡ fail rather than pass on the shared accessible
 * name (`strings.recorderMenuOpen`).
 */

const noop = () => {};
const buttonRef = { current: null } as RefObject<HTMLButtonElement | null>;

function baseProps(mode: "record" | "edit"): RecorderToolbarProps {
  return {
    mode,
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
    zoom: 1,
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
  };
}

function toolbarButtons(props: RecorderToolbarProps): HTMLButtonElement[] {
  const container = render(createElement(RecorderToolbar, props));
  return [...container.querySelectorAll("button")] as HTMLButtonElement[];
}

describe("the edit toolbar carries no ⋮ (#1243)", () => {
  it("is Play, Zoom, Undo, Redo and the ✕ exit, in that order", () => {
    const names = toolbarButtons(baseProps("edit")).map((b) =>
      b.getAttribute("aria-label")
    );
    expect(names).toEqual([
      strings.playRecording,
      strings.zoomAtWhole,
      strings.undo,
      strings.redo,
      strings.leaveEdit,
    ]);
  });

  it("has no 'More actions' control in either mode — the opener lives in the header", () => {
    for (const mode of ["record", "edit"] as const) {
      const openers = toolbarButtons(baseProps(mode)).filter(
        (b) => b.getAttribute("aria-label") === strings.recorderMenuOpen
      );
      expect(openers, `${mode} toolbar`).toHaveLength(0);
    }
  });

  it("lays the edit bar out on one track per control (four tools + the toggle)", () => {
    // Removing the ⋮ without shrinking the grid would leave an empty track
    // between Redo and the toggle. A declared-value read: no cascade here.
    const css = readFileSync(
      path.resolve(
        import.meta.dirname,
        "..",
        "src/app/styles/3-components.css"
      ),
      "utf8"
    );
    const body = cssRule(css, ".recorder-toolbar.edit");
    expect(declarationValue(body, "grid-template-columns")).toBe(
      "repeat(4, minmax(0, 1fr)) var(--c-control-md)"
    );
  });
});

describe("the header ⋮ stays top right in both modes, and 'Editing' sits in the waveform (#1243)", () => {
  function segmentView() {
    const samples = new Int16Array(100).fill(3);
    return {
      bookName: "Book",
      chapterNumber: 1,
      ordinal: 1,
      segmentLabel: null,
      finished: false,
      hasClip: true,
      peaks: null,
      lengthSamples: samples.length,
      samples,
    };
  }

  let mount: InteractiveMount;
  let root: InteractiveMount["root"];
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    recorderSegmentBoundary.view = segmentView();
    mount = mountInteractive();
    root = mount.root;
    container = mount.container;
  });

  afterEach(async () => {
    // try/finally: if unmount throws, the stubbed window/document must still
    // be torn down, or they leak into later tests in the same worker.
    try {
      await act(async () => root.unmount());
    } finally {
      mount.teardown();
    }
  });

  async function mountRecorder(): Promise<void> {
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
      playTake: noop,
      playBuffer: noop,
      stopBuffer: noop,
      readPlaybackPosition: () => null,
      startRecording: noop,
      stopRecording: async () => ({ samples: null, blob: null, error: null }),
      retryDecode: async () => ({ samples: null, error: null }),
      leave: noop,
      primeAudioContext: noop,
      readLevel: () => 0,
      readMeterAvailable: () => true,
      readScope: () => null,
      peekScope: () => null,
    } as unknown as UseAudioSession;
    const erase = restingErase();
    await act(async () => {
      root.render(
        createElement(Recorder, {
          segmentId: "segment" as SegmentId,
          audio,
          erase,
          saveRecording: async () => true,
          saveEditedSegment: async () => true,
          clipboard: null,
          onClipboardChange: noop,
          databaseUnreachable: false,
          onExit: noop,
          onRequestBack: noop,
        })
      );
    });
  }

  function header(): HTMLElement {
    const found = container.querySelector("header");
    if (!found) throw new Error("no <header> in the mounted recorder");
    return found;
  }

  function stage(): HTMLElement {
    const found = container.querySelector<HTMLElement>(".recorder-stage");
    if (!found) throw new Error("no .recorder-stage in the mounted recorder");
    return found;
  }

  function findButton(
    scope: Element,
    label: string
  ): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === label
    ) as HTMLButtonElement | undefined;
  }

  /** The header's ⋮: the kebab, as its last button, enabled. */
  function expectHeaderKebab(mode: string): HTMLButtonElement {
    const buttons = [...header().querySelectorAll("button")];
    const opener = findButton(header(), strings.recorderMenuOpen);
    expect(opener, `no ⋮ opener in the ${mode}-mode header`).toBeDefined();
    // Top right: the header's trailing control, in both modes.
    expect(buttons.at(-1), `${mode}: ⋮ is not the header's last button`).toBe(
      opener
    );
    expect(opener!.hasAttribute("disabled")).toBe(false);
    const svg = opener!.querySelector("svg");
    expect(svg, `no <svg> in the ${mode}-mode ⋮ opener`).not.toBeNull();
    expect(svg!.querySelectorAll("circle").length).toBe(3);
    expect(svg!.querySelectorAll("path").length).toBe(0);
    return opener!;
  }

  async function enterEdit(): Promise<void> {
    const toggle = findButton(container, strings.enterEdit);
    expect(toggle, "no Edit toggle to drive the mode swap").toBeDefined();
    await act(async () => toggle!.click());
    expect(
      findButton(container, strings.leaveEdit),
      "the mode swap did not happen: no ✕ exit"
    ).toBeDefined();
  }

  it("record mode: the header carries the ⋮ and the stage carries no Editing marker", async () => {
    await mountRecorder();
    expectHeaderKebab("record");
    expect(stage().querySelector(".recorder-editing")).toBeNull();
    expect(stage().textContent).not.toContain(strings.editingMarker);
  });

  it("edit mode: the same ⋮ stays in the header, and no Done control replaces it", async () => {
    await mountRecorder();
    const before = expectHeaderKebab("record");
    await enterEdit();
    const after = expectHeaderKebab("edit");
    // The same DOM node: the opener did not move or remount across the flip.
    expect(after).toBe(before);
    // Nothing in the header exits edit mode any more (#863's pill is gone):
    // its buttons are Back, the chapter crumb (which runs that same Back,
    // #1269) and the ⋮, nothing else.
    expect(
      [...header().querySelectorAll("button")].map((b) =>
        b.getAttribute("aria-label")
      )
    ).toEqual([
      strings.closeRecorder,
      strings.goToChapter(strings.chapterName(1)),
      strings.recorderMenuOpen,
    ]);
    expect(header().textContent).not.toContain(strings.editingMarker);
  });

  it("edit mode: 'Editing' is plain text inside the waveform window, not a control", async () => {
    await mountRecorder();
    await enterEdit();
    const markers = [...stage().querySelectorAll(".recorder-editing")];
    expect(markers, "Editing markers in the stage").toHaveLength(1);
    const marker = markers[0]!;
    expect(marker.textContent).toBe(strings.editingMarker);
    // Not tappable, and not dressed up as one for a screen reader.
    expect(marker.tagName).toBe("SPAN");
    expect(marker.closest("button")).toBeNull();
    expect(marker.hasAttribute("role")).toBe(false);
    expect(marker.hasAttribute("tabindex")).toBe(false);
    // Spoken as what it says: no aria-label promising an action it no longer
    // performs, and not hidden from the reader either.
    expect(marker.hasAttribute("aria-label")).toBe(false);
    expect(marker.getAttribute("aria-hidden")).toBeNull();
  });

  it("edit mode: the header ⋮ opens the edit menu, which has no Done tile (#1252)", async () => {
    await mountRecorder();
    await enterEdit();
    const opener = expectHeaderKebab("edit");
    await act(async () => opener.click());
    const menu = mount.dom.window.document.querySelector(".menu-panel");
    expect(menu, "the edit menu did not open").not.toBeNull();
    // Erase, then the theme control — nothing that leaves edit mode, and no
    // "Done" that could be read as marking the segment finished.
    const names = [...menu!.querySelectorAll("button")]
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((name) => name !== strings.recorderMenuOpen);
    expect(names).toContain(strings.eraseSegment);
    expect(names.filter((name) => /done/i.test(name))).toEqual([]);
    expect(menu!.textContent).not.toMatch(/\bDone\b/);
  });

  it("edit mode: the only scissors on screen is Cut (#1252)", async () => {
    await mountRecorder();
    await enterEdit();
    const scissors = render(
      createElement(Icon, { name: "scissors" })
    ).querySelector("svg")!.innerHTML;
    const worn = [...container.querySelectorAll("button")]
      .filter((b) => b.querySelector("svg")?.innerHTML === scissors)
      .map((b) => b.getAttribute("aria-label"));
    expect(worn).toEqual([strings.cut]);
  });

  it("the ✕ leaves edit mode on the same node, and the marker goes with it", async () => {
    await mountRecorder();
    const before = findButton(container, strings.enterEdit)!;
    await enterEdit();
    const exit = findButton(container, strings.leaveEdit)!;
    // One control across the flip (`key="edit-toggle"`), so focus stays put.
    expect(exit).toBe(before);
    expect(findButton(container, strings.enterEdit)).toBeUndefined();
    await act(async () => exit.click());
    expect(findButton(container, strings.enterEdit)).toBe(before);
    expect(findButton(container, strings.leaveEdit)).toBeUndefined();
    expect(stage().querySelector(".recorder-editing")).toBeNull();
    expectHeaderKebab("record");
  });
});

describe("the Editing marker's corner (#1243)", () => {
  // Declared values only: no cascade in this suite (#197), so this pins what
  // the stylesheets say, not where a browser draws it.
  const read = (rel: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

  it("is absolutely placed at the stage's top right, and ignores the pan", () => {
    const body = cssRule(
      read("src/app/styles/3-components.css"),
      ".recorder-editing"
    );
    expect(declarationValue(body, "position")).toBe("absolute");
    expect(declarationValue(body, "top")).toBe("var(--p-space-3)");
    expect(declarationValue(body, "right")).toBe("var(--p-space-3)");
    expect(declarationValue(body, "pointer-events")).toBe("none");
    // The accent as INK, the role #164 R-9 split off for small text.
    expect(declarationValue(body, "color")).toBe("var(--s-voice-text)");
  });

  it("takes the O4 stamp's corner under O4", () => {
    const o4 = read("src/app/styles/o4/recorder.css");
    const marker = cssRule(o4, '[data-design="o4"] .recorder-editing');
    const stamp = cssRule(o4, '[data-design="o4"] .recorder-stamp');
    for (const property of ["top", "right", "z-index"]) {
      expect(declarationValue(marker, property), property).toBe(
        declarationValue(stamp, property)
      );
    }
  });
});

describe("the edit toggle: scissors to enter, ✕ to leave (#955, #1252)", () => {
  // #955 (the requirements owner, 2026-09-25) put the scissors on the toggle
  // that enters edit mode (`key="edit-toggle"`). #1252 (the requirements
  // owner, 2026-09-30) keeps that for entering and shows ✕ while editing, so
  // in edit mode the scissors mean only Cut (the bare quiet control under the
  // selection, `recorder.tsx`). Each glyph is compared against a rendered
  // `<Icon>`, so ANY other glyph fails, not only the one it replaced.
  //
  // The name says what a tap does in each state ("Edit recording" / "Stop
  // editing"), and there is no `aria-pressed`: a pressed toggle whose name
  // also flips would announce "Stop editing, pressed" — the contradiction
  // #351 took out of the Mark row.
  const glyph = (name: "scissors" | "close") =>
    render(createElement(Icon, { name })).querySelector("svg")!.innerHTML;

  for (const [mode, label, icon] of [
    ["record", strings.enterEdit, "scissors"],
    ["edit", strings.leaveEdit, "close"],
  ] as const) {
    it(`${mode} toolbar: the last control is "${label}" wearing ${icon}, on the default tile at 22px`, () => {
      const buttons = toolbarButtons(baseProps(mode));
      const toggle = buttons.at(-1)!;
      expect(toggle.getAttribute("aria-label")).toBe(label);
      const svg = toggle.querySelector("svg");
      expect(svg, `no <svg> in the ${mode} edit toggle`).not.toBeNull();
      expect(svg!.innerHTML).toBe(glyph(icon));
      expect(svg!.getAttribute("width")).toBe("22");
      expect(toggle.classList.contains("control--quiet")).toBe(false);
      expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    });
  }

  it("the edit toolbar carries no scissors: in edit mode they mean only Cut", () => {
    const scissors = glyph("scissors");
    const worn = toolbarButtons(baseProps("edit")).filter(
      (b) => b.querySelector("svg")?.innerHTML === scissors
    );
    expect(worn).toEqual([]);
  });
});
