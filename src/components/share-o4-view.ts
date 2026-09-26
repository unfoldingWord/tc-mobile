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
 * segment with no playable audio or a chapter with none recorded. `key` is
 * the identity the export names its counted items by (#1044, `keys` on the
 * step count), or `null` for an item the export cannot count.
 */
export interface ShareItem {
  readonly label: number;
  readonly goesOut: boolean;
  readonly key: string | null;
}

/**
 * Share Chapter's items: the Segments screen's rows, in order. A segment goes
 * out when it has playable audio (`hasClip`, the same `resolveSegmentAudio`
 * check the gather's `resolveChapterClipIds` makes), and its chip shows its
 * ordinal. Its key is that resolved clip's id, which is what the gather
 * names each counted segment by.
 */
export function chapterShareItems(rows: readonly SegmentRow[]): ShareItem[] {
  return rows.map((row) => ({
    label: row.ordinal,
    goesOut: row.hasClip,
    key: row.clipId,
  }));
}

/**
 * Share Book's items: the shared book's chapters, in `chapterIds` order as
 * the Books screen loads them. A chapter goes out when it holds a recorded
 * take (`recordedCount > 0`), and its chip shows its chapter number. Its key
 * is its chapter id, which is what the book export names each chapter by.
 */
export function bookShareItems(chapters: readonly ChapterRow[]): ShareItem[] {
  return chapters.map((chapter) => ({
    label: chapter.number,
    goesOut: chapter.recordedCount > 0,
    key: chapter.chapterId,
  }));
}

/**
 * A chip's state (D21, as corrected on #947). `stays`: the item does not go
 * out, grey with its number. `waiting`: goes out, not reached yet; while
 * packing it is the same grey chip, as in the workbench's `vShare` (only the
 * armed phase, which this overlay does not have, draws it teal). `current`:
 * the one being packed now, amber. `finished`: packed, or handed over, and
 * shows a check on teal.
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
   * before the first count. Handed over (`sent`) keeps it at 100, as the
   * workbench's `system` phase does. `null` itself means the core is not a
   * progress bar, which is every other outcome.
   */
  readonly meter: { readonly now: number | null } | null;
  /**
   * Whether the meter's accessible name is the panel's visible status line
   * rather than `strings.sharePreparingLabel` (DRI pick (c) on #1023, "Follow
   * the visible status"): true at 100 on the hand-off and on `sent`, where
   * the line under the circle no longer says the share is being prepared.
   * Absent while a prepare counts.
   */
  readonly meterFromStatus?: boolean;
  /** One chip per item, in order. Empty draws no chip row. */
  readonly chips: readonly ShareChip[];
}

type VisibleProgress = Exclude<ShareProgress, { readonly phase: "hidden" }>;
type Steps = NonNullable<Extract<ShareProgress, { phase: "busy" }>["steps"]>;
type Carry = Extract<ShareProgress, { phase: "busy" }>["carried"];

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
      meter: sent ? { now: 100 } : null,
      ...(sent ? { meterFromStatus: true } : {}),
      chips: sent ? handedOver(items, scope, progress.carried) : [],
    };
  }
  if (progress.work === "send")
    return {
      icon: "share",
      ring: null,
      meter: { now: 100 },
      meterFromStatus: true,
      chips: handedOver(items, scope, progress.carried),
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

/**
 * Handed over (or being handed over): every item that goes out is done,
 * except one the prepare finished with no audio. The send carries the
 * prepare's `hollow` positions (#1023, `ShareCarry`), counted in the same
 * order {@link shareChips} counts, so a skipped item stays the grey chip and
 * the "N of M go out" label does not count it. When the snapshot names the
 * counted items (`keys`, #1044), an item the export left out before its count
 * stays grey as well. Without a carried snapshot (a build that never reported
 * a count) every go-out item is checked.
 */
function handedOver(
  items: readonly ShareItem[],
  scope: "chapter" | "book",
  carried: Carry
): ShareChip[] {
  const counted = countedItems(items, scope, carried?.keys);
  const inCount = carried?.keys === undefined ? null : new Set(counted);
  const skipped = new Set((carried?.hollow ?? []).map((at) => counted[at]));
  return items.map((item) => ({
    label: item.label,
    state:
      item.goesOut && !skipped.has(item) && (inCount?.has(item) ?? true)
        ? "finished"
        : "stays",
  }));
}

/**
 * The screen item at each position of the count, in order (see
 * {@link shareChips}); `undefined` where the count holds an item the screen
 * does not.
 *
 * With the export's `keys` (#1044), position `k` is the screen item whose key
 * is `keys[k]` (a clip id or a chapter id, each unique), so an item the
 * export left out before it fixed its count is simply absent. Without them (a
 * build that never named its items) positions are guessed from the screen:
 * every item for a book, the items that go out for a chapter.
 */
function countedItems(
  items: readonly ShareItem[],
  scope: "chapter" | "book",
  keys: readonly string[] | undefined
): readonly (ShareItem | undefined)[] {
  if (keys === undefined)
    return scope === "book" ? items : items.filter((i) => i.goesOut);
  return keys.map((key) => items.find((item) => item.key === key));
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
 * An item the count has passed is finished if it goes out. The item the
 * count is on (position `done` among the counted items) is current while the
 * count is still on its items, but only if it goes out: while Share Book's
 * step is a chapter with no audio, no chip is current, and the next recorded
 * chapter turns amber only once its own step is being worked on (DRI pick (b)
 * on #1023, "No amber while skipping"). The encode stretch passes no item. The count and the screen
 * can disagree (a clip's record gone between the screen's read and the
 * gather's): a count longer than the screen's items stops at the last of
 * them, and a screen item beyond the count's items stays waiting, never
 * current, until the hand-over checks every item that goes out.
 *
 * An item the count finished WITHOUT audio (`steps.hollow`, #996: a clip or
 * chapter the export skipped) did not go out, so it is the grey chip with its
 * number (D21), never a check, and the "N of M go out" label does not count
 * it. `hollow` holds positions among the count's items, the same order as
 * `counted`.
 *
 * When the count names its items (`steps.keys`, #1044), positions are read
 * through those keys rather than guessed from the screen, and an item that
 * goes out on the screen but is not among the count's items (the export left
 * it out before it fixed its count) is the grey chip too.
 */
function shareChips(
  steps: Steps,
  scope: "chapter" | "book",
  items: readonly ShareItem[]
): ShareChip[] {
  const counted = countedItems(items, scope, steps.keys);
  const inCount = steps.keys === undefined ? null : new Set(counted);
  const itemSteps = steps.items ?? steps.total;
  const passed = new Set(counted.slice(0, Math.min(steps.done, itemSteps)));
  const skipped = new Set((steps.hollow ?? []).map((at) => counted[at]));
  const current = steps.done < itemSteps ? counted[steps.done] : undefined;
  return items.map((item) => {
    if (!item.goesOut || skipped.has(item) || !(inCount?.has(item) ?? true))
      return { label: item.label, state: "stays" };
    if (passed.has(item)) return { label: item.label, state: "finished" };
    if (item === current) return { label: item.label, state: "current" };
    return { label: item.label, state: "waiting" };
  });
}
