import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * George R1 P2-2 (PR #499): the `commit-close-recorder` popstate case must
 * RE-ARM the screen-depth entry the browser already popped even when the
 * recorder handle is missing — matching every other non-screen intercept in
 * the switch. On `develop`/PR2's first head the null-handle branch was a bare
 * `if (!handle) return;`, which left the popped entry unrestored: not reachable
 * in PR2's App tree (the recovering/databasePanel early-returns re-arm via
 * `trap-recovery`/`trap-database-panel` first, and `panelWouldLoseAudio`
 * withholds the panel while `recorder !== null`), but the one intercept that
 * strands the physical stack one level below the visible screen (invariant 2)
 * the moment a future caller can make `screenFor` return "recorder" with a null
 * recorder ref (a PR3 overlay conversion, an inner error boundary).
 *
 * This source gate strips comments and isolates the null-handle branch; it
 * does not mount `useNavStack` or dispatch a `popstate` event.
 *
 * WHAT IT PROVES, EXACTLY: that the source text's `commit-close-recorder` case
 * has a braced `if (!handle) { ... }` branch whose body calls
 * `pushHistoryEntry()` before it returns, and reports the missed mount through
 * `console.error`. It does NOT prove the re-arm executes correctly at runtime,
 * that the branch is ever reached, or that any device has run this.
 */
describe("commit-close-recorder re-arms on a null recorder handle (George R1 P2-2)", () => {
  const sourceUrl = new URL("../src/hooks/use-nav-stack.ts", import.meta.url);

  // Comments are stripped so the gate reads CODE, not prose: the branch's own
  // comment discusses re-arming and `pushHistoryEntry`, and a naive match would
  // score documentation.
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  /** Brace-count from `openIndex` (an opening `{`) to its matching close. */
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

  /**
   * Isolate the `case "commit-close-recorder":` block so the assertions check
   * THIS case's null-handle branch, not "somewhere in the file" — the happy
   * path in the same case also calls `pushHistoryEntry()`, and a file-wide
   * match could be satisfied by that unrelated call.
   */
  const caseDeclStart = code.indexOf('case "commit-close-recorder":');
  if (caseDeclStart === -1) {
    throw new Error(
      "commit-close-recorder case not found — has it been renamed or moved?"
    );
  }
  const caseBraceOpen = code.indexOf("{", caseDeclStart);
  if (caseBraceOpen === -1) {
    throw new Error("commit-close-recorder case's opening brace not found");
  }
  const caseBraceClose = matchingBraceClose(code, caseBraceOpen);
  if (caseBraceClose === -1 || caseBraceClose <= caseBraceOpen) {
    throw new Error("commit-close-recorder case's closing brace not found");
  }
  const caseBody = code.slice(caseBraceOpen, caseBraceClose + 1);

  /**
   * The null-handle branch: `if (!handle) { ... }`, non-greedy to its first
   * closing brace (the branch has no nested braces). A bare
   * `if (!handle) return;` — the pre-fix shape — has no `{` after the `)`, so
   * this does not match and the first assertion below goes red (the red-first
   * kill for the missing re-arm).
   */
  const nullBranchMatch = /if\s*\(\s*!handle\s*\)\s*\{([\s\S]*?)\}/.exec(
    caseBody
  );

  it("the null-handle branch is a block (not a bare early return)", () => {
    expect(nullBranchMatch).not.toBeNull();
  });

  it("that block re-arms with pushHistoryEntry() before it returns", () => {
    const branch = nullBranchMatch?.[1] ?? "";
    const rearmIdx = branch.search(/pushHistoryEntry\s*\(\s*\)/);
    const returnIdx = branch.search(/\breturn\b/);
    // Both present, and the re-arm strictly before the return — deleting the
    // re-arm (back to `if (!handle) return;`), or ordering the return first,
    // must fail this.
    expect(rearmIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    expect(rearmIdx).toBeLessThan(returnIdx);
  });

  it("that block reports the missed mount through console.error", () => {
    const branch = nullBranchMatch?.[1] ?? "";
    expect(branch).toMatch(/console\.error\s*\(/);
  });
});
