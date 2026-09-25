/**
 * The word a screen shows for each `CoverColourKey`, as one pure function.
 *
 * Built the way `capture-failure-copy.ts` is, and for the same reason: a
 * `switch` with a `never` default makes the compiler name every key, so a
 * palette addition that forgets to word it here fails to compile rather than
 * rendering an unlabelled swatch.
 *
 * `CoverColourKey` is a `lib/` value (`lib/cover-colour.ts`, #957) and the
 * words it maps to live in `lib/strings.ts` — the one string table (#169) —
 * so this file is the thin `components/` bridge between the two, same split
 * `capture-failure-copy.ts` already draws.
 */

import { strings } from "@/lib/strings";
import type { CoverColourKey } from "@/lib/cover-colour";

/**
 * @pivotpending No production caller yet — `components/cover-picker.tsx`
 * (also tagged, same reason) is the one caller this lane (#957) ships; #943
 * and #949 are what wire the picker itself onto a screen.
 */
export function coverColourName(key: CoverColourKey): string {
  switch (key) {
    case "amber":
      return strings.coverColourAmber;
    case "teal":
      return strings.coverColourTeal;
    case "plum":
      return strings.coverColourPlum;
    case "forest":
      return strings.coverColourForest;
    case "brick":
      return strings.coverColourBrick;
    case "slate":
      return strings.coverColourSlate;
    case "rose":
      return strings.coverColourRose;
    case "olive":
      return strings.coverColourOlive;
    case "rust":
      return strings.coverColourRust;
    case "cocoa":
      return strings.coverColourCocoa;
    default: {
      const unhandled: never = key;
      return unhandled;
    }
  }
}
