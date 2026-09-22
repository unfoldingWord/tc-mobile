import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu } from "@/components/menu";

/**
 * #621: a dismissed drawer slides back to the right edge it came in from,
 * instead of vanishing on the frame `open` drops.
 *
 * Two halves, proved separately because they live in different files:
 *
 * - `menu.tsx` keeps the drawer mounted — `inert`, marked `data-closing` — for
 *   as long as the stylesheet is animating anything inside it, and asks the
 *   stylesheet (`getAnimations`) rather than a duration of its own. With
 *   nothing animating — reduced motion sets `animation: none`, and jsdom has no
 *   Web Animations API at all — the drawer is gone on the next tick, which is
 *   what the first case pins and what every other test that closes a menu
 *   silently relies on.
 * - `3-components.css` is where the direction, the duration and the
 *   reduced-motion guard are written, so the direction is read from the
 *   keyframes there, not inferred from a class name.
 *
 * Same client-root-in-jsdom harness as `menu-hamburger-header.test.ts`, for the
 * same reason: `Menu` portals to `document.body` and runs its lifecycle in
 * effects, which the static harness in `./render` cannot mount.
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

async function mount(open: boolean) {
  await act(async () => {
    root.render(createElement(Menu, { open, onClose: vi.fn() }));
  });
}

const scrim = () => document.querySelector(".menu-scrim");
const panel = () => document.querySelector('[role="dialog"]');

/**
 * Stand in for the stylesheet's exit motion: one running animation whose
 * `finished` the test settles by hand. Installed on the scrim ELEMENT, where
 * `menu.tsx` asks — jsdom's `Element` has no `getAnimations`, so this is the
 * only way one exists here.
 */
function animate(el: Element) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const getAnimations = vi.fn(() => [{ finished }]);
  Object.defineProperty(el, "getAnimations", { value: getAnimations });
  return { finish, getAnimations };
}

describe("the drawer's exit (#621)", () => {
  it("is gone on the next tick when nothing is animating (reduced motion, or no Web Animations API)", async () => {
    await mount(true);
    expect(panel()).not.toBeNull();

    await mount(false);
    expect(scrim()).toBeNull();
    expect(panel()).toBeNull();
  });

  it("stays mounted, inert and marked closing while the stylesheet's motion runs, then unmounts when it finishes", async () => {
    await mount(true);
    const { finish, getAnimations } = animate(scrim()!);

    await mount(false);
    // Still on screen — paint only.
    expect(scrim()).not.toBeNull();
    expect(panel()).not.toBeNull();
    expect(scrim()!.hasAttribute("data-closing")).toBe(true);
    expect(scrim()!.hasAttribute("inert")).toBe(true);
    // Asked the whole drawer, not one element of it: the scrim fades while the
    // panel slides, and both have to finish.
    expect(getAnimations).toHaveBeenCalledWith({ subtree: true });

    await act(async () => finish());
    expect(scrim()).toBeNull();
  });

  it("carries neither mark while open, and reopening mid-exit cancels the exit", async () => {
    await mount(true);
    expect(scrim()!.hasAttribute("data-closing")).toBe(false);
    expect(scrim()!.hasAttribute("inert")).toBe(false);

    const { finish } = animate(scrim()!);
    await mount(false);
    expect(scrim()!.hasAttribute("data-closing")).toBe(true);

    await mount(true);
    expect(scrim()!.hasAttribute("data-closing")).toBe(false);
    expect(scrim()!.hasAttribute("inert")).toBe(false);

    // The old motion settling later must not take the reopened drawer down.
    await act(async () => finish());
    expect(panel()).not.toBeNull();
  });
});

describe("the drawer's motion in the stylesheet (#621)", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");
  const css = read("src/app/styles/3-components.css");
  // The menu shell's block, sliced between its own section header and the next
  // one — never the whole file, whose prose names selectors on purpose.
  const start = css.indexOf("/* --- the menu shell");
  const block = css.slice(start, css.indexOf("/* ---", start + 1));

  /** The body of the first rule whose selector list contains `selector`. */
  function rule(selector: string): string {
    const at = block.indexOf(selector);
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1);
    return block.slice(block.indexOf("{", at) + 1, block.indexOf("}", at));
  }

  it("slices a real block", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain(".menu-panel {");
  });

  it("slides the panel back to the RIGHT on dismiss, and in from the right on open", () => {
    // Positive x is rightward: the drawer docks on the right edge
    // (`justify-content: flex-end` on the scrim), so 100% of its own width to
    // the right is exactly off screen.
    expect(rule("@keyframes menu-panel-out")).toMatch(
      /to\s*\{\s*transform:\s*translateX\(100%\)/
    );
    expect(rule("@keyframes menu-panel-in")).toMatch(
      /from\s*\{\s*transform:\s*translateX\(100%\)/
    );
  });

  it("times the exit with the shared motion primitives and holds its last frame", () => {
    const exit = rule(".menu-scrim[data-closing] .menu-panel");
    expect(exit).toMatch(
      /animation:\s*menu-panel-out\s+var\(--p-dur-base\)\s+var\(--p-ease\)\s+forwards/
    );
    const scrimExit = rule(".menu-scrim[data-closing] {");
    expect(scrimExit).toMatch(
      /animation:\s*menu-scrim-out\s+var\(--p-dur-base\)\s+var\(--p-ease\)\s+forwards/
    );
  });

  it("switches every drawer animation off under reduced motion — the exit rules too, which outrank the base ones", () => {
    const mediaAt = block.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaAt).toBeGreaterThan(-1);
    const media = block.slice(mediaAt, block.indexOf("}\n  }", mediaAt));
    for (const selector of [
      ".menu-scrim",
      ".menu-panel",
      ".menu-scrim[data-closing]",
      ".menu-scrim[data-closing] .menu-panel",
    ]) {
      expect(media, `${selector} keeps animating`).toContain(selector);
    }
    expect(media).toMatch(/animation:\s*none/);
  });

  it("keeps no clock of its own in menu.tsx — the stylesheet is the only one", () => {
    const source = read("src/components/menu.tsx");
    expect(source).not.toMatch(/setTimeout|requestAnimationFrame/);
    expect(source).toMatch(/getAnimations/);
  });
});
