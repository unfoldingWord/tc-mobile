import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * An inward focus offset is unlayered or it is dead (#448, #635).
 *
 * The global `:focus-visible` in `globals.css` is unlayered. Under CSS Cascade
 * Level 5 an unlayered declaration beats every layered one regardless of
 * specificity, so `.paste-marker:focus-visible { outline-offset: -2px }`
 * inside `@layer components` never applied: keyboard focus painted the 3px
 * outward ring, which `.recorder-stage`'s `overflow: hidden` clips (#448).
 * `.selection-handle:focus-visible` carried the same dead rule (#635); the
 * handle is flush to the top and bottom of the clipping canvas, so its ring
 * clipped on every focus. Both now live beside the global rule, unlayered.
 *
 * These assertions read source text; they do not compute styles or render
 * focus rings in a browser.
 *
 * Comments are stripped before matching. `3-components.css`'s header names
 * selectors and values in prose, and a raw regex over the whole file matches
 * the prose (AGENTS.md, "Architecture — onion layers").
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...parts: string[]) =>
  readFileSync(path.join(ROOT, "src", "app", ...parts), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

const globals = read("globals.css");
const components = read("styles", "3-components.css");

const INWARD_SELECTORS = [
  ".paste-marker:focus-visible",
  ".selection-handle:focus-visible",
];

describe("inward focus offsets sit unlayered beside the global ring (#448, #635)", () => {
  it("globals.css declares the unlayered global ring these exceptions race", () => {
    expect(globals).toMatch(
      /^:focus-visible\s*\{[^}]*outline-offset:\s*var\(--c-focus-offset\)/m
    );
  });

  it("globals.css opens no @layer, so every rule in it is unlayered", () => {
    expect(globals).not.toMatch(/@layer\b/);
  });

  // The one rule in globals.css that declares an inward offset, located by
  // its declaration rather than by selector, so a rule that keeps the selector
  // and loses the offset is caught too.
  const exception = /([^{}]+)\{[^}]*outline-offset:\s*-2px[^}]*\}/.exec(
    globals
  );

  it("declares outline-offset: -2px for exactly the inward-offset controls", () => {
    expect(
      exception,
      "no unlayered rule declares outline-offset: -2px"
    ).not.toBeNull();
    const selectors = (exception?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(selectors).toEqual([...INWARD_SELECTORS].sort());
  });

  it("3-components.css carries no inward offset, because a layered one can never win", () => {
    // Vacuity guard: the file still styles focus at all, so an empty or
    // renamed file cannot pass the assertion below by having nothing in it.
    expect(components).toMatch(/outline-offset:\s*var\(--c-focus-offset\)/);
    expect(components).not.toMatch(/outline-offset:\s*-/);
  });
});
