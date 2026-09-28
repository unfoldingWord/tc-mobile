import { describe, expect, it } from "vitest";

import {
  sendLogHandoffView,
  sendLogLabel,
  type SendLogHandoff,
} from "@/components/send-log-control-view";
import { shareSettledGlyph } from "@/components/share-outcome-glyph";
import { strings } from "@/lib/strings";

/**
 * #1088 items 1 and 2, the pure half. `SendLogControl` wraps the browser-
 * boundary `useFailureLogShare` hook, and `tests/render.ts` brings no
 * effects or events (its own docblock), so neither a tap nor a settled send
 * is reachable through a static render — the same constraint
 * `tests/save-failed.test.ts` already documents for this control. These two
 * functions are the decision tables that reachability problem is routed
 * around: pure, so a test calls them directly.
 */
describe("sendLogLabel (#1088 item 2 — the visible label)", () => {
  it("is the Share-now label once armed, whatever sendUnconfirmed says", () => {
    expect(sendLogLabel(true, false)).toBe(strings.shareSend);
    expect(sendLogLabel(true, true)).toBe(strings.shareSend);
  });

  it("is the plain Send-problem-report label when idle and never unconfirmed", () => {
    expect(sendLogLabel(false, false)).toBe(strings.shareFailureLog);
  });

  it("is the unconfirmed variant when idle after an unproven send", () => {
    expect(sendLogLabel(false, true)).toBe(strings.shareFailureLogUnconfirmed);
  });
});

describe("sendLogHandoffView (#1088 item 2 — the hand-off confirmation)", () => {
  const cases: readonly [SendLogHandoff, string][] = [
    ["sent", strings.shareSent],
    ["dismissed", strings.shareDismissed],
    ["unproven", strings.shareUnproven],
  ];

  for (const [outcome, text] of cases) {
    it(`reads ${text.slice(0, 20)}... for a "${outcome}" settle`, () => {
      const view = sendLogHandoffView(outcome);
      expect(view.text).toBe(text);
    });

    it(`"${outcome}" wears the SAME mark the chapter/book share overlay uses (the D16 table)`, () => {
      const view = sendLogHandoffView(outcome);
      const glyph = shareSettledGlyph(outcome);
      expect(view.icon).toBe(glyph.icon);
      expect(view.tone).toBe(glyph.tone);
    });
  }

  it("never claims delivery — the same rule shareSent/shareUnproven already follow", () => {
    for (const [outcome] of cases) {
      const { text } = sendLogHandoffView(outcome);
      expect(text.toLowerCase()).not.toMatch(/\bsent\b|\bdelivered\b/);
    }
  });
});
