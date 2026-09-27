import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EraseConfirm } from "@/components/erase-confirm";

/**
 * The O4 confirm dialog (#946: states 13 Erase confirm, G5 Record again asks
 * first, G6 Delete book asks first).
 *
 * All three are the one `EraseConfirm`: the segment Erase, the recorder's
 * Erase-and-record-again path and the Books delete-book confirm each render
 * it with their own copy. The O4 look is CSS only, in
 * `src/app/styles/o4/dialogs.css`, and the component's markup is not touched.
 * Inference, not a test result: focus landing and the Tab trap therefore run on
 * the same DOM in both looks. The last describe below pins the two with the
 * switch on; focus return belongs to each caller, not to this component, and
 * is not exercised here.
 *
 * Two halves, because each alone can pass vacuously:
 *   1. the stylesheet's declarations carry the design values, every rule is
 *      scoped under the switch, and no colour primitive leaks past layer 2
 *      (the `share-progress.test.ts` shape: rule blocks are sliced and their
 *      declaration VALUES matched, with comments stripped first, so a comment
 *      that names a selector cannot capture the test — AGENTS.md);
 *   2. every selector in that stylesheet matches real EraseConfirm markup
 *      with the switch on, and none with it off — a renamed class in the
 *      component would otherwise leave the O4 rules matching nothing while
 *      half 1 stayed green.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(
  path.join(ROOT, "src", "app", "styles", "o4", "dialogs.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

const SCOPE = '[data-design="o4"]';

interface Rule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/** Innermost `selector { body }` blocks — the file has no nested at-rules
 *  below its one `@layer components`, which this regex steps over. */
const RULES: readonly Rule[] = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel = "", body = ""]) => ({
    selectors: sel
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    body,
  }))
  .filter((r) => !r.selectors.some((s) => s.startsWith("@")));

/** The declarations of the rule whose selector list contains `selector`. */
function decl(selector: string): Record<string, string> {
  const rule = RULES.find((r) => r.selectors.includes(selector));
  expect(rule, `no rule for ${selector}`).toBeDefined();
  const out: Record<string, string> = {};
  for (const [, prop = "", value = ""] of rule!.body.matchAll(
    /([a-z-]+)\s*:\s*([^;]+);/g
  ))
    out[prop] = value.trim();
  return out;
}

describe("o4/dialogs.css — the confirm dialog's O4 values (#946)", () => {
  it("has rules at all (non-emptiness floor)", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(8);
  });

  it("scopes every rule under the switch, so switch-off is unchanged", () => {
    for (const { selectors } of RULES)
      for (const s of selectors)
        expect(s.startsWith(`${SCOPE} `), s).toBe(true);
  });

  it("dims behind the dialog and insets it 18px", () => {
    const scrim = decl(`${SCOPE} .confirm-scrim`);
    expect(scrim.background).toBe("var(--s-dim)");
    expect(scrim.padding).toBe("18px");
    const panel = decl(`${SCOPE} .confirm-panel`);
    expect(panel.width).toBe("100%");
    expect(panel["border-radius"]).toBe("22px");
    expect(panel["box-shadow"]).toBe("0 24px 48px rgba(0, 0, 0, 0.35)");
    expect(panel.background).toBe("var(--s-surface)");
  });

  it("sets the title at 22/800", () => {
    const title = decl(`${SCOPE} .confirm-panel .t-title`);
    expect(title["font-size"]).toBe("22px");
    expect(title["font-weight"]).toBe("800");
  });

  it("puts the erase badge on --s-live-quiet", () => {
    const glyph = decl(`${SCOPE} .confirm-glyph`);
    expect(glyph.background).toBe("var(--s-live-quiet)");
    expect(glyph.color).toBe("var(--s-live)");
    expect(glyph.width).toBe("76px");
    expect(glyph.height).toBe("76px");
    expect(glyph["border-radius"]).toBe("50%");
  });

  it("floats the preview row on --s-floor, with a 60px round Play/Pause transport (#979)", () => {
    const preview = decl(`${SCOPE} .confirm-preview`);
    expect(preview.background).toBe("var(--s-floor)");
    expect(preview.height).toBe("78px");
    expect(preview["border-radius"]).toBe("14px");
    expect(preview["align-self"]).toBe("stretch");
    const play = decl(`${SCOPE} .confirm-preview-play`);
    expect(play.width).toBe("60px");
    expect(play.height).toBe("60px");
  });

  it("lays the two buttons out in two columns, 76 tall, radius 14", () => {
    const actions = decl(`${SCOPE} .confirm-actions`);
    expect(actions.display).toBe("grid");
    expect(actions["grid-template-columns"]).toBe("1fr 1fr");
    expect(actions["align-self"]).toBe("stretch");
    const button = decl(`${SCOPE} .confirm-actions > .control`);
    expect(button.height).toBe("76px");
    expect(button.width).toBe("auto");
    expect(button["border-radius"]).toBe("14px");
    const keep = decl(`${SCOPE} .confirm-actions > .confirm-cancel`);
    expect(keep.background).toBe("var(--s-well)");
    expect(keep.color).toBe("var(--s-ink)");
  });

  it("reaches colour only through layer-2 roles", () => {
    const values = RULES.flatMap(({ body }) => [
      ...body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g),
    ]);
    expect(values.length).toBeGreaterThanOrEqual(15);
    for (const [, prop, value] of values)
      expect(value, `${prop} reaches past layer 2`).not.toMatch(/--p-/);
  });
});

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

async function mountConfirm() {
  await act(async () => {
    root.render(
      createElement(EraseConfirm, {
        open: true,
        title: "Erase this recording?",
        confirmLabel: "Erase",
        cancelLabel: "Cancel",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      })
    );
  });
}

/**
 * The bare mount above, plus `preview` (#979) — used only by the selector
 * checks below, never by the focus-trap describe further down: that one
 * stays on the bare `mountConfirm()` so its "two buttons" assertions are
 * exactly what they were before this row existed (the focus trap unchanged,
 * per #979's Done-when).
 */
async function mountConfirmWithPreview() {
  // jsdom has no canvas 2D context; `Waveform`'s draw effect already bails
  // out on a null one (its own early return), so this only silences the
  // "not implemented" noise.
  vi.spyOn(
    dom.window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockReturnValue(null);
  await act(async () => {
    root.render(
      createElement(EraseConfirm, {
        open: true,
        title: "Erase this recording?",
        confirmLabel: "Erase",
        cancelLabel: "Cancel",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        preview: {
          peaks: null,
          playing: false,
          onTogglePlay: vi.fn(),
          playLabel: "Play what will be lost",
          pauseLabel: "Pause",
        },
      })
    );
  });
}

describe("o4/dialogs.css's selectors against EraseConfirm's real markup (#946, #979)", () => {
  const selectors = RULES.flatMap((r) => r.selectors);
  const isPreview = (s: string) => s.includes(".confirm-preview");

  it("every non-preview selector matches with the switch on, no preview passed", async () => {
    document.documentElement.setAttribute("data-design", "o4");
    await mountConfirm();
    const rest = selectors.filter((s) => !isPreview(s));
    expect(rest.length).toBeGreaterThanOrEqual(6);
    for (const s of rest) expect(document.querySelector(s), s).not.toBeNull();
  });

  it("the preview row's selectors match with the switch on, once preview is passed", async () => {
    document.documentElement.setAttribute("data-design", "o4");
    await mountConfirmWithPreview();
    const previewSelectors = selectors.filter(isPreview);
    expect(previewSelectors.length).toBeGreaterThanOrEqual(2);
    for (const s of previewSelectors)
      expect(document.querySelector(s), s).not.toBeNull();
  });

  it("no selector matches with the switch off, even with preview passed", async () => {
    document.documentElement.setAttribute("data-design", "current");
    await mountConfirmWithPreview();
    // The dialog, and the preview row itself, are up — so a null below is the
    // scope prefix doing its job, not an empty page or an unrendered row.
    expect(document.querySelector(".confirm-panel")).not.toBeNull();
    expect(document.querySelector(".confirm-preview")).not.toBeNull();
    for (const s of selectors) expect(document.querySelector(s), s).toBeNull();
  });
});

describe("EraseConfirm's focus with the switch on (#946)", () => {
  function tab(shiftKey = false) {
    const e = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(e);
  }

  it("lands on Cancel, and Tab wraps both ways inside the panel", async () => {
    document.documentElement.setAttribute("data-design", "o4");
    await mountConfirm();
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(".confirm-panel button"),
    ];
    expect(buttons).toHaveLength(2);
    const [cancel, erase] = buttons;
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab on the first control wraps to the last.
    tab(true);
    expect(document.activeElement).toBe(erase);
    // Tab on the last control wraps back to the first.
    tab();
    expect(document.activeElement).toBe(cancel);
  });
});
