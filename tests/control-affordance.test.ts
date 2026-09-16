import { describe, expect, it } from "vitest";

import {
  confirmControlAffordance,
  shareControlAffordance,
} from "@/components/control-affordance";

/**
 * #354 / #383 — a busy `Control` and a ready `Control` must each look and
 * read like it, and neither may borrow the other's mark. Mirrors
 * `notice-tone.test.ts`'s shape: pin the state → presentation table, not a
 * render (this repo has no jsdom).
 */

const SHARE_STATUSES = ["idle", "preparing", "ready"] as const;

describe("shareControlAffordance", () => {
  it("gives every status its own glyph — preparing must never wear idle's or ready's", () => {
    const icons = SHARE_STATUSES.map((s) => shareControlAffordance(s).icon);
    expect(new Set(icons).size).toBe(SHARE_STATUSES.length);
  });

  it("only preparing sets aria-busy", () => {
    expect(shareControlAffordance("idle").busy).toBe(false);
    expect(shareControlAffordance("preparing").busy).toBe(true);
    expect(shareControlAffordance("ready").busy).toBe(false);
  });

  it("only ready is the primary tap-to-send variant; idle and preparing stay the same size (#164, #351)", () => {
    expect(shareControlAffordance("idle").variant).toBe("quiet");
    expect(shareControlAffordance("preparing").variant).toBe("quiet");
    expect(shareControlAffordance("ready").variant).toBe("primary");
  });

  it("preparing reuses the retry glyph — the same wait mark Notice's busy tone wears", () => {
    expect(shareControlAffordance("preparing").icon).toBe("retry");
  });

  it("ready reuses the check glyph — the 'yes, this is so' mark, never the plain share glyph", () => {
    expect(shareControlAffordance("ready").icon).toBe("check");
    expect(shareControlAffordance("idle").icon).toBe("share");
  });

  it("only ready carries the ink class — a caller cannot forget the tone the way a hand-attached className could (George R1 P3)", () => {
    expect(shareControlAffordance("idle").className).toBeUndefined();
    expect(shareControlAffordance("preparing").className).toBeUndefined();
    expect(shareControlAffordance("ready").className).toBe("control-ready");
  });
});

describe("confirmControlAffordance", () => {
  it("gives busy and idle their own glyph", () => {
    expect(confirmControlAffordance(true).icon).not.toBe(
      confirmControlAffordance(false).icon
    );
  });

  it("only the in-flight write sets aria-busy", () => {
    expect(confirmControlAffordance(false).busy).toBe(false);
    expect(confirmControlAffordance(true).busy).toBe(true);
  });

  it("busy reuses the retry glyph; idle keeps the check the Save control already wears", () => {
    expect(confirmControlAffordance(true).icon).toBe("retry");
    expect(confirmControlAffordance(false).icon).toBe("check");
  });
});
