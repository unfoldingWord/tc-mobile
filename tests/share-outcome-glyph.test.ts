import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Icon } from "@/components/icon";
import {
  SHARE_OUTCOMES,
  shareErrorGlyph,
  shareOutcomeGlyph,
  shareSettledGlyph,
} from "@/components/share-outcome-glyph";
import { shareControlGlyph } from "@/components/control-affordance";
import { SHARE_SETTLED, type ShareSettled } from "@/hooks/share-progress";
import type { ShareError } from "@/hooks/share-flow";
import { noticePresentation } from "@/components/notice-tone";

/** Source-shape reads, because there is no renderer here (#197). */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

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
  // A hand-written list typed `ShareOutcome[]` checks its ENTRIES, not its
  // completeness: widen the union to a fourth outcome, handle it in the
  // switch, forget the list, and every case above still passes over three
  // while the "every outcome" export is one short — and a hard-coded
  // `length === 3` is the same claim restated, not a check of it (Frank R1 P2
  // on #457). So the list is DERIVED from a `Record<ShareOutcome, …>`, where a
  // missing key is a compile error: complete by construction, the same
  // `never`-default reasoning `shareOutcomeGlyph` uses, at the type level.
  //
  // What a runtime test can still do is pin the MECHANISM, so a later tidy-up
  // back to a literal array — which compiles, and passes everything else —
  // fails here.
  it("is derived from a Record keyed by the union, not hand-written", () => {
    const source = read("src/components/share-outcome-glyph.ts");
    expect(source).toMatch(/Record<ShareOutcome, true>/);
    expect(source).toMatch(/SHARE_OUTCOMES = Object\.keys\(/);
    expect(source, "the hand-written list is back").not.toMatch(
      /SHARE_OUTCOMES: readonly ShareOutcome\[\] = \[/
    );
  });
});

describe("shareErrorGlyph (#178)", () => {
  it("maps the two outcome codes to the outcome table's marks", () => {
    expect(shareErrorGlyph("nothing")?.icon).toBe(
      shareOutcomeGlyph("nothing").icon
    );
    expect(shareErrorGlyph("failed")?.icon).toBe(
      shareOutcomeGlyph("failed").icon
    );
  });

  it("separates nothing from failed, which is the whole point", () => {
    expect(shareErrorGlyph("nothing")?.icon).not.toBe(
      shareErrorGlyph("failed")?.icon
    );
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
  //
  // Both menus render the same rows since #160's L-15, so the marks are
  // asserted ONCE, where they are passed. The per-screen half that remains is
  // the one the shared component cannot answer: that each menu renders it at
  // all. Without that, this whole describe could pass over a component
  // nothing mounts — the same blind spot, one level up.
  it("share-menu-section.tsx passes an icon to both share Notices", () => {
    const source = read("src/components/share-menu-section.tsx");
    // The partial/gap Notice.
    expect(source).toMatch(/icon=\{partial\.icon\}/);
    // The error Notice — the mark from `shareErrorGlyph` beside it (George R3
    // P3 on #457 moved the tone with it).
    expect(source).toMatch(/icon=\{errorMark\?\.icon\}/);
    // And no bare `<Notice>` left holding share copy, which is what the error
    // line looked like before.
    expect(source).not.toMatch(/<Notice>\{errorText\}<\/Notice>/);
  });

  for (const screen of [
    "src/components/segments-screen.tsx",
    "src/components/books-screen.tsx",
  ]) {
    it(`${screen.split("/").pop()} actually renders those rows`, () => {
      // The tag must END here — a bare prefix match would accept
      // `<ShareMenuSectionAnythingElse`, which is not this component.
      expect(read(screen)).toMatch(/<ShareMenuSection[\s/>]/);
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

/**
 * The error Notices take their TONE from the table too (George R3 P3-3 on
 * #457).
 *
 * `shareOutcomeGlyph` owns `{ icon, tone }`, and the partial path passes both.
 * The two share-error call sites passed only the icon and leaned on `Notice`'s
 * default `alert` — correct today, since `nothing` and `failed` are both
 * `alert`, but if #147 ever re-tones `nothing` in the table, the table's own
 * tests would go green while the screens stayed `alert`. So the bridge hands
 * the screens the whole entry, and the screens pass both halves.
 */
describe("the share error Notices carry the table's tone (#457 George R3 P3-3)", () => {
  it("shareErrorGlyph returns the outcome table's whole entry, tone included", () => {
    expect(shareErrorGlyph("nothing")).toEqual(shareOutcomeGlyph("nothing"));
    expect(shareErrorGlyph("failed")).toEqual(shareOutcomeGlyph("failed"));
  });

  it("share-menu-section.tsx passes the table's tone to the error Notice", () => {
    // One call site since #160's L-15, where there were two to keep in step.
    const source = read("src/components/share-menu-section.tsx");
    expect(source).toMatch(/tone=\{errorMark\?\.tone\}/);
    // And no error Notice left leaning on the default tone.
    expect(source).not.toMatch(/<Notice icon=\{shareErrorGlyph\(/);
  });
});

/**
 * The two halves #178 did not cover — handed over and dismissed — and the
 * bridge from what the modal can show to the table (#491).
 */
describe("the sent and dismissed marks (#491)", () => {
  it("sent is its own mark — neither the ready control's check nor the Share control's tray", () => {
    // The check is the mark the person JUST tapped ("Share now"), and the tray
    // is the control itself; a success that reuses either says "tap this"
    // rather than "this happened".
    const sent = shareOutcomeGlyph("sent");
    expect(sent.icon).not.toBe("check");
    expect(sent.icon).not.toBe("share");
    expect(sent.icon).not.toBe(noticePresentation("info").icon);
  });

  it("dismissed is its own mark, not the back control's chevron", () => {
    const dismissed = shareOutcomeGlyph("dismissed");
    expect(dismissed.icon).not.toBe("back");
    expect(dismissed.icon).not.toBe("share");
    expect(dismissed.icon).not.toBe(shareOutcomeGlyph("sent").icon);
  });

  it("neither success nor dismissal wears the failure tone — a closed sheet is not an alarm", () => {
    expect(shareOutcomeGlyph("sent").tone).not.toBe("alert");
    expect(shareOutcomeGlyph("dismissed").tone).not.toBe("alert");
  });

  it("shareSettledGlyph covers every settled member, and encoder wears the failed entry explicitly", () => {
    // `shareErrorGlyph` leaves `encoder` on `Notice`'s default (the alert
    // triangle) as a named choice. The modal has no tone default, so the same
    // mark is returned explicitly — the same choice, made visible.
    for (const settled of SHARE_SETTLED) {
      const glyph = shareSettledGlyph(settled);
      expect(glyph.icon, `${settled} has no icon`).toBeTruthy();
      expect(Icon({ name: glyph.icon, size: 48 })).toBeTruthy();
    }
    expect(shareSettledGlyph("encoder")).toEqual(shareOutcomeGlyph("failed"));
    expect(shareSettledGlyph("sent")).toEqual(shareOutcomeGlyph("sent"));
    expect(shareSettledGlyph("dismissed")).toEqual(
      shareOutcomeGlyph("dismissed")
    );
    expect(shareSettledGlyph("nothing")).toEqual(shareOutcomeGlyph("nothing"));
    expect(shareSettledGlyph("failed")).toEqual(shareOutcomeGlyph("failed"));
  });

  it('shareSettledGlyph("unproven") wears the dismissed mark, never the sent tick (Frank a446708 P2)', () => {
    // A native Android resolve this platform cannot vouch for must not draw
    // the same affirmative tick a proven send gets — `resolveProvesDelivery`'s
    // own docblock names the false-success path. Reuses `dismissed`'s neutral,
    // non-alarming mark rather than a fifth glyph; its OWN text is what tells
    // it apart from an actual dismissal.
    expect(shareSettledGlyph("unproven")).toEqual(
      shareOutcomeGlyph("dismissed")
    );
    expect(shareSettledGlyph("unproven").icon).not.toBe(
      shareSettledGlyph("sent").icon
    );
    expect(shareSettledGlyph("unproven").tone).not.toBe("alert");
  });

  it('shareSettledGlyph("partial") is the partial mark, never the plain sent tick (P1, this lane\'s own review round)', () => {
    // A completed-but-incomplete share must not wear the same tick a whole one
    // gets — see `share-progress.ts`'s header on `ShareSettled` for the exact
    // failure this closes.
    expect(shareSettledGlyph("partial")).toEqual(shareOutcomeGlyph("partial"));
    expect(shareSettledGlyph("partial").icon).not.toBe(
      shareSettledGlyph("sent").icon
    );
  });

  it("the four marks a translator can see after a share are four different shapes", () => {
    const visible: ShareSettled[] = ["sent", "dismissed", "nothing", "failed"];
    const icons = visible.map((s) => shareSettledGlyph(s).icon);
    expect(new Set(icons).size).toBe(visible.length);
  });
});

describe("the platform-native Share control glyph (#490, decided 2026-09-19)", () => {
  it("the Android mark is drawn, and it is not the tray", () => {
    expect(Icon({ name: "share-android", size: 22 })).toBeTruthy();
    expect(shareControlGlyph("android")).toBe("share-android");
    expect(shareControlGlyph("ios")).toBe("share");
    expect(shareControlGlyph("web")).toBe("share");
  });
});
