import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bodyAfter, stripComments } from "./support";

/**
 * `goBack` refuses while a SUPPRESSED traversal is in flight (George r3 P2 on
 * PR 634, #374).
 *
 * The travel guard (`beginBack`) refuses a second `history.back()` only for
 * issuers it tracks. `trap-forward`'s cancel is a raw issuer outside it
 * (`travel-guard.ts`; the programmatic recorder close was the other until
 * #763 folded it in): it sets `suppressPop` and calls `history.back()`
 * itself, and its `popstate` lands a task later. The on-screen header Back is
 * disabled for that window, so `goBack` could never run inside it — until the
 * hardware Back (#374) became a `goBack` issuer that nothing disables. Two
 * `history.back()` calls before the first lands is the coalescing hazard #493
 * closed for the tracked issuers; this is the same rule for the untracked one.
 *
 * Since #1275 the body that issues is `issueBack`, shared by `goBack` and
 * `goBackToBooks` (the recorder's book crumb), so the gate reads THAT body
 * and pins that both commands go through it rather than carrying a
 * `history.back()` of their own.
 *
 * Like `nav-commit-close-rearm.test.ts`, this gate reads the hook's CODE
 * rather than driving `useNavStack`'s callbacks. It strips comments and
 * isolates each body so a match elsewhere in the file cannot satisfy it.
 * Mutation that must go red: delete the `suppressPop` check, or move it
 * after `beginBack`; give `goBack` or `goBackToBooks` a `history.back()` of
 * its own.
 */
describe("goBack refuses while a suppressed traversal is outstanding (George r3 P2, PR 634)", () => {
  const sourceUrl = new URL("../src/hooks/use-nav-stack.ts", import.meta.url);

  const code = stripComments(readFileSync(sourceUrl, "utf8"));
  const body = bodyAfter(code, "const issueBack = useCallback(");

  it("isolates a real body — non-empty, and it is the one that calls beginBack", () => {
    expect(body.length).toBeGreaterThan(40);
    expect(body).toMatch(/beginBack\s*\(/);
  });

  it("returns on suppressPop.current BEFORE consulting beginBack", () => {
    const guard = /if\s*\(\s*suppressPop\.current\s*\)\s*return\s*;/.exec(body);
    expect(
      guard,
      "no `if (suppressPop.current) return;` in issueBack"
    ).not.toBeNull();
    const beginIdx = body.search(/beginBack\s*\(/);
    expect(guard!.index).toBeLessThan(beginIdx);
  });

  it("still issues exactly one history.back() on the open path", () => {
    const calls = body.match(/window\.history\.back\s*\(\s*\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("writes the continuation only after the guard has admitted this issuer (#1275)", () => {
    // A refused request (the hardware Back landing while the crumb's Back is
    // outstanding) must not clear, or set, the continuation of a Back it did
    // not issue: the write sits after the refusal return.
    const refuse = body.search(/if\s*\(\s*!begun\.ok\s*\)\s*return\s*;/);
    const write = body.search(/continueToBooks\.current\s*=\s*toBooks/);
    expect(refuse).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(refuse);
  });

  it.each(["goBack", "goBackToBooks"])(
    "%s is a call into issueBack and touches no history itself (#1275)",
    (name) => {
      const declStart = code.indexOf(`const ${name} = useCallback(`);
      expect(declStart, `${name} declaration`).toBeGreaterThan(-1);
      const declaration = code.slice(declStart, code.indexOf(";", declStart));
      expect(declaration).toMatch(/issueBack\(\s*(true|false)\s*\)/);
      expect(declaration).not.toMatch(/window\.history\./);
    }
  );
});
