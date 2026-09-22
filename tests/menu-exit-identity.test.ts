import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Menu } from "@/components/menu";

/**
 * An exiting `Menu` is paint, not a dialog (#621, fix class C1 on PR 656).
 *
 * The drawer stays mounted for one exit motion after `open` drops, so that it
 * can slide back off the right edge. During that window it must not present
 * as a modal dialog — `aria-hidden`, no `aria-modal` — and the moment a
 * sibling `Menu` opens, the exiting one must unmount at once rather than wait
 * for its animation. Otherwise two modal dialogs exist together: every locator
 * that finds a menu by role or class resolves to both (the two CI failures on
 * PR 656 — `e2e/recorder-selection.spec.ts:8`, `e2e/back-navigation.spec.ts:506`),
 * and assistive technology can hear two dialogs at once.
 *
 * The exit is held open here with a `getAnimations` stub whose `finished`
 * never settles — the stand-in for the stylesheet's 140 ms — so what this
 * proves is the identity drop and the sibling-triggered unmount, not the
 * timer. jsdom has no Web Animations API of its own; the control case below
 * shows the stub is what holds the exit, so the other cases are not passing
 * because the exit already ended.
 */

let dom: JSDOM;
let root: Root;
const noop = () => undefined;

function holdAnimations(dom: JSDOM): void {
  Object.defineProperty(dom.window.HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [{ finished: new Promise<never>(() => undefined) }],
  });
}

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
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

async function render(first: boolean, second: boolean): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Menu, { open: first, onClose: noop, title: "First" }),
        createElement(Menu, { open: second, onClose: noop, title: "Second" })
      )
    );
  });
}

/** The dialogs assistive technology (and a role locator) can see. */
function dialogs(): string[] {
  return [
    ...document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"])'),
  ].map((el) => el.getAttribute("aria-label") ?? "");
}
function panels(): number {
  return document.querySelectorAll(".menu-panel").length;
}

it("control: with nothing animating, a dismissed menu is gone on the next microtask", async () => {
  await render(true, false);
  expect(panels()).toBe(1);
  await render(false, false);
  expect(panels()).toBe(0);
});

it("while exiting, the drawer is still painting but no longer presents as a dialog", async () => {
  holdAnimations(dom);
  await render(true, false);
  expect(dialogs()).toEqual(["First"]);

  await render(false, false);

  expect(panels()).toBe(1);
  expect(dialogs()).toEqual([]);
  const panel = document.querySelector(".menu-panel")!;
  expect(panel.getAttribute("aria-hidden")).toBe("true");
  expect(panel.hasAttribute("aria-modal")).toBe(false);
});

it("a sibling opening mid-exit unmounts the exiting drawer at once — one panel, one dialog", async () => {
  holdAnimations(dom);
  await render(true, false);
  await render(false, false);
  expect(panels()).toBe(1);

  await render(false, true);

  expect(panels()).toBe(1);
  expect(dialogs()).toEqual(["Second"]);
});

it("a menu dismissed while a sibling is ALREADY open skips its exit — the order Create book produces, where the row's ≡ is on the shelf before the dialog closes", async () => {
  holdAnimations(dom);
  await render(true, true);
  expect(panels()).toBe(2);

  await render(false, true);

  expect(panels()).toBe(1);
  expect(dialogs()).toEqual(["Second"]);
});

/**
 * The exit is the DRAWER's motion, not its contents' (George r1 P1 on PR 656).
 * A child that animates forever — the Confirm control's `aria-busy` spin,
 * which New Book leaves on after a successful create — must not hold the
 * drawer mounted. This stub answers a subtree query with a never-settling
 * animation (the shape the old wait asked for) and the scrim's and panel's own
 * queries with nothing, so the case is red against a subtree wait and green
 * against a wait on the two elements the stylesheet actually animates.
 */
function holdChildAnimationsOnly(dom: JSDOM): void {
  const pending = { finished: new Promise<never>(() => undefined) };
  Object.defineProperty(dom.window.HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement, options?: { subtree?: boolean }) {
      if (options?.subtree) return [pending];
      const own =
        this.classList.contains("menu-scrim") ||
        this.classList.contains("menu-panel");
      return own ? [] : [pending];
    },
  });
}

let probeMounts = 0;
function Probe() {
  const [mount] = useState(() => ++probeMounts);
  return createElement("span", { "data-mount": mount });
}

async function renderWithProbe(open: boolean): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        Menu,
        { open, onClose: noop, title: "First" },
        createElement(Probe)
      )
    );
  });
}

it("a child animating forever (the busy Confirm's spin) does not hold the exit — the drawer is gone once its own motion is", async () => {
  holdChildAnimationsOnly(dom);
  await render(true, false);
  expect(panels()).toBe(1);

  await render(false, false);

  expect(panels()).toBe(0);
});

it("reopening mid-exit remounts the children — a cancelled half-typed name never comes back", async () => {
  holdAnimations(dom);
  await renderWithProbe(true);
  const first = document
    .querySelector("[data-mount]")!
    .getAttribute("data-mount");
  await renderWithProbe(false);
  expect(panels()).toBe(1);

  await renderWithProbe(true);

  const second = document
    .querySelector("[data-mount]")!
    .getAttribute("data-mount");
  expect(second).not.toBe(first);
});

it("while exiting, the scrim still shields the screen (hit-testable, click ignored) and only the contents are inert", async () => {
  holdAnimations(dom);
  const onClose = vi.fn();
  await act(async () => {
    root.render(createElement(Menu, { open: true, onClose, title: "First" }));
  });
  await act(async () => {
    root.render(createElement(Menu, { open: false, onClose, title: "First" }));
  });
  const scrim = document.querySelector(".menu-scrim")!;
  expect(scrim.hasAttribute("inert")).toBe(false);
  expect(scrim.hasAttribute("data-closing")).toBe(true);
  expect(
    document.querySelector(".menu-panel > .contents")!.hasAttribute("inert")
  ).toBe(true);

  await act(async () => {
    (scrim as HTMLElement).click();
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("reopening the same menu mid-exit cancels the exit and it presents as a dialog again", async () => {
  holdAnimations(dom);
  await render(true, false);
  await render(false, false);
  expect(dialogs()).toEqual([]);

  await render(true, false);

  expect(panels()).toBe(1);
  expect(dialogs()).toEqual(["First"]);
  const panel = document.querySelector(".menu-panel")!;
  expect(panel.hasAttribute("aria-hidden")).toBe(false);
  expect(panel.getAttribute("aria-modal")).toBe("true");
});
