import { describe, expect, it } from "vitest";
import { strings } from "@/lib/strings";

/**
 * The segment editor's eraser wording (#1220). Every other test reads these
 * two entries through the table, so none of them would notice the words
 * changing; this one pins the exact text the requirements owner chose.
 * The confirm title carries no question mark on purpose.
 */
describe("eraser wording (#1220)", () => {
  it("names the eraser row and its spoken label", () => {
    expect(strings.eraseSegment).toBe("Reset segment and start over");
  });

  it("keeps the tile caption as one word of that name", () => {
    expect(strings.tileErase).toBe("Reset");
  });

  it("titles the confirm dialog with the same line", () => {
    expect(strings.eraseConfirmTitle).toBe("Reset segment and start over");
  });
});
