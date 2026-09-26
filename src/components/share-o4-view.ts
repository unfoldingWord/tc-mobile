import type { IconName } from "./icon";
import { shareOverlayGlyph } from "./share-overlay-glyph";
import type { ShareProgress } from "@/hooks/share-progress";
import { ENCODE_STEPS } from "@/lib/export/chapter";

/**
 * What the O4 share circle draws (#947, epic #936, workbench states 15 and
 * G7): the glyph in the 140 core, how far the filling ring has gone, and one
 * dot per item. A plain function, like `shareOverlayGlyph`, so the DRI's
 * choices are behaviour a test can call rather than JSX a test has to read.
 * `share-progress.tsx` calls it only under O4; the current look never sees it.
 *
 * - D13: the ring and dots are driven by real progress (the step count #986
 *   and #996 put on `ShareProgress`), and skipped items draw as hollow dots.
 * - D14: after the hand-off the core shows the workbench's plain `check`, not
 *   #850's `share-sent`. The current look keeps `share-sent`.
 * - D15: while packing, the share glyph with the filling ring. There is no
 *   interim look, so with no count yet (the first moment of a prepare, or a
 *   send, which has no per-item work) there is no ring and no dot at all.
 * - D16: every other outcome keeps its #850 glyph; its colours are CSS.
 */

/**
 * One item's state. `hollow` is a finished item that carried no audio: in a
 * book, a chapter with nothing recorded; in a chapter, a segment whose clip
 * vanished between the gather's two passes. A chapter's segment with no audio
 * at all when the gather begins is never counted (`gatherChapterPcm` leaves
 * it out of `total`), so it draws no dot.
 */
type ShareDot = "filled" | "hollow" | "empty";

export interface ShareO4View {
  /** The glyph in the core. */
  readonly icon: IconName;
  /** How much of the ring is filled, 0 to 1; `null` draws no ring at all. */
  readonly ring: number | null;
  /** One entry per item, in order. Empty draws no dot row. */
  readonly dots: readonly ShareDot[];
}

type VisibleProgress = Exclude<ShareProgress, { readonly phase: "hidden" }>;
type Steps = NonNullable<Extract<ShareProgress, { phase: "busy" }>["steps"]>;

export function shareO4View(
  progress: VisibleProgress,
  scope: "chapter" | "book"
): ShareO4View {
  if (progress.phase === "outcome")
    return {
      icon:
        progress.settled === "sent"
          ? "check"
          : shareOverlayGlyph(progress).icon,
      ring: null,
      dots: [],
    };
  const steps = progress.steps;
  if (steps === undefined) return { icon: "share", ring: null, dots: [] };
  return {
    icon: "share",
    ring: steps.done / steps.total,
    dots: shareDots(steps, scope),
  };
}

/**
 * The dot row for a count. A book counts chapters, one step each
 * (`lib/export/book.ts`). A chapter counts the segments that had audio when
 * the gather began, then a fixed stretch of `ENCODE_STEPS` for the MP3
 * encode (`withEncodeSteps`), so its items are `total - ENCODE_STEPS`, and
 * once every counted segment is gathered every dot is finished while the ring
 * still fills through the encode.
 *
 * `ShareSteps` carries how MANY finished items were skipped, not WHICH ones,
 * so the hollow dots are drawn after the filled ones rather than at the
 * skipped items' own positions. That ordering is this module's choice, not a
 * DRI decision, and it is wrong whenever an early item is the skipped one;
 * #1026 tracks the DRI's pick and the per-item data a fix needs.
 */
function shareDots(steps: Steps, scope: "chapter" | "book"): ShareDot[] {
  const items = scope === "chapter" ? steps.total - ENCODE_STEPS : steps.total;
  if (items < 1) return [];
  const finished = Math.min(steps.done, items);
  const hollow = Math.min(steps.skipped ?? 0, finished);
  return Array.from({ length: items }, (_, i): ShareDot =>
    i < finished - hollow ? "filled" : i < finished ? "hollow" : "empty"
  );
}
