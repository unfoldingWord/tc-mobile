import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { areaScope, areaSelector, selectorDeclarations } from "./o4-area-css";
import { cssRule, declarationValue, stripCssComments } from "./support";

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

// Comments stripped before anything is parsed: `declarations` keeps the LAST
// `--name: value;` it meets, so a commented-out declaration after the live one
// would be scored in its place, and a failing live value could pass (#822).
const primitives = stripCssComments(
  readFileSync(path.join(STYLES, "1-primitives.css"), "utf8")
);
const semantic = stripCssComments(
  readFileSync(path.join(STYLES, "2-semantic.css"), "utf8")
);

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

    // `--s-voice-text` is the voice accent as small INK. Its first reader was
    // the "Editing" pill (12px on a 15% voice wash); #1243 made that marker
    // plain text on the stage (`.recorder-editing`, 3-components.css), so it
    // is checked on the bare surfaces as well as on the wash the role was
    // tuned for. In the DARK theme the accent clears AA as text; on light the
    // fill does not (~3.0:1), which is what the role exists for — see the
    // light block's own comment.
    it(`${theme}: --s-voice-text as small text, bare and on a 15% voice wash`, () => {
      const voiceText = resolve(theme, "--s-voice-text");
      for (const surface of ["--s-floor", "--s-surface", "--s-raised"]) {
        const bg = resolve(theme, surface);
        expect(
          contrast(voiceText, bg),
          `--s-voice-text on ${surface}`
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
        expect(
          contrast(voiceText, wash(resolve(theme, "--s-voice"), bg, 0.15)),
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
  // OUTSET on the recorder's red Record and on an unrecorded row's mic
  // (#1217), which the stylesheet covers with one variant-keyed rule. What the ring has to
  // stand out from therefore differs by call site, and each one is scored
  // against what is actually behind it.
  const behind = [
    [
      "--s-raised",
      "inset on raised controls — Create book and both empty-state CTAs",
    ],
    [
      "--s-surface",
      "Add chapter, outset around an unrecorded row's mic — `.row`'s own surface — and outset around O4's green name-sheet Confirm",
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

    it(`${theme}: the ring cannot live INSIDE O4's green Confirm — the reason it is outset (#943)`, () => {
      // o4/sheets.css paints the name sheet's commit control on --s-done and
      // outsets its guide ring onto the sheet's --s-surface, for the same
      // reason the record button's is outset. If a future accent clears the
      // floor on --s-done, that exception can go.
      const ratio = contrast(
        resolve(theme, "--s-guide"),
        resolve(theme, "--s-done")
      );
      expect(ratio).toBeLessThan(AA_NON_TEXT);
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
  // the O4 pairs that carry an icon, text or a control's boundary; decorative
  // marks (`--s-mark-empty`) are deliberately not gated here.
  const tileFills = ["--s-edit", "--s-name", "--s-send"] as const;
  const coverFills = [
    "--s-cover-amber",
    "--s-cover-teal",
    "--s-cover-plum",
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

    // #937 D3: words may sit on the live and done washes (chips, crumbs, the
    // clip pill). On light the fill accents are too pale for that, so each
    // wash has a text role of its own, as the warn wash does.
    for (const [text, quiet] of [
      ["--s-live-text", "--s-live-quiet"],
      ["--s-done-text", "--s-done-quiet"],
    ] as const) {
      it(`${theme}: ${text} on ${quiet} — words on the wash (#937 D3)`, () => {
        const ratio = contrast(resolve(theme, text), resolve(theme, quiet));
        expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }

    // #937 D2: the share progress ring marks a control, so it takes the
    // non-text floor on both grounds the share button can sit on.
    for (const surface of ["--s-floor", "--s-surface"]) {
      it(`${theme}: --s-send-ring on ${surface} — the share ring (#937 D2)`, () => {
        const ratio = contrast(
          resolve(theme, "--s-send-ring"),
          resolve(theme, surface)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }
  }
});

describe("the chapter-play ring fill clears the non-text floor (#1469)", () => {
  // The ring is the control's progress mark, so its FILL takes 3:1 on both
  // grounds a chapter row can sit on. The TRACK (`--s-mark-empty`) is not
  // gated here: it is read as decorative, which is a pending decision, not a
  // pinned one — nothing below asserts its ratio either way.
  const booksCss = areaScope("books");

  it("the ring paints its fill with --s-voice, so this pin scores the real paint", () => {
    const ring = cssRule(booksCss, areaSelector("books", ".books-play-ring"));
    const background = declarationValue(ring, "background");
    expect(background).toMatch(/^conic-gradient\(\s*var\(--s-voice\)\s+calc\(/);
  });

  for (const theme of ["dark", "light"] as const) {
    for (const surface of ["--s-floor", "--s-well"]) {
      it(`${theme}: --s-voice on ${surface} — the chapter-play ring fill`, () => {
        const ratio = contrast(
          resolve(theme, "--s-voice"),
          resolve(theme, surface)
        );
        expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
      });
    }
  }
});

describe("the O4 colour values #937 decided hold", () => {
  // A floor alone would let either value drift back to what the decision
  // replaced: the old blue Edit tile cleared 5:1 too.
  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: --s-edit is Slate #475569, off blue (D1, D1b)`, () => {
      expect(resolve(theme, "--s-edit")).toBe("#475569");
    });
  }

  it("light: --s-send-ring is #12a090 (D2)", () => {
    expect(resolve("light", "--s-send-ring")).toBe("#12a090");
  });
});

describe("an unrecorded row's mic glyph reads on its own disc (#1217, #1233 item 14)", () => {
  // `.control--mic` paints a red microphone on a grey disc. Both tokens are
  // read from the rule itself rather than restated here, so swapping either
  // one in the stylesheet re-scores the pair instead of leaving this test
  // checking a pairing nothing paints. The glyph is held to the small-text
  // floor, not the non-text one: `--s-live-text` is the red role made for
  // reading, and the hand computation on #1223 put it at about 5.5:1 dark
  // and 5.9:1 light, so the floor was never in question for the tokens as
  // they stand.
  const rule = cssRule(
    readFileSync(path.join(STYLES, "3-components.css"), "utf8"),
    ".control--mic"
  );
  const token = (property: string): string => {
    const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(
      declarationValue(rule, property)
    );
    if (!ref?.[1]) throw new Error(`.control--mic ${property} is not a var()`);
    return ref[1];
  };

  it("the rule paints --s-live-text on --s-well", () => {
    expect([token("color"), token("background")]).toEqual([
      "--s-live-text",
      "--s-well",
    ]);
  });

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: the mic glyph clears AA on the disc`, () => {
      const ratio = contrast(
        resolve(theme, token("color")),
        resolve(theme, token("background"))
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});

describe("a Finished segment's green reads on the recorder stage (#926)", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: --s-done bars on --s-surface — the .recorder-stage behind the canvas`, () => {
      const ratio = contrast(
        resolve(theme, "--s-done"),
        resolve(theme, "--s-surface")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${theme}: the --s-done Play button on --s-floor — the record toolbar`, () => {
      const ratio = contrast(
        resolve(theme, "--s-done"),
        resolve(theme, "--s-floor")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${theme}: the --s-done-ink Play glyph on --s-done`, () => {
      const ratio = contrast(
        resolve(theme, "--s-done-ink"),
        resolve(theme, "--s-done")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  }
});

describe("the SaveFailed armed Restart glyph reads on its own fill (#1088 S9)", () => {
  // The fix for S9 ("reads red on blue"): `.o4-err-wide--armed`
  // (o4/errors.css) swaps the wide guide button's fill from `--s-guide` to
  // `--s-live`/`--s-live-ink` while armed, instead of layering red TEXT on
  // top of the still-blue fill. The glyph is a non-text mark (an icon, no
  // label), so it takes the same floor `--s-done-ink` on `--s-done` does
  // above, not the small-text floor.
  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: --s-live-ink on --s-live — the armed wide guide button`, () => {
      const ratio = contrast(
        resolve(theme, "--s-live-ink"),
        resolve(theme, "--s-live")
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });
  }
});

describe("the trim selection has its own blue, --s-select (#1471)", () => {
  // The band, its two edges, both stems and both knobs used to paint
  // `--s-voice`, the same amber as the waveform under them: the light-theme
  // band over a waveform bar scored 2.84:1. The requirements owner chose a new
  // colour that never reads as the guide ring (Q7-blue).
  //
  // All ratios are WCAG 2.x over the declared sRGB values and all distances are
  // OKLab over the same values — computed, not measured on a screen.

  type Matrix = readonly (readonly number[])[];

  /** OKLab (Ottosson) from an sRGB hex, on the 0–100 scale the issue states. */
  function oklab(hex: string, matrix?: Matrix): [number, number, number] {
    const lin = channels(hex).map((c) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    ) as [number, number, number];
    const [r, g, b] = matrix
      ? ([0, 1, 2].map((row) =>
          Math.min(
            1,
            Math.max(
              0,
              matrix[row]![0]! * lin[0] +
                matrix[row]![1]! * lin[1] +
                matrix[row]![2]! * lin[2]
            )
          )
        ) as [number, number, number])
      : lin;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s),
      100 * (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s),
      100 * (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s),
    ];
  }

  // Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear
  // sRGB. These simulate full dichromacy: a stated model, not a person. The
  // issue's own matrices were typed from memory, so the helper below is
  // checked against a maintained library's output instead.
  const VISION: Record<string, Matrix | undefined> = {
    normal: undefined,
    protanopia: [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
    deuteranopia: [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
    tritanopia: [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  };

  function distance(a: string, b: string, matrix?: Matrix): number {
    const A = oklab(a, matrix);
    const B = oklab(b, matrix);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }

  /** The band's own fill is 20% of the role over whatever is behind it. */
  const BAND_PCT = 0.2;
  /** A stated judgement, not a standard (the issue's own words). */
  const MIN_DISTANCE_FROM_GUIDE = 10;

  it("the OKLab distance helper reproduces a maintained library's values", () => {
    // Reference values computed with culori's `oklab()` and its `lrgb`
    // converter, the severity-1.0 matrices applied in linear light and
    // clamped, as the paper specifies. (culori's own `filterDeficiency*`
    // multiplies gamma-encoded values, which is not the paper's model, so it
    // is not the reference here.) Rounded to one decimal.
    expect(distance("#0369a1", "#2e7df6")).toBeCloseTo(14.1, 1);
    expect(distance("#0369a1", "#2e7df6", VISION.tritanopia)).toBeCloseTo(
      11.5,
      1
    );
    expect(distance("#4cc9f0", "#2e7df6", VISION.deuteranopia)).toBeCloseTo(
      21.7,
      1
    );
  });

  for (const theme of ["dark", "light"] as const) {
    it(`${theme}: --s-select is a different colour from guide, hear, voice and focus`, () => {
      const select = resolve(theme, "--s-select");
      for (const other of ["--s-guide", "--s-hear", "--s-voice", "--s-focus"]) {
        expect(select).not.toBe(resolve(theme, other));
      }
    });

    for (const [vision, matrix] of Object.entries(VISION)) {
      it(`${theme}: --s-select is at least ${MIN_DISTANCE_FROM_GUIDE} OKLab units from --s-guide under ${vision} vision`, () => {
        expect(
          distance(
            resolve(theme, "--s-select"),
            resolve(theme, "--s-guide"),
            matrix
          )
        ).toBeGreaterThanOrEqual(MIN_DISTANCE_FROM_GUIDE);
      });
    }

    it(`${theme}: --s-select on --s-surface clears the non-text floor`, () => {
      expect(
        contrast(resolve(theme, "--s-select"), resolve(theme, "--s-surface"))
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${theme}: --s-select on the band's own wash clears the non-text floor`, () => {
      const surface = resolve(theme, "--s-surface");
      const band = wash(resolve(theme, "--s-select"), surface, BAND_PCT);
      expect(
        contrast(resolve(theme, "--s-select"), band)
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${theme}: the amber waveform bar seen through the band reads against the band's wash`, () => {
      // Both sides are the band's 20% over what it covers: over the surface for
      // the wash, over an amber bar for the bar as seen through it.
      const select = resolve(theme, "--s-select");
      const band = wash(select, resolve(theme, "--s-surface"), BAND_PCT);
      const barThroughBand = wash(
        select,
        resolve(theme, "--s-voice"),
        BAND_PCT
      );
      expect(contrast(barThroughBand, band)).toBeGreaterThanOrEqual(
        AA_NON_TEXT
      );
    });
  }

  it("an amber band over an amber bar, as it used to be, fails in the light theme", () => {
    // The state the issue exists to fix (2.84:1), kept so the pin above is
    // known to be able to fail.
    const voice = resolve("light", "--s-voice");
    const band = wash(voice, resolve("light", "--s-surface"), BAND_PCT);
    expect(contrast(wash(voice, voice, BAND_PCT), band)).toBeLessThan(
      AA_NON_TEXT
    );
  });

  describe("source: the band, the stems and the knobs read --s-select", () => {
    const components = readFileSync(
      path.join(STYLES, "3-components.css"),
      "utf8"
    );
    const recorder = areaScope("recorder");
    const band = cssRule(components, ".selection-band");
    const stem = cssRule(components, ".selection-stem");
    const knob = cssRule(
      recorder,
      areaSelector("recorder", ".selection-handle::after")
    );

    it("the band fill is a 20% wash of --s-select", () => {
      expect(declarationValue(band, "background")).toBe(
        "color-mix(in srgb, var(--s-select) 20%, transparent)"
      );
    });

    it("the band's edges are 2px of --s-select", () => {
      expect(declarationValue(band, "border-inline")).toBe(
        "2px solid var(--s-select)"
      );
    });

    it("the stem and the knob are --s-select", () => {
      expect(declarationValue(stem, "background")).toBe("var(--s-select)");
      expect(declarationValue(knob, "background")).toBe("var(--s-select)");
    });

    it("none of the four rules reads the voice, guide or hear role", () => {
      // The knob is an area rule: every rule for its selector in the whole
      // of recorder.css is read, every nested block included.
      const knobs = selectorDeclarations(
        "recorder",
        areaSelector("recorder", ".selection-handle::after")
      ).map(([property, value]) => `${property}: ${value}`);
      for (const rule of [band, stem, ...knobs]) {
        expect(stripCssComments(rule)).not.toMatch(
          /var\(--s-(?:voice|guide|hear)\b/
        );
      }
    });
  });
});
