import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * Which `armFocus` call sites pass `preventScroll` (#800, DRI: split it).
 *
 * The hook's own argument handling is pinned in `scroll-to-new.test.ts`; this
 * pins the CALL SITES, which are what actually decide the split. Source-reading,
 * comments stripped first. The files hold no `//` or `/*` inside a string.
 */

function armFocusCalls(file: string): string[] {
  const text = stripComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  const re = /rowReveal\.armFocus\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; depth > 0 && i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push(text.slice(m.index, i).replace(/\s+/g, " "));
  }
  return out;
}

const keeps = (c: string) => c.includes("preventScroll: true");

describe("armFocus call sites", () => {
  it("Books: the three delete-confirm hand-offs keep the viewport, nothing else does", () => {
    const calls = armFocusCalls("src/components/books-screen.tsx");
    expect(calls.filter(keeps)).toHaveLength(3);
    expect(
      calls.filter(keeps).every((c) => /deleteTargetId|targetId/.test(c))
    ).toBe(true);
    expect(calls.filter((c) => !keeps(c))).toHaveLength(calls.length - 3);
  });

  it("Segments: the delete cancel and the neighbour hand-off keep it, create and drop do not", () => {
    const calls = armFocusCalls("src/components/segments-screen.tsx");
    expect(calls.filter(keeps)).toHaveLength(2);
    const plain = calls.filter((c) => !keeps(c));
    expect(plain.some((c) => c.includes("segment.id"))).toBe(true);
    expect(plain.some((c) => c.includes("segmentId"))).toBe(true);
  });
});
