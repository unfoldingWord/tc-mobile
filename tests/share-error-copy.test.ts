import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shareErrorText,
  shareGapText,
  shareProgressText,
} from "@/components/share-error-copy";
import { strings } from "@/components/strings";
import { EncoderFailedError, EncoderStalledError } from "@/hooks/mp3-codec";
import { subscribeToFailures } from "@/hooks/report-failure";
import {
  HIDDEN,
  type ShareProgress,
  type ShareSettled,
} from "@/hooks/share-progress";
import { classifyPrepareError, settlePrepareFailure } from "@/hooks/share-flow";

/** Source-shape reads, because there is no renderer here (#197). */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

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

/**
 * The words under the modal's glyph (#491). Secondary by design — the glyph
 * is the signal — and pinned here because the two new success-side strings
 * are the ones that could overclaim.
 */
describe("shareProgressText", () => {
  const busy = (work: "prepare" | "send"): ShareProgress => ({
    phase: "busy",
    work,
    since: 0,
    pending: null,
  });
  const outcome = (
    settled: ShareSettled,
    gap?: { missing: number; partial: number }
  ): ShareProgress => ({
    phase: "outcome",
    settled,
    since: 0,
    gap,
  });

  it("says nothing when hidden", () => {
    expect(shareProgressText(HIDDEN, "chapter")).toBeNull();
    expect(shareProgressText(HIDDEN, "book")).toBeNull();
  });

  it("uses the existing preparing copy for each scope while tap 1 works", () => {
    expect(shareProgressText(busy("prepare"), "chapter")).toBe(
      strings.sharePreparing
    );
    expect(shareProgressText(busy("prepare"), "book")).toBe(
      strings.shareBookPreparing
    );
  });

  it("says the sheet is opening while tap 2 works, on both scopes", () => {
    expect(shareProgressText(busy("send"), "chapter")).toBe(
      strings.shareHandingOver
    );
    expect(shareProgressText(busy("send"), "book")).toBe(
      strings.shareHandingOver
    );
  });

  it("keeps the existing nothing / failed / encoder copy under the outcome glyph", () => {
    expect(shareProgressText(outcome("nothing"), "chapter")).toBe(
      strings.shareNothing
    );
    expect(shareProgressText(outcome("nothing"), "book")).toBe(
      strings.shareBookNothing
    );
    expect(shareProgressText(outcome("failed"), "chapter")).toBe(
      strings.shareFailed
    );
    expect(shareProgressText(outcome("failed"), "book")).toBe(
      strings.shareBookFailed
    );
    expect(shareProgressText(outcome("encoder"), "chapter")).toBe(
      strings.shareEncoderStopped
    );
  });

  it("gives sent and dismissed their own lines", () => {
    expect(shareProgressText(outcome("sent"), "chapter")).toBe(
      strings.shareSent
    );
    expect(shareProgressText(outcome("sent"), "book")).toBe(strings.shareSent);
    expect(shareProgressText(outcome("dismissed"), "chapter")).toBe(
      strings.shareDismissed
    );
    expect(shareProgressText(outcome("dismissed"), "book")).toBe(
      strings.shareDismissed
    );
    expect(strings.shareSent).not.toBe(strings.shareDismissed);
  });

  it("partial reuses the handed-over line, then names the gap — chapter scope (P1, this lane's own review round)", () => {
    expect(
      shareProgressText(
        outcome("partial", { missing: 1, partial: 0 }),
        "chapter"
      )
    ).toBe(`${strings.shareSent} ${strings.shareMissing(1)}`);
    expect(
      shareProgressText(
        outcome("partial", { missing: 3, partial: 0 }),
        "chapter"
      )
    ).toBe(`${strings.shareSent} ${strings.shareMissing(3)}`);
  });

  it("partial names the gap in BOOK terms, combining both grains when both are non-zero", () => {
    expect(
      shareProgressText(outcome("partial", { missing: 2, partial: 0 }), "book")
    ).toBe(`${strings.shareSent} ${strings.shareBookMissing(2)}`);
    expect(
      shareProgressText(outcome("partial", { missing: 0, partial: 2 }), "book")
    ).toBe(`${strings.shareSent} ${strings.shareBookPartial(2)}`);
    expect(
      shareProgressText(outcome("partial", { missing: 1, partial: 2 }), "book")
    ).toBe(`${strings.shareSent} ${strings.shareBookMissingAndPartial(1, 2)}`);
  });

  it("partial is never the plain sent line — the whole point of the outcome", () => {
    const text = shareProgressText(
      outcome("partial", { missing: 1, partial: 0 }),
      "chapter"
    );
    expect(text).not.toBe(strings.shareSent);
    expect(text).toMatch(strings.shareSent);
  });

  it("the success copy says HANDED OVER, never delivered, and names no destination", () => {
    // `navigator.share` resolving proves the bytes reached the OS sheet, not
    // that any app received them — some targets drop the file while `share`
    // still resolves (the R-B7 comment in `send()`). On Android native the
    // resolve can even follow a Back after the activity stopped
    // (`resolveProvesDelivery`). So the words must stop at the sheet.
    for (const line of [
      strings.shareSent,
      strings.shareDismissed,
      strings.shareUnproven,
      strings.shareHandingOver,
    ]) {
      expect(line).not.toMatch(/deliver/i);
      expect(line).not.toMatch(/sent to|shared to|received/i);
      expect(line).not.toMatch(/WhatsApp|Drive|Files|Telegram|Signal/i);
    }
    expect(strings.shareSent).toMatch(/share sheet/i);
  });

  /**
   * `unproven` (Frank a446708 P2): a resolved native Android send this
   * platform cannot vouch for. Its own line, distinct from both `sent` (which
   * would overclaim) and `dismissed` (which would wrongly claim nothing went)
   * — same wording test both existing outcomes already had to pass.
   */
  it("gives an unproven send its own line, distinct from sent and dismissed, on both scopes", () => {
    expect(shareProgressText(outcome("unproven"), "chapter")).toBe(
      strings.shareUnproven
    );
    expect(shareProgressText(outcome("unproven"), "book")).toBe(
      strings.shareUnproven
    );
    expect(strings.shareUnproven).not.toBe(strings.shareSent);
    expect(strings.shareUnproven).not.toBe(strings.shareDismissed);
    expect(strings.shareUnproven).not.toMatch(/could not|failed/i);
  });
});

/**
 * `shareGapText` (George r1 P3-5, #491): the ready-state gap Notice each
 * screen shows once a share is armed used to compose the SAME words the
 * outcome glyph's `partial` settle already builds through this function —
 * inline, at each call site, duplicating exactly the drift `strings.ts`'s own
 * header on `shareBookPartial` warns against. Exported so both screens (and
 * `shareProgressText` above) call the one function.
 */
describe("shareGapText", () => {
  it("chapter scope always reads the plain missing count — the finer grain never applies", () => {
    expect(shareGapText({ missing: 1, partial: 0 }, "chapter")).toBe(
      strings.shareMissing(1)
    );
    // Chapter share never sets `partial` (see `share-flow.ts`'s
    // `PreparedShare`), but the function still must not read it if it did.
    expect(shareGapText({ missing: 1, partial: 5 }, "chapter")).toBe(
      strings.shareMissing(1)
    );
  });

  it("book scope combines both grains when both are non-zero", () => {
    expect(shareGapText({ missing: 2, partial: 0 }, "book")).toBe(
      strings.shareBookMissing(2)
    );
    expect(shareGapText({ missing: 0, partial: 3 }, "book")).toBe(
      strings.shareBookPartial(3)
    );
    expect(shareGapText({ missing: 1, partial: 2 }, "book")).toBe(
      strings.shareBookMissingAndPartial(1, 2)
    );
  });

  it("an undefined gap reads as all-zero", () => {
    expect(shareGapText(undefined, "chapter")).toBe(strings.shareMissing(0));
  });

  it("both screens call this function for their own ready-state gap Notice, not a hand-rolled composition (George r1 P3-5)", () => {
    const segments = read("src/components/segments-screen.tsx");
    const books = read("src/components/books-screen.tsx");
    expect(segments).toMatch(
      /shareGapText\(\s*\{ missing: share\.missing, partial: 0 \},\s*"chapter"\s*\)/
    );
    expect(books).toMatch(
      /shareGapText\(\s*\{ missing: bookShare\.missing, partial: bookShare\.partialSegments \},\s*"book"\s*\)/
    );
  });
});
