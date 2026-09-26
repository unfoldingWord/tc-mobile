import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { CoverPicker } from "@/components/cover-picker";
import { coverColourName } from "@/components/cover-colour-copy";
import { COVER_COLOUR_KEYS, type CoverColourKey } from "@/lib/cover-colour";
import { strings } from "@/lib/strings";

import { render } from "./render";

/**
 * `CoverPicker` is exported only — #957 item 6, "nothing changes on screen" —
 * so this is the props-to-attributes guarantee `tests/render.ts` exists for
 * (#197), the same shape `control-render.test.ts` proves for `Control`.
 * Static markup cannot exercise `onClick`, so the "calls onSelect with the
 * tapped key" half is not covered here; there is no mounted screen to reach it
 * from until #943/#949 land.
 */
function swatches(selected: CoverColourKey) {
  return render(
    createElement(CoverPicker, { selected, onSelect: () => {} })
  ).querySelectorAll("button.cover-swatch");
}

describe("CoverPicker", () => {
  it("renders one swatch per palette key, in palette order", () => {
    const buttons = swatches(COVER_COLOUR_KEYS[0]!);
    expect(buttons.length).toBe(COVER_COLOUR_KEYS.length);
    COVER_COLOUR_KEYS.forEach((key, i) => {
      expect(buttons[i]!.getAttribute("title")).toBe(coverColourName(key));
    });
  });

  it("marks exactly the selected swatch aria-pressed", () => {
    const selected = COVER_COLOUR_KEYS[2]!;
    const buttons = swatches(selected);
    const pressed = Array.from(buttons).filter(
      (b) => b.getAttribute("aria-pressed") === "true"
    );
    expect(pressed.length).toBe(1);
    expect(pressed[0]!.getAttribute("title")).toBe(coverColourName(selected));

    // Every other swatch is explicitly aria-pressed="false", never absent —
    // `Control`'s own `pressed` doc is why: an absent attribute and a false
    // one say different things, and this is a row of toggles, not one.
    const notPressed = Array.from(buttons).filter((b) => b !== pressed[0]);
    expect(
      notPressed.every((b) => b.getAttribute("aria-pressed") === "false")
    ).toBe(true);
  });

  it("names the selected swatch's accessible name with the selected word", () => {
    const selected = COVER_COLOUR_KEYS[1]!;
    const buttons = swatches(selected);
    const selectedButton = Array.from(buttons).find(
      (b) => b.getAttribute("aria-pressed") === "true"
    )!;
    expect(selectedButton.getAttribute("aria-label")).toBe(
      strings.coverSwatchLabel(coverColourName(selected), true)
    );
  });

  it("gives an unselected swatch its plain colour name, with no selected word", () => {
    const buttons = swatches(COVER_COLOUR_KEYS[0]!);
    const unselected = Array.from(buttons).find(
      (b) => b.getAttribute("aria-pressed") === "false"
    )!;
    // Whichever one this is, its name must not carry the selected suffix.
    expect(unselected.getAttribute("aria-label")).not.toContain("selected");
  });

  it("paints each swatch's own hex as an inline fill", () => {
    const buttons = swatches(COVER_COLOUR_KEYS[0]!);
    // jsdom normalises `background-color: #rrggbb` to an `rgb(...)` string in
    // the style attribute; asserting presence (non-empty) rather than the
    // exact string keeps this from being an accidental hex-format pin.
    Array.from(buttons).forEach((b) => {
      expect((b as HTMLElement).style.backgroundColor).not.toBe("");
    });
  });

  it("groups the row under the cover-colour accessible name", () => {
    const container = render(
      createElement(CoverPicker, {
        selected: COVER_COLOUR_KEYS[0]!,
        onSelect: () => {},
      })
    );
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe(strings.coverColourLabel);
  });

  it("disables every swatch when told a write is in flight", () => {
    const container = render(
      createElement(CoverPicker, {
        selected: COVER_COLOUR_KEYS[0]!,
        onSelect: () => {},
        disabled: true,
      })
    );
    const buttons = container.querySelectorAll("button.cover-swatch");
    expect(buttons.length).toBeGreaterThan(0);
    expect(Array.from(buttons).every((b) => b.hasAttribute("disabled"))).toBe(
      true
    );
  });
});
