import { Control } from "./control";
import { Menu } from "./menu";
import { rowHint, type RowReason } from "./menu-row-state";
import { strings } from "@/lib/strings";
import { ThemeControl } from "./theme-control";

/**
 * The recorder sheet's ≡ menu (#160, L-1).
 *
 * A hundred lines of JSX lifted out of a 4000-line component, and the split is
 * where it is because every input is already a DERIVED value: the three row
 * reasons come from `menu-row-state.ts`, `finishedState` from the resolved
 * state the store will write, and the rest are handlers. Nothing here reads
 * the recorder's audio, editor or viewport state, which is what made this the
 * first of L-1's three JSX splits worth doing — the toolbars read far more.
 *
 * It renders one of two row sets, keyed on the sheet's mode. Every reason the
 * rows can be grey is passed in rather than re-derived, so the row and the
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
  /** Why Edit is unavailable, or null. */
  editReason: RowReason | null;
  /** Why Mark finished is unavailable, or null. */
  markReason: RowReason | null;
  /** Why Erase is unavailable, or null. Shared by both modes' rows. */
  eraseReason: RowReason | null;
  onEnterEdit: () => void;
  onToggleFinished: () => void;
  /** Close the menu and arm the erase confirm. */
  onErase: () => void;
  onExitEdit: () => void;
}

export function RecorderMenu({
  open,
  onClose,
  mode,
  ordinal,
  finishedState,
  editReason,
  markReason,
  eraseReason,
  onEnterEdit,
  onToggleFinished,
  onErase,
  onExitEdit,
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
      // dismiss stays a ≡, top-right, and is what dismisses it — no "More"
      // heading, and no chevron, because a chevron pointing LEFT reads as
      // "move left" on a drawer that docks on the RIGHT. That holds
      // regardless of which control opened it: record mode's header opener
      // is ≡, but since #863 the edit toolbar's opener is ⋮ (≡ is used only
      // at the top right, and the toolbar is not the top right) — the
      // drawer's own top-right control is the only ≡ on screen either way.
      // The book, chapter and segment menus open from a ⋮ since #589 and
      // keep the chevron; this drawer keeps ≡ no matter which opener it was.
      hamburger
    >
      {mode === "record" ? (
        <>
          <Control
            icon="edit"
            label={strings.enterEdit}
            variant="quiet"
            // Editable when there is audio to edit, or a full clipboard to
            // paste — a never-recorded segment with a pending clip must still
            // open edit mode to receive it, or the chapter-wide clipboard (G3)
            // could never land on an empty segment (George R2). Blocked while a
            // take is live, not only while it is committing: #134 once let a
            // live take through (`onEnterEdit` would commit it first, then
            // edit), but #857 (Moto G tester report) found the toolbar's `[ ]`
            // twin of this row still openable mid-recording and closed that for
            // both — this row shares `editReason` with `recorder.tsx`'s
            // toolbar Edit control verbatim, so the two can never disagree.
            // Never while `denied`: the permission panel owns the body, and
            // entering edit there strands the edit toolbar over a Retry that
            // starts the mic (George R3, with onRetryRecord as the other half).
            // The gate lives in `editRowReason` so the grey row can say WHY
            // (#135): a blocked take shows the `alert` badge — a state mark
            // that names no control — and the reason joins the row's
            // accessible name.
            disabled={editReason !== null}
            hint={rowHint(editReason)}
            onClick={onEnterEdit}
          />
          <Control
            icon="check"
            // Green AND the mark/unmark label both key on `finishedState`, the
            // resolved state the store will actually write — NOT the raw
            // `displayedFinished` intent. They diverge on an emptied segment:
            // mark finished, Edit, cut all, Done → `finishedState` is
            // "disabled" (a 0-frame take cannot be finished, and close writes
            // `finished: false`), but `displayedFinished` is still true, so
            // keying the paint on it would show a green, "Unmark finished" row
            // that lies until close (George R1). `finishedState === "finished"`
            // is true only when the mark will stick.
            label={
              marked
                ? strings.markUnfinished(ordinal)
                : strings.markFinished(ordinal ?? 0)
            }
            variant="quiet"
            // Same `onToggleFinished`/`finishedIntent` semantics the header
            // checkbox carried (D1) — only the trigger moved. It does NOT close
            // the menu: the row re-renders in place so the check turns green as
            // the translator taps, the record-and-mark-done-in-one-sheet flow.
            // Frozen through the requesting/processing/close window exactly as
            // Record is (G10), plus the never-recorded `finishedState ===
            // "disabled"` the Checkbox encoded via `state`.
            className={marked ? "is-done" : undefined}
            // Gate + reason from `markRowReason` (#135 round 3): this row greyed
            // silently while Edit and Erase beside it explained themselves.
            disabled={markReason !== null}
            hint={rowHint(markReason)}
            onClick={onToggleFinished}
          />
          <Control
            icon="trash"
            label={strings.eraseSegment}
            variant="quiet"
            // Only when there is stored audio to erase (a first, uncommitted
            // recording has nothing on disk yet) AND only at idle: erasing the
            // stored take out from under a live capture is nonsensical, and the
            // menu opener stays reachable mid-take (Edit commits-then-edits a
            // live take, #134), so this entry must refuse there itself
            // (George R-B6). Gate + reason from `eraseRowReason` (#135).
            disabled={eraseReason !== null}
            hint={rowHint(eraseReason)}
            onClick={onErase}
          />
          {/* The theme toggle (#149). LAST in both branches, so that WHEREVER A
              ROW ABOVE IS ACTIONABLE the open-edge focus still lands on it —
              Edit / Done, what the translator opened this menu for — rather than
              on a control that repaints the screen. Where none of them is, focus
              lands here, and that is the correct outcome rather than a regression
              to repair by reordering: see the consequence stated below, which is
              the half that governs (George round 1 read the two halves as
              contradicting, and the unqualified "never" was the wrong one).

              This is the site the reframing of #149 turns on: the sheet is
              `aria-modal` over an `inert` Segments, so while it is up the Books
              hamburger is four screens away, and direct sun is exactly the
              condition that arrives while you are recording. The `≡` that opens
              this menu is itself closed through the close window, while `denied`,
              and while a take is held — the panels those states raise own the
              body — so the toggle inherits those gates rather than adding its own.

              ONE CONSEQUENCE, STATED RATHER THAN GLOSSED. `Menu` lands open-edge
              focus on the first ACTIONABLE child, skipping the `aria-disabled`
              hinted rows (#135). On a segment with nothing recorded and an empty
              clipboard all three rows above are hinted, so this control — always
              actionable — is now what focus lands on, where it used to fall back
              to Edit and its reason. That is `Menu`'s own rule applied to a menu
              that finally has something actionable in that state, and the hinted
              rows keep their place in the Tab order and still announce their
              reasons; but it IS a change to what an AT user hears first there,
              and it is #149's to own. */}
          <ThemeControl />
        </>
      ) : (
        <>
          <Control
            icon="check"
            label={strings.doneEditing}
            variant="quiet"
            onClick={onExitEdit}
          />
          <Control
            icon="trash"
            label={strings.eraseSegment}
            variant="quiet"
            // Kept reachable from edit mode too — erasing is a segment-level op
            // useful in either mode. Same idle + has-stored-clip guard.
            disabled={eraseReason !== null}
            hint={rowHint(eraseReason)}
            onClick={onErase}
          />
          {/* Same entry, same last position, in edit mode too — see the
              record-mode branch above for why. */}
          <ThemeControl />
        </>
      )}
    </Menu>
  );
}
