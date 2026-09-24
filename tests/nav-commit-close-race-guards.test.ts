import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchingBraceClose, stripComments } from "./support";

/**
 * George R2 P2-1 and P2-2 (PR #499): the commit-close-recorder RACE guards.
 *
 * These are source-shape gates, the same comment-stripping / brace-counting
 * idiom as `tests/nav-commit-close-rearm.test.ts` and
 * `tests/recorder-stop-release-guards.test.ts`. These tests read source text;
 * they do not mount `useNavStack`, dispatch `popstate`, or render the recorder.
 * The static render harness does not execute effects or browser events either.
 * The race is a `requestClose()` resolving before an outstanding go-back's
 * `popstate` lands. The Playwright spec covers idle navigation, not this timing
 * window (`e2e/back-navigation.spec.ts` header).
 *
 * WHAT THESE PROVE, EXACTLY: that the source TEXT still has the three shapes.
 * They do NOT prove any of it executes correctly at runtime, that the race
 * window is ever hit, or that any device has run this. Behaviour is the e2e
 * spec's idle path (cases b, d) plus the on-device items named in its header.
 */

const navSource = stripComments(
  readFileSync(
    new URL("../src/hooks/use-nav-stack.ts", import.meta.url),
    "utf8"
  )
);

/**
 * Isolate the `case "commit-close-recorder":` block so the assertions check
 * THIS case, not "somewhere in the file": `goBack` also calls `beginBack`, and
 * `commitCloseRecorder` also sets `suppressPop.current = true`, both OUTSIDE
 * this case.
 */
const commitCloseCaseBody = (() => {
  const declStart = navSource.indexOf('case "commit-close-recorder":');
  if (declStart === -1) {
    throw new Error(
      "commit-close-recorder case not found — has it been renamed or moved?"
    );
  }
  const braceOpen = navSource.indexOf("{", declStart);
  const braceClose = matchingBraceClose(navSource, braceOpen);
  if (braceOpen === -1 || braceClose <= braceOpen) {
    throw new Error("commit-close-recorder case braces not found");
  }
  return navSource.slice(braceOpen, braceClose + 1);
})();

describe("commit-close settle absorbs a refused re-arm, never issues a second back() (George R2 P2-1)", () => {
  /**
   * The refused arm: `beginBack(travelGuard.current, "commit-close")` returns
   * `!ok` because an outstanding go-back's popstate has not landed yet; the
   * settle must ABSORB that landing (`suppressPop.current = true`) and must NOT
   * issue a second `window.history.back()` — a second traversal would strand
   * the app one physical level below its screen (invariant 2). We isolate the
   * `else { ... }` arm of `if (begun.ok) { ... }` and assert exactly that.
   */
  const elseBody = (() => {
    const beginIdx = commitCloseCaseBody.indexOf(
      'beginBack(travelGuard.current, "commit-close")'
    );
    expect(beginIdx).toBeGreaterThan(-1);
    const ifIdx = commitCloseCaseBody.indexOf("if", beginIdx);
    const ifBraceOpen = commitCloseCaseBody.indexOf("{", ifIdx);
    const ifBraceClose = matchingBraceClose(commitCloseCaseBody, ifBraceOpen);
    // After the if-block's close, the next token must be `else {`.
    const elseKeyword = commitCloseCaseBody.indexOf("else", ifBraceClose);
    const elseBraceOpen = commitCloseCaseBody.indexOf("{", elseKeyword);
    const elseBraceClose = matchingBraceClose(
      commitCloseCaseBody,
      elseBraceOpen
    );
    if (
      elseKeyword === -1 ||
      elseBraceClose <= elseBraceOpen ||
      elseKeyword > ifBraceClose + 3
    ) {
      throw new Error(
        "the beginBack('commit-close') if/else refusal arm was not found"
      );
    }
    return commitCloseCaseBody.slice(elseBraceOpen, elseBraceClose + 1);
  })();

  it("the refused arm sets suppressPop.current = true (absorbs the outstanding landing)", () => {
    // RED-FIRST kill: deleting `suppressPop.current = true` from the else-branch
    // makes this fail. Its absence would let the outstanding goBack's popstate
    // route as a real second pop.
    expect(elseBody).toMatch(/suppressPop\.current\s*=\s*true/);
  });

  it("the refused arm issues NO second window.history.back()", () => {
    // The whole point of absorbing: the outstanding goBack's own back() already
    // consumes the protective entry; a second one here over-pops.
    expect(elseBody).not.toMatch(/window\.history\.back\s*\(/);
  });
});

describe("commit-close-recorder re-arms transitionInFlight BEFORE requestClose (George R2 P2-2 / #58 / #168)", () => {
  /**
   * F1/#58/#168: while stop -> decode -> save runs, a second Back must re-arm,
   * not escape. That depends on the adapter SETTING `transitionInFlight` before
   * the async `close()` — `popAction`'s pure rows only read the boolean, they
   * never set it. No behavioural test reads this assignment (the e2e idle path
   * cannot tell commit-close from a bare sheet-close). This gate does.
   */
  const requestCloseIdx = commitCloseCaseBody.search(/\.requestClose\s*\(/);
  const assignIdx = commitCloseCaseBody.search(
    /transitionInFlight\.current\s*=\s*true/
  );

  it("the case calls handle.requestClose()", () => {
    expect(requestCloseIdx).toBeGreaterThan(-1);
  });

  it("assigns transitionInFlight.current = true before requestClose()", () => {
    // RED-FIRST kill: deleting `transitionInFlight.current = true` leaves only
    // the `= false` in the `.finally`, so this `= true` search returns -1 and
    // the ordering assertion fails. (The `.finally`'s `= false` is AFTER
    // requestClose, so it can never satisfy this even if the search widened.)
    expect(assignIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(requestCloseIdx);
  });
});

describe("recorder header Close is disabled through the close window (George R2 P2-1)", () => {
  /**
   * The on-screen belt to the absorb branch's suspenders: the header Close
   * control must be `disabled` while `isClosing`, matching its record-mode menu
   * and Editing-pill siblings, so it is not the issuer in the HEADER of a
   * `goBack` during `requestClose` (LoadErrorPanel's and PermissionPanel's Back
   * stay live through the close window and are covered by the absorb branch).
   * Isolate the Close control by its unique `label={strings.closeRecorder}` and
   * read the `disabled={...}` expression that follows it.
   */
  const recorderSource = stripComments(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );

  const closeDisabledExpr = (() => {
    const labelIdx = recorderSource.indexOf("strings.closeRecorder");
    expect(labelIdx).toBeGreaterThan(-1);
    const match = /disabled=\{([^}]*)\}/.exec(recorderSource.slice(labelIdx));
    if (!match) {
      throw new Error(
        "the Close control's disabled={...} prop was not found after its label"
      );
    }
    return match[1];
  })();

  it("guards on heldTake (still the #165 held-take guard)", () => {
    expect(closeDisabledExpr).toMatch(/heldTake/);
  });

  it("also guards on isClosing", () => {
    // RED-FIRST kill: on PR2's head this expression was `heldTake !== null`
    // only, so this assertion fails until `|| isClosing` is added.
    expect(closeDisabledExpr).toMatch(/isClosing/);
  });
});
