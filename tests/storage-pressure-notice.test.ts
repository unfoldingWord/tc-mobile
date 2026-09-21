import { describe, expect, it } from "vitest";

import {
  storagePressureNotice,
  type StoragePressureGate,
} from "@/components/storage-pressure-notice";
import { strings } from "@/components/strings";

/**
 * What the Books shelf says for #247's storage-pressure marker.
 *
 * The whole gate is here, not just a tone lookup, for the same reason
 * `encoder-notice.test.ts` pins `encoderNotice` directly: this repo has no
 * DOM test runner, so a mount predicate left in JSX is pinned by nothing.
 * #540 is what this file exists to make impossible to repeat — the core PR's
 * (#537) own published example would have painted the band name on screen in
 * `Notice`'s default `alert` tone.
 *
 * Round 1 review of #542 (Frank P2-2 / George P3-5) found that first pass had
 * lifted the tone/text decision here but left the VISIBILITY decision behind
 * in `books-screen.tsx`'s own untested JSX `&&`. The cases below pin the
 * exclusivity gate that moved into this function: hidden when the shelf is
 * empty (George P2-2), hidden while the shelf's acute trio is live
 * (George P2-4), and visible otherwise for both bands.
 */

/** A gate with nothing suppressing the line — every case below starts from
 * this and flips exactly the one thing it means to test. */
const openGate: StoragePressureGate = {
  hasContent: true,
  loading: false,
  loadFailed: false,
  deleteFailed: false,
};

describe("storagePressureNotice", () => {
  it("says nothing when there is no marker", () => {
    expect(storagePressureNotice(null, openGate)).toBeNull();
  });

  it("shows the low line", () => {
    expect(storagePressureNotice("low", openGate)).toEqual({
      tone: "info",
      text: strings.storageLow,
    });
  });

  it("shows the critical line", () => {
    expect(storagePressureNotice("critical", openGate)).toEqual({
      tone: "info",
      text: strings.storageCritical,
    });
  });

  it("is a heads-up, NOT a failure — never the alert tone", () => {
    // This is the exact defect #540 found in #537's published example: the
    // discriminant string type-checks as `Notice`'s children, and `Notice`
    // defaults `tone` to `"alert"` when a caller forgets to set one.
    expect(storagePressureNotice("low", openGate)?.tone).not.toBe("alert");
    expect(storagePressureNotice("critical", openGate)?.tone).not.toBe("alert");
  });

  it("never puts a raw byte count or percentage in front of a translator", () => {
    // pressure.ts's docblock: the estimate is coarse and per-origin, so
    // nothing may render the numbers it is computed from.
    const low = storagePressureNotice("low", openGate)?.text ?? "";
    const critical = storagePressureNotice("critical", openGate)?.text ?? "";
    expect(low).not.toMatch(/\d/);
    expect(critical).not.toMatch(/\d/);
  });

  it("says nothing when the shelf is empty, even with a marker (George P2-2, #542)", () => {
    // A book deleted down to an empty shelf must not keep showing a
    // device-storage warning over the empty-shelf invite — the same
    // retraction `storageNotPersisted`'s sibling line already makes.
    expect(
      storagePressureNotice("low", { ...openGate, hasContent: false })
    ).toBeNull();
    expect(
      storagePressureNotice("critical", { ...openGate, hasContent: false })
    ).toBeNull();
  });

  it("says nothing while the shelf is loading (George P2-4, #542)", () => {
    expect(
      storagePressureNotice("critical", { ...openGate, loading: true })
    ).toBeNull();
  });

  it("says nothing after a failed shelf load (George P2-4, #542)", () => {
    expect(
      storagePressureNotice("critical", { ...openGate, loadFailed: true })
    ).toBeNull();
  });

  it("says nothing after a failed delete (George P2-4, #542)", () => {
    // The acute trio, not the wider `noticeText` the sibling slot renders:
    // `noticeText` also covers a failed `addChapter`, a quota-shaped write
    // this feature exists to warn about, and gating on it would retract the
    // warning exactly when it matters most. `deleteFailed` is part of the
    // trio itself, so it is still checked here.
    expect(
      storagePressureNotice("critical", { ...openGate, deleteFailed: true })
    ).toBeNull();
  });

  it("shows the line again once the acute trio clears, with content present", () => {
    expect(storagePressureNotice("low", openGate)).not.toBeNull();
  });
});
