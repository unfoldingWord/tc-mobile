import { describe, expect, it } from "vitest";

import { createShareHandoff } from "@/hooks/share-handoff";

/**
 * The staged-file ownership handoff (#365): what is armed, and whether a
 * send currently owns it. These tests call the extracted handoff directly;
 * they do not mount `useShareFlow` or exercise the native share sheet.
 *
 * A reset must not discard a file already owned by a send: tapping the scrim
 * after Share now must not leave FileProvider serving a deleted file. The
 * `dropArmed()` cases cover ownership before and after `take()`.
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
