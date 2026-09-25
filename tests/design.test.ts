import { describe, expect, it } from "vitest";

import {
  DESIGN_STORAGE_KEY,
  nextDesign,
  readStoredDesign,
  type Design,
} from "@/lib/design";

/**
 * The O4 design switch (#938, batch 0 of epic #936) — the pure half, modelled
 * on `tests/theme.test.ts`'s split of the identical shape for `lib/theme.ts`.
 *
 * The DOM half — the `data-design` attribute and `localStorage` — is
 * `hooks/use-design.ts`, covered by `tests/use-design.test.ts` (jsdom). The
 * menu entry, `components/design-control.tsx`, is rendered by no test. The
 * build-time cascade guarantee this switch exists to make
 * possible is `tests/o4-cascade.test.ts`'s question, not this file's.
 */
describe("readStoredDesign (#938)", () => {
  it("returns the stored design when it is one this app has", () => {
    expect(readStoredDesign("current")).toBe("current");
    expect(readStoredDesign("o4")).toBe("o4");
  });

  it("defaults to current when nothing has been chosen", () => {
    // The app ships the current look; O4 is opt-in until #951 turns it on by
    // default for the v1.0.0 release.
    expect(readStoredDesign(null)).toBe("current");
  });

  it("defaults to current on a bad stored value, rather than trusting the string", () => {
    // `localStorage` is shared per-origin and can carry a value this app
    // never wrote (a stale key from a future design id, a corrupted write, a
    // dev-tools edit). `data-design` is a plain attribute selector, and only
    // "o4" selects anything different from today, so the safe fallback for
    // anything unrecognised is the look already shipping — never falling
    // through to an unstyled screen the way a stray theme value would.
    for (const raw of ["", " ", "O4", "Current", "sepia", "null", "{}", "0"])
      expect(readStoredDesign(raw), `readStoredDesign(${raw})`).toBe("current");
  });

  it("takes a stored string and nothing else", () => {
    expect(readStoredDesign.length).toBe(1);
  });

  it("is namespaced, the same reasoning THEME_STORAGE_KEY documents", () => {
    expect(DESIGN_STORAGE_KEY).toBe("tc-mobile.design");
  });
});

describe("nextDesign (#938)", () => {
  it("is an involution — two taps return you to where you were", () => {
    // The menu entry is one fixed-label control ("New look (O4)") carrying
    // its state via `aria-pressed`, not two different destination labels —
    // see `design-control.tsx`. A third design id would need this revisited.
    for (const d of ["current", "o4"] as const)
      expect(nextDesign(nextDesign(d))).toBe(d);
  });

  it("swaps the two designs", () => {
    expect(nextDesign("current")).toBe("o4");
    expect(nextDesign("o4")).toBe("current");
  });

  it("covers every design in the union", () => {
    // Exhaustive switch fails at compile time if a third design id is added
    // without updating this function; this pins the runtime behaviour too.
    const designs: Design[] = ["current", "o4"];
    expect(new Set(designs.map(nextDesign))).toEqual(new Set(designs));
  });
});
