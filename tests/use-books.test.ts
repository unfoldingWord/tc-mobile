import { describe, expect, it, vi } from "vitest";

import { reportUnlessStale } from "@/hooks/use-books";
import type { BookId } from "@/types/domain";

/**
 * `reportUnlessStale` is the plain-async decision `renameBook`/`addChapter`'s
 * catch blocks call before reporting a failure: is this a stale race with an
 * unrelated, already-successful delete (`isStaleBookFailure`, PR #344 round 8),
 * or a genuine failure the screen must speak? It takes its store read as an
 * injected `checkPresent` — the same seam this repo already uses to test the
 * encoder boundary (`AudioCodec`) — so its own failure path (Frank's round-9
 * finding: an unguarded second IndexedDB read could turn a HANDLED mutation
 * failure into an unhandled rejection) can be pinned here without a failing
 * IndexedDB. This is the whole of the decision; the React state (`report`'s
 * actual `setFailure` wiring) is review + on-device surface, as with
 * `use-erase-segment.test.ts`.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;

describe("reportUnlessStale", () => {
  it("reports the ORIGINAL mutation failure, and resolves, when the stale-check read itself fails", async () => {
    // Frank, PR #344 round 9: before this guard, a rejecting `checkPresent`
    // propagated out of `reportUnlessStale` — the mutation's own catch never
    // got to `report` at all, and `addChapter`/`renameBook` rejected instead
    // of resolving to `null`. Both halves are asserted: the call resolves, and
    // it reports the mutation's cause, not the read's.
    const cause = new Error("addChapter failed: quota exceeded");
    const report = vi.fn();
    const checkPresent = vi
      .fn()
      .mockRejectedValue(new Error("IDB unavailable"));

    await expect(
      reportUnlessStale(cause, bookId, report, checkPresent)
    ).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledExactlyOnceWith(cause);
  });

  it("reports as-is when the book is still present", () => {
    const cause = new Error(`No such book: ${bookId}`);
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(true);

    return reportUnlessStale(cause, bookId, report, checkPresent).then(() => {
      expect(report).toHaveBeenCalledExactlyOnceWith(cause);
    });
  });

  it("suppresses the exact stale race: same book id, confirmed gone", async () => {
    const cause = new Error(`No such book: ${bookId}`);
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(false);

    await reportUnlessStale(cause, bookId, report, checkPresent);

    expect(report).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated failure just because the book is gone", async () => {
    const cause = new Error("quota exceeded");
    const report = vi.fn();
    const checkPresent = vi.fn().mockResolvedValue(false);

    await reportUnlessStale(cause, bookId, report, checkPresent);

    expect(report).toHaveBeenCalledExactlyOnceWith(cause);
  });
});
