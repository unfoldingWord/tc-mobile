import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Control } from "@/components/control";
import {
  PillButton,
  SpeakerButton,
  SquareButton,
  TransportButton,
} from "@/components/o4-controls";

import { areaRules, declsFor } from "./o4-area-css";
import { one, render } from "./render";

/**
 * #941: the O4 shared control wrappers (speaker 52, square 56 r14, row
 * transport 72, pill 60 r30), and the one addition to `Control` they need —
 * a visible caption.
 *
 * Two halves, the split `tests/render.ts` documents: the markup each wrapper
 * emits (the accessible name and the `Control` semantics it must keep), and
 * the rules `o4/controls.css` carries for it. The harness has no cascade, so
 * whether the rules WIN in a browser is not a question this file can answer.
 */
const button = (el: Parameters<typeof render>[0]) => one(render(el), "button");

describe("Control's caption (#941)", () => {
  it("renders nothing extra when no caption is passed — the switch-off markup", () => {
    const el = button(createElement(Control, { icon: "play", label: "Play" }));
    expect(el.querySelector(".control-caption")).toBeNull();
    expect(el.children.length).toBe(1);
  });

  it("puts the caption inside the button, hidden from AT, without changing the name", () => {
    const el = button(
      createElement(Control, { icon: "share", label: "Share", caption: "Send" })
    );
    const caption = one(el, ".control-caption");
    expect(caption.textContent).toBe("Send");
    expect(caption.getAttribute("aria-hidden")).toBe("true");
    // The name is still the label, never the caption: the accessible name
    // must be the same in both looks (#936's switch contract).
    expect(el.getAttribute("aria-label")).toBe("Share");
  });
});

describe("the O4 control wrappers (#941)", () => {
  it("SpeakerButton is a Control wearing the hear glyph and the speaker shape", () => {
    const el = button(createElement(SpeakerButton, { label: "Hear this" }));
    expect(el.classList.contains("control")).toBe(true);
    expect(el.classList.contains("o4-speaker")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("Hear this");
    expect(el.querySelector("svg")?.getAttribute("width")).toBe("24");
  });

  it("SquareButton is a Control wearing the square shape", () => {
    const el = button(
      createElement(SquareButton, { icon: "plus", label: "New book" })
    );
    expect(el.classList.contains("control")).toBe(true);
    expect(el.classList.contains("o4-square")).toBe(true);
    expect(el.getAttribute("aria-label")).toBe("New book");
  });

  it("TransportButton keeps Control's play and record variants", () => {
    const play = button(
      createElement(TransportButton, {
        kind: "play",
        icon: "play",
        label: "Play",
      })
    );
    expect(play.classList.contains("o4-transport")).toBe(true);
    expect(play.classList.contains("control--play")).toBe(true);
    const rec = button(
      createElement(TransportButton, {
        kind: "record",
        icon: "record",
        label: "Record",
      })
    );
    expect(rec.classList.contains("o4-transport")).toBe(true);
    expect(rec.classList.contains("control--record")).toBe(true);
  });

  it("PillButton shows its caption and keeps the label as the name", () => {
    const el = button(
      createElement(PillButton, {
        icon: "share",
        label: "Send report",
        caption: "Send report",
      })
    );
    expect(el.classList.contains("o4-pill")).toBe(true);
    expect(one(el, ".control-caption").textContent).toBe("Send report");
    expect(el.getAttribute("aria-label")).toBe("Send report");
  });

  it("keeps Control's inert semantics — a hinted wrapper stays focusable", () => {
    const el = button(
      createElement(SquareButton, {
        icon: "plus",
        label: "New book",
        disabled: true,
        hint: { label: "Busy" },
      })
    );
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe("New book. Busy");
  });
});

describe("o4/controls.css (#941)", () => {
  const rules = areaRules("controls");

  it("scopes every rule under the switch", () => {
    // Non-emptiness floor: an empty parse must not pass the loop vacuously.
    expect(rules.length).toBeGreaterThanOrEqual(4);
    for (const rule of rules)
      for (const selector of rule.selectors)
        expect(selector).toMatch(/^\[data-design="o4"\] /);
  });

  it("paints colour only through layer-2 roles", () => {
    const colours = rules.flatMap((r) =>
      [...r.decls].filter(([prop]) => /color|background|shadow/.test(prop))
    );
    expect(colours.length).toBeGreaterThanOrEqual(4);
    for (const [prop, value] of colours) {
      expect(value, prop).not.toMatch(/--p-/);
      expect(value, prop).toMatch(/var\(--s-/);
    }
  });

  it("sizes the speaker 52, circle, on the well with the hear glyph", () => {
    const d = declsFor(rules, '[data-design="o4"] .o4-speaker');
    expect(d.get("width")).toBe("52px");
    expect(d.get("height")).toBe("52px");
    expect(d.get("background")).toBe("var(--s-well)");
    expect(d.get("color")).toBe("var(--s-hear)");
  });

  it("sizes the square 56 with radius 14, on the well", () => {
    const d = declsFor(rules, '[data-design="o4"] .o4-square');
    expect(d.get("width")).toBe("56px");
    expect(d.get("height")).toBe("56px");
    expect(d.get("border-radius")).toBe("var(--p-radius-lg)");
    expect(d.get("background")).toBe("var(--s-well)");
  });

  it("sizes the row transport 72", () => {
    const d = declsFor(rules, '[data-design="o4"] .o4-transport');
    expect(d.get("width")).toBe("72px");
    expect(d.get("height")).toBe("72px");
  });

  it("sizes the pill 60 tall with radius 30, 17/700, on the well", () => {
    const d = declsFor(rules, '[data-design="o4"] .o4-pill');
    expect(d.get("height")).toBe("60px");
    expect(d.get("border-radius")).toBe("30px");
    expect(d.get("font-size")).toBe("17px");
    expect(d.get("font-weight")).toBe("700");
    expect(d.get("background")).toBe("var(--s-well)");
  });
});
