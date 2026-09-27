// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareChip, ShareO4View } from "@/components/share-o4-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";

/**
 * The bounded chip row keeps the current chip in view (DRI pick (a) on #1023):
 * when the current index changes, the row's own `scrollTop` moves just enough
 * to show that chip, and nothing else scrolls.
 *
 * jsdom has no layout, so the geometry is stubbed on the prototype: six chips
 * to a 48px row (38px chip, 10px gap) and a 134px-high chip row, the
 * stylesheet's cap. What a phone actually draws is the device check (#974);
 * this says which `scrollTop` the hook asks for, given that geometry.
 */

const PER_ROW = 6;
const ROW = 48;
const CHIP = 38;
const VIEW = 134;

const scrollTops = new WeakMap<Element, number>();
const scrollIntoView = vi.fn();
const scrollTo = vi.fn();

function isChip(el: Element): boolean {
  return el.classList.contains("share-o4-chip");
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (!isChip(this) || this.parentElement === null) return 0;
      const i = [...this.parentElement.children].indexOf(this);
      return Math.floor(i / PER_ROW) * ROW;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return isChip(this) ? CHIP : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.classList.contains("share-o4-chips") ? VIEW : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      scrollTops.set(this, v);
    },
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  scrollIntoView.mockClear();
  scrollTo.mockClear();
});

let root: Root;
let host: HTMLDivElement;

function chipsWithCurrent(at: number, length = 150): ShareChip[] {
  return Array.from({ length }, (_, i) => ({
    label: i + 1,
    state: i < at ? "finished" : i === at ? "current" : "waiting",
  }));
}

function draw(chips: readonly ShareChip[]) {
  const o4: ShareO4View = {
    icon: "share",
    ring: 0.5,
    meter: { now: 50 },
    chips,
  };
  act(() =>
    root.render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share",
        text: "Preparing",
        o4,
      })
    )
  );
}

function rowTop(): number {
  const group = host.querySelector(".share-o4-chips");
  expect(group).not.toBeNull();
  return group!.scrollTop;
}

describe("the chip row keeps the current chip in view", () => {
  it("scrolls down just far enough to show a current chip below the fold", () => {
    draw(chipsWithCurrent(0));
    expect(rowTop()).toBe(0);
    // Chip 30 sits on row 5: top 240, bottom 278; the row shows 134px.
    draw(chipsWithCurrent(30));
    expect(rowTop()).toBe(5 * ROW + CHIP - VIEW);
  });

  it("scrolls back up when the current chip is above the view", () => {
    draw(chipsWithCurrent(30));
    draw(chipsWithCurrent(2));
    expect(rowTop()).toBe(0);
  });

  it("leaves the row alone while the current chip is already visible", () => {
    draw(chipsWithCurrent(30));
    const before = rowTop();
    // Chip 31 is on the same row as chip 30.
    draw(chipsWithCurrent(31));
    expect(rowTop()).toBe(before);
  });

  it("does not move the row when no chip is current (the hand-off, or an empty step)", () => {
    draw(chipsWithCurrent(30));
    const before = rowTop();
    draw(
      Array.from({ length: 150 }, (_, i) => ({
        label: i + 1,
        state: "finished" as const,
      }))
    );
    expect(rowTop()).toBe(before);
  });

  it("scrolls only the chip row: never the page, never through scrollIntoView", () => {
    draw(chipsWithCurrent(0));
    draw(chipsWithCurrent(100));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
