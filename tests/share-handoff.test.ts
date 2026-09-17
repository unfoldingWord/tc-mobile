import { describe, expect, it } from "vitest";

import { createShareHandoff } from "@/hooks/share-handoff";

/**
 * The staged-file ownership handoff (#365, raised independently by both
 * review lenses on #347 round 6 — Frank R6 P2 and George R6 P2, the highest-
 * confidence class this repo's review history has). `useShareFlow` itself
 * needs a renderer to test directly (no jsdom, no `@testing-library/react` —
 * see `tests/menu-row-state.test.ts` / `tests/use-erase-segment.test.ts`), so
 * this covers the one property pulled out into `share-handoff.ts`: what is
 * armed, and whether a send currently owns it.
 *
 * The concrete regression both reviewers described: a later edit moves
 * `discard` back onto `reset()` without the handoff, the translator taps
 * Share now and then the scrim, and `FileProvider` is left serving a deleted
 * file. The two `dropArmed()` cases below are that story, end to end.
 */
describe("createShareHandoff", () => {
  it("arms a value; take() returns it and clears armed", () => {
    const h = createShareHandoff<string>();
    h.arm("file-a");
    expect(h.armed).toBe("file-a");
    expect(h.take()).toBe("file-a");
    expect(h.armed).toBeNull();
  });

  it("take() with nothing armed returns null and does not start sending", () => {
    const h = createShareHandoff<string>();
    expect(h.take()).toBeNull();
    expect(h.sending).toBe(false);
  });

  it("take() marks sending; cleared only by finishSending()", () => {
    const h = createShareHandoff<string>();
    h.arm("file-a");
    h.take();
    expect(h.sending).toBe(true);
    h.finishSending();
    expect(h.sending).toBe(false);
  });

  it("dropArmed() after take() has already claimed the value returns null — a send in flight is never discarded out from under it", () => {
    const h = createShareHandoff<string>();
    h.arm("file-a");
    h.take(); // send() takes ownership synchronously, before any await
    // reset()/unmount racing that send must see nothing to discard.
    expect(h.dropArmed()).toBeNull();
  });

  it("dropArmed() while a value is armed but not yet taken returns it — reset() while ready DOES discard", () => {
    const h = createShareHandoff<string>();
    h.arm("file-a");
    expect(h.dropArmed()).toBe("file-a");
    expect(h.armed).toBeNull();
  });

  it("restore() puts a value back after a retryable send failure, and a later dropArmed() still discards it", () => {
    const h = createShareHandoff<string>();
    h.arm("file-a");
    h.take();
    h.restore("file-a");
    expect(h.dropArmed()).toBe("file-a");
  });

  it("isBusy() is true whenever something is armed OR a send owns the flow", () => {
    const h = createShareHandoff<string>();
    expect(h.isBusy()).toBe(false);
    h.arm("file-a");
    expect(h.isBusy()).toBe(true);
    h.take();
    expect(h.isBusy()).toBe(true); // nothing armed, but a send owns it
    h.finishSending();
    expect(h.isBusy()).toBe(false);
  });
});
