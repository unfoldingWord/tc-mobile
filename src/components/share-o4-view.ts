import type { IconName } from "./icon";
import { shareOverlayGlyph } from "./share-overlay-glyph";
import type { ShareProgress } from "@/hooks/share-progress";
import type { ChapterRow, SegmentRow } from "@/types/view";

/**
 * What the O4 share circle draws (#947, epic #936, workbench states 15 and
 * G7): the glyph in the 140 core, how far the filling ring has gone, what the
 * core's progress bar reads, and one numbered chip per item. A plain
 * function, like `shareOverlayGlyph`, so the DRI's choices are behaviour
 * tests call rather than JSX a test has to read. `share-progress.tsx` calls
 * it only under O4; the current look never sees it.
 *
 * - D13: the ring is driven by real progress (the step count #986 and #996
 *   put on `ShareProgress`).
 * - D14: after the hand-off the core shows the workbench's plain `check`, not
 *   #850's `share-sent`. The current look keeps `share-sent`.
 * - D15: while packing, the share glyph with the filling ring. There is no
 *   interim look, so with no count yet there is no ring and no chip.
 * - D16: every other outcome keeps its #850 glyph; its colours are CSS.
 * - D21: one chip per item, in the items' own order (the workbench's
 *   `vShare`). See {@link shareChips}.
 * - D22: the core is a progress bar valued `done / total`.
 */

/**
 * One item the share walks over, as the screen already holds it: a segment
 * of the chapter (Share Chapter) or a chapter of the book (Share Book), in
 * order. `label` is the number the chip shows; `goesOut` is false for a
 * segment with no playable audio or a chapter with none recorded.
 */
export interface ShareItem {
  readonly label: number;
  readonly goesOut: boolean;
}

/**
 * Share Chapter's items: the Segments screen's rows, in order. A segment goes
 * out when it has playable audio (`hasClip`, the same `resolveSegmentAudio`
 * check the gather's `resolveChapterClipIds` makes), and its chip shows its
 * ordinal.
 */
export function chapterShareItems(rows: readonly SegmentRow[]): ShareItem[] {
  return rows.map((row) => ({ label: row.ordinal, goesOut: row.hasClip }));
}

/**
 * Share Book's items: the shared book's chapters, in `chapterIds` order as
 * the Books screen loads them. A chapter goes out when it holds a recorded
 * take (`recordedCount > 0`), and its chip shows its chapter number.
 */
export function bookShareItems(chapters: readonly ChapterRow[]): ShareItem[] {
  return chapters.map((chapter) => ({
    label: chapter.number,
    goesOut: chapter.recordedCount > 0,
  }));
}

/**
 * A chip's state (D21). `stays`: the item does not go out, grey with its
 * number. `waiting`: goes out, not reached yet. `current`: the one being
 * packed now. `finished`: packed, or handed over, and shows a check.
 */
type ShareChipState = "stays" | "waiting" | "current" | "finished";

export interface ShareChip {
  readonly label: number;
  readonly state: ShareChipState;
}

export interface ShareO4View {
  /** The glyph in the core. */
  readonly icon: IconName;
  /** How much of the ring is filled, 0 to 1; `null` draws no ring at all. */
  readonly ring: number | null;
  /**
   * The core's progress bar (D22): `now` is the whole percent, or `null`
   * before the first count. `null` itself means the core is not a progress
   * bar, which is every outcome.
   */
  readonly meter: { readonly now: number | null } | null;
  /** One chip per item, in order. Empty draws no chip row. */
  readonly chips: readonly ShareChip[];
}

type VisibleProgress = Exclude<ShareProgress, { readonly phase: "hidden" }>;
type Steps = NonNullable<Extract<ShareProgress, { phase: "busy" }>["steps"]>;

export function shareO4View(
  progress: VisibleProgress,
  scope: "chapter" | "book",
  items: readonly ShareItem[] = []
): ShareO4View {
  if (progress.phase === "outcome") {
    const sent = progress.settled === "sent";
    return {
      icon: sent ? "check" : shareOverlayGlyph(progress).icon,
      ring: null,
      meter: null,
      chips: sent ? handedOver(items) : [],
    };
  }
  if (progress.work === "send")
    return {
      icon: "share",
      ring: null,
      meter: { now: 100 },
      chips: handedOver(items),
    };
  const steps = progress.steps;
  if (steps === undefined)
    return { icon: "share", ring: null, meter: { now: null }, chips: [] };
  return {
    icon: "share",
    ring: steps.done / steps.total,
    meter: { now: Math.round((steps.done / steps.total) * 100) },
    chips: shareChips(steps, scope, items),
  };
}

/** Handed over (or being handed over): every item that goes out is done. */
function handedOver(items: readonly ShareItem[]): ShareChip[] {
  return items.map(({ label, goesOut }) => ({
    label,
    state: goesOut ? "finished" : "stays",
  }));
}

/**
 * The chip row for a prepare's count. The count and the items walk in the
 * same order; what differs is which items the count steps over.
 *
 * - Share Book counts EVERY chapter, one step each, a chapter with no audio
 *   included (`lib/export/book.ts`), so step `k` is item `k`.
 * - Share Chapter counts only the segments with audio when the gather begins
 *   (`gatherChapterPcm` leaves the rest out of `total`), then the encode
 *   stretch, so step `k` is the `k`th item that goes out, and once
 *   `done >= items` every one of them is finished while the ring still fills.
 *
 * An item the count has passed is finished if it goes out. The first item
 * that goes out and has not been passed is current, while the count is still
 * on its items. The encode stretch passes no item. The count and the screen
 * can disagree (a clip's record gone between the screen's read and the
 * gather's): a count longer than the screen's items stops at the last of
 * them, and a screen item beyond the count's items stays waiting, never
 * current, until the hand-over checks every item that goes out.
 */
function shareChips(
  steps: Steps,
  scope: "chapter" | "book",
  items: readonly ShareItem[]
): ShareChip[] {
  const counted = scope === "book" ? items : items.filter((i) => i.goesOut);
  const itemSteps = steps.items ?? steps.total;
  const passed = new Set(counted.slice(0, Math.min(steps.done, itemSteps)));
  const onItems = steps.done < itemSteps;
  let current = onItems;
  return items.map((item) => {
    if (!item.goesOut) return { label: item.label, state: "stays" };
    if (passed.has(item)) return { label: item.label, state: "finished" };
    if (current) {
      current = false;
      return { label: item.label, state: "current" };
    }
    return { label: item.label, state: "waiting" };
  });
}
