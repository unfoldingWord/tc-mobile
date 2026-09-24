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
 * `encoder-notice.test.ts` pins `encoderNotice` directly: no test currently
 * mounts `BooksScreen` and this effectful hook graph (`useStoragePressure`,
 * `useBooks`, …) through a DOM render — `tests/render.ts` (jsdom +
 * `renderToStaticMarkup`, #197) exists, but nothing wires it to this screen —
 * so a mount predicate left in JSX is pinned by nothing. #540 is what this
 * file exists to make impossible to repeat — the core PR's (#537) own
 * published example would have painted the band name on screen in `Notice`'s
 * default `alert` tone.
 *
 * Round 1 review of #542 (Frank P2-2 / George P3-5) found that first pass had
 * lifted the tone/text decision here but left the VISIBILITY decision behind
 * in `books-screen.tsx`'s own untested JSX `&&`. The cases below pin the
 * exclusivity gate that moved into this function: hidden when the shelf is
 * empty (George P2-2), hidden while the shelf's acute trio is live
 * (George P2-4), and visible otherwise for both bands — each in the tone the
 * DRI decided for its band (Seth, 2026-09-24): `"low"` in `info`, `"critical"`
 * in `alert`.
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

  it("shows the low line, in the info tone", () => {
    expect(storagePressureNotice("low", openGate)).toEqual({
      tone: "info",
      text: strings.storageLow,
    });
  });

  it("shows the critical line, in the alert tone (DRI decision, 2026-09-24)", () => {
    expect(storagePressureNotice("critical", openGate)).toEqual({
      tone: "alert",
      text: strings.storageCritical,
    });
  });

  it("never puts the low band in the failure tone", () => {
    // The low band is a heads-up with time to act, not a failure — it must
    // never wear `alert`, which is `Notice`'s own DEFAULT tone (the exact
    // shape #540 found: the discriminant string type-checks as `Notice`'s
    // children, and a caller who forgets to set `tone` gets `alert` for
    // free). `"critical"` deliberately does NOT repeat this assertion — see
    // the DRI decision above and `storage-pressure-notice.ts`'s docblock: a
    // critical condition in the same tone as a low one does not read as more
    // urgent, so `"critical"` now wears `alert` on purpose, not by accident.
    expect(storagePressureNotice("low", openGate)?.tone).not.toBe("alert");
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

  // The next two cases pair `loading: true` / `loadFailed: true` with
  // `hasContent: true` (via `openGate`). That combination is one the pure
  // function accepts and must still retract on, but the real caller
  // (`books-screen.tsx`) can never actually construct it: `hasContent`
  // requires `loaded === true` (`hasContent = loaded && books.length > 0`),
  // `loadFailed` requires `loaded === false`
  // (`loadFailed = error !== null && !loaded`), and `loading`
  // (`use-books.ts`) only ever transitions back to `false` inside the same
  // load effect that, on the success path, has already called `setLoaded
  // (true)` moments earlier in the same batched update — so no render can
  // observe `loading: true` once `loaded`, and therefore `hasContent`, is
  // true. These two were previously named for George P2-4 as if they pinned
  // Books-reachable behavior; they don't, so they are named here for what
  // they actually check: the gate FUNCTION's own contract on `loading` and
  // `loadFailed` in isolation, not a state `books-screen.tsx` can produce.
  it("retracts on `loading` alone, as a function contract (not a books-screen-reachable state)", () => {
    expect(
      storagePressureNotice("critical", { ...openGate, loading: true })
    ).toBeNull();
  });

  it("retracts on `loadFailed` alone, as a function contract (not a books-screen-reachable state)", () => {
    expect(
      storagePressureNotice("critical", { ...openGate, loadFailed: true })
    ).toBeNull();
  });

  it("says nothing after a failed delete (George P2-4, #542)", () => {
    // Unlike the two cases above, THIS combination is reachable from
    // `books-screen.tsx` with `hasContent: true`: a delete can fail while
    // another book remains on the shelf, so `deleteFailed` and `hasContent`
    // can both be true at once.
    //
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
