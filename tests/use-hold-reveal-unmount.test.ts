// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHoldReveal } from "@/hooks/use-hold-reveal";

/**
 * The click guard leaves with the screen (#1747, from #1617). A revealed
 * hold's release arms a window click listener and a timer that swallow that
 * release's click. If the screen unmounts inside that window, the unmount
 * takes both down instead of leaving them to expire on their own.
 *
 * A one-element probe is enough: the hook's own handler on a cut-off name
 * inside a button, as the Books and Segments rows wire it. Layout is faked
 * (jsdom has none), as in `tests/hold-reveal-books.test.ts`.
 */

function Probe() {
  const { holdStart } = useHoldReveal();
  return createElement(
    "button",
    { type: "button" },
    createElement("span", { className: "name", onPointerDown: holdStart }, "x")
  );
}

let root: Root;
let clickListeners: Set<EventListenerOrEventListenerObject>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = "<div id='root'></div>";
  clickListeners = new Set();
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "click") clickListeners.add(fn);
      add(type, fn, opts as AddEventListenerOptions);
    }
  );
  vi.spyOn(window, "removeEventListener").mockImplementation(
    (type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "click") clickListeners.delete(fn);
      remove(type, fn, opts as EventListenerOptions);
    }
  );
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pointer(el: Element | Window, type: string) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    })
  );
}

async function revealAndRelease() {
  await act(async () => root.render(createElement(Probe)));
  const name = document.querySelector<HTMLElement>(".name")!;
  Object.defineProperty(name, "scrollWidth", {
    configurable: true,
    value: 420,
  });
  Object.defineProperty(name, "clientWidth", {
    configurable: true,
    value: 154,
  });
  await act(async () => pointer(name, "pointerdown"));
  await act(async () => vi.advanceTimersByTime(450));
  await act(async () => pointer(window, "pointerup"));
}

describe("the release's click guard on unmount (#1747)", () => {
  it("is armed by a revealed hold's release", async () => {
    await revealAndRelease();
    expect(clickListeners.size).toBe(1);
    await act(async () => root.unmount());
  });

  it("is taken down when the screen unmounts inside its 600 ms", async () => {
    await revealAndRelease();
    const timersBefore = vi.getTimerCount();
    expect(timersBefore).toBeGreaterThan(0);
    await act(async () => root.unmount());
    expect(clickListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
