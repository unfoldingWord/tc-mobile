import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { QrCode } from "@/components/qr-code";
import { encodeQr } from "@/lib/qr";
import { strings } from "@/lib/strings";

import { one, render } from "./render";
import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * #1250 part 2: the QR drawn as inline SVG. One render, no effects, no layout:
 * these are props-to-markup guarantees (the shape of the symbol and its
 * quiet zone), not a statement that a phone camera reads it. A scan from a
 * second phone is owed and has not been run.
 */

const LINK =
  "https://play.google.com/store/apps/details?id=org.unfoldingword.tcmobile";
const QUIET_ZONE = 4;

const matrix = encodeQr(LINK);
const darkModules = matrix.modules.flat().filter(Boolean).length;

function draw(text: string = LINK) {
  return render(createElement(QrCode, { text, label: strings.aboutQrCaption }));
}

describe("the QR component", () => {
  it("draws one dark rect per dark module of the encoder's matrix", () => {
    const svg = one(draw(), "svg");
    expect(svg.querySelectorAll("rect.qr-dark")).toHaveLength(darkModules);
  });

  it("puts each dark rect on the module the matrix says is dark", () => {
    const svg = one(draw(), "svg");
    const drawn = new Set(
      [...svg.querySelectorAll("rect.qr-dark")].map(
        (r) => `${r.getAttribute("x")},${r.getAttribute("y")}`
      )
    );
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        const key = `${col + QUIET_ZONE},${row + QUIET_ZONE}`;
        expect(drawn.has(key), key).toBe(matrix.modules[row]![col]!);
      }
    }
  });

  it("leaves a four-module quiet zone on every side, on a light ground", () => {
    const svg = one(draw(), "svg");
    const full = matrix.size + 2 * QUIET_ZONE;
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${full} ${full}`);
    const ground = one(svg, "rect.qr-light");
    expect(ground.getAttribute("width")).toBe(String(full));
    expect(ground.getAttribute("height")).toBe(String(full));
    for (const r of svg.querySelectorAll("rect.qr-dark")) {
      const x = Number(r.getAttribute("x"));
      const y = Number(r.getAttribute("y"));
      expect(x).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QUIET_ZONE);
      expect(x).toBeLessThan(full - QUIET_ZONE);
      expect(y).toBeLessThan(full - QUIET_ZONE);
    }
  });

  it("is an image named by the caption", () => {
    const svg = one(draw(), "svg");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(strings.aboutQrCaption);
    expect(strings.aboutQrCaption).toBeTruthy();
  });

  it("is drawn at a scannable size, a whole number of pixels per module", () => {
    const svg = one(draw(), "svg");
    const width = Number(svg.getAttribute("width"));
    expect(width).toBeGreaterThanOrEqual(200);
    expect(width % (matrix.size + 2 * QUIET_ZONE)).toBe(0);
  });

  it("is deterministic for the same text", () => {
    expect(draw().innerHTML).toBe(draw().innerHTML);
  });
});

describe("the QR colours are layer-2 roles: light ground, dark ink, both themes", () => {
  const read = (...p: string[]) =>
    stripCssComments(
      readFileSync(path.join(import.meta.dirname, "..", "src", ...p), "utf8")
    );
  const components = read("app", "styles", "3-components.css");
  const semantic = read("app", "styles", "2-semantic.css");

  it("paints the ground and the modules through the QR roles", () => {
    expect(declarationValue(cssRule(components, ".qr-light"), "fill")).toBe(
      "var(--s-qr-light)"
    );
    expect(declarationValue(cssRule(components, ".qr-dark"), "fill")).toBe(
      "var(--s-qr-dark)"
    );
  });

  it("defines both roles in the dark and the light theme block", () => {
    const lightAt = semantic.indexOf(':root[data-theme="light"] {');
    const dark = semantic.slice(0, lightAt);
    const light = semantic.slice(lightAt);
    for (const block of [dark, light]) {
      expect(block).toMatch(/--s-qr-light:\s*var\(--p-cool-000\);/);
      expect(block).toMatch(/--s-qr-dark:\s*var\(--p-cool-950\);/);
    }
  });

  it("the component names no colour primitive and no literal colour", () => {
    const source = read("components", "qr-code.tsx");
    expect(source).not.toMatch(/--p-/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
