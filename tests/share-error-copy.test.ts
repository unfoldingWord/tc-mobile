import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shareErrorText } from "@/components/share-error-copy";
import { strings } from "@/components/strings";
import { EncoderFailedError, EncoderStalledError } from "@/hooks/mp3-codec";
import { subscribeToFailures } from "@/hooks/report-failure";
import { classifyPrepareError, settlePrepareFailure } from "@/hooks/share-flow";

/**
 * A stalled or failing encoder during Share says so where the translator is
 * looking (George R2 P3-2, R3 P2-1).
 *
 * The Books shelf carries the "restart the app" line, but a Share Chapter runs
 * from the Segments screen, where the shelf is unmounted. So the share menu has
 * to carry it whenever the encoder is the problem. Two pure seams are pinned:
 * the hook's classification (and its report to the sink), and the copy each
 * screen shows.
 */
describe("classifyPrepareError", () => {
  it("singles out a stalled encoder, whatever the health reads", () => {
    const stall = new EncoderStalledError(15_000);
    expect(classifyPrepareError(stall, "ok")).toBe("encoder");
    expect(classifyPrepareError(stall, "failing")).toBe("encoder");
  });

  it("leaves an encoder failure `failed` while the encoder is still healthy", () => {
    // The first and second ordinary failures: the threshold is still absorbing
    // noise, and "try again" is the honest advice.
    expect(
      classifyPrepareError(new EncoderFailedError("lame blew up"), "ok")
    ).toBe("failed");
    expect(classifyPrepareError(new Error("lame blew up"), "ok")).toBe(
      "failed"
    );
    expect(classifyPrepareError("a string", "ok")).toBe("failed");
    expect(classifyPrepareError(undefined, "ok")).toBe("failed");
  });

  it("names the encoder for an ENCODER failure once the encoder is failing (George R3 P2-1)", () => {
    // A purged worker chunk (#182) or a worker that dies on every encode never
    // stalls — it errors. Once those errors have tripped the threshold, the
    // encode has already moved the store, and the only place a translator on
    // Segments can learn that a restart is needed is this line.
    expect(
      classifyPrepareError(
        new EncoderFailedError("worker failed to start"),
        "failing"
      )
    ).toBe("encoder");
  });

  it("does NOT blame the encoder for a storage or export failure, even while it is failing (Frank R4 P2)", () => {
    // An IndexedDB read inside the share `build` throws before any encode is
    // attempted. The encoder may well be broken too, but it did not cause THIS
    // failure, and a "restart the app" line would send the translator after
    // the wrong problem.
    const storage = new DOMException(
      "The transaction was aborted",
      "AbortError"
    );
    expect(classifyPrepareError(storage, "failing")).toBe("failed");
    expect(
      classifyPrepareError(new Error("chapter has no segments"), "failing")
    ).toBe("failed");
  });
});

describe("settlePrepareFailure", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reports the failure to the SINK and returns the code (George R3 P3-4)", () => {
    // The sweep moved onto `reportFailure` in this PR; a Share that failed the
    // same way was still only a `console.error`.
    const reports: { context: string; cause: unknown }[] = [];
    const stop = subscribeToFailures((r) =>
      reports.push({ context: r.context, cause: r.cause })
    );
    try {
      const stall = new EncoderStalledError(15_000);
      expect(settlePrepareFailure(stall, "ok")).toBe("encoder");
      expect(reports).toEqual([{ context: "share-prepare", cause: stall }]);
    } finally {
      stop();
    }
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
