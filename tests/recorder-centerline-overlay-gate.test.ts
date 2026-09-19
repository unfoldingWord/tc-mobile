import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * #513 Frank round-2 P2: the centerline overlay's JSX render gate must call
 * `centerlineOverlayShown` DIRECTLY — with no other boolean logic composed
 * at the call site (no `!liveScope &&` in front, no intermediate
 * `const centerlineVisible = ...` between the two). That composition is
 * exactly what let the #418 selection exception be fully tested
 * (`tests/recorder-stage.test.ts`) while the `liveScope` term stayed
 * uncovered: a future edit could change or drop it at the call site and
 * every unit test would stay green.
 *
 * Source-shape, the same reason `tests/recorder-cut-drag-gate.test.ts` and
 * `tests/nav-commit-close-race-guards.test.ts` are: there is no DOM runner
 * here (AGENTS.md), so the JSX conditional cannot be rendered and inspected
 * — only read as text. The comment-stripping / brace-counting idiom is
 * `nav-commit-close-race-guards.test.ts`'s.
 *
 * WHAT THIS PROVES, EXACTLY: that the source TEXT still calls
 * `centerlineOverlayShown` as the sole condition of the JSX gate. It does
 * NOT prove the function itself is correct — `tests/recorder-stage.test.ts`
 * covers that — nor that this renders correctly on a device.
 */

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Depth-counts opens (`(` and `{`) against closes (`)` and `}`) together,
 * since the call's argument is an object literal nested inside its parens —
 * a plain paren-only counter would stop at the object literal's own `}`. */
const matchingClose = (body: string, openIndex: number): number => {
  const opens = "({";
  const closes = ")}";
  let depth = 0;
  for (let i = openIndex; i < body.length; i++) {
    if (opens.includes(body[i]!)) depth++;
    else if (closes.includes(body[i]!)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

const recorder = stripComments(
  readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  )
);

describe("the centerline overlay's JSX gate calls centerlineOverlayShown directly (#513 Frank round-2 P2)", () => {
  const callIdx = recorder.indexOf("centerlineOverlayShown({");

  it("the call exists exactly once in recorder.tsx", () => {
    expect(callIdx, "centerlineOverlayShown({ call not found").toBeGreaterThan(
      -1
    );
    expect(recorder.indexOf("centerlineOverlayShown({", callIdx + 1)).toBe(-1);
  });

  it("is the sole condition of a JSX `{ ... && ( ... ) }` gate — nothing else precedes it inside the brace", () => {
    let openBraceIdx = callIdx - 1;
    while (openBraceIdx >= 0 && /\s/.test(recorder[openBraceIdx]!))
      openBraceIdx--;
    expect(
      recorder[openBraceIdx],
      "expected the JSX `{` immediately before the call, with nothing else (e.g. `!liveScope &&`) between them"
    ).toBe("{");
    expect(recorder.slice(openBraceIdx + 1, callIdx).trim()).toBe("");
  });

  it("nothing is appended after the call's own arguments besides `&& (` — no extra composed term", () => {
    const parenIdx = callIdx + "centerlineOverlayShown".length;
    expect(recorder[parenIdx]).toBe("(");
    const closeParenIdx = matchingClose(recorder, parenIdx);
    expect(
      closeParenIdx,
      "could not find the matching close paren for the call"
    ).toBeGreaterThan(-1);

    let i = closeParenIdx + 1;
    while (i < recorder.length && /\s/.test(recorder[i]!)) i++;
    expect(recorder.slice(i, i + 2)).toBe("&&");
    i += 2;
    while (i < recorder.length && /\s/.test(recorder[i]!)) i++;
    expect(recorder[i]).toBe("(");
  });

  it("the call's arguments are EXACTLY {mode, selectionActive: editor.selectionActive, liveScope} — an exact match, not identifier presence", () => {
    // Frank round-2 P2 on this file's PREVIOUS version: three
    // identifier-presence regexes (`/\bmode\b/`, `/selectionActive/`,
    // `/\bliveScope\b/`) pass on a call site rewritten with wrong VALUES —
    // `liveScope: false`, `mode: "record"`, `selectionActive: false` — since
    // the identifier text is still present somewhere in the argument block.
    // Whitespace-normalize the whole block and compare it to the exact
    // shorthand-object shape the production call must have, so a wrong
    // literal on any one property fails this test.
    const parenIdx = callIdx + "centerlineOverlayShown".length;
    const closeParenIdx = matchingClose(recorder, parenIdx);
    const args = recorder.slice(parenIdx + 1, closeParenIdx);
    const normalized = args.replace(/\s+/g, "");
    expect(normalized).toBe(
      "{mode,selectionActive:editor.selectionActive,liveScope,}"
    );
  });
});
