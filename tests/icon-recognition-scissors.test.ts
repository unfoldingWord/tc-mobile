import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { region, uniqueIndexOf } from "./support";

/**
 * #999: after #955 replaced the recorder's edit-mode toggle with the app's
 * existing scissors glyph, the icon-recognition sheet's row 6 (previously the
 * `[ ]` brackets) has to draw that SAME scissors, not a hand-copied
 * approximation of it — and the protocol's row 6 has to stop asking about
 * brackets that no longer exist. DRI pick (#999, 2026-09-26): "Redraw row 6
 * as scissors (Recommended)"; rows 6 and 8 sharing one glyph is accepted.
 *
 * This does not run the sheet in a browser (no browser/device ran for this
 * change) — it only compares source text, so it cannot catch a rendering
 * regression, only a drift between the two copies of the path data or a
 * leftover "bracket" reference.
 */

const ICON_TSX = path.join(process.cwd(), "src/components/icon.tsx");
const SHEET_HTML = path.join(
  process.cwd(),
  "docs/training/icon-recognition-sheet.html"
);
const PROTOCOL_MD = path.join(
  process.cwd(),
  "docs/training/icon-recognition-protocol.md"
);

/**
 * Every `cx=".."`, `cy=".."`, `r=".."` and `d=".."` attribute value, in
 * document order, out of an SVG-bearing region of text. Comparing this array
 * (rather than raw markup) tolerates whitespace and quote-style differences
 * between the two files while still catching any digit that drifts from the
 * source path — the failure mode a hand-copy invites.
 */
function svgAttrs(svg: string): string[] {
  const out: string[] = [];
  const re = /\b(?:cx|cy|r|d)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const value = m[1];
    if (value === undefined) throw new Error("svgAttrs: capture group missing");
    out.push(value);
  }
  return out;
}

/**
 * Slices one `PATHS` entry out of `icon.tsx` — from its `${name}: (` key up
 * to the top-level `),` that closes it (two-space indent; every nested JSX
 * line in these entries is indented four spaces or more, so this cannot
 * match early on an inner close).
 */
function iconBlock(source: string, name: string): string {
  const start = uniqueIndexOf(source, `${name}: (`);
  const closeAt = source.indexOf("\n  ),", start);
  if (closeAt === -1) {
    throw new Error(`iconBlock: no top-level close found for "${name}"`);
  }
  return region(source, { from: start, to: closeAt });
}

/** Slices one numbered `<tr>` row out of the sheet by its leading `<td>N</td>`. */
function sheetRow(html: string, n: number): string {
  const start = uniqueIndexOf(html, `<td>${n}</td>`);
  const end = html.indexOf("</tr>", start);
  if (end === -1) throw new Error(`sheetRow: no closing </tr> for row ${n}`);
  return region(html, { from: start, to: end });
}

describe("icon-recognition sheet row 6 (#999)", () => {
  const iconSource = readFileSync(ICON_TSX, "utf8");
  const sheetHtml = readFileSync(SHEET_HTML, "utf8");
  const protocolMd = readFileSync(PROTOCOL_MD, "utf8");

  it("draws row 6 with the app's own scissors path data, not a redrawn copy", () => {
    const appScissors = svgAttrs(iconBlock(iconSource, "scissors"));
    expect(appScissors.length).toBeGreaterThan(0);

    const row6 = sheetRow(sheetHtml, 6);
    const row6Svg = region(row6, {
      from: uniqueIndexOf(row6, "<svg"),
      to: uniqueIndexOf(row6, "</svg>"),
    });
    expect(svgAttrs(row6Svg)).toEqual(appScissors);
  });

  it("draws rows 6 and 8 with the identical glyph, per the DRI pick", () => {
    const row6 = sheetRow(sheetHtml, 6);
    const row8 = sheetRow(sheetHtml, 8);
    const row6Svg = region(row6, {
      from: uniqueIndexOf(row6, "<svg"),
      to: uniqueIndexOf(row6, "</svg>"),
    });
    const row8Svg = region(row8, {
      from: uniqueIndexOf(row8, "<svg"),
      to: uniqueIndexOf(row8, "</svg>"),
    });
    expect(svgAttrs(row6Svg)).toEqual(svgAttrs(row8Svg));
  });

  it("no longer asks the sheet about the retired brackets", () => {
    // The sheet is the printed, in-the-moment reference — it never narrates
    // history, so "bracket" should not appear anywhere in it. The protocol
    // DOES narrate history (why row 6 changed, per #955/#999), so that check
    // is scoped to the live row 6 line only, in the next test.
    expect(sheetHtml).not.toMatch(/bracket/i);
  });

  it("the protocol's row 6 line asks about scissors, not brackets, and about opening editing, not picking a piece", () => {
    const row6Line = protocolMd
      .split("\n")
      .find((line) => line.startsWith("| 6   |"));
    if (!row6Line) throw new Error("protocol: row 6 not found in the table");
    expect(row6Line).not.toMatch(/bracket/i);
    expect(row6Line).toMatch(/scissors/i);
    expect(row6Line).toMatch(/open editing/i);
    expect(row6Line).not.toMatch(/picks? (a|the) piece/i);
  });

  it("the protocol records that rows 6 and 8 share a glyph", () => {
    expect(protocolMd).toMatch(/[Rr]ows 6 and 8 draw the same scissors glyph/);
  });
});
