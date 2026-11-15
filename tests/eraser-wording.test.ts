import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";

/**
 * The segment editor's eraser wording (#1220, #1233). Every other test reads
 * these entries through the table, so none of them would notice the words
 * changing; this one pins the exact text the requirements owner chose.
 * The confirm title carries no question mark on purpose.
 */
describe("eraser wording (#1220)", () => {
  it("names the eraser row and its spoken label", () => {
    expect(strings.eraseSegment).toBe("Reset segment and start over");
  });

  it("keeps the tile caption as one word of that name", () => {
    expect(strings.eraseSegment.split(" ")).toContain(strings.tileErase);
  });

  it("titles the confirm dialog with the same line", () => {
    expect(strings.eraseConfirmTitle).toBe("Reset segment and start over");
  });
});

/**
 * One verb for removing a recording (#1233 items 8 and 9): the requirements
 * owner's answer was "Use "Reset recording"". The confirm button takes those
 * words; every other line that names removing a segment's recording says
 * "reset", never "clear", so a translator never confirms a Reset by pressing
 * Clear.
 */
describe("one verb for removing a recording (#1233)", () => {
  it("labels the confirm button with the owner's words", () => {
    expect(strings.eraseConfirm).toBe("Reset recording");
  });

  it("names the record bar's eraser with the same verb", () => {
    expect(strings.rerecord).toBe("Reset and record again");
    expect(strings.rerecord.split(" ")).toContain(strings.tileErase);
  });

  const removing = {
    eraseConfirm: strings.eraseConfirm,
    rerecord: strings.rerecord,
    eraseFailed: strings.eraseFailed,
    clearFailed: strings.clearFailed,
    nothingStored: strings.nothingStored,
    stopToErase: strings.stopToErase,
    loadFailedBody: strings.loadFailedBody,
  };

  it("asks for Try again first and offers Reset only as the fallback (#1933)", () => {
    // DRI pick (verbatim): "Try again first, Reset as fallback (Recommended)".
    expect(strings.loadFailedBody).toBe(
      "Your recording is safe. Try again. If it still won't open, you can reset it from the list."
    );
    const sentences = strings.loadFailedBody.split(/(?<=\.)\s+/);
    const retryAt = sentences.indexOf(`${strings.loadRetry}.`);
    const resetAt = sentences.findIndex((s) => /\breset\b/i.test(s));
    expect(retryAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(retryAt);
    expect(sentences[resetAt]).toMatch(/^If it still won't open,/);
  });

  it.each(Object.entries(removing))(
    "%s says reset, not clear",
    (_key, text) => {
      expect(text).not.toMatch(/\bclear/i);
      expect(text).toMatch(/\breset\b/i);
    }
  );
});
