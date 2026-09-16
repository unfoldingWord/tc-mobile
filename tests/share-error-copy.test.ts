import { describe, expect, it } from "vitest";

import { shareErrorText } from "@/components/share-error-copy";
import { strings } from "@/components/strings";
import { EncoderStalledError } from "@/hooks/mp3-codec";
import { classifyPrepareError } from "@/hooks/share-flow";

/**
 * A stalled encoder during Share says so where the translator is looking
 * (George R2 P3-2).
 *
 * The Books shelf carries the "restart the app" line, but a Share Chapter runs
 * from the Segments screen, where the shelf is unmounted. So the share menu has
 * to carry it for the one failure that needs it. Two pure seams are pinned: the
 * hook's classification, and the copy each screen shows.
 */
describe("classifyPrepareError", () => {
  it("singles out a stalled encoder", () => {
    expect(classifyPrepareError(new EncoderStalledError(15_000))).toBe(
      "encoder"
    );
  });

  it("leaves every other failure as the generic `failed`", () => {
    expect(classifyPrepareError(new Error("lame blew up"))).toBe("failed");
    expect(classifyPrepareError("a string")).toBe("failed");
    expect(classifyPrepareError(undefined)).toBe("failed");
  });
});

describe("shareErrorText", () => {
  it("says nothing when there is nothing to say", () => {
    expect(shareErrorText(null, "chapter")).toBeNull();
    expect(shareErrorText(null, "book")).toBeNull();
  });

  it("keeps the existing chapter and book copy for the old codes", () => {
    expect(shareErrorText("nothing", "chapter")).toBe(strings.shareNothing);
    expect(shareErrorText("failed", "chapter")).toBe(strings.shareFailed);
    expect(shareErrorText("nothing", "book")).toBe(strings.shareBookNothing);
    expect(shareErrorText("failed", "book")).toBe(strings.shareBookFailed);
  });

  it("gives a stalled encoder its own line, on BOTH screens, naming the restart", () => {
    // A nested ternary ending in `: null` is how a new code used to go silent;
    // this is the case that would have shown nothing at all.
    expect(shareErrorText("encoder", "chapter")).toBe(
      strings.shareEncoderStopped
    );
    expect(shareErrorText("encoder", "book")).toBe(strings.shareEncoderStopped);
    expect(strings.shareEncoderStopped).toMatch(/restart the app/);
    expect(strings.shareEncoderStopped).not.toMatch(/error|encoder|MP3/i);
  });
});
