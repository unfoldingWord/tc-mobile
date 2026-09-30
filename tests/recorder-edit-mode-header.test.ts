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
 * non-interactive text reading "Editing"; leaving edit mode stays on the
 * scissors toggle (#557, #955).
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
  it("is Play, Zoom, Undo, Redo and the scissors toggle, in that order", () => {
    const names = toolbarButtons(baseProps("edit")).map((b) =>
      b.getAttribute("aria-label")
    );
    expect(names).toEqual([
      strings.playRecording,
      strings.zoomAtWhole,
      strings.undo,
      strings.redo,
      strings.enterEdit,
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
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    await act(async () => toggle!.click());
    expect(
      findButton(container, strings.enterEdit)?.getAttribute("aria-pressed"),
      "the mode swap did not happen"
    ).toBe("true");
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
    // Nothing in the header exits edit mode any more (#863's pill is gone).
    expect(findButton(header(), strings.doneEditing)).toBeUndefined();
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

  it("edit mode: the header ⋮ opens the edit menu, with Done editing in it", async () => {
    await mountRecorder();
    await enterEdit();
    const opener = expectHeaderKebab("edit");
    await act(async () => opener.click());
    const body = mount.dom.window.document.body;
    expect(
      findButton(body, strings.doneEditing),
      "the edit menu's Done editing tile"
    ).toBeDefined();
  });

  it("the scissors toggle leaves edit mode, and the marker goes with it", async () => {
    await mountRecorder();
    await enterEdit();
    const toggle = findButton(container, strings.enterEdit)!;
    await act(async () => toggle.click());
    expect(
      findButton(container, strings.enterEdit)?.getAttribute("aria-pressed")
    ).toBe("false");
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

describe("the edit-mode toggle wears the scissors in both toolbars (#955)", () => {
  // #955 (the requirements owner, 2026-09-25) overturns #594: the toggle that
  // enters and leaves edit mode (`key="edit-toggle"`) shows the scissors, not
  // the `[ ]` selection brackets. Compared against a rendered `<Icon
  // name="scissors">` rather than a count of shapes, so ANY other glyph fails,
  // not only the brackets.
  //
  // The selection's own Cut control (`recorder.tsx`, under the band) is also
  // a scissors. The toolbar half of keeping the two apart is pinned here: the
  // toggle keeps the default 22px glyph on the raised `default` tile in the
  // bottom bar, where Cut is a bare `quiet` 26px glyph under the waveform.
  const scissorsMarkup = render(
    createElement(Icon, { name: "scissors" })
  ).querySelector("svg")!.innerHTML;

  function editToggle(mode: "record" | "edit"): HTMLButtonElement {
    const toggles = toolbarButtons(baseProps(mode)).filter(
      (button) => button.getAttribute("aria-label") === strings.enterEdit
    );
    expect(toggles, `edit toggles in the ${mode} toolbar`).toHaveLength(1);
    return toggles[0]!;
  }

  for (const [mode, pressed] of [
    ["record", "false"],
    ["edit", "true"],
  ] as const) {
    it(`${mode} toolbar: scissors glyph on the default tile at 22px, aria-pressed=${pressed}`, () => {
      const toggle = editToggle(mode);
      const svg = toggle.querySelector("svg");
      expect(svg, `no <svg> in the ${mode} edit toggle`).not.toBeNull();
      expect(svg!.innerHTML).toBe(scissorsMarkup);
      expect(svg!.getAttribute("width")).toBe("22");
      expect(toggle.classList.contains("control--quiet")).toBe(false);
      expect(toggle.getAttribute("aria-pressed")).toBe(pressed);
    });
  }
});
