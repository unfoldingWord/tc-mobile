import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESIGN_STORAGE_KEY } from "@/lib/design";

/**
 * The DOM half of the O4 design switch (#938, batch 0 of epic #936):
 * `hooks/use-design.ts`'s attribute toggle, persistence and stored-value
 * fallback. `tests/design.test.ts` covers the pure decision this hook wraps;
 * this file is the one that needs a document and `localStorage`.
 *
 * A manual `JSDOM` with a named origin, stubbed over the globals — not this
 * file's own `@vitest-environment jsdom` directive — for the reason
 * `tests/menu-hamburger-header.test.ts` already recorded: jsdom's default
 * opaque origin turns a `localStorage` access into a `SecurityError` rather
 * than the assertion failure a red test should show.
 *
 * `vi.resetModules()` before each dynamic `import()`, because
 * `hooks/use-design.ts` keeps its live value in module scope (`liveDesign`,
 * mirroring `use-theme.ts`'s `liveTheme` and its own documented reason: a
 * hook reseeded from storage on every mount would let a design whose write
 * had failed silently revert on navigation). Without a fresh module per test,
 * the first test's resolved design would still answer every test after it.
 *
 * WHAT IS AND IS NOT COVERED, the same split `tests/theme.test.ts` and
 * `use-theme.ts`'s own docblock draw for the identical shape: COVERED here —
 * the attribute toggle, persistence, the bad-stored-value fallback, and
 * `installStoredDesign`'s pre-render application. NOT COVERED: `readDesign`'s
 * throw-on-READ catch (an accessor that throws on access, not merely absent —
 * jsdom's own `localStorage` does not reproduce that), and anything on a
 * phone — this switch has not been run on a device as of this PR.
 */

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "http://localhost/",
    }
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

/** A leaf that mounts `useDesign()` and exposes a button firing `toggle`. */
async function mountToggle() {
  const { useDesign } = await import("@/hooks/use-design");
  function Probe() {
    const { toggle } = useDesign();
    return createElement("button", { onClick: toggle }, "toggle");
  }
  await act(async () => {
    root.render(createElement(Probe));
  });
  return dom.window.document.querySelector("button")!;
}

describe("useDesign / installStoredDesign (#938)", () => {
  it("defaults the attribute to current with nothing stored", async () => {
    // It is the mount-time RECONCILE effect (`useDesign`'s own `useEffect`)
    // that writes the attribute, not merely `useSyncExternalStore` returning
    // a value — asserting against the DOM rather than the hook's return value
    // is what a mutation deleting that effect would actually break.
    await mountToggle();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("current");
  });

  it("toggles the attribute on click, and involutes back on a second click", async () => {
    const button = await mountToggle();
    button.click();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("o4");
    button.click();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("current");
  });

  it("persists the choice to localStorage under the namespaced key", async () => {
    const button = await mountToggle();
    button.click();
    expect(dom.window.localStorage.getItem(DESIGN_STORAGE_KEY)).toBe("o4");
    button.click();
    expect(dom.window.localStorage.getItem(DESIGN_STORAGE_KEY)).toBe("current");
  });

  it("falls back to current when the stored value is not one this app wrote", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "sepia");
    await mountToggle();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("current");
  });

  it("picks up a validly stored o4 choice on a fresh mount, with no toggle needed", async () => {
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    await mountToggle();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("o4");
  });

  it("installStoredDesign applies the stored design before any component mounts", async () => {
    // What `main.tsx` actually calls, synchronously, before `createRoot` — the
    // no-flash contract `installStoredTheme`'s docblock states for the theme
    // half. No React tree is mounted here at all.
    dom.window.localStorage.setItem(DESIGN_STORAGE_KEY, "o4");
    const { installStoredDesign } = await import("@/hooks/use-design");
    installStoredDesign();
    expect(
      dom.window.document.documentElement.getAttribute("data-design")
    ).toBe("o4");
  });
});
