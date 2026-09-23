import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FailureLogPanel } from "@/components/failure-log-panel";
import { Menu } from "@/components/menu";
import { strings } from "@/components/strings";

/**
 * #468: cancelling the failure-log panel's stacked Clear confirm drops focus.
 *
 * `EraseConfirm` is portalled to `<body>`, stacked OVER the still-open global
 * Menu rather than replacing it (`failure-log-panel.tsx`'s own docblock), so
 * `Menu`'s open-edge focus grab (`menu.tsx`, keyed on `[open]` alone) never
 * re-runs when this confirm comes down — the menu itself never toggles
 * `open`. Before the fix, `closeClearConfirm` dropped `confirmingClear` to
 * `false` and never moved focus, so it fell to `document`; the next Tab then
 * reached the menu header's Close on the very first press, with nothing
 * between the two states.
 *
 * Mounted client root inside a private jsdom window, the same shape
 * `tests/menu-dismiss-unmounts.test.ts` and `tests/segment-row-rename.test.ts`
 * use: `Menu` and `EraseConfirm` both portal to `document.body` and bind
 * `window` keydown listeners in effects, which the static harness in
 * `./render` cannot mount. `Menu` wraps the panel here because the bug and
 * the fix both live in that composition — `FailureLogPanel` alone has no
 * `[role="dialog"]` boundary of its own for Tab to wrap inside.
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

async function renderPanel() {
  await act(async () => {
    root.render(
      createElement(
        Menu,
        { open: true, onClose: vi.fn(), hamburger: true },
        createElement(FailureLogPanel, {
          count: 2,
          onDone: vi.fn(),
          onClearConfirmOpen: vi.fn(),
          onClearConfirmClose: vi.fn(),
        })
      )
    );
  });
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
}

async function click(label: string) {
  const b = button(label);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
}

const clearConfirmDialog = () =>
  document.querySelector(
    `[role="dialog"][aria-label="${strings.clearFailureLogConfirmTitle}"]`
  );

async function dispatchWindowKey(key: string, shiftKey = false) {
  await act(async () => {
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

describe("failure-log panel — Clear confirm focus (#468)", () => {
  it("returns focus to Clear after Escape cancels the stacked confirm, and Tab stays inside the panel", async () => {
    await renderPanel();
    await click(strings.clearFailureLog);
    expect(clearConfirmDialog()).not.toBeNull();

    await dispatchWindowKey("Escape");

    expect(clearConfirmDialog()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      strings.clearFailureLog
    );

    // The bug's second half: before the fix, focus fell to `document` on
    // cancel, so the browser's own Tab traversal — not `wrapTab` — decided
    // where the very next Tab landed. With focus back inside the panel,
    // `wrapTab` owns the boundary and Tab cannot leave the trap.
    await dispatchWindowKey("Tab");
    expect(document.activeElement).not.toBe(dom.window.document.body);
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
  });

  it("returns focus to Clear after tapping Cancel on the stacked confirm", async () => {
    await renderPanel();
    await click(strings.clearFailureLog);
    expect(clearConfirmDialog()).not.toBeNull();

    await click(strings.eraseCancel);

    expect(clearConfirmDialog()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      strings.clearFailureLog
    );
  });

  it("returns focus to Clear after a scrim tap cancels the stacked confirm", async () => {
    await renderPanel();
    await click(strings.clearFailureLog);
    const scrim = document.querySelector(".confirm-scrim");
    expect(scrim).not.toBeNull();

    await act(async () => {
      scrim!.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true })
      );
    });

    expect(clearConfirmDialog()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      strings.clearFailureLog
    );
  });
});
