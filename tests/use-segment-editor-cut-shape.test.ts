import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `useSegmentEditor` is a hook this file exercises only as source text, not
 * mounted: nothing here invokes its returned `cut` directly. A jsdom
 * hook-mount harness now exists elsewhere in this repo
 * (`tests/use-audio-session-supersession.test.ts`, #735/#739) that could
 * reach `cut` directly, but nothing applies it to `useSegmentEditor` yet
 * (#549). This stays a source-shape gate, the same comment-stripping-free,
 * indexOf-isolated idiom `tests/nav-commit-close-race-guards.test.ts` and
 * `tests/recorder-resume-race.test.ts`'s "the wiring, not just the helper"
 * section use for the same reason.
 */
const source = readFileSync(
  new URL("../src/hooks/use-segment-editor.ts", import.meta.url),
  "utf8"
);

/**
 * #512 George R1 P3: `wholeSampleRange` (`lib/audio/edit.ts`) claims to be
 * "the ONE place" a fractional selection becomes the whole-sample bounds a
 * buffer edit acts on — but `cut()` stored and returned `clampRange`'s still
 * -fractional range on the `EditOp`, one caller reimplementing the
 * truncation question instead of sharing the answer. `onCut`'s pan writer
 * (`panAfterCutRest` then, `panAfterCutCollapse` since #613) happens to
 * truncate again downstream, so nothing broke live, but the
 * stored op itself was not actually whole-sample, and the interface's own
 * JSDoc ("the range removed (normalised)") did not say what "normalised"
 * left out.
 */
describe("useSegmentEditor.cut stores and returns a whole-sample range (#512 George R1 P3)", () => {
  const start = source.indexOf(
    "const cut = useCallback((): SampleRange | null => {"
  );
  const end = source.indexOf(
    "}, [selection, working, log, base, runEdit, clipboard, clearSelection]);",
    start
  );

  it("cut() exists in the expected shape (sanity check the isolation below is reading the right function)", () => {
    expect(
      start,
      "no `const cut = useCallback(...)` in use-segment-editor.ts"
    ).toBeGreaterThan(-1);
    expect(
      end,
      "no matching cut() dependency array closing the callback"
    ).toBeGreaterThan(start);
  });

  const body = source.slice(start, end);

  it("routes the selection through wholeSampleRange before it is stored on the EditOp or returned", () => {
    // RED-FIRST kill: on PR #512's pre-fix head this line was
    // `const range = clampRange(selection, working.length);` — no
    // `wholeSampleRange` wrap — so this fails until the stored/returned
    // range is truncated the same way `sliceRange`/`cut` truncate it.
    expect(body).toMatch(
      /const range = wholeSampleRange\(clampRange\(selection, working\.length\)\);/
    );
  });

  it("the interface docblock names the range as whole-sample, not merely 'normalised'", () => {
    const docStart = source.indexOf(
      "Cut the selection to the clipboard, then drop the frame."
    );
    expect(
      docStart,
      "no cut() JSDoc found on the SegmentEditor interface"
    ).toBeGreaterThan(-1);
    const docEnd = source.indexOf("*/", docStart);
    const doc = source.slice(docStart, docEnd);
    expect(doc).toMatch(/whole-sample/);
  });
});
