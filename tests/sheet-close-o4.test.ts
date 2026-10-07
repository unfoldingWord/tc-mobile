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

  it("every <Menu> in src/ is a known caller, and only About asks for back", () => {
    // Every .tsx under src/, recursively, so a sheet added in a new folder
    // trips this too.
    const dir = path.resolve(import.meta.dirname, "..", "src");
    const calls: Record<string, number> = {};
    const backs: string[] = [];
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => f.split(path.sep).join("/"));
    expect(files.length, "no .tsx files found under src/").toBeGreaterThan(20);
    for (const file of files) {
      const src = stripComments(readFileSync(path.join(dir, file), "utf8"));
      const tags = [...src.matchAll(/<Menu\b[\s\S]*?>/g)];
      if (tags.length === 0) continue;
      calls[file] = tags.length;
      if (tags.some(([t]) => /\sback[\s=]/.test(t))) backs.push(file);
    }
    expect(calls).toEqual({
      "components/about-panel.tsx": 1,
      "components/books-screen.tsx": 4,
      "components/recorder-menu.tsx": 1,
      "components/segment-row.tsx": 1,
      "components/segments-screen.tsx": 1,
    });
    expect(backs).toEqual(["components/about-panel.tsx"]);
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

  // jsdom synthesises no click from pointer events, so the click that a real
  // tap would produce is dispatched by hand after the pointer sequence.
  it("a press that starts on the ✕ never starts a drag, and its click still closes once", async () => {
    const p = await mountMenu();
    const close = named(strings.menuClose);
    await drag(close, [100, 100 + 2 * SHEET_CLOSE_DISTANCE_PX]);
    expect(onClose).not.toHaveBeenCalled();
    expect(p.hasAttribute("data-sheet-drag")).toBe(false);
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("the trailing click after a drag closes the sheet (#1273, George round 1)", () => {
    /** A button outside the sheet, standing in for what it covered. */
    function underneath() {
      const hit = vi.fn();
      const button = document.createElement("button");
      button.textContent = "under the sheet";
      button.addEventListener("click", hit);
      document.body.append(button);
      return { button, hit };
    }
    const click = (el: Element) =>
      el.dispatchEvent(
        new m.dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );

    /** A whole tap: pointerdown, pointerup, then its click. */
    const tapOn = (el: Element) => {
      pointer(el, "pointerdown", 300);
      pointer(el, "pointerup", 300);
      click(el);
    };
    const key = (el: Element, k: string) =>
      el.dispatchEvent(
        new m.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })
      );

    it("does not reach what was under the finger", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      expect(onClose).toHaveBeenCalledTimes(1);
      click(button);
      expect(hit).not.toHaveBeenCalled();
      // A second bare click in the window (no gesture of its own) is
      // swallowed too (PR #1318 round 2, George); a real tap gets through.
      click(button);
      expect(hit).not.toHaveBeenCalled();
      tapOn(button);
      expect(hit).toHaveBeenCalledTimes(1);
    });

    it("stops waiting after the bound, so a later real tap is not eaten", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      expect(onClose).toHaveBeenCalledTimes(1);
      // No trailing click arrived (a pointer that never clicks); wait out
      // the 400 ms bound.
      await new Promise((resolve) => setTimeout(resolve, 450));
      click(button);
      expect(hit).toHaveBeenCalledTimes(1);
    });

    // #1278 (PR #1273 round 3, Frank P3): a touch drag that closes the sheet
    // fires no click, so the swallow stays armed. A real tap inside the
    // window is a whole new gesture on its own target, so its click must land.
    it("lets a new tap's click through inside the window", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      expect(onClose).toHaveBeenCalledTimes(1);
      pointer(button, "pointerdown", 300);
      pointer(button, "pointerup", 300);
      click(button);
      expect(hit).toHaveBeenCalledTimes(1);
    });

    it("lets a keyboard click through inside the window", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      button.dispatchEvent(
        new m.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        })
      );
      click(button);
      expect(hit).toHaveBeenCalledTimes(1);
    });

    // PR #1318 round 1 (George): a new gesture must not uninstall the
    // swallow. A click that is not that gesture's own (here, on what the
    // sheet covered) is still eaten inside the window.
    it("still eats a click elsewhere after a new pointerdown, then lets that tap's click through", async () => {
      const covered = underneath();
      const next = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      pointer(next.button, "pointerdown", 300);
      click(covered.button);
      expect(covered.hit).not.toHaveBeenCalled();
      pointer(next.button, "pointerup", 300);
      click(next.button);
      expect(next.hit).toHaveBeenCalledTimes(1);
    });

    it("still eats a click elsewhere after a keydown, then lets the key's click through", async () => {
      const covered = underneath();
      const next = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      next.button.dispatchEvent(
        new m.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        })
      );
      click(covered.button);
      expect(covered.hit).not.toHaveBeenCalled();
      click(next.button);
      expect(next.hit).toHaveBeenCalledTimes(1);
    });

    it("eats a click on the new tap's target that arrives before its pointerup", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      pointer(button, "pointerdown", 300);
      click(button);
      expect(hit).not.toHaveBeenCalled();
    });

    // PR #1318 round 2 (George): the swallow stays for the whole window,
    // a delivered click does not take it down, and only the new gesture's
    // own control gets its click.
    it("stays armed after a delivered tap: a later stray click is eaten, a later tap is not", async () => {
      const a = underneath();
      const b = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      tapOn(b.button);
      expect(b.hit).toHaveBeenCalledTimes(1);
      // The gesture is spent: a second bare click on the same control is
      // not a new tap.
      click(b.button);
      expect(b.hit).toHaveBeenCalledTimes(1);
      click(a.button);
      expect(a.hit).not.toHaveBeenCalled();
      tapOn(a.button);
      expect(a.hit).toHaveBeenCalledTimes(1);
    });

    it("stays armed after Enter's click: a later stray click is eaten", async () => {
      const a = underneath();
      const b = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      key(b.button, "Enter");
      click(b.button);
      expect(b.hit).toHaveBeenCalledTimes(1);
      click(a.button);
      expect(a.hit).not.toHaveBeenCalled();
    });

    it.each([["a"], ["Escape"]])(
      "a keydown of %s lets no click through",
      async (k) => {
        const { button, hit } = underneath();
        const p = await mountMenu();
        await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
        key(button, k);
        click(button);
        expect(hit).not.toHaveBeenCalled();
      }
    );

    it("eats a click on an ancestor of the new gesture's control", async () => {
      const { button, hit } = underneath();
      const bodyHit = vi.fn();
      document.body.addEventListener("click", bodyHit);
      try {
        const p = await mountMenu();
        await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
        pointer(button, "pointerdown", 300);
        pointer(button, "pointerup", 300);
        click(document.body);
        expect(bodyHit).not.toHaveBeenCalled();
        click(button);
        expect(hit).toHaveBeenCalledTimes(1);
      } finally {
        document.body.removeEventListener("click", bodyHit);
      }
    });

    // PR #1318 round 3 (George): a finger lands on what a button holds (its
    // icon, its label), not on the button. The browser fires the click on
    // the nearest common ancestor of the pointerdown and pointerup targets,
    // so a press on the icon that lifts on the label clicks the button
    // itself. All three name the same control, so the click is delivered.
    it("delivers a tap made on the parts inside a control, and still eats a click elsewhere", async () => {
      const { button, hit } = underneath();
      button.textContent = "";
      const icon = document.createElement("span");
      const label = document.createElement("span");
      label.textContent = "under the sheet";
      button.append(icon, label);
      const bodyHit = vi.fn();
      document.body.addEventListener("click", bodyHit);
      try {
        const p = await mountMenu();
        await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
        pointer(icon, "pointerdown", 300);
        pointer(label, "pointerup", 300);
        click(document.body);
        expect(bodyHit).not.toHaveBeenCalled();
        click(button);
        expect(hit).toHaveBeenCalledTimes(1);
        // The same on one part: down, up and click all on the label.
        tapOn(label);
        expect(hit).toHaveBeenCalledTimes(2);
      } finally {
        document.body.removeEventListener("click", bodyHit);
      }
    });

    // PR #1318 round 3 (George): Space, unlike Enter, clicks on keyup, so its
    // click comes after a keyup the swallow does not listen for.
    it("lets Space's click through after its keyup, and still eats a click elsewhere", async () => {
      const covered = underneath();
      const next = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 100 + SHEET_CLOSE_DISTANCE_PX]);
      key(next.button, " ");
      click(covered.button);
      expect(covered.hit).not.toHaveBeenCalled();
      next.button.dispatchEvent(
        new m.dom.window.KeyboardEvent("keyup", { key: " ", bubbles: true })
      );
      click(next.button);
      expect(next.hit).toHaveBeenCalledTimes(1);
    });

    it("is not armed by a drag that springs back", async () => {
      const { button, hit } = underneath();
      const p = await mountMenu();
      await drag(one(p, ".menu-grip"), [100, 120]);
      expect(onClose).not.toHaveBeenCalled();
      click(button);
      expect(hit).toHaveBeenCalledTimes(1);
    });
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
