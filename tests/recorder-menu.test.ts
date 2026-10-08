// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";
import { strings } from "@/lib/strings";

import { stripComments } from "./support";

/**
 * The recorder's ⋮ menu, now that it is its own component (#160, L-1).
 *
 * It had no test while it was a hundred lines inside a 4000-line component —
 * reaching it meant mounting the whole recorder with a mocked audio session.
 * As a component whose every input is a derived value, it is a props → rows
 * question, which is what these ask. The tile grid's own layout, tones and
 * gating are `tests/recorder-menu-o4.test.ts`'s.
 *
 * `Menu` portals to `<body>`, so the queries go through `document`, not the
 * container.
 */

let root: Root;
let host: HTMLDivElement;

const base: RecorderMenuProps = {
  open: true,
  onClose: vi.fn(),
  mode: "record",
  ordinal: 3,
  finishedState: "empty",
  markReason: null,
  eraseReason: null,
  onToggleFinished: vi.fn(),
  onErase: vi.fn(),
};

function show(over: Partial<RecorderMenuProps> = {}) {
  act(() => root.render(createElement(RecorderMenu, { ...base, ...over })));
}
const buttons = () => [...document.querySelectorAll("button")];
const named = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === label);
// A hinted row's accessible name is `"{label}. {reason}"` (#135) — the reason
// JOINS the name rather than sitting somewhere only a sighted user finds it.
const startingWith = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label")?.startsWith(label));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("RecorderMenu", () => {
  it("shows nothing while closed", () => {
    show({ open: false });
    expect(buttons()).toHaveLength(0);
  });

  it("offers Mark finished and Erase in record mode, and no Edit (G3)", () => {
    show();
    expect(named(strings.markFinished(3))).toBeDefined();
    expect(named(strings.eraseSegment)).toBeDefined();
    // G3: the recorder screen carries its own edit control.
    expect(startingWith(strings.enterEdit)).toBeUndefined();
  });

  it("offers Erase in edit mode, and no Done or Mark (#1252)", () => {
    show({ mode: "edit" });
    // #1252 (the requirements owner): "Done" keeps one meaning, mark
    // finished; the toolbar's ✕ leaves edit mode.
    expect(
      buttons()
        .map((b) => b.getAttribute("aria-label") ?? "")
        .filter((name) => /done/i.test(name))
    ).toEqual([]);
    expect(named(strings.eraseSegment)).toBeDefined();
    expect(named(strings.markFinished(3))).toBeUndefined();
    expect(named(strings.enterEdit)).toBeUndefined();
  });

  it("never offers Delete segment, in either mode (#1104 — Delete moved to the chapter view)", () => {
    // #590/#1080 first shipped Delete segment as a row/tile in THIS menu; the
    // requirements owner's 2026-09-26 decision on #1104 pulled it back out:
    // "the menu inside the segment editor (recorder) shows Erase only.
    // Delete (removing the whole segment) belongs to the chapter view." A red
    // run of this exact case (against the pre-#1104 tree) failed on both
    // modes, which is what proves this file is asserting the removal rather
    // than an accident of never having built it.
    show();
    expect(named(strings.deleteSegment)).toBeUndefined();
    show({ mode: "edit" });
    expect(named(strings.deleteSegment)).toBeUndefined();
  });

  it("carries aria-pressed beside aria-disabled on a greyed, marked row (#351)", () => {
    // The pair #351 asked to check: a marked row frozen while its take commits
    // (`markRowReason`'s "uncommitted-take", which has a hint, #135)
    // is `aria-disabled` AND still says it is pressed, and its name is the
    // fixed label with the reason joined on.
    show({ finishedState: "finished", markReason: "uncommitted-take" });
    const row = startingWith(strings.markFinished(3));
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.getAttribute("aria-pressed")).toBe("true");
    expect(row?.getAttribute("aria-label")).toBe(
      `${strings.markFinished(3)}. ${strings.blockedByTake}`
    );
  });

  it("gates Erase in BOTH modes from the same reason", () => {
    // One `eraseReason` feeds the record-mode row and the edit-mode row, so
    // the two cannot drift into disagreeing about when erasing is allowed.
    show({ eraseReason: "no-clip" });
    expect(
      startingWith(strings.eraseSegment)?.getAttribute("aria-disabled")
    ).toBe("true");
    show({ mode: "edit", eraseReason: "no-clip" });
    expect(
      startingWith(strings.eraseSegment)?.getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("hands the erase tap to its caller, from either mode", () => {
    // Named for what it pins. This component cannot see whether the tap arms a
    // confirm or erases outright — it only calls the prop, and a caller that
    // erased immediately would leave this green. That half is pinned at the
    // source, in the case below (George R1).
    const onErase = vi.fn();
    show({ onErase });
    act(() => named(strings.eraseSegment)?.click());
    expect(onErase).toHaveBeenCalledTimes(1);

    show({ mode: "edit", onErase });
    act(() => named(strings.eraseSegment)?.click());
    expect(onErase).toHaveBeenCalledTimes(2);
  });

  it("the sheet's onErase ARMS the confirm — it does not erase", () => {
    // The claim the mount cannot make. Erase is the one row that can destroy a
    // recording, so what the sheet passes down has to be the two-statement
    // arming lambda and not a call into the erase itself. Read from source, and
    // bounded to the element rather than to end-of-file, so the strings cannot
    // be satisfied by some later comment.
    // `import.meta.url` is not a file: URL under this file's jsdom
    // environment, so resolve from `import.meta.dirname` — the same way
    // `tests/guided-ring.test.ts` reaches the tree.
    // Strip comments from the WHOLE FILE before locating the element, not
    // from the slice afterwards. This is the THIRD hole on this pin: (1) the
    // slice ran to end of file, (2) a comment INSIDE the slice satisfied the
    // regex, and (3) a block comment OPENING before `<RecorderMenu` leaves no
    // `/*` inside the slice, so a slice-level strip cannot see it — `indexOf`
    // then finds the decoy and the live handler is never read. Same read-then-
    // strip-then-search order `tests/menu-hamburger-header.test.ts` uses.
    // The shared strip, because a line-anchored one keeps a comment
    // trailing a code line, and `indexOf` would find a whole arming
    // `<RecorderMenu … />` written there ahead of the live one (#822).
    const sheet = stripComments(
      readFileSync(
        path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
        "utf8"
      )
    );
    const open = sheet.indexOf("<RecorderMenu");
    const end = sheet.indexOf("/>", open);
    expect(open, "no <RecorderMenu in the sheet").toBeGreaterThan(-1);
    expect(end, "unterminated <RecorderMenu").toBeGreaterThan(open);
    const tag = sheet.slice(open, end);

    // An allow-list of ONE, not a denylist (#830). The earlier shape matched
    // the body up to its first `}` and then checked it against two forbidden
    // words, and it was fooled five ways: a trailing `//` on a code line
    // survives the line-anchored strip above, a nested block hides whatever
    // follows its `}`, and any destructive call not named `erase` or
    // `clearSegmentTake` passed. Taking the WHOLE attribute to its matching
    // brace and requiring it to equal the two arming statements exactly
    // closes all of them: a comment, an extra statement or a renamed call
    // each change the text. It fails closed on purpose — a harmless edit to
    // this handler turns it red too, and on the control that erases a
    // recording, making someone look is the point.
    const attr = "onErase={";
    const at = tag.indexOf(attr);
    expect(at, "no onErase on <RecorderMenu>").toBeGreaterThan(-1);
    expect(tag.indexOf(attr, at + 1), "a second onErase").toBe(-1);
    let depth = 0;
    let close = -1;
    for (let i = at + attr.length - 1; i < tag.length; i++) {
      if (tag[i] === "{") depth++;
      else if (tag[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    expect(close, "unbalanced onErase braces").toBeGreaterThan(at);
    // `setConfirmFor("erase")` (#862): the dialog also asks the clipboard's
    // discard question, so this door names which one it opens — still only
    // arming the confirm, never erasing.
    expect(tag.slice(at, close + 1).replace(/\s+/g, "")).toBe(
      'onErase={()=>{setMenuOpen(false);setConfirmFor("erase");setConfirmOpen(true);}}'
    );
  });

  it("the sheet no longer wires an onDeleteSegment prop to <RecorderMenu> (#1104)", () => {
    // The negative half of the removal: not only does the RENDERED menu omit
    // Delete (the case above), the SHEET's own JSX no longer even offers a
    // prop for it — so a future edit cannot silently wire a fresh delete
    // handler back onto this menu without touching this test.
    const sheet = stripComments(
      readFileSync(
        path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
        "utf8"
      )
    );
    const open = sheet.indexOf("<RecorderMenu");
    const end = sheet.indexOf("/>", open);
    expect(open, "no <RecorderMenu in the sheet").toBeGreaterThan(-1);
    expect(end, "unterminated <RecorderMenu").toBeGreaterThan(open);
    const tag = sheet.slice(open, end);
    expect(tag.indexOf("onDeleteSegment"), "onDeleteSegment still wired").toBe(
      -1
    );
    expect(tag.indexOf("deleteReason"), "deleteReason still wired").toBe(-1);
  });

  it("does not close itself when the finished mark is toggled", () => {
    // The record-and-mark-done-in-one-sheet flow: the row re-renders in place
    // so the check turns green under the translator's thumb.
    const onToggleFinished = vi.fn();
    const onClose = vi.fn();
    show({ onToggleFinished, onClose });
    act(() => named(strings.markFinished(3))?.click());
    expect(onToggleFinished).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
