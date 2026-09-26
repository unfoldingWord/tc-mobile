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

/**
 * The recorder's ≡ menu, now that it is its own component (#160, L-1).
 *
 * It had no test while it was a hundred lines inside a 4000-line component —
 * reaching it meant mounting the whole recorder with a mocked audio session.
 * As a component whose every input is a derived value, it is a props → rows
 * question, which is what these ask.
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
  editReason: null,
  markReason: null,
  eraseReason: null,
  onEnterEdit: vi.fn(),
  onToggleFinished: vi.fn(),
  onErase: vi.fn(),
  onExitEdit: vi.fn(),
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

  it("offers Edit, Mark finished and Erase in record mode", () => {
    show();
    expect(named(strings.enterEdit)).toBeDefined();
    expect(named(strings.markFinished(3))).toBeDefined();
    expect(named(strings.eraseSegment)).toBeDefined();
    expect(named(strings.doneEditing)).toBeUndefined();
  });

  it("offers Done and Erase in edit mode, and no Mark", () => {
    show({ mode: "edit" });
    expect(named(strings.doneEditing)).toBeDefined();
    expect(named(strings.eraseSegment)).toBeDefined();
    expect(named(strings.markFinished(3))).toBeUndefined();
    expect(named(strings.enterEdit)).toBeUndefined();
  });

  it("flips the Mark row's LABEL and its green mark on the same value", () => {
    // George R1: the paint and the label both key on `finishedState` — the
    // state the store will actually write — never on the displayed intent,
    // which can still read "finished" for a segment that was emptied.
    show({ finishedState: "finished" });
    const marked = named(strings.markUnfinished(3));
    expect(marked).toBeDefined();
    expect(marked?.className).toContain("is-done");

    show({ finishedState: "empty" });
    const unmarked = named(strings.markFinished(3));
    expect(unmarked).toBeDefined();
    expect(unmarked?.className).not.toContain("is-done");
  });

  it("keeps the paint and the label agreeing when the ordinal is missing", () => {
    // The two used to be separate expressions with different conditions: the
    // label required a non-null ordinal, the class did not. So this pair —
    // ordinal null, `finishedState` "finished" — painted the row GREEN under a
    // "Mark finished" label numbered 0, which is a row contradicting itself.
    //
    // The parent never sends this pair — a null ordinal means the view has not
    // loaded, and the `ordinal` prop's docblock traces why that always arrives
    // greyed. So this is defensive: it pins that the component stays
    // self-consistent without relying on its caller. That
    // is the whole reason the two expressions were collapsed into one, and
    // without this case reverting the collapse passes (George R1).
    show({ ordinal: null, finishedState: "finished" });
    const row = startingWith(strings.markFinished(0));
    expect(
      row,
      "the unmarked label is what a null ordinal shows"
    ).toBeDefined();
    expect(row?.className).not.toContain("is-done");
    expect(named(strings.markUnfinished(0))).toBeUndefined();
  });

  it("does NOT paint the green mark on a disabled-finished row", () => {
    // "disabled" is a never-recorded or emptied segment: the mark cannot
    // stick, so the row must not look as if it has.
    show({ finishedState: "disabled", markReason: "no-audio" });
    expect(startingWith(strings.markFinished(3))?.className).not.toContain(
      "is-done"
    );
  });

  it("greys a row and gives it a reason, rather than greying it silently", () => {
    // #135: a row that goes grey with no explanation is the defect. The reason
    // is passed in, so the gate and the hint cannot disagree.
    show({ editReason: "uncommitted-take" });
    const edit = startingWith(strings.enterEdit);
    // The reason is IN the accessible name, not only in a glyph.
    expect(edit?.getAttribute("aria-label")).toBe(
      `${strings.enterEdit}. ${strings.blockedByTake}`
    );
    // Reachable by keyboard WHILE it explains itself — `aria-disabled`, not
    // the native `disabled` that would drop it out of the Tab trap and strand
    // a switch user behind the scrim.
    expect(edit?.getAttribute("aria-disabled")).toBe("true");
    expect(edit?.hasAttribute("disabled")).toBe(false);
  });

  it("HARD-disables a row whose reason has nothing to say", () => {
    // The other half of the same rule, and the reason the hint is derived from
    // the reason rather than passed beside it: `rowHint` returns null for
    // "no-segment", so there is no explanation to keep focusable, and the row
    // takes the native `disabled` instead. A row that is soft-disabled with no
    // hint would be focusable AND silent — worse than either.
    show({ editReason: "no-segment" });
    const edit = named(strings.enterEdit);
    // Nothing appended: there was no reason with words to append.
    expect(edit?.hasAttribute("disabled")).toBe(true);
    expect(edit?.getAttribute("aria-disabled")).toBeNull();
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
    const sheet = readFileSync(
      path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
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
    expect(tag.slice(at, close + 1).replace(/\s+/g, "")).toBe(
      "onErase={()=>{setMenuOpen(false);setConfirmOpen(true);}}"
    );
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
