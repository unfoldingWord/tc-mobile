/**
 * What the Books shelf says about #247's storage-pressure band — the tone
 * decision, in a DOM-free function.
 *
 * Lifted out of `books-screen.tsx` for the reason `encoder-notice.ts` was:
 * this repo has no DOM test runner, so a mount predicate left in JSX is
 * pinned by nothing. #540 (George's review of #537, the core PR this wires
 * up) found exactly that failure mode in the core PR's own published JSX
 * recipe: `Notice`'s default `tone` is `"alert"`, and `"low" | "critical"` is
 * a valid `ReactNode`, so completing the example the obvious way type-checks
 * while painting the band name on the home screen in the failure colour. The
 * DRI decided both bands read `info`, never `alert` (`lib/storage/
 * pressure.ts`'s `StoragePressure` docblock: a standing condition is not a
 * failure, and red on the home screen teaches people to ignore red). Putting
 * that decision here, in a function a test can pin, means a caller cannot get
 * it wrong the way a bare `{marker && <Notice>}` in JSX could.
 */

import { strings } from "./strings";
import type { NoticeTone } from "./notice-tone";
import type { StoragePressureMarker } from "@/lib/storage/pressure";

export interface StoragePressureNotice {
  readonly tone: NoticeTone;
  readonly text: string;
}

/** The shelf's one line about storage pressure, or `null` when there is
 * nothing to show. */
export function storagePressureNotice(
  marker: StoragePressureMarker | null
): StoragePressureNotice | null {
  if (marker === null) return null;
  return {
    tone: "info",
    text: marker === "critical" ? strings.storageCritical : strings.storageLow,
  };
}
