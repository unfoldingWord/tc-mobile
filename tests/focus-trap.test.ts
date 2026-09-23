// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FOCUSABLE, wrapTab } from "@/components/focus-trap";

/**
 * The Tab wrap shared by `Menu` and `EraseConfirm` (#160, L-15).
 *
 * It had no test before this: the logic lived twice inside a `useEffect` in a
 * component, and the only way to reach it was to render the dialog and
 * dispatch keys. Extracting it made it a function jsdom can exercise directly,
 * which is most of the reason to extract it — the wrap is the part of a modal
 * a keyboard or switch user depends on, and nothing was checking it.
 */

function panelWith(html: string): HTMLElement {
  document.body.innerHTML = `<div id="panel">${html}</div>`;
  return document.getElementById("panel")!;
}

function tab(shift = false): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift });
  vi.spyOn(e, "preventDefault");
  return e;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("wrapTab", () => {
  it("sends Tab on the LAST control round to the first", () => {
    const panel = panelWith(
      `<button id="a">a</button><button id="b">b</button>`
    );
    document.getElementById("b")!.focus();

    const e = tab();
    wrapTab(panel, e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("a");
  });

  it("sends Shift+Tab on the FIRST control round to the last", () => {
    const panel = panelWith(
      `<button id="a">a</button><button id="b">b</button>`
    );
    document.getElementById("a")!.focus();

    const e = tab(true);
    wrapTab(panel, e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("b");
  });

  it("leaves a Tab in the MIDDLE to the browser", () => {
    const panel = panelWith(
      `<button id="a">a</button><button id="b">b</button><button id="c">c</button>`
    );
    document.getElementById("b")!.focus();

    const e = tab();
    wrapTab(panel, e);

    // The browser's own Tab is what moves b → c. Calling preventDefault here
    // would strand focus on b.
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("b");
  });

  it("wraps a ONE-control panel to itself, in both directions", () => {
    // A real shape, not a corner: the chapter menu holds a single action
    // (Share chapter, B7). `first` and `last` are the same node, so both
    // branches must fire or Tab walks out of an open menu.
    const panel = panelWith(`<button id="only">only</button>`);
    document.getElementById("only")!.focus();

    const forward = tab();
    wrapTab(panel, forward);
    expect(forward.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("only");

    const back = tab(true);
    wrapTab(panel, back);
    expect(back.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("only");
  });

  it("leaves a panel with nothing focusable alone, so Tab escapes it", () => {
    // The observable contract, and the reason both dialogs keep one control
    // enabled while busy rather than relying on the trap: with nothing to hold,
    // the wrap does not hold.
    //
    // NOT a check of the `!first || !last` line. Deleting that line leaves all
    // eight cases here green — with no focusables, `first` and `last` are
    // `undefined` and neither comparison can match, so the no-op falls out of
    // the comparisons themselves. The line is what makes it EXPRESSIBLE under
    // `noUncheckedIndexedAccess`, and removing it fails `tsc` (TS18048 on both
    // `last.focus()` and `first.focus()`), which is the check on it.
    const panel = panelWith(`<p>no controls</p>`);
    const e = tab();

    expect(() => wrapTab(panel, e)).not.toThrow();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("treats an aria-disabled row as part of the trap (#135)", () => {
    // A hinted row is focusable and holds its place in the Tab order, which is
    // how its reason is announced. So it can be the LAST control, and the wrap
    // has to turn on it.
    const panel = panelWith(
      `<button id="a">a</button><button id="hinted" aria-disabled="true">hinted</button>`
    );
    document.getElementById("hinted")!.focus();

    const e = tab();
    wrapTab(panel, e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("a");
  });

  it("skips a natively disabled control, so the wrap turns on the live one", () => {
    // The recorder menu at idle: Erase disabled, Edit live. A disabled `last`
    // would never turn the wrap and Tab would escape the panel.
    const panel = panelWith(
      `<button id="a">a</button><button id="live">live</button><button id="dead" disabled>dead</button>`
    );
    document.getElementById("live")!.focus();

    const e = tab();
    wrapTab(panel, e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("a");
  });

  it("matches the controls a dialog is actually built from", () => {
    const panel = panelWith(
      `<button>b</button><a href="#x">link</a><input /><div tabindex="0">div</div>` +
        `<div tabindex="-1">skipped</div><button disabled>off</button><input disabled />`
    );
    const matched = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(matched.map((el) => el.tagName.toLowerCase())).toEqual([
      "button",
      "a",
      "input",
      "div",
    ]);
  });
});
