import { Menu } from "./menu";
import { O4SheetHead } from "./o4-crumbs";
import { Tile, TileGrid, TileSpacer } from "./o4-tile-menu";
import { rowHint, type RowReason } from "./menu-row-state";
import { strings } from "@/lib/strings";
import { ThemeControl } from "./theme-control";

/**
 * The recorder sheet's ⋮ menu (#160, L-1).
 *
 * A hundred lines of JSX lifted out of a 4000-line component, and the split is
 * where it is because every input is already a DERIVED value: the three row
 * reasons (edit, mark, erase) come from `menu-row-state.ts`, `finishedState`
 * from the resolved state the store will write, and the rest are handlers.
 * Nothing here reads the recorder's audio, editor or viewport state, which is
 * what made this the first of L-1's three JSX splits worth doing — the
 * toolbars read far more.
 *
 * **Delete segment does NOT live here** (#1104, the requirements owner's
 * 2026-09-26 decision, superseding #590's original placement): "the menu
 * inside the segment editor (recorder) shows Erase only. Delete (removing the
 * whole segment) belongs to the chapter view." #1080 (PR2 of #590) had put a
 * Delete row/tile in both modes here; #1104 pulled it back out.
 * The chapter view's own row menu (`segment-row.tsx`) carries Delete now.
 *
 * It renders one of two tile sets, keyed on the sheet's mode. Every reason a
 * tile can be grey is passed in rather than re-derived, so the tile and the
 * hint that explains it (#135) cannot disagree.
 */
export interface RecorderMenuProps {
  open: boolean;
  onClose: () => void;
  mode: "record" | "edit";
  /**
   * The segment's ordinal for the mark/unmark label, or null before the
   * segment has loaded.
   *
   * The `?? 0` fallback below is never shown as a real number, but the gate
   * that guarantees it is `markReason`, NOT `finishedState` (George R2 named
   * the wrong one here). `RecorderSegmentView.ordinal` is a non-nullable
   * `number`, so the sheet's `view?.ordinal ?? null` is null exactly when
   * `view` is null — and that is the same input `markRowReason` reads as
   * `hasView: false`, which answers "no-audio". A null ordinal therefore
   * always arrives with a non-null `markReason`, and the row is
   * `disabled` for that reason.
   *
   * This component does not enforce that itself: given `ordinal: null` with
   * `markReason: null` it would render an enabled `markFinished(0)`. No
   * caller can produce that pair, so the split does not add a gate the sheet
   * did not have.
   */
  ordinal: number | null;
  /**
   * The resolved finished state the store WILL write — not the displayed
   * intent. They diverge on an emptied segment, and the row's paint and label
   * both key on this one so neither can lie until close (George R1).
   */
  finishedState: "finished" | "empty" | "disabled";
  /** Why Mark finished is unavailable, or null. */
  markReason: RowReason | null;
  /** Why Erase is unavailable, or null. Shared by both modes' rows. */
  eraseReason: RowReason | null;
  onToggleFinished: () => void;
  /** Close the menu and arm the erase confirm. */
  onErase: () => void;
  /**
   * The book's name, the sheet head's first crumb (workbench G3). Absent,
   * that crumb is left out.
   */
  bookName?: string;
  /**
   * The book's resolved cover colour (#949, #957), already a hex string —
   * see `O4SheetHead`'s own docblock for how it is resolved and why absent
   * means "no square", not "no colour". `recorder.tsx` passes
   * `view?.bookCoverHex ?? undefined`.
   */
  bookCoverHex?: string;
  /** The chapter's number, the sheet head's second crumb. */
  chapterNumber?: number;
  /**
   * The chapter's resolved name (`strings.chapterHeading`), shown in place
   * of `chapterNumber` when given, so the head matches the recorder header
   * it was opened from (#1230). `recorder.tsx` always passes it once the
   * view has loaded.
   */
  chapterHeading?: string;
}

export function RecorderMenu({
  open,
  onClose,
  mode,
  ordinal,
  finishedState,
  markReason,
  eraseReason,
  onToggleFinished,
  onErase,
  bookName,
  bookCoverHex,
  chapterNumber,
  chapterHeading,
}: RecorderMenuProps) {
  // ONE answer for "this segment is marked", read by both the label and the
  // paint. They were two expressions that disagreed: the label also required a
  // non-null ordinal, the class did not. A null ordinal with `finishedState`
  // "finished" therefore painted the row green under a "Mark finished" label
  // numbered 0. The parent never sends that pair — see the `ordinal` prop's
  // docblock — but a component should not depend on its caller being right to
  // stay self-consistent (George R1).
  const marked = ordinal !== null && finishedState === "finished";

  return (
    <Menu
      open={open}
      onClose={onClose}
      // Still the drawer's name for a screen reader; never painted (#621).
      title={strings.recorderMenuTitle}
      // `hamburger` (#621, the requirements owner's call on this panel,
      // after #608 set the rule on the global menu): this drawer's own
      // dismiss is a single glyph, top-right, and is what dismisses it — no
      // "More" heading, and no chevron, because a chevron pointing LEFT reads
      // as "move left" on a drawer that docks on the RIGHT. The dismiss is
      // the ✕ every sheet closes with (#1268).
      hamburger
    >
      {/* The grid ends with the theme tile past the spacer, LAST so that
          wherever a tile above is actionable the open-edge focus lands on
          it — Done or Erase, what the translator opened this menu for —
          rather than on a control that repaints the screen (#149). */}
      {/* Workbench G3's sheet head: the book, chapter and segment crumbs
          (§7), decoration only, as on the chapter and segment menus. The
          segment crumb is tinted by the state this menu already reads: the
          mark that will stick is "finished", audio that will exist on close
          is "recorded", anything else is "empty". The workbench's "hear
          this" speaker is not drawn (spoken titles, #952). */}
      <O4SheetHead
        book={bookName}
        bookCoverHex={bookCoverHex}
        chapter={chapterHeading ?? chapterNumber}
        segment={
          ordinal === null
            ? undefined
            : {
                ordinal,
                state: marked
                  ? "finished"
                  : finishedState === "empty"
                    ? "recorded"
                    : "empty",
              }
        }
      />
      <TileGrid>
        <RecorderMenuTiles
          mode={mode}
          marked={marked}
          ordinal={ordinal}
          markReason={markReason}
          eraseReason={eraseReason}
          onToggleFinished={onToggleFinished}
          onErase={onErase}
        />
        <TileSpacer />
        <ThemeControl tile />
      </TileGrid>
    </Menu>
  );
}

/**
 * This menu's action tiles (#949, workbench G3 and G8), on the tile grid,
 * which `o4/menus.css` turns into a bottom sheet capped at half the screen,
 * so the waveform above is meant to stay in view (#927).
 *
 *   - Record mode has no Edit tile. G3 (workbench round 4) took it out
 *     because the recorder screen carries its own edit control — the one
 *     `recorder.tsx` gates on `editReason`.
 *   - Mark's tile is #995's shared marking-done tone (G8): `doneoff` until
 *     the mark will stick, then `done`, keyed on `marked`. Its caption is
 *     the shared "Done" (D17).
 *
 * Every tile draws at the shared tile glyph size; `recorder-menu-tile` is
 * only the hook for this sheet's half-screen cap in `o4/menus.css`.
 */
function RecorderMenuTiles({
  mode,
  marked,
  ordinal,
  markReason,
  eraseReason,
  onToggleFinished,
  onErase,
}: Pick<
  RecorderMenuProps,
  | "mode"
  | "ordinal"
  | "markReason"
  | "eraseReason"
  | "onToggleFinished"
  | "onErase"
> & { marked: boolean }) {
  return (
    <>
      {/* Edit mode has no Done tile (#1252, the requirements owner): "Done"
          keeps one meaning, mark finished, and the toolbar's ✕ leaves edit
          mode. */}
      {mode === "record" && (
        <Tile
          tone={marked ? "done" : "doneoff"}
          icon="check"
          // Fixed label, state on `pressed` (#351).
          // The tile's `is-on` ink loses to the tone's own ink: equal
          // specificity, and `o4/` is imported after `3-components.css`.
          label={strings.markFinished(ordinal ?? 0)}
          pressed={marked}
          caption={strings.tileFinished}
          className="recorder-menu-tile"
          disabled={markReason !== null}
          hint={rowHint(markReason)}
          onClick={onToggleFinished}
        />
      )}
      {/* Clear (the DRI's 2026-09-28 pick on #1119): the eraser on the plain
          well. Red is kept for Delete, which removes a whole segment and
          lives only in the chapter view (#1104). */}
      <Tile
        tone="plain"
        icon="eraser"
        label={strings.eraseSegment}
        caption={strings.tileErase}
        className="recorder-menu-tile"
        disabled={eraseReason !== null}
        hint={rowHint(eraseReason)}
        onClick={onErase}
      />
    </>
  );
}
