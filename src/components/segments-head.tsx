import { segmentRowState } from "@/lib/view/segment-rows";
import type { SegmentRow } from "@/types/view";

interface SegmentsHeadProps {
  /** The chapter's typed name, or `null` while it has none. */
  chapterName: string | null;
  rows: readonly SegmentRow[];
}

/**
 * The O4 chapter header (#944, states 05 and 06): the typed chapter title at
 * 22/800, then a progress bar with one mark per segment, coloured by the same
 * three states the rows derive (`segmentRowState`). An empty chapter shows one
 * empty mark, as the workbench's state 05 does.
 *
 * Rendered only in the O4 look, and decoration only: the breadcrumb already
 * names the chapter and each row already names its own state, so the whole
 * block is `aria-hidden` and the screen's reading order is the same in both
 * looks. The spoken-name speaker the design reference puts here is tier 2
 * (#952), so it is not.
 */
export function SegmentsHead({ chapterName, rows }: SegmentsHeadProps) {
  return (
    <div className="segments-head" aria-hidden="true">
      {chapterName ? <p className="segments-title">{chapterName}</p> : null}
      <div className="segments-progress">
        {rows.length === 0 ? (
          <i className="segments-mark" data-state="empty" />
        ) : (
          rows.map((row) => (
            <i
              key={row.segmentId}
              className="segments-mark"
              data-state={segmentRowState(row)}
            />
          ))
        )}
      </div>
    </div>
  );
}
