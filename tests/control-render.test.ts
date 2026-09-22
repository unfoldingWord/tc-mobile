import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Control } from "@/components/control";
import { rowHint } from "@/components/menu-row-state";

import { one, render } from "./render";

/**
 * #197 (the scope item added 2026-09-03): `Control`'s three inert cells, as
 * the attributes they actually emit.
 *
 * All three are contracts about *how* a control is made inert, and every one of
 * them is a single expression on `control.tsx:disabled`. Inverting it to
 * `(disabled || busy) && !softDisabled` left the whole suite green, because no
 * `tests/` file rendered the component — the cell is also unreachable in the
 * tree today (no caller passes both `busy` and `disabled`), so `Control.busy`
 * could spread to one before anything noticed.
 *
 * `tests/control-affordance.test.ts` covers the neighbouring question — which
 * glyph and label a busy control wears — from the pure table. This file is the
 * attribute half. Static markup cannot exercise the `onClick` guard: whether
 * busy and soft-disabled controls reject activation remains outside this
 * harness's coverage. Neither half subsumes the other: a correct table rendered
 * through a wrong attribute is still a control an AT user is stranded behind, and a
 * correct attribute carrying the wrong glyph is still the wrong mark.
 */
const button = (props: Parameters<typeof Control>[0]) =>
  one(render(createElement(Control, props)), "button");

describe("Control's inert cells", () => {
  it("never natively disables a busy control, even when `disabled` is also set", () => {
    // The #155 F1 guarantee. A native `disabled` drops focus, which behind the
    // recovery panel's scrim strands an AT/switch user with nowhere to land.
    const el = button({
      icon: "retry",
      label: "Try again",
      busy: true,
      disabled: true,
    });

    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-busy")).toBe("true");
  });

  it("natively disables the hard-disabled cell — no hint, not busy", () => {
    // The other direction, so the assertion above cannot be satisfied by a
    // `disabled` attribute that simply never renders.
    const el = button({ icon: "play", label: "Play", disabled: true });

    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
  });

  it("makes a hinted row `aria-disabled` and says the reason in its name", () => {
    // #135: natively disabled skips Tab, putting the reason out of reach of
    // exactly the users who needed it.
    const hint = rowHint("uncommitted-take");
    const el = button({
      icon: "trash",
      label: "Erase recording",
      disabled: true,
      hint,
    });

    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.getAttribute("aria-disabled")).toBe("true");
    expect(el.getAttribute("aria-label")).toBe(
      `Erase recording. ${hint!.label}`
    );
  });
});

describe("Control's disabled-row badge", () => {
  it("paints the ≡-row `alert` badge beside the button, not inside it", () => {
    // The sighted half of the same cue (#135 round 2 found the words alone were
    // invisible), and a SIBLING so the dimming that marks the row inert does
    // not also dim the mark explaining it.
    const container = render(
      createElement(Control, {
        icon: "trash",
        label: "Erase recording",
        disabled: true,
        hint: rowHint("uncommitted-take"),
      })
    );
    const badge = one(container, ".control-hint");

    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(one(container, "button").contains(badge)).toBe(false);
  });

  it("keeps the hinted root stable when the row is enabled, and shows no badge", () => {
    // The root must not switch between <span> and <button> as a row gains its
    // badge: that remounts — and destroys — a focused button (George R3).
    const enabled = render(
      createElement(Control, {
        icon: "trash",
        label: "Erase recording",
        hint: null,
      })
    );

    expect(one(enabled, ".control-hinted")).toBeTruthy();
    expect(enabled.querySelector(".control-hint")).toBeNull();
    expect(one(enabled, "button").getAttribute("aria-label")).toBe(
      "Erase recording"
    );
  });

  it("drops the wrapper entirely for a control that can never carry a hint", () => {
    const plain = render(
      createElement(Control, { icon: "play", label: "Play" })
    );

    expect(plain.querySelector(".control-hinted")).toBeNull();
    expect(plain.firstElementChild?.tagName.toLowerCase()).toBe("button");
  });
});

describe("Control's toggle state", () => {
  it("distinguishes an off toggle from a plain action button", () => {
    // An absent `aria-pressed` and a `false` one say different things, so
    // `pressed` must not default (#286/#91).
    expect(
      button({ icon: "zoom-in", label: "Zoom", pressed: false }).getAttribute(
        "aria-pressed"
      )
    ).toBe("false");
    expect(
      button({ icon: "zoom-in", label: "Zoom" }).hasAttribute("aria-pressed")
    ).toBe(false);
  });

  it("paints the on-mark only while pressed", () => {
    expect(
      button({ icon: "zoom-in", label: "Zoom", pressed: true }).className
    ).toContain("is-on");
    expect(
      button({ icon: "zoom-in", label: "Zoom", pressed: false }).className
    ).not.toContain("is-on");
  });
});
