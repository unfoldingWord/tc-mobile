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
 * exclusivity gate that moved into this function: hidden when the shelf holds
 * no recorded audio (George P2-2, strengthened from `hasContent` to
 * `hasReclaimableAudio` by #542 Part B, DRI decision 2026-09-24), hidden
 * after a failed delete (George P2-4), and visible otherwise for both
 * bands — each in the tone the DRI decided for its band (Seth, 2026-09-24):
 * `"low"` in `info`, `"critical"` in `alert`. `loading` and `loadFailed` were
 * part of this gate through #542 but are gone as of #843 item 4 — see
 * `storage-pressure-notice.ts`'s docblock for why they were unreachable.
 *
 * **`hasReclaimableAudio`, not `hasContent`** (#542 Part B). The round-1 gate
 * asked only "does a book exist" — a book with zero chapters, or a chapter
 * with zero recorded segments, could still show this line's remediation copy
 * ("mark segments finished", "share your work and remove it") with nothing to
 * remediate. The case below named "a book with no recordings" is the one that
 * distinguishes the two predicates: it sets `hasReclaimableAudio: false` on a
 * gate that a `books.length > 0` check would have read as `true`, so
 * reverting the gate's *meaning* back to "a book exists" — even under the new
 * field's name — fails it.
 */

/** A gate with nothing suppressing the line — every case below starts from
 * this and flips exactly the one thing it means to test. */
const openGate: StoragePressureGate = {
  hasReclaimableAudio: true,
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

  it("says nothing when the gate reports no reclaimable audio, even with a marker (George P2-2, #542)", () => {
    // This function only ever sees the already-computed boolean — it cannot
    // tell "the shelf is empty" from "a book (or chapter) exists but holds no
    // recording" apart, and it does not need to: both are `hasReclaimableAudio
    // === false`, and both must retract the line the same way
    // `storageNotPersisted`'s sibling line already does for an empty shelf.
    // The test that DOES distinguish the two states — a book that exists,
    // with a chapter that exists, but with `recordedCount: 0` — is
    // `hasReclaimableAudio`'s own, in `tests/book-rows.test.ts`: that is
    // where a caller-side regression back to "a book exists" (`hasContent`)
    // would actually be caught, since `books-screen.tsx` computes this
    // boolean before it ever reaches this function.
    expect(
      storagePressureNotice("low", { ...openGate, hasReclaimableAudio: false })
    ).toBeNull();
    expect(
      storagePressureNotice("critical", {
        ...openGate,
        hasReclaimableAudio: false,
      })
    ).toBeNull();
  });

  // `loading`/`loadFailed` were removed from `StoragePressureGate` entirely
  // (#843 item 4, repeat of round-2 P3-3/#533): both were unreachable in
  // combination with `hasReclaimableAudio: true` from the only caller
  // (`books-screen.tsx`) — see `storage-pressure-notice.ts`'s docblock for
  // the file:line derivation — so the two tests that used to pin them here,
  // as a function-contract-only claim rather than a books-screen-reachable
  // one, are gone along with the fields. Nothing else in this file changes:
  // `openGate` no longer carries them, and every remaining case is unaffected.

  it("says nothing after a failed delete (George P2-4, #542)", () => {
    // Reachable from `books-screen.tsx` with `hasReclaimableAudio: true`: a
    // delete can fail while another book — with a recording on it — remains
    // on the shelf, so `deleteFailed` and `hasReclaimableAudio` can both be
    // true at once (unlike `loading`/`loadFailed`, dropped in #843 item 4).
    //
    // `deleteFailed`, not the wider `noticeText` the sibling slot renders:
    // `noticeText` also covers a failed `addChapter`, a quota-shaped write
    // this feature exists to warn about, and gating on it would retract the
    // warning exactly when it matters most.
    expect(
      storagePressureNotice("critical", { ...openGate, deleteFailed: true })
    ).toBeNull();
  });

  it("shows the line again once the delete failure clears, with content present", () => {
    expect(storagePressureNotice("low", openGate)).not.toBeNull();
  });
});
