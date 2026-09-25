import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O4's own piece of the share overlay (#947, epic #936). Everything else
 * workbench states 14/15/G7 show — the 140/176 circular Share button, its
 * send-ring, an animated packing-progress arc, the per-item chips, the armed
 * pulse (#950) — lives inside `share-menu-section.tsx` (rendered from
 * `books-screen.tsx`/`segments-screen.tsx` through `control.tsx`), none of
 * which this lane owns or may edit. The one piece reachable from this lane's
 * four owned files is colour: issue #947 itself separates a "Share button"
 * bullet (geometry, out of scope here) from a distinct "Overlay: the
 * share-progress overlay (#491, #850) in O4 colours" bullet — colour only.
 *
 * This mirrors `tests/share-progress.test.ts`'s own technique on
 * `3-components.css` ("the stylesheet inks busy and every settled outcome,
 * with layer-2 roles only"), applied to the new O4-only rule instead: slice
 * the block out of the SOURCE file (not the built `dist/` bundle —
 * `tests/o4-cascade.test.ts` already covers that this file's content
 * survives the build) and assert on declaration VALUES, never a bare
 * `--s-send` identifier, so a comment mentioning the token cannot false-hit
 * (AGENTS.md's documented share-progress-vs-touch-policy trap).
 *
 * `3-components.css` is NOT touched by this change: the new rule lives only
 * in `o4/share.css`, under the extra `[data-design="o4"]` ancestor attribute
 * selector, which is strictly more specific than 3-components.css's own
 * `.share-scrim[data-outcome="busy"] .share-progress-glyph` rule — so it wins
 * regardless of cascade-layer/import order, and `tests/share-progress.test.ts`
 * passes unedited (confirmed by running the full suite in this same PR).
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("O4 share overlay colour (#947)", () => {
  it('inks the busy glyph with the send-teal role, scoped under [data-design="o4"]', () => {
    const css = read("src/app/styles/o4/share.css");
    const start = css.indexOf(
      '[data-design="o4"] .share-scrim[data-outcome="busy"]'
    );
    expect(
      start,
      "no O4 busy-glyph rule found in o4/share.css"
    ).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start) + 1);
    const colourMatch = block.match(/color:\s*([^;]+);/);
    expect(colourMatch, `no color declaration in: ${block}`).not.toBeNull();
    const value = colourMatch![1]!.trim();
    // A layer-2 role, and specifically the send-teal identity the O4 design
    // gives Share (D2/#937) — not merely "some --s- role", and never a
    // --p- primitive reaching past layer 2 (the same guard
    // share-progress.test.ts already runs on 3-components.css).
    expect(value).toBe("var(--s-send)");
    expect(value, "reaches past layer 2").not.toMatch(/--p-/);
  });

  it("scopes the rule under the o4 attribute selector, not the bare .share-scrim class", () => {
    const css = read("src/app/styles/o4/share.css");
    // Guards against a rule that accidentally repeats 3-components.css's own
    // unscoped selector, which would apply with the switch OFF too and break
    // "byte-for-byte unchanged with the switch off".
    expect(css).not.toMatch(/^\s*\.share-scrim\[data-outcome="busy"\]/m);
  });
});
