import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "@/components/icon";
import { Menu } from "@/components/menu";
import { strings } from "@/lib/i18n/strings";

import { one, render as renderStatic } from "./render";

/**
 * #608: the ≡ that opens the global menu stays a ≡ once the menu is open — same
 * glyph, same corner, and the panel carries no visible "Menu" label.
 *
 * `Menu` portals to `document.body` and binds its focus trap in effects, so the
 * static harness in `./render` cannot mount it (`react-dom/server` refuses a
 * portal). This file takes the step up that harness's docblock names — a
 * `react-dom/client` root inside its own jsdom window — and still uses the
 * static harness for the one thing it is good at: rendering an `Icon` by name
 * so the glyph the header wears is compared against the real path, not a
 * hand-copied `d` string that a redraw of the icon would silently orphan.
 *
 * What a screen reader hears is asserted to be UNCHANGED in both states: the
 * dialog is still named `strings.menuTitle` and the dismiss control is still
 * named `strings.menuClose`, which is what `e2e/back-navigation.spec.ts`,
 * `e2e/theme-toggle.spec.ts` and `e2e/failure-log.spec.ts` locate the menu by.
 * Only the visible header changes, and only when the caller says so.
 */

let dom: JSDOM;
let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    // A named origin: vitest's failure printer walks the stubbed `window` and
    // trips on `localStorage` under jsdom's default opaque origin, which turns
    // a red assertion into an unrelated `SecurityError`.
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

async function mount(props: { hamburger?: boolean }) {
  await act(async () => {
    root.render(createElement(Menu, { open: true, onClose, ...props }));
  });
  const panel = document.querySelector('[role="dialog"]');
  expect(panel).not.toBeNull();
  return panel!;
}

/** The `d` of the one path an `Icon` of this name draws. */
function glyphPath(name: IconName): string {
  return one(renderStatic(createElement(Icon, { name })), "path").getAttribute(
    "d"
  )!;
}

function dismissControl(panel: Element): HTMLButtonElement {
  const button = [...panel.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === strings.menuClose
  );
  expect(button).toBeDefined();
  return button!;
}

describe("the global menu's header (#608)", () => {
  it("opts the Books global menu into the hamburger header (#643)", () => {
    const books = readFileSync(
      new URL("../src/components/books-screen.tsx", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Check the caller as well as Menu's rendered opt-in behavior below.
    // Count matches so a missing or duplicated global menu cannot pass.
    const globalMenus = [...books.matchAll(/<Menu\b[^>]*>/g)].filter(([tag]) =>
      /\bopen\s*=\s*\{\s*menuOpen\s*\}/.test(tag)
    );
    expect(globalMenus).toHaveLength(1);
    expect(globalMenus.at(0)?.[0]).toMatch(/\shamburger(?=\s|>)/);
  });

  it("keeps the ≡ glyph top-right with no visible title, and still closes as 'Close menu'", async () => {
    const panel = await mount({ hamburger: true });

    // The dialog is still named for AT — the label moved out of sight, not out
    // of the accessibility tree.
    expect(panel.getAttribute("aria-label")).toBe(strings.menuTitle);
    // No visible "Menu" anywhere in the panel: not as the title span, not as
    // any other text run.
    expect(panel.querySelector(".t-title")).toBeNull();
    expect(panel.textContent).not.toContain(strings.menuTitle);

    // The dismiss control wears the same glyph the opener does.
    const dismiss = dismissControl(panel);
    expect(one(dismiss, "path").getAttribute("d")).toBe(glyphPath("menu"));
    expect(one(dismiss, "path").getAttribute("d")).not.toBe(glyphPath("back"));

    // ...and a tap on it is still the dismiss: one ≡, open then close.
    await act(async () => dismiss.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves every other menu as it was — a title beside a back chevron (#589 owns those)", async () => {
    const panel = await mount({});

    expect(panel.getAttribute("aria-label")).toBe(strings.menuTitle);
    expect(one(panel, ".t-title").textContent).toBe(strings.menuTitle);

    const dismiss = dismissControl(panel);
    expect(one(dismiss, "path").getAttribute("d")).toBe(glyphPath("back"));
  });
});
