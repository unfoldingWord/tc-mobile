import { readFileSync } from "node:fs";
import { createElement, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import {
  RecorderToolbar,
  type RecorderToolbarProps,
} from "@/components/recorder-toolbars";
import { strings } from "@/components/strings";

import { render } from "./render";

/**
 * #863 (the requirements owner's rule, verbatim on #608): "≡ is used only at
 * the top right, and while the 'Editing' pill occupies that slot, no ≡ is
 * shown. The edit toolbar's menu opener becomes ⋮."
 *
 * `RecorderToolbar` (`recorder-toolbars.tsx`, the #160/#668 split) is the
 * bottom bar in both modes and IS render-testable through `tests/render.ts` —
 * it is presentational, with no hooks of its own. The header that carries
 * record mode's ≡ and the "Editing" pill is not: it lives inside
 * `recorder.tsx`, which mounts the audio hook graph, so
 * `tests/recorder-zoom-gate.test.ts` and `tests/menu-hamburger-header.test.ts`
 * already document the same limit and read it as source instead. The second
 * `describe` below follows that precedent for the header half of this rule.
 *
 * The "more" glyph (`icon.tsx`) draws three `<circle>` elements and no
 * `<path>`; "menu" draws one `<path>` (three horizontal rules) and no
 * `<circle>`. Counting both shapes, the way
 * `tests/share-progress-busy-glyph.test.ts` already does for its own busy-vs-
 * settled glyph pair, is what makes a revert back to "menu" provably fail
 * rather than passing on a coincidental read of the same `<svg>`.
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
    const enabled = menuOpeners(baseProps("edit"))[0]!;
    expect(enabled.getAttribute("aria-label")).toBe(strings.recorderMenuOpen);
    expect(enabled.hasAttribute("disabled")).toBe(false);

    const disabledProps = baseProps("edit");
    disabledProps.hasView = false;
    const disabled = menuOpeners(disabledProps)[0]!;
    expect(disabled.hasAttribute("disabled")).toBe(true);

    const closingProps = baseProps("edit");
    closingProps.isClosing = true;
    const closing = menuOpeners(closingProps)[0]!;
    expect(closing.hasAttribute("disabled")).toBe(true);
  });

  it("record mode carries no menu opener of its own — that control lives in the header (#160 split)", () => {
    expect(menuOpeners(baseProps("record"))).toHaveLength(0);
  });
});

describe("record mode's header opener stays ≡, and the Editing pill hides it in edit mode (#608, #863)", () => {
  // Same source-shape reasoning as `tests/recorder-zoom-gate.test.ts`:
  // `recorder.tsx` cannot be rendered through the static harness, so the
  // header's two branches are read as text. Comments are stripped first, the
  // way that file and `tests/menu-hamburger-header.test.ts` do, so a comment
  // mentioning either icon literal cannot satisfy or defeat the match.
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sheet = strip(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );

  const recordBranchStart = sheet.indexOf('mode === "record" ? (');
  const pillStart = sheet.indexOf('className="modepill"');

  it("both header branches are present, in the expected order", () => {
    expect(recordBranchStart, "no header mode ternary found").toBeGreaterThan(
      -1
    );
    expect(pillStart, "no Editing pill found").toBeGreaterThan(
      recordBranchStart
    );
  });

  it('record mode\'s header control is icon="menu" (≡)', () => {
    const recordBranch = sheet.slice(recordBranchStart, pillStart);
    expect(recordBranch).toMatch(/icon="menu"/);
    expect(recordBranch).not.toMatch(/icon="more"/);
  });

  it("edit mode's header slot is the Editing pill, not a Control — no ≡ there", () => {
    // Bounded to the pill's own element, not to end of file: reading to EOF
    // would also cross the bottom edit toolbar's own `icon="more"` control
    // lower in the file, which is a different control (#863) and out of
    // scope here.
    const pillEnd = sheet.indexOf("</button>", pillStart);
    expect(pillEnd, "unterminated Editing pill button").toBeGreaterThan(
      pillStart
    );
    const pillOnly = sheet.slice(pillStart, pillEnd);
    expect(pillOnly).not.toMatch(/icon="menu"/);
    expect(pillOnly).not.toMatch(/icon="more"/);
  });
});
