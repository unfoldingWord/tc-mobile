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
import type { UseEraseSegment } from "@/hooks/use-erase-segment";
import type { SegmentId } from "@/types/domain";

import { render } from "./render";
import { mountInteractive, type InteractiveMount } from "./interactive-mount";

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
 * #863 (the requirements owner's rule, verbatim on #608): "≡ is used only at
 * the top right, and while the 'Editing' pill occupies that slot, no ≡ is
 * shown. The edit toolbar's menu opener becomes ⋮."
 *
 * `RecorderToolbar` (`recorder-toolbars.tsx`, the #160/#668 split) is the
 * bottom bar in both modes and IS render-testable through `tests/render.ts` —
 * it is presentational, with no hooks of its own.
 *
 * The header that carries record mode's ≡ and the "Editing" pill lives inside
 * `recorder.tsx`, which mounts the whole audio hook graph, so it cannot go
 * through `./render`'s STATIC harness (`renderToStaticMarkup` runs no effects
 * and dispatches no events, and the mode swap below is driven by a click, not
 * a prop). #890 item 2 (George r1 on #887) asked for the step up that harness's
 * own docblock names instead of another source-read point regex: a
 * `react-dom/client` root inside its own jsdom window, `act()`-wrapped, the
 * same shape `tests/menu-hamburger-header.test.ts` already uses for `Menu`
 * (which also cannot mount through `./render` — it portals to `document.body`).
 *
 * This mounts the REAL `Recorder`, with only the boundary `recorder-rerecord-
 * control.test.ts` already mocks (the segment load, and the three canvas/level
 * components with no bearing on the header). Everything else in the tree is
 * real, including every effect — which is what makes this safe to run
 * interactively rather than statically:
 *
 * - `WaveformScroller`'s and `PlayheadOverlay`'s rAF loops both start only
 *   while a buffer is actually sounding (`active` / `stage.render ===
 *   "scroll"`, gated on `audio.playingBuffer`) — false throughout, since
 *   nothing here ever calls `playBuffer`. Neither loop ever starts, so no
 *   `requestAnimationFrame` stub is needed and no rAF is left running past a
 *   test's `act()`.
 * - `Menu`'s portal is gated on its own `open` prop (`if (!open) return
 *   null`), and `menuOpen` starts and stays `false` here.
 * - The one bare global the mounted tree touches is `getComputedStyle` (the
 *   paste-row probe, `recorder.tsx`), which is why it is stubbed alongside
 *   `window`/`document` below — proven by running the mount without it: it
 *   throws `getComputedStyle is not defined` rather than passing quietly.
 *
 * The "more" glyph (`icon.tsx`) draws three `<circle>` elements and no
 * `<path>`; "menu" draws one `<path>` (three horizontal rules) and no
 * `<circle>`. Counting both shapes, the way
 * `tests/share-progress-busy-glyph.test.ts` already does for its own busy-vs-
 * settled glyph pair, is what makes a revert back to "menu" provably fail
 * rather than passing on a coincidental read of the same `<svg>` — the header
 * opener and the edit toolbar's opener share one accessible name
 * (`strings.recorderMenuOpen`), so a name-only check cannot tell them apart.
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
}

/** Every button in the bar whose accessible name is "More actions". */
function menuOpeners(props: RecorderToolbarProps): HTMLButtonElement[] {
  const container = render(createElement(RecorderToolbar, props));
  return [...container.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === strings.recorderMenuOpen
  ) as HTMLButtonElement[];
}

describe("the edit toolbar's menu opener wears ⋮, not ≡ (#863)", () => {
  it("renders the kebab (three dots, no path), not the hamburger (one path, no dots)", () => {
    const [opener] = menuOpeners(baseProps("edit"));
    expect(
      opener,
      "no 'More actions' control in the edit toolbar"
    ).toBeDefined();
    const svg = opener!.querySelector("svg")!;
    expect(svg.querySelectorAll("circle").length).toBe(3);
    expect(svg.querySelectorAll("path").length).toBe(0);
  });

  it("keeps the same accessible name and disabled gate the ≡ opener had", () => {
    // #890 item 1 (George r1 on #887): each of the three cases below used to
    // index `[0]!` straight off `menuOpeners(...)` — if the control ever went
    // missing this would fail with a bare `TypeError` on a null read instead
    // of a real assertion message. Asserting the opener exists first, the way
    // the kebab-shape case above already does, is what turns that into a
    // named failure.
    const enabledOpeners = menuOpeners(baseProps("edit"));
    expect(
      enabledOpeners[0],
      "no 'More actions' control in the edit toolbar (enabled case)"
    ).toBeDefined();
    const enabled = enabledOpeners[0]!;
    expect(enabled.getAttribute("aria-label")).toBe(strings.recorderMenuOpen);
    expect(enabled.hasAttribute("disabled")).toBe(false);

    const disabledProps = baseProps("edit");
    disabledProps.hasView = false;
    const disabledOpeners = menuOpeners(disabledProps);
    expect(
      disabledOpeners[0],
      "no 'More actions' control in the edit toolbar (disabled case)"
    ).toBeDefined();
    const disabled = disabledOpeners[0]!;
    expect(disabled.hasAttribute("disabled")).toBe(true);

    const closingProps = baseProps("edit");
    closingProps.isClosing = true;
    const closingOpeners = menuOpeners(closingProps);
    expect(
      closingOpeners[0],
      "no 'More actions' control in the edit toolbar (closing case)"
    ).toBeDefined();
    const closing = closingOpeners[0]!;
    expect(closing.hasAttribute("disabled")).toBe(true);
  });

  it("record mode carries no menu opener of its own — that control lives in the header (#160 split)", () => {
    expect(menuOpeners(baseProps("record"))).toHaveLength(0);
  });
});

describe("record mode's header opener stays ≡, and the Editing pill hides it in edit mode (#608, #863)", () => {
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
    // be torn down, or they leak into later tests in the same worker (#907
    // item 2, George r1 on #902).
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
    // Resting erase: this suite never opens the confirm, but the sheet reads
    // `erase.isErasing` during render, so the prop cannot be absent (#160 L-12).
    const erase: UseEraseSegment = {
      erase: vi.fn(async () => "ok" as const),
      erasing: false,
      isErasing: () => false,
    };
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

  function findButton(
    scope: Element,
    label: string
  ): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === label
    ) as HTMLButtonElement | undefined;
  }

  it("record mode's header carries a ≡ (menu) opener, not the toolbar's ⋮", async () => {
    await mountRecorder();
    const opener = findButton(header(), strings.recorderMenuOpen);
    expect(opener, "no ≡ opener in the header").toBeDefined();
    const svg = opener!.querySelector("svg");
    // #907 item 1 (George r1 on #902): assert the <svg> exists, with a
    // message, before reading path/circle counts off it — a button rendered
    // with no <svg> must fail here with a named assertion, not a bare
    // TypeError off a non-null assertion on `null`.
    expect(svg, "no <svg> in the ≡ opener").not.toBeNull();
    // The exact shape, not just the name: the header's ≡ opener and the edit
    // toolbar's ⋮ opener both carry `strings.recorderMenuOpen` as their
    // accessible name (see `menuOpeners` above), so only the glyph — not the
    // aria-label — can tell a wrongly-swapped icon from the real one.
    expect(svg!.querySelectorAll("path").length).toBe(1);
    expect(svg!.querySelectorAll("circle").length).toBe(0);
    expect(header().querySelector(".modepill")).toBeNull();
  });

  it("entering edit mode leaves no button named recorderMenuOpen in the header, and the Editing pill carries no glyph of its own", async () => {
    // #907 item 3 (George r1 on #902): this title used to claim "no ≡ is left
    // anywhere in the header", which is a visual claim the assertions below
    // don't make. What they actually check is (a) no *button* whose
    // accessible name is `strings.recorderMenuOpen` survives into edit mode,
    // and (b) the Editing pill itself renders no `<svg>` — the shape check
    // that rules out the pill being mistaken for a leftover opener glyph.
    // That is the right check for the #890 bug: a name-only check can't tell
    // a real ≡ removal from a coincidental re-render, and a full-header scan
    // (not sliced to the pill) is what #890 item 2 fixed.
    await mountRecorder();
    const enterEdit = findButton(container, strings.enterEdit);
    expect(
      enterEdit,
      "no Enter edit control to drive the mode swap"
    ).toBeDefined();
    await act(async () => enterEdit!.click());

    // Scanned over the WHOLE header element, not sliced to the pill — this is
    // #890 item 2's fix: the old source-read bounded its slice to the pill's
    // first `</button>`, so nothing rendered after it in the same branch was
    // ever checked. A real render has no "after the slice" left to miss.
    const opener = findButton(header(), strings.recorderMenuOpen);
    expect(opener, "≡ opener must not survive into edit mode").toBeUndefined();

    const pill = header().querySelector(".modepill");
    expect(pill, "no Editing pill in the header").not.toBeNull();
    expect(pill!.getAttribute("aria-label")).toBe(strings.doneEditing);
    expect(pill!.textContent).toBe(strings.modepillEditing);
    // The shape check: the pill is a plain text control — no icon of its own
    // to confuse with either opener glyph.
    expect(pill!.querySelector("svg")).toBeNull();
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
    const container = render(createElement(RecorderToolbar, baseProps(mode)));
    const toggles = [...container.querySelectorAll("button")].filter(
      (button) => button.getAttribute("aria-label") === strings.enterEdit
    );
    expect(toggles, `edit toggles in the ${mode} toolbar`).toHaveLength(1);
    return toggles[0] as HTMLButtonElement;
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
