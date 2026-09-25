import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `useSegmentEditor` is a hook this file exercises only as source text, not
 * mounted: nothing here invokes its returned `undo`/`redo` directly. It is
 * a source-shape gate, in the same comment-stripping-free, indexOf-isolated
 * idiom `tests/nav-commit-close-race-guards.test.ts` and
 * `tests/recorder-resume-race.test.ts`'s "the wiring, not just the helper"
 * section use.
 */
const source = readFileSync(
  new URL("../src/hooks/use-segment-editor.ts", import.meta.url),
  "utf8"
);

/**
 * #512 George R1 P2-2: `undo`/`redo`'s "which op did this step pass over"
 * choice is now the shared, separately-tested `opUndone`/`opRedone` pair
 * from `lib/audio/edit-log.ts` (see `tests/audio-edit-log.test.ts` and
 * `tests/recorder-stage.test.ts`), not an inline `log.ops[log.cursor - 1]`/
 * `log.ops[log.cursor]` read duplicated in the hook. This pins the WIRING —
 * that the hook actually calls the tested function — which the pure-function
 * tests cannot see for themselves.
 */
describe("useSegmentEditor.undo/redo call the shared opUndone/opRedone helpers (#512 George R1 P2-2)", () => {
  it("imports opUndone and opRedone from lib/audio/edit-log", () => {
    expect(source).toMatch(/opUndone/);
    expect(source).toMatch(/opRedone/);
    expect(source).toMatch(/from "@\/lib\/audio\/edit-log"/);
  });

  it("undo() reads the stepped-over op through opUndone(log), not an inline index", () => {
    const start = source.indexOf(
      "const undo = useCallback((): EditOp | null => {"
    );
    const end = source.indexOf(
      "}, [log, applyLog, clearSelection, clipboard]);",
      start
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toMatch(/opUndone\(log\)/);
    expect(body).not.toMatch(/log\.ops\[log\.cursor - 1\]/);
  });

  it("redo() reads the stepped-over op through opRedone(log), not an inline index", () => {
    const start = source.indexOf(
      "const redo = useCallback((): EditOp | null => {"
    );
    const end = source.indexOf(
      "}, [log, applyLog, clearSelection, clipboard]);",
      start
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toMatch(/opRedone\(log\)/);
    expect(body).not.toMatch(/log\.ops\[log\.cursor\]/);
  });
});
