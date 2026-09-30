import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { Icon, type IconName } from "@/components/icon";
import { Menu } from "@/components/menu";
import {
  RecorderMenu,
  type RecorderMenuProps,
} from "@/components/recorder-menu";
import { SHEET_CLOSE_DISTANCE_PX } from "@/components/sheet-drag";
import type { Design } from "@/lib/design";
import { licenseTexts } from "@/components/licenses";
import { strings } from "@/lib/strings";

import { mountInteractive, type InteractiveMount } from "./interactive-mount";
import { one, render as renderStatic } from "./render";
import { stripComments } from "./support";

/**
 * #1268, the requirements owner's decision (verbatim): "1. Yes, it should
 * work as drag down to close. 2. Can we use a standard close button (some
 * form of X)?"
 *
 * Every sheet is one `<Menu>` (`components/menu.tsx`): the half-screen
 * shape is CSS keyed on what the panel holds (`o4/menus.css`,
 * `o4/sheets.css`), and the closer is the Menu header's one `Control`. So
 * the glyph is asserted where it is decided — `Menu`, under each of the
 * three header modes its callers use — and then through two real callers
 * (the recorder's ⋮ menu and About), with a source sweep that every
 * `<Menu>` in `src/` is one of the known callers and that only About's
 * licence view asks for the back chevron.
 *
 * The drag is driven with jsdom pointer events on a mounted `Menu`. What
 * this cannot show: layout (jsdom has none, so the sheet's height is 0 and
 * the fixed distance applies), the cascade, the spring-back transition, and
 * a finger on a phone. The pure decision is `tests/sheet-drag.test.ts`.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
// About's footer reads build defines the test env does not have.
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));

let m: InteractiveMount;
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  design.current = "o4";
  m = mountInteractive();
  // jsdom has no pointer capture; the browser's is what keeps a drag's
  // moves on the grip once the finger leaves it.
  const proto = m.dom.window.HTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  // About's licence view fetches its text; nothing here reads it.
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  // About's list reads this build define.
  vi.stubGlobal(
    "__BUILD_SHA_FULL__",
    "0123456789abcdef0123456789abcdef01234567"
  );
});
afterEach(async () => {
  try {
    await act(async () => m.root.unmount());
  } finally {
    m.teardown();
  }
});

/** What an `Icon` of this name draws inside its svg (⋮ is three circles). */
function glyphPath(name: IconName): string {
  return one(renderStatic(createElement(Icon, { name })), "svg").innerHTML;
}

const panel = () => {
  const p = document.querySelector('[role="dialog"]');
  expect(p, "no dialog mounted").not.toBeNull();
  return p as HTMLElement;
};
const named = (label: string) => {
  const b = [...panel().querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(b, `no button named ${label}`).toBeDefined();
  return b!;
};
const glyphOf = (button: Element) => one(button, "svg").innerHTML;

async function mountMenu(props: Partial<Parameters<typeof Menu>[0]> = {}) {
  await act(async () => {
    m.root.render(
      createElement(
        Menu,
        { open: true, onClose, ...props },
        createElement("p", null, "body")
      )
    );
  });
  return panel();
}

const MODES = {
  "a titled sheet (book, chapter, segment, name sheets)": {},
  "the global ≡ menu": { hamburger: true },
  "the recorder's ⋮ menu": { hamburger: true, dismissIcon: "more" as const },
};

describe("one ✕ closes every sheet in O4 (#1268 item 2)", () => {
  for (const [mode, props] of Object.entries(MODES)) {
    it(`${mode}: the header's closer is ✕, top right, named as before`, async () => {
      const p = await mountMenu(props);
      const close = named(strings.menuClose);
      expect(glyphOf(close)).toBe(glyphPath("close"));
      for (const old of ["back", "menu", "more"] as const)
        expect(glyphOf(close)).not.toBe(glyphPath(old));
      // Same place on every sheet: the header row's last child.
      expect(close.parentElement?.lastElementChild).toBe(close);
      expect(p.contains(close)).toBe(true);
      await act(async () => close.click());
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  }

  it("a closer that steps back one level keeps the chevron", async () => {
    await mountMenu({ back: true, closeLabel: strings.aboutBack });
    expect(glyphOf(named(strings.aboutBack))).toBe(glyphPath("back"));
  });

  it("the recorder's ⋮ menu closes on ✕ (its opener stays ⋮, #1243)", async () => {
    const props: RecorderMenuProps = {
      open: true,
      onClose,
      mode: "record",
      ordinal: 3,
      finishedState: "empty",
      editReason: null,
      markReason: null,
      eraseReason: null,
      onEnterEdit: vi.fn(),
      onToggleFinished: vi.fn(),
      onErase: vi.fn(),
    };
    await act(async () => m.root.render(createElement(RecorderMenu, props)));
    expect(glyphOf(named(strings.menuClose))).toBe(glyphPath("close"));
  });

  it("About closes on ✕, and its licence view keeps ‹ for Back to the list", async () => {
    const about = (viewing: (typeof licenseTexts)[number] | null) =>
      createElement(AboutPanel, {
        open: true,
        viewing,
        onView: vi.fn(),
        onBack: vi.fn(),
        onClose,
      });
    await act(async () => m.root.render(about(null)));
    expect(glyphOf(named(strings.menuClose))).toBe(glyphPath("close"));
    await act(async () => m.root.render(about(licenseTexts[0]!)));
    expect(glyphOf(named(strings.aboutBack))).toBe(glyphPath("back"));
  });

  it("every <Menu> under src/components is a known caller, and only About asks for back", () => {
    const dir = path.resolve(import.meta.dirname, "..", "src", "components");
    const calls: Record<string, number> = {};
    const backs: string[] = [];
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" });
    for (const file of files.filter((f) => f.endsWith(".tsx"))) {
      const src = stripComments(readFileSync(path.join(dir, file), "utf8"));
      const tags = [...src.matchAll(/<Menu\b[\s\S]*?>/g)];
      if (tags.length === 0) continue;
      calls[file] = tags.length;
      if (tags.some(([t]) => /\sback[\s=]/.test(t))) backs.push(file);
    }
    expect(calls).toEqual({
      "about-panel.tsx": 1,
      "books-screen.tsx": 4,
      "recorder-menu.tsx": 1,
      "segment-row.tsx": 1,
      "segments-screen.tsx": 1,
    });
    expect(backs).toEqual(["about-panel.tsx"]);
  });
});

describe("the current look keeps its closers", () => {
  const cases: [string, object, IconName][] = [
    ["titled", {}, "back"],
    ["≡", { hamburger: true }, "menu"],
    ["⋮", { hamburger: true, dismissIcon: "more" }, "more"],
  ];
  for (const [mode, props, glyph] of cases) {
    it(`${mode}: ${glyph}, and no grip`, async () => {
      design.current = "current";
      const p = await mountMenu(props);
      expect(glyphOf(named(strings.menuClose))).toBe(glyphPath(glyph));
      expect(p.querySelector(".menu-grip")).toBeNull();
    });
  }
});

/** Dispatch a pointer event the way a finger would. */
// Each event is stamped `dt` ms after the last one (100 by default, a slow
// drag), because jsdom stamps real time and a whole drag dispatched in one
// tick would read as an instant flick.
let clock = 0;
function pointer(el: Element, type: string, clientY: number, dt = 100) {
  const PE = m.dom.window.PointerEvent;
  const event = new PE(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    pointerId: 7,
    isPrimary: true,
    pointerType: "touch",
    button: type === "pointermove" ? -1 : 0,
  });
  clock += dt;
  Object.defineProperty(event, "timeStamp", { value: clock });
  el.dispatchEvent(event);
}
async function drag(from: Element, ys: number[], dt = 100) {
  await act(async () => {
    pointer(from, "pointerdown", ys[0]!, dt);
    for (const y of ys.slice(1)) pointer(from, "pointermove", y, dt);
    pointer(from, "pointerup", ys.at(-1)!, dt);
  });
}

describe("drag down to close (#1268 item 1)", () => {
  it("draws a grip that screen readers skip, inside the inert subtree", async () => {
    const p = await mountMenu();
    const grip = one(p, ".menu-grip");
    expect(grip.getAttribute("aria-hidden")).toBe("true");
    expect(grip.querySelector("button, [tabindex]")).toBeNull();
    await mountMenu({ inert: true });
    expect(one(panel(), ".menu-grip").closest("[inert]")).not.toBeNull();
  });

  it("a drag on the grip past the distance closes through onClose", async () => {
    const p = await mountMenu();
    await drag(one(p, ".menu-grip"), [100, 150, 100 + SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a drag-close swallows its release's click, once, so what the sheet covered is not tapped", async () => {
    const p = await mountMenu();
    const beneath = document.createElement("button");
    const tapped = vi.fn();
    beneath.addEventListener("click", tapped);
    document.body.append(beneath);
    await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => beneath.click());
    expect(tapped).not.toHaveBeenCalled();
    // One-shot: the next real tap goes through.
    await act(async () => beneath.click());
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("a release that springs back swallows no click", async () => {
    const p = await mountMenu();
    const beneath = document.createElement("button");
    const tapped = vi.fn();
    beneath.addEventListener("click", tapped);
    document.body.append(beneath);
    await drag(one(p, ".menu-grip"), [100, 120]);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => beneath.click());
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("a drag on the sheet head (off the ✕) closes too", async () => {
    const p = await mountMenu();
    const head = one(p, ".menu-head");
    await drag(head, [100, 100 + SHEET_CLOSE_DISTANCE_PX + 10]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a short drag springs back, and the sheet follows the finger meanwhile", async () => {
    const p = await mountMenu();
    const grip = one(p, ".menu-grip");
    await act(async () => {
      pointer(grip, "pointerdown", 100);
      pointer(grip, "pointermove", 140);
    });
    expect(p.getAttribute("data-sheet-drag")).toBe("dragging");
    expect(p.style.getPropertyValue("--sheet-drag-y")).toBe("40px");
    await act(async () => pointer(grip, "pointerup", 140));
    expect(onClose).not.toHaveBeenCalled();
    expect(p.getAttribute("data-sheet-drag")).toBe("settling");
    expect(p.style.getPropertyValue("--sheet-drag-y")).toBe("0px");
  });

  it("a quick flick down closes before the distance", async () => {
    const p = await mountMenu();
    await drag(one(p, ".menu-grip"), [100, 115, 130], 10);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an upward drag does nothing", async () => {
    const p = await mountMenu();
    await drag(one(p, ".menu-grip"), [300, 250, 100]);
    expect(onClose).not.toHaveBeenCalled();
    expect(p.style.getPropertyValue("--sheet-drag-y")).toBe("0px");
  });

  it("a cancelled pointer springs back without closing", async () => {
    const p = await mountMenu();
    const grip = one(p, ".menu-grip");
    await act(async () => {
      pointer(grip, "pointerdown", 100);
      pointer(grip, "pointermove", 400);
      pointer(grip, "pointercancel", 400);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(p.getAttribute("data-sheet-drag")).toBe("settling");
  });

  it("a press dragged from the ✕ never starts a drag", async () => {
    const p = await mountMenu();
    await drag(named(strings.menuClose), [
      100,
      100 + 2 * SHEET_CLOSE_DISTANCE_PX,
    ]);
    expect(onClose).not.toHaveBeenCalled();
    expect(p.hasAttribute("data-sheet-drag")).toBe(false);
  });

  it("the body does not start a drag, so it keeps its own scroll", async () => {
    const p = await mountMenu();
    await drag(one(p, "p"), [100, 100 + 2 * SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not drag where the grip is not drawn (a side drawer)", async () => {
    const style = document.createElement("style");
    style.textContent = ".menu-grip { display: none; }";
    document.head.append(style);
    const p = await mountMenu();
    await drag(one(p, ".menu-grip"), [100, 100 + 2 * SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the current look has no drag at all", async () => {
    design.current = "current";
    const p = await mountMenu();
    const head = p.querySelector(".menu-head") ?? p;
    await drag(head, [100, 100 + 2 * SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
