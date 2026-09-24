import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchingBraceClose, stripComments } from "./support";

/**
 * The commit window is locked for the WHOLE gesture, not just its start
 * (George r1 pass C, P1, on PR #681).
 *
 * `panGesture`'s half of this is pure and covered in `recorder-stage.test.ts`:
 * `captureLocksPan` now names `isClosing`, so a finger landing during the
 * post-stop save is refused. The other two halves live in `recorder.tsx` as a
 * pointer handler and an async callback, and both are about a drag that is
 * ALREADY in flight:
 *
 * - `onPointerMove` has to freeze on the same terms, or a pan that cannot begin
 *   during the commit can still be finished during it.
 * - `commitTake` has to ABANDON that drag when the commit starts, or the drag
 *   simply thaws when `isClosing` clears and its next move rebases from an
 *   origin captured before the splice — overwriting the rest `panAfterCommit`
 *   just wrote with an absolute sample inside the take being saved, so the next
 *   Record appends in front of it.
 *
 * **Source gates, and this file says so.** Both are pointer events on a canvas
 * inside a component the Vitest suite renders without a real pointer: jsdom has
 * no `setPointerCapture` semantics to speak of, so a "drag through a commit"
 * test would be asserting over a harness rather than over the gesture. What is
 * decidable from the text is that the two guards read the same predicate and
 * that the abandon happens before the commit's first `await`. Each assertion
 * below names the mutation it must die on.
 */
describe("a drag cannot survive a commit (George r1 pass C P1)", () => {
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

  const move = bodyOf("const onPointerMove = useCallback(");
  const commit = bodyOf("const commitTake = useCallback(");

  it("isolates real bodies — the move pans, the commit stops the recorder", () => {
    // Without this, a typo in either declaration would hand the assertions
    // below an empty string and they would all pass on nothing.
    expect(move).toMatch(/setPanState\s*\(/);
    expect(commit).toMatch(/stopRecording\s*\(/);
  });

  it("freezes a moving drag on the same predicate that refuses a new one", () => {
    // Mutation: spell the terms out here again as `recording || busy`, which
    // drops `isClosing` — the pure cases in `recorder-stage.test.ts` stay
    // green under it, because they only ever see `panGesture`.
    expect(move).toMatch(
      /captureLocksPan\(\s*\{\s*recording,\s*busy,\s*isClosing,?\s*\}\s*\)/
    );
    const guard = move.search(/captureLocksPan\(/);
    // And it has to be a GUARD, not a late check: everything that moves the
    // waveform happens after it.
    expect(guard).toBeLessThan(move.search(/setPanState\s*\(/));
  });

  it("abandons the drag when the commit starts, before anything awaits", () => {
    // Mutation: move any of the three writes below the `await`, or delete one,
    // and this dies. Placing them after the await is the subtler bug — the
    // drag then keeps the stage for however long `stopRecording` takes.
    const firstAwait = commit.search(/\bawait\b/);
    expect(firstAwait).toBeGreaterThan(-1);
    for (const write of [
      "ownerRef.current = null;",
      "setDragging(false);",
      "resumeAfterDragRef.current = false;",
    ]) {
      const at = commit.indexOf(write);
      expect(at, `${write} missing from commitTake`).toBeGreaterThan(-1);
      expect(at, `${write} runs after the first await`).toBeLessThan(
        firstAwait
      );
    }
  });
});
