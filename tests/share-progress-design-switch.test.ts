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

async function mount(progress: ShareProgressState) {
  const { ShareProgress } = await import("@/components/share-progress");
  await act(async () => {
    root.render(
      createElement(ShareProgress, {
        progress,
        scope: "book",
        items: [1, 2, 3, 4].map((label) => ({ label, goesOut: true })),
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
});
