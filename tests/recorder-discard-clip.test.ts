import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bodyAfter, region, stripComments, uniqueIndexOf } from "./support";

/**
 * The clipboard's bin (#862): a greyed trash can under the red line, while
 * the clipboard holds a cut, that opens the whole-take erase's confirm dialog
 * and, confirmed, empties the clipboard and lets a selection frame back.
 *
 * Source shape, for the reason `tests/recorder-cut-collapse.test.ts` gives:
 * `recorder.tsx` cannot be rendered here. The behaviour itself — cancel keeps
 * the cut, confirm empties it and the frame returns, the erase door still
 * asks the erase question — is `e2e/recorder-discard-clip.spec.ts`, against
 * the shipped build in Chromium. Neither is a device check.
 */

const recorder = stripComments(
  readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  )
);

describe("the clipboard's bin (#862)", () => {
  it("sits in the reserved row under the canvas, gated like the paste marker and never beside the scissors", () => {
    const rowAt = uniqueIndexOf(recorder, '<div className="recorder-cut');
    const labelAt = recorder.indexOf("label={strings.discardClip}", rowAt);
    const block = region(recorder, {
      from: rowAt,
      to: recorder.indexOf("onClick={onDiscardClip}", labelAt),
    });
    // The paste marker's own gate, term for term, so the two come and go
    // together...
    for (const term of [
      "idleEditable &&",
      "editor.canPaste &&",
      "zoomPan === null &&",
      "!stage.windowControlsInert &&",
    ]) {
      expect(block).toContain(term);
    }
    // ...plus no open frame: a frame means the clipboard was already empty,
    // and the row then holds the scissors.
    expect(block).toContain("!editor.selectionActive &&");
    expect(block).toMatch(/icon="trash"/);
    expect(block).toMatch(/variant="quiet"/);
  });

  it("opens the shared confirm asking the discard question, and does not touch the clipboard itself", () => {
    const body = bodyAfter(recorder, "const onDiscardClip = useCallback(");
    expect(body).toMatch(/setConfirmFor\("clip"\)/);
    expect(body).toMatch(/setConfirmOpen\(true\)/);
    expect(body).not.toMatch(/onClipboardChange/);
  });

  it("confirmed, empties the clipboard, lifts the cut collapse and closes the dialog", () => {
    const body = bodyAfter(
      recorder,
      "const onConfirmDiscardClip = useCallback("
    );
    expect(body).toMatch(/onClipboardChange\(null\)/);
    expect(body).toMatch(/reopenFrame\(\)/);
    expect(body).toMatch(/setConfirmOpen\(false\)/);
  });

  it("every door into the dialog names the question it opens", () => {
    // A door that opened the dialog without setting `confirmFor` would ask
    // whatever the last door asked — after a Back-dismissed discard, the
    // menu's Erase would confirm a discard and the take would stay.
    const opens = [...recorder.matchAll(/setConfirmOpen\(true\)/g)];
    expect(opens.length).toBeGreaterThanOrEqual(3);
    for (const open of opens) {
      const before = recorder.slice(Math.max(0, open.index - 80), open.index);
      expect(before).toMatch(/setConfirmFor\("(erase|clip)"\);\s*$/);
    }
    const dialog = region(recorder, {
      from: uniqueIndexOf(recorder, "<EraseConfirm"),
      to: recorder.indexOf("/>", recorder.indexOf("<EraseConfirm")),
    });
    expect(dialog).toMatch(
      /confirmFor === "clip" \? onConfirmDiscardClip : onConfirmErase/
    );
  });
});
