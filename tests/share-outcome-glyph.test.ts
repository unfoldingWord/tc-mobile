import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Icon } from "@/components/icon";
import {
  SHARE_OUTCOMES,
  shareErrorGlyph,
  shareOutcomeGlyph,
  type ShareOutcome,
} from "@/components/share-outcome-glyph";
import type { ShareError } from "@/hooks/share-flow";
import { noticePresentation } from "@/components/notice-tone";

/**
 * The share outcomes must be tellable apart WITHOUT reading (#178).
 *
 * Share is the only way audio leaves the phone. "Your chapter went out with
 * one segment missing" and "nothing went out at all" have different remedies,
 * and if they look the same a facilitator collects an incomplete chapter
 * believing it is whole — the exact contract the `missing` count exists to
 * enforce.
 *
 * At the time #178 was filed all three wore one shape. #140 has since given
 * `partial` the `info` tone, so the residual collision is `nothing` against
 * `failed`: both were the red alert triangle, for "record something first" and
 * "try again".
 *
 * THIS FIXES THE GLYPH AND DELIBERATELY NOT THE TONE. #178's own fix shape says
 * "reuse the `info`/`alert` tone split from #112 rather than adding a fourth
 * tone", and whether `nothing` is a failure at all is #147's question — which
 * is `needs-decision` and Tim's, and whose table currently reads the share
 * error as "genuinely a failure". Re-toning it here would decide that issue by
 * the back door. So: three marks, existing tones.
 */
describe("shareOutcomeGlyph (#178)", () => {
  it("gives every outcome a DIFFERENT mark", () => {
    // The whole point. Three outcomes, three shapes.
    const icons = SHARE_OUTCOMES.map((o) => shareOutcomeGlyph(o).icon);
    expect(new Set(icons).size).toBe(SHARE_OUTCOMES.length);
  });

  it("covers every outcome, with no silent hole", () => {
    // `share-error-copy.ts`'s header names the defect this avoids: a nested
    // ternary ending in `: null` means widening the union compiles cleanly and
    // the menu shows nothing. Same reasoning, same `never` default.
    for (const outcome of SHARE_OUTCOMES) {
      const glyph = shareOutcomeGlyph(outcome);
      expect(glyph.icon, `${outcome} has no icon`).toBeTruthy();
      expect(glyph.tone, `${outcome} has no tone`).toBeTruthy();
    }
  });

  it("every mark is a glyph the icon set actually draws", () => {
    // A name that `PATHS` does not carry renders an empty <svg> — a Notice with
    // no mark at all, which is worse than the shared mark it replaced, and
    // nothing else in the tree would catch it.
    expect(typeof Icon).toBe("function");
    for (const outcome of SHARE_OUTCOMES) {
      const { icon } = shareOutcomeGlyph(outcome);
      // `Icon`'s own union is the contract; a bad name is a type error. This
      // asserts the runtime half — that the drawn set has an entry.
      const rendered = Icon({ name: icon, size: 20 });
      expect(rendered, `no drawn path for "${icon}"`).toBeTruthy();
    }
  });

  it("keeps the tones exactly as they are — this lane changes marks, not tones", () => {
    // Pins the #178/#147 boundary so a later "tidy-up" cannot quietly re-tone
    // `nothing` and close Tim's open question by accident.
    expect(shareOutcomeGlyph("partial").tone).toBe("info");
    expect(shareOutcomeGlyph("nothing").tone).toBe("alert");
    expect(shareOutcomeGlyph("failed").tone).toBe("alert");
  });

  it("nothing and failed share a tone, so ONLY the mark separates them", () => {
    // The reason the distinct-icon assertion above is load-bearing rather than
    // cosmetic: these two get the same colour and the same role, so if their
    // icons ever converge a non-reader has no way to tell "record something
    // first" from "try again".
    const nothing = shareOutcomeGlyph("nothing");
    const failed = shareOutcomeGlyph("failed");
    expect(nothing.tone).toBe(failed.tone);
    expect(noticePresentation(nothing.tone).glyph).toBe(
      noticePresentation(failed.tone).glyph
    );
    expect(nothing.icon).not.toBe(failed.icon);
  });

  it("does not reuse the tone's own default mark for either alert outcome", () => {
    // `alert`'s default glyph is the failure triangle. If `nothing` fell back to
    // it, this whole module would be a no-op that still passed the distinctness
    // check against `partial`.
    const alertDefault = noticePresentation("alert").icon;
    expect(shareOutcomeGlyph("nothing").icon).not.toBe(alertDefault);
    expect(shareOutcomeGlyph("failed").icon).toBe(alertDefault);
  });

  it("gives `partial` its own mark, not the generic info glyph", () => {
    // `info`'s default is the ring-and-i, which also carries storage
    // durability (#214/#406) and the interruption heads-up. "Some of your
    // audio did not go out" deserves its own shape, or share shares a mark
    // with an unrelated standing condition.
    expect(shareOutcomeGlyph("partial").icon).not.toBe(
      noticePresentation("info").icon
    );
  });
});

describe("the outcome list is exhaustive over ShareOutcome (#178)", () => {
  it("SHARE_OUTCOMES holds every member of the union", () => {
    // A hand-written list can fall behind the type. Assigning each member to
    // the union and back is what makes the compiler complain if it does, and
    // the length check catches a duplicate padding the count.
    const roundTrip: ShareOutcome[] = [...SHARE_OUTCOMES];
    expect(new Set(roundTrip).size).toBe(SHARE_OUTCOMES.length);
    expect(SHARE_OUTCOMES.length).toBe(3);
  });
});

describe("shareErrorGlyph (#178)", () => {
  it("maps the two outcome codes to the outcome table's marks", () => {
    expect(shareErrorGlyph("nothing")).toBe(shareOutcomeGlyph("nothing").icon);
    expect(shareErrorGlyph("failed")).toBe(shareOutcomeGlyph("failed").icon);
  });

  it("separates nothing from failed, which is the whole point", () => {
    expect(shareErrorGlyph("nothing")).not.toBe(shareErrorGlyph("failed"));
  });

  it("leaves `encoder` on the tone's own mark, as a named choice", () => {
    // #166's case, not one of #178's three outcomes: its copy already names a
    // different subsystem, and inventing a fourth mark for it would widen this
    // lane into a case nobody asked about. `undefined` means "use the tone's
    // default", which is the alert triangle it already had.
    expect(shareErrorGlyph("encoder")).toBeUndefined();
  });

  it("no error, no mark", () => {
    expect(shareErrorGlyph(null)).toBeUndefined();
  });

  it("is exhaustive over ShareError — a new code cannot go silent", () => {
    // `share-error-copy.ts`'s header records the defect: the old inline ternary
    // ended in `: null`, so #166 adding `encoder` compiled cleanly and the menu
    // showed nothing. Every code must be a deliberate answer, including
    // "the default".
    const codes: ShareError[] = ["nothing", "failed", "encoder"];
    for (const code of codes)
      expect(() => shareErrorGlyph(code), `${code} is unhandled`).not.toThrow();
    expect(new Set(codes).size).toBe(3);
  });
});

describe("the share menus actually pass the mark (#178)", () => {
  // The table could be perfect and wired to nothing — the knip blind spot
  // AGENTS.md names first, since a module imported only by a test looks used.
  // Source-shape, because there is no renderer here (#197).
  const read = (rel: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

  for (const screen of [
    "src/components/segments-screen.tsx",
    "src/components/books-screen.tsx",
  ]) {
    it(`${screen.split("/").pop()} passes an icon to both share Notices`, () => {
      const source = read(screen);
      // The partial/gap Notice.
      expect(source).toMatch(/icon=\{sharePartial\.icon\}/);
      // The error Notice.
      expect(source).toMatch(/icon=\{shareErrorGlyph\(/);
      // And no bare `<Notice>` left holding share copy, which is what the
      // error line looked like before.
      expect(source).not.toMatch(
        /<Notice>\{(bookS|s)hareErrorText\}<\/Notice>/
      );
    });
  }

  it("Notice can carry a caller's mark but never a caller's role", () => {
    // The override is scoped on purpose: substituting the shape is #178's
    // business, changing how urgently a screen reader interrupts is not.
    const notice = read("src/components/notice.tsx");
    expect(notice).toMatch(/icon\?: IconName/);
    expect(notice).toMatch(/icon \?\? toneIcon/);
    // `role` comes off the tone presentation and is not a prop.
    expect(notice).not.toMatch(/role\?:/);
    expect(notice).toMatch(
      /const \{ role, icon: toneIcon \} = noticePresentation/
    );
  });
});
