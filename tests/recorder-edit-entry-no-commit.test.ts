import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchingBraceClose, stripComments } from "./support";

/**
 * Edit entry never commits a live take (#871).
 *
 * #134 let the Edit control commit a take in progress and then open edit mode
 * over it, through `commitTake("edit")`. #857 greyed both Edit surfaces while a
 * take is live (`editRowReason`'s `hasTake` term, fed `recording`), which left
 * that arm, and `recoverDestination`'s `"edit"` value, with no caller. #871
 * removed them. `tests/recorder-stop-commits.test.ts` covers the behaviour
 * through the real component: a click on the greyed toggle starts no stop and
 * opens no edit mode. That click never reaches `onEnterEdit` (`Control`'s
 * activation guard swallows it), so what the handler itself does with a live
 * take cannot be observed from the UI. These source pins cover that.
 *
 * Each assertion names the mutation it dies on.
 */
describe("Edit entry never commits a live take (#871)", () => {
  const code = stripComments(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );

  const bodyOf = (declaration: string): string => {
    const start = code.indexOf(declaration);
    if (start === -1) {
      throw new Error(`${declaration} not found — renamed or moved?`);
    }
    const open = code.indexOf("{", start);
    const close = matchingBraceClose(code, open);
    if (open === -1 || close <= open) {
      throw new Error(`${declaration} body braces not found`);
    }
    return code.slice(open, close + 1);
  };

  const enterEdit = bodyOf("const onEnterEdit = useCallback(");

  it("isolates the real handler body", () => {
    // A floor: without it, a wrong slice hands the assertions below an
    // unrelated string, and the `not` ones pass on nothing.
    expect(enterEdit).toMatch(/setMode\("edit"\)/);
  });

  it("refuses a live take before doing anything else", () => {
    // Dies on: deleting the guard, or moving it below `setMode("edit")`,
    // which would open edit mode over the stale stored clip mid-take.
    expect(enterEdit.replace(/\s+/g, " ")).toMatch(
      /^\{ if \(recording\) return;/
    );
  });

  it("does not commit from Edit entry", () => {
    // Dies on: reintroducing a commit-then-edit arm in the handler.
    expect(enterEdit).not.toMatch(/commitTake\s*\(/);
  });

  it("commitTake takes no destination argument", () => {
    // Dies on: restoring `after: "stay" | "edit"`. With no parameter, a
    // `commitTake("edit")` call anywhere is also a type error in `tsc -b`.
    expect(code).toMatch(/const commitTake = useCallback\(\s*\(\)\s*=>/);
  });

  it("the recovery destination has no edit value", () => {
    // Dies on: widening the ref back to three values, or assigning "edit".
    expect(code).toMatch(
      /const recoverDestination = useRef<"close" \| "stay">\("close"\)/
    );
    expect(code).not.toMatch(/recoverDestination\.current\s*=\s*"edit"/);
    expect(code).not.toMatch(/destination === "edit"/);
  });
});
