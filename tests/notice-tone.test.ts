import { describe, expect, it } from "vitest";

import { noticePresentation, type NoticeTone } from "@/components/notice-tone";

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

// Enumerated here rather than exported from the module: production has no use
// for a tone list (the exhaustive `switch` already makes the table total), and a
// src export kept alive only by a test import is invisible to knip.
const TONES: readonly NoticeTone[] = ["alert", "busy", "info"];

describe("noticePresentation", () => {
  it("gives every tone its own glyph", () => {
    const icons = TONES.map((tone) => noticePresentation(tone).icon);
    expect(new Set(icons).size).toBe(TONES.length);
  });

  it("gives every tone its own glyph colour", () => {
    // The glyph carries the meaning for a non-reader, so shape and colour must
    // both separate the three (George G3).
    const colours = TONES.map((tone) => noticePresentation(tone).glyph);
    expect(new Set(colours).size).toBe(TONES.length);
  });

  it("only a failure paints the glyph in the failure colour", () => {
    expect(noticePresentation("alert").glyph).toBe("var(--s-live)");
    expect(noticePresentation("busy").glyph).toBe("var(--s-ink-muted)");
    expect(noticePresentation("info").glyph).toBe("var(--s-warn)");
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
