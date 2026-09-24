import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * `renameBook`'s catch had the identical race `addChapter`'s catch had before
 * PR #728 fixed it for #666: a genuine (non-stale) reported failure sets the
 * failure Notice via `report(cause)`, but never invalidates a `loadGen`
 * generation an earlier `reload()` (from `createBook`, `addChapter`, or a
 * prior `renameBook`) may still have in flight. If that load resolves
 * afterward, its success path's
 * `setFailure((prev) => (prev?.fromDelete ? prev : null))` reads the failure
 * as stale-and-current and silently clears the Notice the rename failure just
 * set — #732 (this PR).
 *
 * This is a source-text gate. It does not mount `useBooks`, run its effects
 * or schedule IndexedDB reads against a reported failure. The static render
 * helper in `tests/render.ts` does not exercise those timings either.
 *
 * WHAT IT PROVES, EXACTLY: that `renameBook`'s `catch (cause)` block bumps
 * `loadGen.current` inside the callback `reportUnlessStale` reports through,
 * in the same synchronous step as `report` — a bump after the `await` left a
 * microtask window for a load continuation (Frank, #733 round 1). It does NOT
 * prove the in-flight load actually loses the race in a running browser, or
 * that the Notice is observed staying up on a device.
 */
describe("renameBook invalidates an in-flight load on a reported failure (#732, mirrors #728's addChapter fix)", () => {
  const sourceUrl = new URL("../src/hooks/use-books.ts", import.meta.url);

  const code = stripComments(readFileSync(sourceUrl, "utf8"));

  const declStart = code.indexOf("const renameBook = useCallback");
  if (declStart === -1) {
    throw new Error(
      "renameBook declaration not found — has it been renamed or moved?"
    );
  }
  const braceOpen = code.indexOf("{", declStart);
  if (braceOpen === -1) {
    throw new Error("renameBook's opening brace not found");
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
    throw new Error("renameBook's closing brace not found");
  }
  const renameBookBody = code.slice(braceOpen, braceClose + 1);

  const catchStart = renameBookBody.indexOf("catch (cause)");
  if (catchStart === -1) {
    throw new Error("renameBook's catch (cause) block not found");
  }
  const catchBody = renameBookBody.slice(catchStart);

  it("calls reportUnlessStale and branches on `swallowed`, unchanged", () => {
    expect(catchBody).toMatch(
      /const \{ swallowed \} = await reportUnlessStale\(\s*cause,\s*bookId,/
    );
    expect(catchBody).toMatch(/if\s*\(\s*swallowed\s*\)/);
  });

  it("bumps loadGen.current inside the report callback, not after the await or in the swallowed branch", () => {
    // The swallowed branch (patch-and-reload) is unchanged from before #732 —
    // asserted here so a future edit that moved the bump INSIDE that branch
    // (defeating the point: a swallow already calls `reload()`, which bumps
    // `loadGen` itself) fails this test rather than passing on a coincidence.
    const swallowedBlockMatch = catchBody.match(
      /if\s*\(\s*swallowed\s*\)\s*\{([^{}]*)\}/
    );
    expect(swallowedBlockMatch).not.toBeNull();
    const swallowedBlock = swallowedBlockMatch![1];
    expect(swallowedBlock).not.toMatch(/loadGen\.current/);
    expect(swallowedBlock).toMatch(/dropBookCard\(\s*prev,\s*bookId\s*\)/);
    expect(swallowedBlock).toMatch(/reload\(\)/);

    // Bumped in the same synchronous step that sets the Notice, and once.
    expect(catchBody).toMatch(
      /reportUnlessStale\(\s*cause,\s*bookId,\s*\(\s*(\w+)\s*\)\s*=>\s*\{\s*loadGen\.current\s*\+=\s*1;\s*report\(\s*\1\s*\);?\s*\}\s*,?\s*\)/
    );
    expect(catchBody.match(/loadGen\.current/g)).toHaveLength(1);
  });
});
