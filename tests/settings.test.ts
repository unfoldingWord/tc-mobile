import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Icon } from "@/components/icon";
import { SettingRow } from "@/components/setting-row";
import { one, render } from "./render";
import {
  chapterNameShown,
  readStoredAlwaysChapterNumber,
  readStoredNormalizeOnFinished,
  storeAlwaysChapterNumber,
} from "@/lib/settings";
import { strings } from "@/lib/strings";

describe("the always-chapter-number setting (S12, #1575)", () => {
  it("defaults off on anything this app did not write", () => {
    expect(readStoredAlwaysChapterNumber(null)).toBe(false);
    expect(readStoredAlwaysChapterNumber("")).toBe(false);
    expect(readStoredAlwaysChapterNumber("true")).toBe(false);
    expect(readStoredAlwaysChapterNumber("0")).toBe(false);
  });

  it("reads back what it stores, both ways", () => {
    expect(readStoredAlwaysChapterNumber(storeAlwaysChapterNumber(true))).toBe(
      true
    );
    expect(readStoredAlwaysChapterNumber(storeAlwaysChapterNumber(false))).toBe(
      false
    );
  });

  it("off: the name when there is one, the number when there is not", () => {
    expect(strings.chapterHeading(chapterNameShown("Mark 6", false), 3)).toBe(
      "Mark 6"
    );
    expect(strings.chapterHeading(chapterNameShown(null, false), 3)).toBe(
      strings.chapterName(3)
    );
  });

  it("on: always the sequential number, named or not", () => {
    expect(strings.chapterHeading(chapterNameShown("Mark 6", true), 3)).toBe(
      strings.chapterName(3)
    );
    expect(strings.chapterHeading(chapterNameShown(null, true), 3)).toBe(
      strings.chapterName(3)
    );
  });
});

describe("the normalize-on-Finished preference (#1433, U6b)", () => {
  it("is off when nothing is stored, and on only for an explicit on", () => {
    // Off by default for the v1.2.0 tester build (PR #1746). A stored "1"
    // is a person's own choice and holds.
    expect(readStoredNormalizeOnFinished(null)).toBe(false);
    expect(readStoredNormalizeOnFinished("")).toBe(false);
    expect(readStoredNormalizeOnFinished("0")).toBe(false);
    expect(readStoredNormalizeOnFinished("1")).toBe(true);
  });
});

describe("the gear icon (#1575)", () => {
  it("draws on the 22-unit grid in currentColor, and is not the sun", () => {
    const gear = one(render(createElement(Icon, { name: "gear" })), "svg");
    const sun = one(render(createElement(Icon, { name: "sun" })), "svg");
    expect(gear.getAttribute("viewBox")).toBe("0 0 22 22");
    expect(gear.innerHTML).toContain("currentColor");
    expect(gear.querySelectorAll("path, circle").length).toBeGreaterThan(0);
    // The theme row sits beside the gear's screen; two near-identical glyphs
    // would be the confusion the drawing is made to avoid.
    expect(gear.innerHTML === sun.innerHTML).toBe(false);
  });
});

describe("a Settings row (#1575)", () => {
  const row = (on?: boolean) =>
    one(
      render(
        createElement(SettingRow, {
          icon: "gear",
          label: "Words",
          on,
          onClick: () => {},
        })
      ),
      "button"
    );

  it("a switch row names its state in place and to AT; an action row has neither", () => {
    expect(row(true).getAttribute("role")).toBe("switch");
    expect(row(true).getAttribute("aria-checked")).toBe("true");
    expect(row(true).hasAttribute("aria-pressed")).toBe(false);
    expect(row(true).querySelector(".setting-switch")).not.toBeNull();
    expect(row(true).classList).toContain("is-on");
    expect(row(false).getAttribute("role")).toBe("switch");
    expect(row(false).getAttribute("aria-checked")).toBe("false");
    expect(row(false).hasAttribute("aria-pressed")).toBe(false);
    expect(row(false).classList).not.toContain("is-on");
    // An absent `aria-checked` and a false one say different things, and an
    // action row is a plain button: no switch role, no pressed state.
    expect(row(undefined).hasAttribute("aria-checked")).toBe(false);
    expect(row(undefined).hasAttribute("role")).toBe(false);
    expect(row(undefined).hasAttribute("aria-pressed")).toBe(false);
    expect(row(undefined).querySelector(".setting-switch")).toBeNull();
  });

  it("its visible words are its whole accessible name", () => {
    const b = row(false);
    expect(b.getAttribute("aria-label")).toBe("Words");
    expect(b.querySelector(".setting-row-text")?.textContent).toBe("Words");
  });
});
