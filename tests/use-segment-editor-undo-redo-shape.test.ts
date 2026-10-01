import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { region, stripComments } from "./support";

/**
 * `useSegmentEditor` is a hook this file exercises only as source text, not
 * mounted: nothing here invokes its returned `undo`/`redo` directly. It is
 * a source-shape gate, indexOf-isolated like
 * `tests/nav-commit-close-race-guards.test.ts`.
 *
 * Comments are stripped BEFORE anything is searched (#822): every case below
 * makes a positive match, and unstripped, a comment naming `opUndone(log)`
 * inside `undo()` satisfies it while the live read goes back to an inline
 * index the `not.toMatch` beside it does not happen to spell.
 */
const source = stripComments(
  readFileSync(
    new URL("../src/hooks/use-segment-editor.ts", import.meta.url),
    "utf8"
  )
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
    const body = region(source, { from: start, to: end });
    expect(body).toMatch(/opUndone\(log\)/);
    expect(body).not.toMatch(/log\.ops\[log\.cursor - 1\]/);
  });

  it("redo() reads the stepped-over op through opRedone(log), not an inline index", () => {
    const start = source.indexOf(
      "const redo = useCallback((): EditOp | null => {"
    );
    const end = source.indexOf(
      "}, [log, base, working, runEdit, clearSelection, clipboard]);",
      start
    );
    const body = region(source, { from: start, to: end });
    expect(body).toMatch(/opRedone\(log\)/);
    expect(body).not.toMatch(/log\.ops\[log\.cursor\]/);
  });
});
