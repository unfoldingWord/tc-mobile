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
    const icons = SHARE_STATUSES.map(
      (s) => shareControlAffordance(s, "web").icon
    );
    expect(new Set(icons).size).toBe(SHARE_STATUSES.length);
  });

  it("only preparing sets aria-busy", () => {
    expect(shareControlAffordance("idle", "web").busy).toBe(false);
    expect(shareControlAffordance("preparing", "web").busy).toBe(true);
    expect(shareControlAffordance("ready", "web").busy).toBe(false);
  });

  it("only ready is the primary tap-to-send variant; idle and preparing stay the same size (#164, #351)", () => {
    expect(shareControlAffordance("idle", "web").variant).toBe("quiet");
    expect(shareControlAffordance("preparing", "web").variant).toBe("quiet");
    expect(shareControlAffordance("ready", "web").variant).toBe("primary");
  });

  it("preparing reuses the retry glyph — the same wait mark Notice's busy tone wears", () => {
    expect(shareControlAffordance("preparing", "web").icon).toBe("retry");
  });

  it("ready reuses the check glyph — the 'yes, this is so' mark, never the plain share glyph", () => {
    expect(shareControlAffordance("ready", "web").icon).toBe("check");
    expect(shareControlAffordance("idle", "web").icon).toBe("share");
  });

  it("only ready carries the ink class — a caller cannot forget the tone the way a hand-attached className could (George R1 P3)", () => {
    expect(shareControlAffordance("idle", "web").className).toBeUndefined();
    expect(
      shareControlAffordance("preparing", "web").className
    ).toBeUndefined();
    expect(shareControlAffordance("ready", "web").className).toBe(
      "control-ready"
    );
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

/**
 * The Share control's idle glyph is the platform's own (#490, decided
 * 2026-09-19): Android's three joined dots on the Android build, the tray
 * everywhere else. Only `idle` — `preparing` and `ready` are the wait and the
 * "yes" marks, which are the same on every phone.
 */
describe("shareControlAffordance is platform-native at idle only (#490)", () => {
  const PLATFORMS = ["android", "ios", "web"] as const;

  it("android idle draws Android's share glyph; iOS and web keep the tray", () => {
    expect(shareControlAffordance("idle", "android").icon).toBe(
      "share-android"
    );
    expect(shareControlAffordance("idle", "ios").icon).toBe("share");
    expect(shareControlAffordance("idle", "web").icon).toBe("share");
  });

  it("preparing and ready are identical on every platform", () => {
    for (const status of ["preparing", "ready"] as const) {
      const [first, ...rest] = PLATFORMS.map((p) =>
        shareControlAffordance(status, p)
      );
      for (const other of rest) expect(other).toEqual(first);
    }
  });

  it("every status still has its own glyph on every platform", () => {
    for (const platform of PLATFORMS) {
      const icons = SHARE_STATUSES.map(
        (s) => shareControlAffordance(s, platform).icon
      );
      expect(new Set(icons).size).toBe(SHARE_STATUSES.length);
    }
  });

  it("the glyph is the ONLY thing the platform changes — the label never enters the table", () => {
    // The aria-label is identical on every platform by construction: it is
    // supplied by the screen from `strings`, and the affordance has no label
    // field for a platform to vary.
    const affordance = shareControlAffordance("idle", "android");
    expect(Object.keys(affordance).sort()).toEqual(
      ["busy", "className", "icon", "variant"].sort()
    );
  });
});
