import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * George R3 P2 (PR #499), Amendment B's load-bearing half: the mount effect
 * must adopt the resumed index into BOTH `navIndex.current` AND
 * `nextIndex.current`. `pushHistoryEntry` stamps the next entry from
 * `++nextIndex.current` ALONE (`hooks/use-nav-stack.ts`), so adopting only
 * `navIndex` and leaving `nextIndex` at its `useRef(0)` default reintroduces
 * finding F3 one push later: the first chapter opened after a reload stamps a
 * LOWER index than the adopted baseline, `navDirection` reads the following
 * Back as "same"/"forward", and `popAction` swallows it — the translator is
 * stuck on Segments.
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. This Node-only suite has no
 * renderer (AGENTS.md: no jsdom), so `useNavStack`'s mount effect cannot be
 * run and its refs cannot be read at runtime. `tests/nav-resume-index.test.ts`
 * proves the pure COMPOSITION (that adopting both refs classifies the next
 * Back correctly) against a local `let nextIndex`, not against the adapter
 * source — deleting `nextIndex.current = resumed` from the real effect leaves
 * every one of those rows green, and the Playwright case that DOES exercise the
 * live effect is the other half of this fix (`e2e/back-navigation.spec.ts`
 * case (c), which opens a chapter after the reload and asserts the new entry's
 * index is resumed + 1). This gate is the source-shape guard for the same
 * assignment, the comment-stripping idiom of `tests/nav-commit-close-rearm.test.ts`.
 *
 * WHAT IT PROVES, EXACTLY: that the source text's ONE `resumeNavIndex(...)`
 * call is followed, in the same mount effect, by an assignment of that
 * `resumed` value to BOTH `navIndex.current` and `nextIndex.current`. It does
 * NOT prove the effect runs correctly at runtime, that a reload path is ever
 * taken, or that any device has run this.
 */
describe("Amendment B adopts the resumed index into BOTH refs (George R3 P2)", () => {
  const sourceUrl = new URL("../src/hooks/use-nav-stack.ts", import.meta.url);

  // Strip comments so the gate reads CODE, not the docblock beside the effect
  // that (deliberately) names `navIndex`, `nextIndex` and "BOTH refs".
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  it("the adapter has exactly one resumeNavIndex(...) call (the mount effect)", () => {
    // If a refactor adds a second call site or renames this one, the isolation
    // below is no longer sound — fail loudly rather than score the wrong block.
    const calls = code.match(/resumeNavIndex\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  /**
   * Isolate the mount effect's tail: from the `resumeNavIndex(...)` call to the
   * effect's `}, []` closer. Both adoption assignments live in this slice, and
   * `pushHistoryEntry`'s `navIndex.current = index` (a DIFFERENT right-hand
   * side) and the popstate handler's `navIndex.current = toIndex` are OUTSIDE
   * it, so the assertions below cannot be satisfied by an unrelated assignment.
   */
  const effectTail = (() => {
    const callIdx = code.search(/resumeNavIndex\s*\(/);
    if (callIdx === -1) {
      throw new Error(
        "resumeNavIndex call not found — has the mount effect moved or been renamed?"
      );
    }
    const closerIdx = code.indexOf("}, []", callIdx);
    if (closerIdx === -1 || closerIdx <= callIdx) {
      throw new Error("the mount effect's `}, []` closer was not found");
    }
    return code.slice(callIdx, closerIdx);
  })();

  it("adopts the resumed value into navIndex.current", () => {
    expect(effectTail).toMatch(/navIndex\.current\s*=\s*resumed\b/);
  });

  it("adopts the SAME resumed value into nextIndex.current (the F3 guard)", () => {
    // RED-FIRST kill: delete `nextIndex.current = resumed;` from the effect and
    // this assertion fails — the exact mutation that reintroduces F3 one push
    // after a reload (see `e2e/back-navigation.spec.ts` case (c)).
    expect(effectTail).toMatch(/nextIndex\.current\s*=\s*resumed\b/);
  });
});
