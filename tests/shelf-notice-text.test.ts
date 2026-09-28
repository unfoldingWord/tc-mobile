import { describe, expect, it } from "vitest";

import { shelfNoticeText } from "@/components/shelf-notice-text";
import { strings } from "@/lib/strings";

/**
 * #894: the Books shelf's failure Notice. A failed delete speaks in its own
 * words, except on a full disk, where it names the condition the way every
 * other write does.
 */
describe("shelfNoticeText", () => {
  it("says nothing when there is no failure", () => {
    expect(shelfNoticeText(null, false)).toBeNull();
  });

  it("speaks a failed delete in the delete's own words", () => {
    expect(shelfNoticeText("saveFailed", true)).toBe(strings.deleteBookFailed);
  });

  it("speaks a failed delete on a full disk as noRoom", () => {
    expect(shelfNoticeText("noRoom", true)).toBe(strings.noRoom);
  });

  it("speaks any other failure by its key", () => {
    expect(shelfNoticeText("saveFailed", false)).toBe(strings.saveFailed);
    expect(shelfNoticeText("loadFailed", false)).toBe(strings.loadFailed);
    expect(shelfNoticeText("noRoom", false)).toBe(strings.noRoom);
  });
});
