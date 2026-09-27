import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * `createBook` and `deleteBook` each call `bumpStoragePressure()` once their
 * write has committed (#542 Part A, DRI decision 2026-09-24: "build the
 * module-scope estimate() invalidation now, bumped by book delete/create").
 *
 * `createBook`/`deleteBook` are `useCallback`s inside `useBooks()`, and this
 * repo has no harness that mounts that hook's real effects/callbacks against
 * fake-indexeddb — the same limitation `tests/use-books-delete-failure-gate.
 * test.ts` names for `deleteBook`'s failure-funnel wiring. This is the same
 * shape of gate: a structural read of the source, not a behavioural run,
 * scoped to each callback's own body by brace-matching so a `bumpStoragePressure`
 * call anywhere ELSE in the file (or in the wrong callback) does not
 * satisfy it.
 *
 * WHAT IT PROVES, EXACTLY: that `bumpStoragePressure()` is called, textually,
 * after the write's own `await` and before that callback's optimistic
 * `setBooks` patch. It does NOT prove `bumpStoragePressure` reaches a live
 * `useStoragePressure` mount at runtime, or that any device has exercised a
 * book delete/create with the pressure line showing.
 */

const sourceUrl = new URL("../src/hooks/use-books.ts", import.meta.url);

/** Comments stripped for the same reason the sibling gate strips them: a
 * docblock mentioning these identifiers in prose must not satisfy a match
 * meant for code. This simple strip does not distinguish comments from
 * comment-like text inside string literals — none of the strings this file
 * greps for contain `//` or `/*`, so that gap does not matter here. */
const code = stripComments(readFileSync(sourceUrl, "utf8"));

/** Slice out one `const <name> = useCallback(` declaration's own body, by
 * brace-matching from its FIRST `{` — the arrow function's body, not the
 * `useCallback(` call's own parens. Throws with a diagnosable message rather
 * than silently matching nothing if `use-books.ts` is restructured. */
function callbackBody(name: string): string {
  const declStart = code.indexOf(`const ${name} = useCallback`);
  if (declStart === -1) {
    throw new Error(
      `${name} declaration not found — has it been renamed or moved?`
    );
  }
  const braceOpen = code.indexOf("{", declStart);
  if (braceOpen === -1) {
    throw new Error(`${name}'s opening brace not found`);
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
    throw new Error(`${name}'s closing brace not found`);
  }
  return code.slice(braceOpen, braceClose + 1);
}

const createBookBody = callbackBody("createBook");
const deleteBookBody = callbackBody("deleteBook");

describe("createBook bumps storage-pressure after its write commits (#542 Part A)", () => {
  it("calls bumpStoragePressure() at all, inside createBook's own body", () => {
    expect(createBookBody).toMatch(/bumpStoragePressure\(\)/);
  });

  it("calls it AFTER createBookInStore's write has landed, not before", () => {
    const writeAt = createBookBody.indexOf("await createBookInStore(name)");
    const bumpAt = createBookBody.indexOf("bumpStoragePressure()");
    expect(writeAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(writeAt);
  });

  it("calls it from the SUCCESS path, before the optimistic setBooks patch — never from that patch itself", () => {
    // "Never from the optimistic pre-commit state update" (the task's own
    // wording): the optimistic `setBooks` patch below can still be
    // superseded by a stale concurrent load and re-run; the write above it
    // already committed unconditionally, so the bump belongs before the
    // patch, anchored to the write instead.
    const bumpAt = createBookBody.indexOf("bumpStoragePressure()");
    const patchAt = createBookBody.indexOf("setBooks((prev) => [");
    expect(patchAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeLessThan(patchAt);
  });

  it("does not call it from the catch (a failed create frees nothing)", () => {
    const catchAt = createBookBody.indexOf("catch (cause)");
    expect(catchAt).toBeGreaterThan(-1);
    const catchBody = createBookBody.slice(catchAt);
    expect(catchBody).not.toMatch(/bumpStoragePressure\(\)/);
  });
});

describe("deleteBook bumps storage-pressure after its write commits (#542 Part A)", () => {
  it("calls bumpStoragePressure() at all, inside deleteBook's own body", () => {
    expect(deleteBookBody).toMatch(/bumpStoragePressure\(\)/);
  });

  it("calls it AFTER deleteBookFromStore's write has landed, not before", () => {
    const writeAt = deleteBookBody.indexOf("await deleteBookFromStore(bookId)");
    const bumpAt = deleteBookBody.indexOf("bumpStoragePressure()");
    expect(writeAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(writeAt);
  });

  it("calls it from the SUCCESS path, before the optimistic setBooks patch — never from that patch itself", () => {
    const bumpAt = deleteBookBody.indexOf("bumpStoragePressure()");
    const patchAt = deleteBookBody.indexOf(
      "setBooks((prev) => dropBookCard(prev, bookId))"
    );
    expect(patchAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeLessThan(patchAt);
  });

  it("does not call it from the catch (a failed delete freed nothing)", () => {
    const catchAt = deleteBookBody.indexOf("catch (cause)");
    expect(catchAt).toBeGreaterThan(-1);
    const catchBody = deleteBookBody.slice(catchAt);
    expect(catchBody).not.toMatch(/bumpStoragePressure\(\)/);
  });
});

describe("addChapter and renameBook do NOT bump storage-pressure (#542 Part A scope)", () => {
  // The DRI authorized book delete/create ONLY. Segment erase and recorder
  // close remain #247's separate, still-open "recorder-close refresh"
  // bullet, and addChapter/renameBook free or reserve no storage on their
  // own — scoping the bump to exactly two call sites, not to "every
  // use-books.ts mutation", is itself part of what this PR was authorized to
  // build. A future PR widening the scope updates this test deliberately;
  // it must not happen as a side effect of refactoring createBook/deleteBook.
  it("addChapter's body has no bumpStoragePressure call", () => {
    expect(callbackBody("addChapter")).not.toMatch(/bumpStoragePressure\(\)/);
  });

  it("renameBook's body has no bumpStoragePressure call", () => {
    expect(callbackBody("renameBook")).not.toMatch(/bumpStoragePressure\(\)/);
  });
});
