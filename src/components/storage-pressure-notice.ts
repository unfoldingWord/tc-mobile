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
 * and both missing before this fix (George P2-2, P2-4, #542):
 *
 * - **`hasContent`.** `useStoragePressure` is deliberately NOT gated on shelf
 *   content itself (the device can be full before this app has read
 *   anything — see that hook's CONTRACT note), so the retraction has to live
 *   on the display side instead. Without it, deleting a book down to an empty
 *   shelf left a device-storage warning standing over the empty-shelf invite
 *   — the exact bug `storageNotPersisted`'s own `hasContent` gate exists to
 *   prevent, that this line failed to inherit.
 * - **The acute trio — `loading`, `loadFailed`, `deleteFailed`.** The load/
 *   delete/loading slot above this line in `books-screen.tsx` is exclusive
 *   and acute-first; this line must retract while any of the three is live,
 *   the same way it retracts while that slot is showing something. The gate
 *   is deliberately narrower than that slot's own `noticeText`, which also
 *   covers a failed `addChapter` — a quota-shaped write failure, precisely
 *   the case this feature exists to warn about. Gating on the wider
 *   `noticeText` would retract the pressure warning exactly when a failed
 *   write makes it most relevant.
 */

import { strings } from "./strings";
import type { NoticeTone } from "./notice-tone";
import type { StoragePressureMarker } from "@/lib/storage/pressure";

export interface StoragePressureNotice {
  readonly tone: NoticeTone;
  readonly text: string;
}

/** Everything `storagePressureNotice` needs to decide whether its line
 * appears at all, in addition to the marker itself. */
export interface StoragePressureGate {
  /** Whether the shelf holds at least one book. `false` retracts the line —
   * the same predicate `storageNotPersisted`'s sibling line is gated on, so a
   * book deleted down to an empty shelf clears this warning too rather than
   * showing a device-storage caveat over the empty-shelf invite. */
  readonly hasContent: boolean;
  /** The shelf is (re)loading. */
  readonly loading: boolean;
  /** The last shelf load failed. */
  readonly loadFailed: boolean;
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
  if (!gate.hasContent) return null;
  if (gate.loading || gate.loadFailed || gate.deleteFailed) return null;
  return marker === "critical"
    ? { tone: "alert", text: strings.storageCritical }
    : { tone: "info", text: strings.storageLow };
}
