/**
 * What the Books shelf says about #247's storage-pressure band — the WHOLE
 * gate, in a DOM-free function.
 *
 * Lifted out of `books-screen.tsx` for the reason `encoder-notice.ts` was: no
 * test currently mounts `BooksScreen` and this effectful hook graph
 * (`useStoragePressure`, `useBooks`, …) through a DOM render — `tests/
 * render.ts` (jsdom + `renderToStaticMarkup`, #197) exists, but nothing wires
 * it to this screen — so a mount predicate left in JSX here is pinned by
 * nothing. #540 (George's review of #537, the core PR this wires up) found
 * exactly that failure mode in the core PR's own published JSX recipe:
 * `Notice`'s default `tone` is `"alert"`, and `"low" | "critical"` is a valid
 * `ReactNode`, so completing the example the obvious way type-checks while
 * painting the band name on the home screen in the failure colour. Putting
 * the tone/text decision here, in a function a test can pin, means a caller
 * cannot get it wrong the way a bare `{marker && <Notice>}` in JSX could.
 *
 * **The tone split (DRI decision, Seth, 2026-09-24).** `"low"` reads `info`;
 * `"critical"` now reads `alert`. This reverses the call recorded in
 * `lib/storage/pressure.ts`'s `StoragePressure` docblock through
 * 2026-09-24 — both bands `info`, on the reasoning that a standing condition
 * is not a failure and red on the home screen teaches people to ignore red
 * (George R4 G3) — see that docblock for the superseded reasoning and the
 * reversal note. The DRI's reason for the reversal: a critical condition
 * rendered in the same tone as a low one does not read as more urgent, and
 * the critical copy (`strings.storageCritical`) now states a concrete
 * consequence — new recordings may not save — which is the shape `alert`
 * exists for. `"low"` keeps `info`: it is still a heads-up with time to act,
 * not a failure.
 *
 * **Round 1 review (#542) found the tone/text half was lifted here but the
 * VISIBILITY half was not** — `books-screen.tsx` still decided "does this
 * line render at all" as raw JSX `&&`, which is exactly the shape this
 * module exists to remove (Frank P2-2 / George P3-5). This function now owns
 * all three of `encoder-notice.ts`'s "whole gate" claims — whether the line
 * appears at all, which mark it wears, and which string it says — the same
 * three `encoderNotice` already owns.
 *
 * Two exclusivity rules moved in, both modelled on this line's sibling,
 * `storageNotPersisted` (`persistence.ts` / `use-storage-persistence.ts`),
 * and both missing before the round-1 fix (George P2-2, P2-4, #542):
 *
 * - **`hasReclaimableAudio`** (renamed from `hasContent`, #542 Part B, DRI
 *   decision 2026-09-24). `useStoragePressure` is deliberately NOT gated on
 *   shelf content itself (the device can be full before this app has read
 *   anything — see that hook's CONTRACT note), so the retraction has to live
 *   on the display side instead. The round-1 fix gated that retraction on
 *   `hasContent` — "the shelf holds at least one book" — which closed the
 *   empty-shelf case (a device-storage warning must not stand over the
 *   empty-shelf invite) but left a weaker one open: a book with zero
 *   chapters, or a chapter with zero recorded segments, could still show the
 *   full warning even though its copy ("mark segments finished", "share your
 *   work and remove it") has nothing to act on there — there is no recording
 *   to reclaim. `hasReclaimableAudio` (`lib/view/book-rows.ts`) answers the
 *   stronger question — does at least one segment, anywhere on the shelf,
 *   hold a recorded take — and retracts the line on an empty shelf for the
 *   same reason `hasContent` did (no books ⇒ no chapters ⇒ no recorded
 *   segments), so that case stays covered by construction, not by keeping
 *   both predicates.
 * - **`deleteFailed`.** The load/delete/loading slot above this line in
 *   `books-screen.tsx` is exclusive and acute-first; this line must retract
 *   while a delete has failed, the same way it retracts while that slot is
 *   showing something. Narrower than that slot's own `noticeText`, which also
 *   covers a failed `addChapter` — a quota-shaped write failure, precisely
 *   the case this feature exists to warn about. Gating on the wider
 *   `noticeText` would retract the pressure warning exactly when a failed
 *   write makes it most relevant.
 *
 *   **`loading` and `loadFailed` were dropped from this gate (#843 item 4,
 *   repeat of round-2 P3-3/#533).** Both were unreachable in combination with
 *   `hasReclaimableAudio: true` from the only caller: `loadFailed` requires
 *   `loaded === false` (`books-screen.tsx`'s `error !== null && !loaded`),
 *   `hasReclaimableAudio` requires `loaded === true` (`loaded &&
 *   hasReclaimableAudio(books)`), and `loading` starts `true` only while
 *   `loaded` is still `false` and is set back to `false` in the same batched
 *   update (`use-books.ts`'s load effect: `setLoaded(true)` on the success
 *   path and `setLoading(false)` in that same effect's `finally`) that would
 *   first let `loaded` — and so `hasReclaimableAudio` — read `true`. So
 *   `!gate.hasReclaimableAudio` already retracted the line in both states;
 *   the pair added nothing this caller could ever trigger.
 */

import { strings } from "@/lib/strings";
import type { NoticeTone } from "./notice-tone";
import type { StoragePressureMarker } from "@/lib/storage/pressure";

export interface StoragePressureNotice {
  readonly tone: NoticeTone;
  readonly text: string;
}

/** Everything `storagePressureNotice` needs to decide whether its line
 * appears at all, in addition to the marker itself. */
export interface StoragePressureGate {
  /** Whether at least one segment, in any chapter of any book on the shelf,
   * holds a recorded take (`ChapterRow.recordedCount > 0` somewhere) —
   * `lib/view/book-rows.ts`'s `hasReclaimableAudio` (#542 Part B, DRI
   * decision 2026-09-24). `false` retracts the line: an empty shelf, or one
   * with books/chapters but nothing yet recorded in any of them, has nothing
   * this line's copy could tell someone to reclaim. Stronger than, and
   * replaces, the round-1 `hasContent` ("the shelf holds at least one book")
   * — a book or chapter with zero recordings used to still show the full
   * warning with no remediation available. */
  readonly hasReclaimableAudio: boolean;
  /** The last delete failed. */
  readonly deleteFailed: boolean;
}

/** The shelf's one line about storage pressure, or `null` when there is
 * nothing to show — either because there is no marker, or because one of the
 * gate's exclusivity conditions applies. */
export function storagePressureNotice(
  marker: StoragePressureMarker | null,
  gate: StoragePressureGate
): StoragePressureNotice | null {
  if (marker === null) return null;
  if (!gate.hasReclaimableAudio) return null;
  if (gate.deleteFailed) return null;
  return marker === "critical"
    ? { tone: "alert", text: strings.storageCritical }
    : { tone: "info", text: strings.storageLow };
}
