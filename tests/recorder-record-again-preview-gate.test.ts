import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { region, stripComments, uniqueIndexOf } from "./support";

/**
 * The clipboard's discard-clip confirm (#862) shares the same `EraseConfirm`
 * mount `recorder.tsx`'s record-again call site does, and can carry a stale
 * `confirmFrom === "rerecord"` left over from an earlier, cancelled
 * record-again — nothing resets `confirmFrom` back to `"erase"` except
 * `openMenu`. `badge` already guards against exactly this staleness with its
 * own `confirmFor !== "clip"` term (#1022); `g5Preview` (#979 remainder)
 * reuses the same term for the same reason.
 *
 * Reaching that state by interaction needs a clipboard cut and edit mode —
 * `tests/recorder-discard-clip.test.ts`'s own docblock gives the identical
 * reason for reading this file's source rather than rendering it — so this
 * checks the same way: `g5Preview`'s gate names the same
 * `confirmFor !== "clip"` term `badge`'s does.
 */
const recorder = stripComments(
  readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  )
);

describe("g5Preview is gated against the clipboard discard the same way badge is (#979)", () => {
  it('names the same confirmFor !== "clip" term badge\'s own gate does', () => {
    const anchor = uniqueIndexOf(
      recorder,
      "const g5Preview: EraseConfirmPreview | undefined ="
    );
    const gate = region(recorder, {
      from: anchor,
      to: recorder.indexOf("? {", anchor),
    });
    expect(gate).toMatch(/g5 && confirmFor !== "clip"/);
  });
});
