import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ShareProgress as ShareProgressState } from "@/hooks/share-progress";
import { DESIGN_STORAGE_KEY } from "@/lib/design";

/**
 * The O4 switch at the ONE call site that decides which look the share
 * overlay draws (#947): `share-progress.tsx` passes `shareO4View(...)` to its
 * panel only when `useDesign()` reads `"o4"`. `tests/share-progress-o4-render.test.ts`
 * renders the panel with and without an `o4` prop, but the panel alone
 * cannot show that the SWITCH picks the prop, and `ShareProgress` itself
 * portals to `document.body`, which `tests/render.ts`'s server renderer
 * cannot render. So this mounts the real component with `createRoot` and
 * `act` in a manual jsdom, the harness `tests/use-design.test.ts` uses for
 * the same hook, and reads the portalled panel out of the document.
 *
 * A named origin, a fresh module per test and the stubbed globals are all
 * for the reasons `tests/use-design.test.ts`'s docblock gives: `useDesign`
 * keeps its live value in module scope, and jsdom's opaque default origin
 * makes `localStorage` throw.
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
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A prepare two chapters into a four-chapter book: a count the ring can fill by. */
const BUSY: ShareProgressState = {
  phase: "busy",
  work: "prepare",
  since: 0,
  pending: null,
  steps: { done: 2, total: 4, skipped: 0 },
};

const ALL_GO = [1, 2, 3, 4].map((label) => ({ label, goesOut: true }));

async function mount(progress: ShareProgressState, items = ALL_GO) {
  const { ShareProgress } = await import("@/components/share-progress");
  await act(async () => {
    root.render(
      createElement(ShareProgress, {
        progress,
        scope: "book",
        items,
        onCancel: () => {},
        onDismiss: () => {},
      })
    );
  });
  const panel = dom.window.document.querySelector(".share-progress");
  expect(panel, "the overlay rendered no panel").not.toBeNull();
  return panel!;
}

describe("ShareProgress follows the O4 switch (#947)", () => {
  it("with the switch off, draws the current look's glyph and no O4 node", async () => {
    const panel = await mount(BUSY);
    expect(panel.querySelector(".share-progress-glyph")).not.toBeNull();
    expect(panel.querySelector("[class*='share-o4']")).toBeNull();
    expect(panel.querySelector("[role='progressbar']")).toBeNull();
  });

  it("with the switch on, draws the O4 circle, its ring and its chips instead", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    const panel = await mount(BUSY);
    expect(
      panel.querySelector(".share-o4-frame .share-o4-core")
    ).not.toBeNull();
    expect(panel.querySelector(".share-o4-ring")).not.toBeNull();
    expect(panel.querySelectorAll(".share-o4-chip")).toHaveLength(4);
    expect(
      panel.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")
    ).toBe("50");
    expect(panel.querySelector(".share-progress-glyph")).toBeNull();
  });

  it("while packing, a go-out chip still waiting is the same bare chip as one that stays (Q1, vShare)", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    // One chapter into a four-chapter book whose last chapter has no audio:
    // chip 1 finished, chip 2 current, chip 3 waiting, chip 4 stays.
    const panel = await mount(
      { ...BUSY, steps: { done: 1, total: 4, skipped: 0 } },
      [
        { label: 1, goesOut: true },
        { label: 2, goesOut: true },
        { label: 3, goesOut: true },
        { label: 4, goesOut: false },
      ]
    );
    const chips = [...panel.querySelectorAll(".share-o4-chip")];
    expect(chips.map((c) => c.getAttribute("data-chip"))).toEqual([
      "finished",
      "current",
      "waiting",
      "stays",
    ]);
    // Same class, same content shape (its number, no check): the stylesheet
    // names neither state (tests/share-o4-circle-css.test.ts), so both draw
    // as the base grey chip.
    expect(chips[2]!.getAttribute("class")).toBe(
      chips[3]!.getAttribute("class")
    );
    expect(chips[2]!.textContent).toBe("3");
    expect(chips[2]!.querySelector("svg")).toBeNull();
  });

  it("once handed over (sent), the core stays a progress bar at 100 (Q3, vShare's system phase)", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    const panel = await mount({ phase: "outcome", settled: "sent", since: 0 });
    const bar = panel.querySelector(".share-o4-core[role='progressbar']");
    expect(bar, "the handed-over core is not a progress bar").not.toBeNull();
    expect(bar!.getAttribute("aria-valuenow")).toBe("100");
    expect(bar!.getAttribute("aria-valuemax")).toBe("100");
  });

  it("on any other outcome the core is not a progress bar", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    const panel = await mount({
      phase: "outcome",
      settled: "failed",
      since: 0,
    });
    expect(panel.querySelector(".share-o4-core")).not.toBeNull();
    expect(panel.querySelector("[role='progressbar']")).toBeNull();
  });
});
