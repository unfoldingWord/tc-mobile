import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
 * WHY A STRUCTURAL GATE AND NOT A BEHAVIOURAL TEST. `renameBook` is a
 * `useCallback` inside `useBooks()`, entangled with `setBooks`, `reload` and
 * `report` — hook-owned React state this Node-only suite (no jsdom, no
 * renderer, no timers driving a real `useEffect`) cannot exercise. #728's own
 * PR body says exactly this of the identical `addChapter` fix: "this repo's
 * render harness (`tests/render.ts`) explicitly does not run effects ...
 * nothing here drives IndexedDB read timing against a hook's own
 * `useEffect`. The fix is verified by tracing the code paths ... not by an
 * automated red test or a device run." Same shape, same limit — this file
 * pins the source text instead, the same trade `use-books-delete-failure-gate
 * .test.ts` makes for `deleteBook`'s funnel call.
 *
 * WHAT IT PROVES, EXACTLY: that `renameBook`'s `catch (cause)` block bumps
 * `loadGen.current` in the branch where `reportUnlessStale` reports (does
 * NOT swallow) the failure — mirroring `addChapter`'s `else { loadGen.current
 * += 1; }` from #728. It does NOT prove the in-flight load actually loses the
 * race in a running browser, or that the Notice is observed staying up on a
 * device.
 */
describe("renameBook invalidates an in-flight load on a reported failure (#732, mirrors #728's addChapter fix)", () => {
  const sourceUrl = new URL("../src/hooks/use-books.ts", import.meta.url);

  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

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
      /const \{ swallowed \} = await reportUnlessStale\(\s*cause,\s*bookId,\s*report\s*\)/
    );
    expect(catchBody).toMatch(/if\s*\(\s*swallowed\s*\)/);
  });

  it("bumps loadGen.current in the non-swallowed (reported) branch, not inside the swallowed branch", () => {
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

    // The bump must be reachable when `swallowed` is false — an `else`
    // attached to the same `if (swallowed)` is the only shape checked here,
    // matching #728's `addChapter` fix exactly.
    const elseBlockMatch = catchBody.match(
      /if\s*\(\s*swallowed\s*\)\s*\{[^{}]*\}\s*else\s*\{([^{}]*)\}/
    );
    expect(elseBlockMatch).not.toBeNull();
    const elseBlock = elseBlockMatch![1];
    expect(elseBlock).toMatch(/loadGen\.current\s*\+=\s*1/);
  });
});
