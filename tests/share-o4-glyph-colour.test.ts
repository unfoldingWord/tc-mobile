import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O4's own piece of the share overlay (#947, epic #936). The 140/176
 * circular Share button, its send-ring, an animated packing-progress arc,
 * the per-item chips and the armed pulse (#950) are deferred to #981 — not
 * because `share-menu-section.tsx` is unreachable (it is not on the
 * coordinator's other-lanes list, and #947 assigns "the share button ...
 * component" to this lane), but because building it faithfully is a
 * UX-architecture question (the workbench renders it inside a bottom sheet,
 * not the current look's inline ≡-menu row) plus a T2 hook change (no
 * percent/per-item field exists on `ShareProgress` yet) — see #981 and the
 * PR body. The one piece this lane builds today is colour: issue #947
 * itself separates a "Share button" bullet (geometry, deferred) from a
 * distinct "Overlay: the share-progress overlay (#491, #850) in O4 colours"
 * bullet — colour only.
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
 * on specificity within the shared `components` layer both files declare
 * their rules in (o4/index.css's header), not "regardless of layer order",
 * and `tests/share-progress.test.ts` passes unedited.
 */

function read(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

/**
 * Drops CSS block comments before selector-scanning, so a docblock that
 * quotes a selector in prose (as this file's own header, and `share.css`'s,
 * both do) cannot be mistaken for a rule.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
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

  it("scopes every .share-progress-glyph rule under the o4 attribute selector", () => {
    const css = stripComments(read("src/app/styles/o4/share.css"));
    // Guards against ANY rule targeting `.share-progress-glyph` that is not
    // scoped under `[data-design="o4"]` — not just a repeat of
    // 3-components.css's own exact selector — which would apply with the
    // switch OFF too and break "byte-for-byte unchanged with the switch
    // off". Splitting on "{" rather than matching one fixed selector string
    // is what catches a differently-shaped unscoped rule (e.g. a bare
    // `.share-scrim .share-progress-glyph` descendant selector) that the
    // single exact-string check this replaced would have missed.
    const selectors = css
      .split("{")
      .slice(0, -1)
      .map((chunk) => chunk.slice(chunk.lastIndexOf("}") + 1));
    const glyphSelectors = selectors.filter((selector) =>
      selector.includes(".share-progress-glyph")
    );
    expect(
      glyphSelectors.length,
      "expected at least one .share-progress-glyph selector in o4/share.css"
    ).toBeGreaterThan(0);
    for (const selector of glyphSelectors) {
      expect(
        selector,
        `unscoped .share-progress-glyph selector: ${selector.trim()}`
      ).toMatch(/\[data-design="o4"\]/);
    }
  });
});
