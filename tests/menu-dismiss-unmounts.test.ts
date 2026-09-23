import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu } from "@/components/menu";

import { render } from "./render";

/**
 * #621 on PR 656: a dismissed drawer is gone on the same render in which
 * `open` becomes false, and the drawer does not animate at all.
 *
 * That is the contract every caller of `Menu` is written against — each one
 * drops its own layer, its Back ownership and its "overlay up" flags in
 * `onClose`, and some replace the drawer with another surface in that same
 * render. A drawer kept mounted through an exit motion broke it in four
 * callers, and an animated entrance produced the same class on the way in, so
 * both halves of the motion were retired (the review triage on PR 656; the
 * motion is tracked on #706).
 *
 * The dismiss case stubs a running animation that never finishes. `menu.tsx`
 * no longer asks for animations, so today the stub changes nothing; it is kept
 * so that a future drawer which waits on its own motion before unmounting
 * fails here. jsdom has no Web Animations API, so without the stub such a
 * drawer would still vanish on the next microtask and pass.
 *
 * Client root inside a private jsdom window, as `menu-hamburger-header.test.ts`
 * does: `Menu` portals to `document.body` and binds in effects, which the
 * static harness in `./render` cannot mount.
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
  // Every element reports one running animation that never settles — the
  // browser mid-motion, frozen.
  Object.defineProperty(dom.window.Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished: new Promise<void>(() => {}) }],
  });
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount(open: boolean) {
  await act(async () => {
    root.render(createElement(Menu, { open, onClose: vi.fn() }));
  });
}

describe("a dismissed Menu unmounts on the render `open` drops (#621, pick B)", () => {
  it("leaves no scrim and no panel behind, even while the stylesheet is still animating", async () => {
    await mount(true);
    expect(document.querySelector(".menu-scrim")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await mount(false);
    expect(document.querySelector(".menu-scrim")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders nothing at all with `open={false}`", () => {
    const container = render(
      createElement(Menu, { open: false, onClose: () => {} })
    );
    expect(container.innerHTML).toBe("");
  });
});
