import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `deleteBook`'s failure catch reports to the funnel (#456), and this is a
 * structural gate on it, not a behavioural test — same shape and same reason
 * as `tests/recorder-stop-release-guards.test.ts`.
 *
 * WHY A TEXTUAL GATE AND NOT A BEHAVIOURAL TEST. `deleteBook` is a
 * `useCallback` inside `useBooks()`, entangled with `setBooks`, `reload` and
 * `report` — hook-owned React state this Node-only suite (no jsdom, no
 * renderer) cannot exercise, exactly as `tests/use-books.test.ts`'s own
 * docblock already says of `report`'s `setFailure` wiring ("review +
 * on-device surface, as with `use-erase-segment.test.ts`"). Extracting
 * `deleteBook`'s fallible core into a plain function the way `performErase`
 * and `performSaveTake` are would touch a hook this file's own comments
 * document as having survived multiple rounds of race-condition fixes
 * (George R1/R3/R4/R7, the `loadGen` generation guard, the
 * delete-failure-outranks-a-healthy-reload rule) for a change this PR's scope
 * does not otherwise need — so the call site is pinned by source text
 * instead, the same trade `#474`'s guards made in `use-recorder.ts`.
 *
 * WHAT IT PROVES, EXACTLY: that `deleteBook`'s `catch (cause)` block calls
 * both `console.error` (kept, unchanged) and
 * `reportFailure(cause, "book-delete")` (new). It does NOT prove the report
 * actually reaches a live sink at runtime, that `cause` is never wrapped in a
 * nested closure the react-hooks/refs bail-out shape would catch (checked
 * separately below), or that any device has exercised a failed delete.
 */
describe('deleteBook reports its catch to the funnel under "book-delete" (#456)', () => {
  const sourceUrl = new URL("../src/hooks/use-books.ts", import.meta.url);

  /**
   * Comments stripped for the same reason `recorder-stop-release-guards`
   * strips them: the guard's own prose mentions `reportFailure` and
   * `console.error`, and a naive match would score documentation rather than
   * code. `use-books.ts` contains no `//` or `/*` inside a string literal
   * (grep-checked at this head), so the strip cannot misfire on one.
   */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  const declStart = code.indexOf("const deleteBook = useCallback");
  if (declStart === -1) {
    throw new Error(
      "deleteBook declaration not found — has it been renamed or moved?"
    );
  }
  const braceOpen = code.indexOf("{", declStart);
  if (braceOpen === -1) {
    throw new Error("deleteBook's opening brace not found");
  }
  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose === -1 || braceClose <= braceOpen) {
    throw new Error("deleteBook's closing brace not found");
  }
  const deleteBookBody = code.slice(braceOpen, braceClose + 1);

  const catchStart = deleteBookBody.indexOf("catch (cause)");
  if (catchStart === -1) {
    throw new Error("deleteBook's catch (cause) block not found");
  }
  const catchBody = deleteBookBody.slice(catchStart);

  /**
   * Walks `text` up to `callIndex` tracking brace depth, and for every `{`
   * opened along the way decides whether it opens a function/arrow BODY
   * (as opposed to an `if`/`try`/block `{`) by inspecting the text
   * immediately before it — `=>` for an arrow, or a `function` keyword
   * (optionally named) followed by a parameter list for a function
   * expression/declaration. Returns true when, at `callIndex`, at least one
   * still-open brace on the stack is such a closure, OR when the call is
   * itself the (brace-less) expression body of an arrow — `=>` immediately
   * before it with nothing else in between, as in
   * `.then(() => reportFailure(cause, "book-delete"))`. Either shape means
   * the call sits inside a nested function, not directly in `text`'s own
   * top-level flow.
   *
   * This replaces a single non-greedy regex
   * (`[^}]*(?:=>|function)[^}]*cause[^}]*reportFailure\(...\)`), which
   * could never match: `[^}]*` cannot cross the `}` that closes a
   * single-statement closure body right after the call, and the only
   * `cause` token available to satisfy the regex's own `cause` requirement
   * was the one already consumed inside `reportFailure(cause, ...)` itself,
   * leaving no second `cause` for the earlier `[^}]*cause[^}]*` to match —
   * so the negative assertion passed on every input, including a
   * `setTimeout(() => { reportFailure(cause, "book-delete"); }, 0)` mutation
   * (verified: it stayed green against that mutation before this fix).
   *
   * The brace-less-arrow check exists because a first pass at this fix
   * (brace-depth tracking alone) was itself verified to miss
   * `Promise.resolve().then(() => reportFailure(cause, "book-delete"))` — no
   * `{` is ever opened for an expression-bodied arrow, so there was nothing
   * on the closure stack to find, and eslint (checked directly, with a
   * render-time canary ref write added to `useBooks()`) confirmed the
   * react-hooks/refs bail-out fires for that shape too.
   */
  function isInsideClosure(text: string, callIndex: number): boolean {
    const closureStack: boolean[] = [];
    for (let i = 0; i < callIndex; i++) {
      const ch = text[i];
      if (ch === "{") {
        const prefix = text.slice(0, i);
        const isArrowBody = /=>\s*$/.test(prefix);
        const isFunctionBody =
          /\bfunction\b\s*[A-Za-z0-9_$]*\s*\([^()]*\)\s*$/.test(prefix);
        closureStack.push(isArrowBody || isFunctionBody);
      } else if (ch === "}") {
        closureStack.pop();
      }
    }
    const isArrowExpressionBody = /=>\s*$/.test(text.slice(0, callIndex));
    return closureStack.some(Boolean) || isArrowExpressionBody;
  }

  it("calls console.error in the catch, unchanged", () => {
    expect(catchBody).toMatch(/console\.error\(\s*"Deleting a book failed"/);
  });

  it('calls reportFailure(cause, "book-delete") directly in the catch, never inside a nested function', () => {
    // The whole point of the gate: deleting this call, or the string, fails
    // this and only this. `reportFailure` called elsewhere in the file (the
    // load effect's own catch, a sibling hook) does not satisfy it — the
    // match is anchored to `deleteBook`'s own catch body above.
    const callPattern = /reportFailure\(\s*cause,\s*"book-delete"\s*\)/;
    const callMatch = catchBody.match(callPattern);
    expect(callMatch).not.toBeNull();

    // The react-hooks/refs catch-block bail-out shape AGENTS.md documents:
    // ANY nested function defined inside `catch (cause) { ... }` that
    // references `cause` silences eslint-plugin-react-hooks's analysis for
    // the WHOLE hook. `reportFailure(cause, ...)` called directly in the
    // catch body is not that shape; a `.then(...)`, `setTimeout(...)`, or any
    // other closure wrapping the call, still referencing `cause`, would be —
    // so this fails on that shape specifically, not just on the call's
    // absence. Detected structurally (brace-depth walk to the call site)
    // rather than by a single regex, which could not express "still open"
    // across an intervening `}` — see `isInsideClosure` above.
    expect(isInsideClosure(catchBody, callMatch!.index!)).toBe(false);
  });
});
