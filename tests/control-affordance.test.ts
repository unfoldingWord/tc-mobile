import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  confirmControlAffordance,
  shareControlAffordance,
  shareControlGlyph,
} from "@/components/control-affordance";

/** Source-shape reads: what the JSX SAYS, where no render would show it. */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

/**
 * #354 / #383 — a busy `Control` and a ready `Control` must each look and
 * read like it, and neither may borrow the other's mark. Mirrors
 * `notice-tone.test.ts`'s shape: pin the state → presentation table, not a
 * render. `tests/control-render.test.ts` is the render half — the attributes
 * `Control` emits for its inert cells — and neither file subsumes the other.
 */

const SHARE_STATUSES = ["idle", "preparing", "ready"] as const;

describe("shareControlAffordance", () => {
  it("preparing wears neither idle's nor ready's glyph (#860: idle and ready can now coincide on web/iOS, told apart by variant/className, not icon)", () => {
    const [idleIcon, preparingIcon, readyIcon] = SHARE_STATUSES.map(
      (s) => shareControlAffordance(s, "web").icon
    );
    expect(preparingIcon).not.toBe(idleIcon);
    expect(preparingIcon).not.toBe(readyIcon);
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

  it("ready wears the share glyph, not the check that used to read 'done' (#860, O1)", () => {
    expect(shareControlAffordance("ready", "web").icon).toBe("share");
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
 * everywhere else. Only `idle` — `preparing`'s wait mark and `ready`'s share
 * mark (#860, O1) are each the same on every phone; `ready`'s icon happens to
 * equal `idle`'s on iOS and web (both draw the tray), which is why the two
 * are told apart by variant/size/tint there, not by glyph.
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

  it("preparing's glyph is distinct from idle's and ready's on every platform; idle and ready may now coincide (#860, O1)", () => {
    for (const platform of PLATFORMS) {
      const [idleIcon, preparingIcon, readyIcon] = SHARE_STATUSES.map(
        (s) => shareControlAffordance(s, platform).icon
      );
      expect(preparingIcon).not.toBe(idleIcon);
      expect(preparingIcon).not.toBe(readyIcon);
    }
  });

  it("android's idle glyph (the three dots) still differs from ready's (the share mark) — only iOS and web share one shape for both", () => {
    expect(shareControlAffordance("idle", "android").icon).not.toBe(
      shareControlAffordance("ready", "android").icon
    );
    for (const platform of ["ios", "web"] as const) {
      expect(shareControlAffordance("idle", platform).icon).toBe(
        shareControlAffordance("ready", platform).icon
      );
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

  /**
   * `shareControlGlyph`'s own header names three callers that must share the
   * platform mark: "the two menus, the failure log's Send, the held-take
   * rescue". `recorder.tsx` (the held-take rescue) already reads
   * `shareControlGlyph(readSharePlatform())`; `send-log-control.tsx` (the
   * failure log's Send, on the crash and save-failed screens) hardcoded
   * `icon="share"` on both its prepare and send Controls instead (George r1
   * P3-4, #491) — the Android APK would have shown the tray there while
   * every ≡ menu showed three dots.
   */
  it("every named Share control caller reads the platform's own glyph, not a hardcoded tray (George r1 P3-4)", () => {
    for (const file of [
      "src/components/send-log-control.tsx",
      "src/components/recorder.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} hardcodes icon="share"`).not.toMatch(
        /icon="share"/
      );
      expect(source, `${file} never reads the platform`).toMatch(
        /shareControlGlyph\(readSharePlatform\(\)\)/
      );
    }
  });

  it("shareControlGlyph itself: android draws the three dots, everything else the tray", () => {
    expect(shareControlGlyph("android")).toBe("share-android");
    expect(shareControlGlyph("ios")).toBe("share");
    expect(shareControlGlyph("web")).toBe("share");
  });
});

/**
 * `unconfirmed` (George r2 P2-2, #491) — {@link UseShareFlow.sendUnconfirmed}
 * — overrides the IDLE cell only, on every platform: `preparing` and `ready`
 * already speak for themselves and must not change. Defaults to `false`, so
 * every existing call site (and every test above, none of which pass a third
 * argument) is unaffected — the whole point of adding a parameter here rather
 * than a fourth `ShareStatus`.
 */
describe("shareControlAffordance's unconfirmed idle override (George r2 P2-2, #491)", () => {
  it("defaults to false — omitting the argument reads exactly like passing false", () => {
    for (const platform of ["android", "ios", "web"] as const) {
      expect(shareControlAffordance("idle", platform)).toEqual(
        shareControlAffordance("idle", platform, false)
      );
    }
  });

  it("idle + unconfirmed wears the dismissed outcome's own arrow-back-down mark, on every platform — not the platform's own idle tray/dots, and not a new glyph", () => {
    for (const platform of ["android", "ios", "web"] as const) {
      expect(shareControlAffordance("idle", platform, true).icon).toBe(
        "share-closed"
      );
    }
  });

  it("unconfirmed does not change idle's variant, busy or className — only the icon", () => {
    const plain = shareControlAffordance("idle", "web", false);
    const unconfirmed = shareControlAffordance("idle", "web", true);
    expect(unconfirmed.variant).toBe(plain.variant);
    expect(unconfirmed.busy).toBe(plain.busy);
    expect(unconfirmed.className).toBe(plain.className);
  });

  it("unconfirmed has NO effect on preparing or ready — only the idle cell reads it", () => {
    for (const status of ["preparing", "ready"] as const) {
      expect(shareControlAffordance(status, "web", true)).toEqual(
        shareControlAffordance(status, "web", false)
      );
    }
  });
});
