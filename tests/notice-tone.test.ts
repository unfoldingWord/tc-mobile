import { describe, expect, it } from "vitest";

import { NOTICE_TONES, noticePresentation } from "@/components/notice-tone";

/**
 * #112 — `Notice` has to say three different things with three different marks.
 *
 * The app is for people who may not read, so the glyph carries the meaning: a
 * failure (`alert`), work to wait for (`busy`), and a heads-up about something
 * already done (`info`) must never share a mark. Before this the share gap
 * warning ("N segments were left out") rode on `busy`, so it wore the same
 * wait/retry glyph the translator had just seen for "Preparing the chapter".
 *
 * No renderer here (this repo has no jsdom); the JSX around these values is
 * review surface. What is pinned is the tone → presentation table itself.
 */

describe("noticePresentation", () => {
  it("gives every tone its own glyph", () => {
    const icons = NOTICE_TONES.map((tone) => noticePresentation(tone).icon);
    expect(new Set(icons).size).toBe(NOTICE_TONES.length);
  });

  it("only a failure interrupts (role=alert); busy and info wait their turn", () => {
    expect(noticePresentation("alert").role).toBe("alert");
    expect(noticePresentation("busy").role).toBe("status");
    expect(noticePresentation("info").role).toBe("status");
  });

  it("only a failure wears the failure colour", () => {
    expect(noticePresentation("alert").failure).toBe(true);
    expect(noticePresentation("busy").failure).toBe(false);
    expect(noticePresentation("info").failure).toBe(false);
  });

  it("info is a heads-up, not a wait: it is neither muted nor the retry mark", () => {
    const info = noticePresentation("info");
    expect(info.icon).not.toBe("retry");
    expect(info.muted).toBe(false);
    expect(noticePresentation("busy").muted).toBe(true);
  });
});
