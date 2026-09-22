import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `goBack` refuses while a SUPPRESSED traversal is in flight (George r3 P2 on
 * PR 634, #374).
 *
 * The travel guard (`beginBack`) refuses a second `history.back()` only for
 * issuers it tracks. `commitCloseRecorder` and `trap-forward`'s cancel are
 * raw issuers outside it on purpose (`travel-guard.ts`, the third-issuer
 * paragraph): they set `suppressPop` and call `history.back()` themselves,
 * and their `popstate` lands a task later. The on-screen header Back is
 * disabled for that window, so `goBack` could never run inside it — until the
 * hardware Back (#374) became a `goBack` issuer that nothing disables. Two
 * `history.back()` calls before the first lands is the coalescing hazard #493
 * closed for the tracked issuers; this is the same rule for the untracked one.
 *
 * Same shape as `nav-commit-close-rearm.test.ts`, for the same reason: the
 * Vitest suite has no renderer (AGENTS.md: no jsdom), so `useNavStack`'s
 * callbacks cannot be driven; the gate reads the hook's CODE, comments
 * stripped, and isolates `goBack`'s body so a match elsewhere in the file
 * cannot satisfy it. Mutation that must go red: delete the `suppressPop`
 * check, or move it after `beginBack`.
 */
describe("goBack refuses while a suppressed traversal is outstanding (George r3 P2, PR 634)", () => {
  const sourceUrl = new URL("../src/hooks/use-nav-stack.ts", import.meta.url);

  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  const matchingBraceClose = (body: string, openIndex: number): number => {
    let depth = 0;
    for (let i = openIndex; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const declStart = code.indexOf("const goBack = useCallback(");
  if (declStart === -1) {
    throw new Error("goBack declaration not found — renamed or moved?");
  }
  const braceOpen = code.indexOf("{", declStart);
  const braceClose = matchingBraceClose(code, braceOpen);
  if (braceOpen === -1 || braceClose <= braceOpen) {
    throw new Error("goBack body braces not found");
  }
  const body = code.slice(braceOpen, braceClose + 1);

  it("isolates a real body — non-empty, and it is the one that calls beginBack", () => {
    expect(body.length).toBeGreaterThan(40);
    expect(body).toMatch(/beginBack\s*\(/);
  });

  it("returns on suppressPop.current BEFORE consulting beginBack", () => {
    const guard = /if\s*\(\s*suppressPop\.current\s*\)\s*return\s*;/.exec(body);
    expect(
      guard,
      "no `if (suppressPop.current) return;` in goBack"
    ).not.toBeNull();
    const beginIdx = body.search(/beginBack\s*\(/);
    expect(guard!.index).toBeLessThan(beginIdx);
  });

  it("still issues exactly one history.back() on the open path", () => {
    const calls = body.match(/window\.history\.back\s*\(\s*\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
