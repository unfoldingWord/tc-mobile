import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The AA gate for the roles that paint SMALL TEXT (#164 R-9, and the contrast
 * caveat #171 asked to land with the light theme).
 *
 * This reads source token values and recomputes contrast ratios so changes to
 * layer 1 or layer 2 cannot silently put a small-text role below AA.
 *
 * What it does NOT claim: nothing here is measured on a screen. WCAG's formula
 * over the declared sRGB values is what this computes, exactly as #164's own
 * evidence class says ("computed from the token values with the WCAG formula,
 * not measured on a device or in a browser"). A phone's panel, its brightness
 * and direct sun are the conditions this cannot speak to — which is the whole
 * reason the light theme exists (#171).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const STYLES = path.join(ROOT, "src", "app", "styles");

const primitives = readFileSync(path.join(STYLES, "1-primitives.css"), "utf8");
const semantic = readFileSync(path.join(STYLES, "2-semantic.css"), "utf8");

/** Every `--name: value;` declaration in a block of CSS text. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, name, value] = match;
    // Both groups are non-optional in the pattern, so a match always carries
    // them; the guard is what `noUncheckedIndexedAccess` needs to see.
    if (name === undefined || value === undefined) continue;
    out.set(name, value.trim());
  }
  return out;
}

/**
 * The two theme blocks of layer 2, sliced by their selectors. `:root,
 * :root[data-theme="dark"]` is the dark block; `:root[data-theme="light"]` is
 * the light one. Sliced rather than regex-matched per token because both blocks
 * declare the SAME token names — the point of the layer — so a whole-file match
 * would silently read the dark value for a light assertion.
 */
function themeBlock(theme: "dark" | "light"): Map<string, string> {
  const marker =
    theme === "dark"
      ? ':root,\n  :root[data-theme="dark"] {'
      : ':root[data-theme="light"] {';
  const start = semantic.indexOf(marker);
  if (start === -1) throw new Error(`no ${theme} block in 2-semantic.css`);
  const from = start + marker.length;
  const end = semantic.indexOf("\n  }", from);
  if (end === -1) throw new Error(`unterminated ${theme} block`);
  return declarations(semantic.slice(from, end));
}

const p = declarations(primitives);
const themes = { dark: themeBlock("dark"), light: themeBlock("light") };

/**
 * Resolve a token to a `#rrggbb` literal, following `var(--…)` through layer 2
 * and into layer 1. Only the two forms these roles actually use are supported —
 * a bare hex and a single `var()` — so a token that grows a `color-mix()` or a
 * fallback chain throws here rather than being silently scored wrong.
 */
function resolve(theme: "dark" | "light", token: string): string {
  let value = themes[theme].get(token) ?? p.get(token);
  if (value === undefined) throw new Error(`unknown token ${token}`);
  for (let hops = 0; hops < 8; hops++) {
    if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
    const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
    if (!ref?.[1]) throw new Error(`${token} is not a plain colour: ${value}`);
    const next = themes[theme].get(ref[1]) ?? p.get(ref[1]);
    if (next === undefined) throw new Error(`unknown token ${ref[1]}`);
    value = next.trim();
  }
  throw new Error(`${token} did not resolve in 8 hops`);
}

function channels(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, <fg> <pct>%, transparent)` composited over `over`. */
function wash(fg: string, over: string, pct: number): string {
  const F = channels(fg);
  const O = channels(over);
  const hex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${[0, 1, 2].map((i) => hex(F[i]! * pct + O[i]! * (1 - pct))).join("")}`;
}

/** WCAG AA for text below 18.66px bold / 24px regular. Every site below is 11–16px. */
const AA_SMALL_TEXT = 4.5;

/**
 * WCAG 2.1 non-text contrast (1.4.11), the floor for a visual boundary that
 * identifies a control rather than spelling anything. The guide ring (#604)
 * is exactly that: a mark on a control's own shape, never text.
 */
const AA_NON_TEXT = 3;

describe("the ink and voice roles that paint small text meet AA (#164 R-9, #171)", () => {
  // The surfaces `--s-ink-faint` is ACTUALLY painted on today, each with the
  // call site that puts it there — so this list is falsifiable by reading the
  // tree rather than being a blanket sweep of every surface in layer 2.
  //
  // `--s-overlay` is deliberately absent: no current site paints faint ink on
  // it. If one appears, it must be added here (dark faint clears AA on floor,
  // surface, raised and the scrim, but not on overlay).
  const faintSites = [
    ["--s-floor", "`.build-stamp`, 11px (3-components.css)"],
    ["--s-raised", "`.name-input::placeholder`, 16px (3-components.css)"],
    ["--s-surface", "the same faint ink on a raised panel"],
  ] as const;

  for (const theme of ["dark", "light"] as const) {
    for (const [surface, site] of faintSites) {
      it(`${theme}: --s-ink-faint on ${surface} — ${site}`, () => {
        const ratio = contrast(
          resolve(theme, "--s-ink-faint"),
          resolve(theme, surface)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }

    // `save-failed.tsx:184` paints 12px faint ink over the scrim, which is a
    // translucent wash rather than a surface token — composited here over the
    // floor it covers, which is what a full-screen scrim sits on.
    it(`${theme}: --s-ink-faint over the scrim — save-failed.tsx, 12px`, () => {
      const scrim = /rgba\(([^)]+)\)/.exec(
        themes[theme].get("--s-scrim") ?? ""
      );
      expect(scrim?.[1], "--s-scrim is still an rgba() wash").toBeTruthy();
      const [r, g, b, a] = scrim![1]!.split(",").map((n) => Number(n.trim()));
      const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
      const over = contrast(
        resolve(theme, "--s-ink-faint"),
        wash(`#${hex(r!)}${hex(g!)}${hex(b!)}`, resolve(theme, "--s-floor"), a!)
      );
      expect(over).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    // `.modepill` (3-components.css) is 12px `--p-weight-strong` text painted
    // in the voice accent on a 15% voice wash. In the DARK theme the accent
    // clears AA as text; on light it does not (~3.0:1), which is what
    // `--s-voice-text` exists for — see the light block's own comment.
    it(`${theme}: --s-voice-text on the .modepill voice wash — 12px`, () => {
      const voiceText = resolve(theme, "--s-voice-text");
      for (const surface of ["--s-floor", "--s-surface", "--s-raised"]) {
        const ratio = contrast(
          voiceText,
          wash(resolve(theme, "--s-voice"), resolve(theme, surface), 0.15)
        );
        expect(
          ratio,
          `--s-voice-text on a 15% voice wash over ${surface}`
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      }
    });
  }

  // The three ink roles must stay TELLABLE APART, or raising faint to AA has
  // quietly collapsed the ladder into two roles that look the same — the
  // regression the obvious fix (set faint := muted) would have shipped.
  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: the ink ladder keeps three distinguishable steps`, () => {
      const floor = resolve(theme, "--s-floor");
      const steps = (
        ["--s-ink", "--s-ink-muted", "--s-ink-faint"] as const
      ).map((t) => contrast(resolve(theme, t), floor));
      // Monotonic: ink is the strongest, faint the weakest.
      expect(steps[0]).toBeGreaterThan(steps[1]!);
      expect(steps[1]).toBeGreaterThan(steps[2]!);
      // And separated by more than a rounding error at each step.
      expect(steps[0]! - steps[1]!).toBeGreaterThan(1);
      expect(steps[1]! - steps[2]!).toBeGreaterThan(1);
    });
  }
});

describe("the guide ring is visible on every surface it is drawn on (#604)", () => {
  // The ring is INSET on a control's own box and on the chapter row, and
  // OUTSET on either red Record — the recorder's and the segment row's, which
  // the stylesheet covers with one variant-keyed rule. What the ring has to
  // stand out from therefore differs by call site, and each one is scored
  // against what is actually behind it.
  const behind = [
    [
      "--s-raised",
      "inset on raised controls — Create book and both empty-state CTAs",
    ],
    [
      "--s-surface",
      "Add chapter and the segment row's red Record — `.row`'s own surface",
    ],
    [
      "--s-floor",
      "inset on the transparent chapter row; outset around the record button",
    ],
  ] as const;

  for (const theme of ["dark", "light"] as const) {
    for (const [surface, site] of behind) {
      it(`${theme}: --s-guide on ${surface} — ${site}`, () => {
        const ratio = contrast(
          resolve(theme, "--s-guide"),
          resolve(theme, surface)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }

    it(`${theme}: the guide and the focus role resolve to different colours`, () => {
      // Exactly that and no more: the two roles are not the same value in this
      // theme. It is not a claim about hue distance, or about whether the two
      // marks are distinguishable to any particular eye — that rests on the
      // geometry (inside the shape against an outline outside it, with a gap
      // where both are outside), which `tests/guided-ring.test.ts` pins.
      expect(resolve(theme, "--s-guide")).not.toBe(resolve(theme, "--s-focus"));
    });

    it(`${theme}: the ring cannot live INSIDE the record button — the reason it is outset`, () => {
      // The reason `3-components.css` gives for the one exception to the inset
      // ring, asserted here rather than quoted there. Blue on the live red is
      // a hue difference with almost no luminance difference, so an inset ring
      // there is a ring a low-vision user does not get. Both themes, because
      // the red differs between them and the exception is unconditional. If a
      // future accent clears the floor here, the exception can go — and this
      // assertion is what says so.
      const ratio = contrast(
        resolve(theme, "--s-guide"),
        resolve(theme, "--s-live")
      );
      expect(ratio).toBeLessThan(AA_NON_TEXT);
    });
  }
});

describe("the O4 roles clear the floors the workbench claimed for them (round 4, G9)", () => {
  // Computed from token values only, like the rest of this file. These are
  // the O4 pairs that carry an icon or text; decorative marks
  // (`--s-mark-empty`) and the light share ring (2.96:1, an open decision in
  // docs/design/o4-design-system.md) are deliberately not gated here.
  const tileFills = ["--s-edit", "--s-name", "--s-send"] as const;
  const coverFills = [
    "--s-cover-amber",
    "--s-cover-teal",
    "--s-cover-plum",
    "--s-cover-blue",
  ] as const;

  for (const theme of ["dark", "light"] as const) {
    for (const fill of tileFills) {
      it(`${theme}: --s-tile-ink on ${fill} clears 5:1 (G9's own claim)`, () => {
        const ratio = contrast(
          resolve(theme, "--s-tile-ink"),
          resolve(theme, fill)
        );
        expect(ratio).toBeGreaterThanOrEqual(5);
      });
    }

    for (const fill of coverFills) {
      it(`${theme}: a white cover glyph on ${fill} clears the non-text floor`, () => {
        // Amber is the weakest at 3.5:1, so covers are gated at 3:1, not 5:1.
        const ratio = contrast(
          resolve(theme, "--p-cool-000"),
          resolve(theme, fill)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }

    for (const surface of ["--s-surface", "--s-well"]) {
      it(`${theme}: --s-hear on ${surface} — the speaker glyph`, () => {
        const ratio = contrast(
          resolve(theme, "--s-hear"),
          resolve(theme, surface)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }

    it(`${theme}: --s-warn-text on --s-warn-quiet — the storage banner words`, () => {
      const ratio = contrast(
        resolve(theme, "--s-warn-text"),
        resolve(theme, "--s-warn-quiet")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});
