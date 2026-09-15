import { describe, expect, it } from "vitest";

import {
  EMPTY_STATE_NODE,
  focusTargetAfterDelete,
} from "@/components/delete-focus";
import type { BookId } from "@/types/domain";

/**
 * Where focus goes after a delete (#364).
 *
 * Pinning the CHOICE, in plain Node. The other half of the fix — that focus must
 * move only after the shelf stops being `inert` — is DOM ordering and cannot be
 * observed in this repo at all (no jsdom, no testing-library: #361). Nothing
 * here should be read as covering it.
 */

const id = (n: string) => n as BookId;
const A = id("aaaaaaaa-0000-4000-8000-000000000001");
const B = id("bbbbbbbb-0000-4000-8000-000000000002");
const C = id("cccccccc-0000-4000-8000-000000000003");

describe("focusTargetAfterDelete", () => {
  it("returns the deleted book's own row when the delete FAILED", () => {
    // Nothing moved — the book is still on the shelf. Focus goes back to it, so
    // the translator is on the row the Notice is about.
    expect(focusTargetAfterDelete("failed", B, [A, B, C])).toBe(B);
    // Even as the only book: the row survives a failure.
    expect(focusTargetAfterDelete("failed", A, [A])).toBe(A);
  });

  it("returns the book BELOW the deleted one, which slides into its place", () => {
    expect(focusTargetAfterDelete("ok", A, [A, B, C])).toBe(B);
    expect(focusTargetAfterDelete("ok", B, [A, B, C])).toBe(C);
  });

  it("returns the book ABOVE when the last row was deleted", () => {
    expect(focusTargetAfterDelete("ok", C, [A, B, C])).toBe(B);
    expect(focusTargetAfterDelete("ok", B, [A, B])).toBe(A);
  });

  it("returns the empty state's CTA when the last book on the shelf is deleted", () => {
    // The shelf is now empty, so the invite mounts and its CTA is the only
    // control left to hand focus to.
    expect(focusTargetAfterDelete("ok", A, [A])).toBe(EMPTY_STATE_NODE);
  });

  it("returns the empty state, NOT the first book, for an id that is not on the shelf", () => {
    // The trap this case exists for: `indexOf` gives -1, and `shelf[-1 + 1]` is
    // `shelf[0]` — so the naive expression hands focus to the FIRST book, which
    // looks like a plausible answer and is the wrong row entirely.
    expect(focusTargetAfterDelete("ok", C, [A, B])).toBe(EMPTY_STATE_NODE);
    expect(focusTargetAfterDelete("ok", A, [])).toBe(EMPTY_STATE_NODE);
  });

  it("never returns the deleted book itself on success", () => {
    // A row that is about to unmount can never be the focus target: focusing it
    // is the silent no-op this whole function exists to avoid.
    for (const shelf of [[A, B, C], [A, B], [A]]) {
      for (const deleted of shelf) {
        expect(focusTargetAfterDelete("ok", deleted, shelf)).not.toBe(deleted);
      }
    }
  });
});
