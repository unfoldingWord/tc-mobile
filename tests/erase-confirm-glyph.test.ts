import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EraseConfirm } from "@/components/erase-confirm";
import { Icon, type IconName } from "@/components/icon";
import { render } from "./render";

/**
 * EraseConfirm's `glyph` prop (#979, O4 G5 "Record again asks first").
 *
 * The workbench draws G5 as the 13 dialog with a record badge and a confirm
 * button carrying the record dot, where 13 has the bin in both places. The
 * prop picks that one icon for both spots; what it must NOT do is change the
 * dialog for a caller that does not pass it — the book delete, the failure
 * log's Clear and the segment Erase all rely on the default.
 *
 * Mounted with `createRoot` in a jsdom window, not through `tests/render.ts`:
 * the dialog portals to `<body>`, and `renderToStaticMarkup` cannot render a
 * portal. `render.ts` is still what draws the reference icons below, so the
 * comparison is against the `Icon` component's own markup, not a string typed
 * into this file.
 */

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "http://localhost/" }
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

/** The inner markup the `Icon` component draws for `name`. */
function iconInner(name: IconName): string {
  const svg = render(createElement(Icon, { name })).querySelector("svg");
  expect(svg, name).not.toBeNull();
  return svg!.innerHTML;
}

const base = {
  open: true,
  title: "Erase this recording?",
  confirmLabel: "Erase",
  cancelLabel: "Cancel",
  onConfirm: () => {},
  onCancel: () => {},
};

async function mount(extra: { glyph?: "trash" | "record" } = {}) {
  await act(async () => {
    root.render(createElement(EraseConfirm, { ...base, ...extra }));
  });
  const panel = document.querySelector(".confirm-panel");
  expect(panel, "the dialog is up").not.toBeNull();
  return panel!;
}

/** The badge's and the confirm button's icon markup. */
function glyphs(panel: Element) {
  const badge = panel.querySelector("svg.confirm-glyph");
  const buttons = panel.querySelectorAll(".confirm-actions > button");
  expect(badge, "badge").not.toBeNull();
  expect(buttons).toHaveLength(2);
  const confirmSvg = buttons[1]!.querySelector("svg");
  expect(confirmSvg, "confirm icon").not.toBeNull();
  return { badge: badge!.innerHTML, confirm: confirmSvg!.innerHTML };
}

describe("EraseConfirm's glyph (#979)", () => {
  it("the two reference icons differ, so the cases below can tell them apart", () => {
    expect(iconInner("record")).not.toBe(iconInner("trash"));
    expect(iconInner("record").length).toBeGreaterThan(0);
  });

  it("draws the bin in the badge and on the confirm when no glyph is passed", async () => {
    const g = glyphs(await mount());
    expect(g.badge).toBe(iconInner("trash"));
    expect(g.confirm).toBe(iconInner("trash"));
  });

  it("draws the record dot in the badge and on the confirm for glyph='record'", async () => {
    const g = glyphs(await mount({ glyph: "record" }));
    expect(g.badge).toBe(iconInner("record"));
    expect(g.confirm).toBe(iconInner("record"));
  });

  it("leaves Cancel's icon, the classes and the focus landing alone for glyph='record'", async () => {
    const panel = await mount({ glyph: "record" });
    const cancel = panel.querySelector<HTMLButtonElement>(".confirm-cancel");
    expect(cancel).not.toBeNull();
    expect(cancel!.querySelector("svg")!.innerHTML).toBe(iconInner("back"));
    expect(document.activeElement).toBe(cancel);
    expect(panel.querySelector("svg.confirm-glyph")).not.toBeNull();
  });

  it("renders byte-identical markup for glyph='trash' and for no glyph at all", async () => {
    const without = (await mount()).outerHTML;
    await act(async () => root.unmount());
    root = createRoot(dom.window.document.getElementById("root")!);
    const withTrash = (await mount({ glyph: "trash" })).outerHTML;
    expect(withTrash).toBe(without);
  });
});
