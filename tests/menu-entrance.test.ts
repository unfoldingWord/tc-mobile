import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu } from "@/components/menu";

/**
 * #621: the drawer's slide-IN, and the ~140 ms entrance window in which what
 * the drawer shows and what it does must still agree (George r3 on PR 656).
 *
 * - The scrim is the full-screen hit target from its first frame, so it must
 *   be visible from its first frame too: the entrance fades the scrim's
 *   BACKGROUND in, never the wrapper's `opacity` (which also made the panel
 *   translucent, and left an invisible scrim eating a tap meant for Pause).
 * - Focus lands in the panel while it is still off the right edge, so it must
 *   not scroll anything to get there: `preventScroll`, a scrim that clips
 *   instead of scrolling, and the slide on a wrapper that does not scroll,
 *   never on the `overflow-y: auto` panel.
 */

describe("the drawer's entrance in the stylesheet", () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, "..", "src/app/styles/3-components.css"),
    "utf8"
  );
  // The menu shell's block, sliced between its own section header and the
  // next one, with comments removed before any declaration is matched: prose
  // in this file names selectors and properties on purpose.
  const start = css.indexOf("/* --- the menu shell");
  const block = css
    .slice(start, css.indexOf("/* ---", start + 1))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations of the first rule whose selector is exactly `selector`. */
  function declarations(selector: string): [string, string][] {
    const at = block.search(
      new RegExp(
        `(^|[\\s}])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`
      )
    );
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
    const open = block.indexOf("{", at);
    // A keyframes rule nests one level; take up to its matching close.
    let depth = 0;
    let end = open;
    for (; end < block.length; end++) {
      if (block[end] === "{") depth++;
      if (block[end] === "}" && --depth === 0) break;
    }
    const body = block.slice(open + 1, end);
    const found = [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map(
      ([, prop = "", value = ""]) => [prop, value.trim()] as [string, string]
    );
    expect(found.length, `${selector} declares nothing`).toBeGreaterThan(0);
    return found;
  }

  it("slices a real block", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(".menu-panel");
  });

  it("fades the scrim's background in, not its opacity — the panel is opaque from the first frame", () => {
    const keyframes = declarations("@keyframes menu-scrim-in");
    expect(keyframes.map(([p]) => p)).not.toContain("opacity");
    expect(keyframes).toContainEqual(["background-color", "transparent"]);
    // The colour it fades TO is the layer-2 role on the base rule.
    expect(declarations(".menu-scrim")).toContainEqual([
      "background",
      "var(--s-scrim)",
    ]);
    expect(declarations(".menu-scrim")).toContainEqual([
      "animation",
      "menu-scrim-in var(--p-dur-base) var(--p-ease)",
    ]);
  });

  it("slides a wrapper that does not scroll, never the scrolling panel", () => {
    const panel = declarations(".menu-panel");
    expect(panel).toContainEqual(["overflow-y", "auto"]);
    expect(panel.map(([p]) => p)).not.toContain("animation");
    expect(panel.map(([p]) => p)).not.toContain("transform");

    const drawer = declarations(".menu-drawer");
    expect(drawer).toContainEqual([
      "animation",
      "menu-panel-in var(--p-dur-base) var(--p-ease)",
    ]);
    expect(drawer.map(([p]) => p).some((p) => p.startsWith("overflow"))).toBe(
      false
    );
    expect(declarations("@keyframes menu-panel-in")).toContainEqual([
      "transform",
      "translateX(100%)",
    ]);
  });

  it("clips the scrim instead of making it a scroll container, with `hidden` only as the fallback for engines without `clip`", () => {
    const overflow = declarations(".menu-scrim").filter(([p]) =>
      p.startsWith("overflow")
    );
    // The LAST declaration wins where `clip` parses; `hidden` before it is
    // what an engine without `clip` keeps.
    expect(overflow).toEqual([
      ["overflow", "hidden"],
      ["overflow", "clip"],
    ]);
  });

  it("switches both entrance animations off under reduced motion", () => {
    const mediaAt = block.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaAt).toBeGreaterThan(-1);
    const media = block.slice(mediaAt, block.indexOf("}\n  }", mediaAt));
    expect(media).toContain(".menu-scrim");
    expect(media).toContain(".menu-drawer");
    expect(media).toMatch(/animation:\s*none/);
  });
});

describe("the drawer's open-edge focus", () => {
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

  it("lands on the first action without scrolling anything to reach it", async () => {
    const focus = vi.spyOn(dom.window.HTMLElement.prototype, "focus");
    await act(async () => {
      root.render(
        createElement(
          Menu,
          { open: true, onClose: vi.fn() },
          createElement("button", { type: "button" }, "Action")
        )
      );
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(
      (focus.mock.contexts[0] as HTMLElement | undefined)?.textContent
    ).toBe("Action");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
