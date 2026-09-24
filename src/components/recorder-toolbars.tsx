import type { RefObject } from "react";

import { Control } from "./control";
import { editControlHint, type EditControlReason } from "./edit-control-state";
import { heldByDrag, ZOOM_QUARTER, ZOOM_WHOLE } from "./recorder-stage";
import { strings } from "@/lib/strings";
import type { RowHint } from "./menu-row-state";
import { cn } from "@/lib/utils";

/**
 * The recorder sheet's bottom bar, in both its modes (#160, L-1) — the bar's
 * JSX, lifted out of the sheet component.
 *
 * ONE component holding the `mode === "record" ? … : …`, not two exported
 * side by side, and that is a correction rather than a preference. The first
 * attempt exported `RecordToolbar` and `EditToolbar` and let the sheet pick.
 * The mode toggle carries
 * `key="edit-toggle"` in BOTH arms so React matches the two `Control`s across
 * the flip and reuses the one DOM node — which is what keeps focus on it, and
 * keeps it at the same pixel, when a keyboard user toggles into edit mode. A
 * key only reconciles within one element list, so two component types at that
 * position unmount and remount instead, and focus goes to the document.
 *
 * So the split is by FILE, not by component: the sheet no longer carries this
 * JSX, and the keyed pair stays in one element list where React can match it.
 *
 * Presentational throughout. Every gate arrives as a prop or is computed here
 * from primitives by a pure function that is already tested (`heldByDrag` in
 * `recorder-stage.ts`); nothing reaches into the audio session, the editor or
 * the viewport. Record's gate is the one that arrives ALREADY answered, as
 * `recordInert`: the sheet hoists it so the #604 guide ring and the button it
 * rings read one derivation rather than two switches, and re-deriving it here
 * from primitives would put the second switch back. `playSource` is the narrow slice of the
 * play plan the labels need — WHAT a tap will sound, so what a screen reader
 * speaks is what happens — and both modes read it, so the same act is named
 * the same way in both.
 */

/** What a Play tap will sound, or null when there is nothing to sound. */
export type PlaySource = "whole" | "line" | "selection" | null;

export interface RecorderToolbarProps {
  mode: "record" | "edit";
  recording: boolean;
  /**
   * The two record-bar buttons the sheet's focus-restore effect reads (#592):
   * when the bin's own erase empties the segment, focus moves off the bin and
   * onto Record. Forwarded rather than owned here, because the effect that
   * compares them lives in the sheet.
   */
  recordRef: RefObject<HTMLButtonElement | null>;
  rerecordRef: RefObject<HTMLButtonElement | null>;
  /** The bin's gate — `eraseReason !== null`, answered by the sheet. */
  rerecordDisabled: boolean;
  /** Its reason, in the shape the ≡ row's hint uses. */
  rerecordHint: RowHint | null;
  /** Record's own gate, answered by the sheet — see the module docblock. */
  recordInert: boolean;
  /** Whether the #604 guide ring is drawn on Record right now. */
  guidedRecord: boolean;
  isClosing: boolean;
  /** A segment is loaded. */
  hasView: boolean;
  playingBuffer: boolean;
  /** A finger is mid-pan (#317) — the stage lock the history controls carry. */
  dragging: boolean;
  /** Idle, and the sheet is not committing. */
  idleEditable: boolean;
  /** What a Play tap will sound, or null when there is nothing to sound. */
  playSource: PlaySource;
  playDisabled: boolean;
  /** The bottom-bar Edit gate, which ORs the open ≡ menu on top of the row's. */
  editToolbarDisabled: boolean;
  /** Its reason, which is NOT always the ≡ row's words (#315). */
  editToolbarHint: RowHint | null;
  /**
   * Why Undo is grey, or null when it is live (#91). The REASON rather than a
   * boolean, because the bar both disables on it AND speaks it through
   * `editControlHint` — #135 found a grey icon-only control with no reason
   * reads as a broken one. `undoReason` in the sheet already folds in the
   * #317 drag hold and the close window, so nothing is re-derived here.
   */
  undoBlocked: EditControlReason | null;
  /** Why Redo is grey, or null when it is live (#91). See `undoBlocked`. */
  redoBlocked: EditControlReason | null;
  /** The real zoom level; `displayedZoom` retired with the preview (#614). */
  zoom: number;
  /** The stage says its window controls cannot act right now. */
  windowControlsInert: boolean;
  onRecordButton: () => void;
  onPlayButton: () => void;
  onEnterEdit: () => void;
  onAuditionButton: () => void;
  onToggleZoom: () => void;
  onUndo: () => void;
  onRedo: () => void;
  openMenu: () => void;
  onExitEdit: () => void;
  onRerecord: () => void;
}

export function RecorderToolbar({
  mode,
  recording,
  recordRef,
  rerecordRef,
  rerecordDisabled,
  rerecordHint,
  recordInert,
  guidedRecord,
  isClosing,
  hasView,
  playingBuffer,
  dragging,
  idleEditable,
  playSource,
  playDisabled,
  editToolbarDisabled,
  editToolbarHint,
  undoBlocked,
  redoBlocked,
  zoom,
  windowControlsInert,
  onRecordButton,
  onRerecord,
  onPlayButton,
  onEnterEdit,
  onAuditionButton,
  onToggleZoom,
  onUndo,
  onRedo,
  openMenu,
  onExitEdit,
}: RecorderToolbarProps) {
  // The ternary is HERE, in one element list, so the mode toggle's shared
  // `key` reconciles across the flip — see the module docblock. Two component
  // types at this position would remount it and drop focus.
  return mode === "record" ? (
    // Both modes reserve the same right-hand slot for the toggle.
    <div className="recorder-toolbar pair grid items-center px-[16px]">
      <Control
        ref={rerecordRef}
        // Wipe and record again (#592), on the bar so a translator who
        // re-records whole passages sees it without opening a menu. The bin,
        // because it is the one "throw away" glyph ADR 0010's check already
        // puts in front of translators; the confirm it opens wears the same
        // bin. Left end, away from the hero Record, so the destructive control
        // is not the one under a thumb reaching to record; the confirm is the
        // second tap either way. Always drawn, so the bar does not re-lay out
        // when a first take lands: greyed, with its reason, where there is
        // nothing to erase.
        icon="trash"
        label={strings.rerecord}
        variant="default"
        disabled={rerecordDisabled}
        hint={rerecordHint}
        onClick={onRerecord}
      />
      <span className={cn("record-guide", guidedRecord && "is-guided")}>
        <Control
          ref={recordRef}
          // The square, not the pause bars: this tap ENDS the take and commits
          // it (#614). A pause glyph over a control that finalizes is the wrong
          // promise to the one reader who cannot check the label — the
          // translator who does not read.
          icon={recording ? "stop" : "record"}
          label={recording ? strings.stop : strings.record}
          variant="record"
          // This is a gate on the INSERTION OFFSET, not button
          // chrome, so the rule is enumerated in `recordDisabled`
          // and tested in both directions rather than inlined here
          // (George R1 P2 #3). Two states it must catch, and the one
          // it must not:
          //
          // - a buffer sounding at idle — under the scrolling view
          //   (#415) the drawn line marks the SOUNDING sample while
          //   `panState` is still the pre-play value, so a take would
          //   splice where the translator cannot see. (This used to be
          //   explained as a swapped whole-clip view lying about the
          //   line; since #415 the line is honest during playback and
          //   it is the stored pan that is stale. The gate is the same
          //   either way — do not "correct" it into an enable.)
          // - a finger mid-pan (#317): the touch that pauses playback
          //   lifts the sounding term while the drag is still moving
          //   the pan, so a second finger here would lock the offset
          //   to a position that then slides away from it.
          //
          // PAUSED used to be an exception to the first of those — the
          // button was Resume, its offset locked at the original Record
          // tap (F9), so it stayed live over a sounding preview (George
          // R3 #4). #614 ended the paused take, so the exception is
          // gone rather than loosened.
          disabled={recordInert}
          // The last link in the guided chain (#604): the ring sits on Record
          // until this segment has audio, which — because a take splices after
          // Stop — means it stays through the whole take, the permission wait
          // and the seal included. `guidedRecordShown` in the sheet owns the
          // whole rule; this file only draws the answer.
          onClick={onRecordButton}
        />
      </span>
      <Control
        icon={playingBuffer ? "pause" : "play"}
        // The name comes from `playSource` (the sheet passes
        // `playPlan?.source`), the same map the edit toolbar uses,
        // because since #317 this control plays
        // from the LINE and not always the whole segment (George R2
        // P2). Speaking "Play recording" over a tap that sounds
        // only the tail is a lie told to the one channel — a screen
        // reader — that cannot see the line. `"whole"` is the F7
        // rest and the line at 0, where it IS the whole segment;
        // `"selection"` is unreachable here (`playPlan` reads the
        // span in edit mode only) and falls through to the same
        // name rather than adding a branch that cannot run.
        label={
          playingBuffer
            ? strings.stopPlayback
            : playSource === "line"
              ? strings.auditionFromLine
              : strings.playRecording
        }
        variant="play"
        disabled={playDisabled}
        onClick={onPlayButton}
      />
      <Control
        key="edit-toggle"
        icon="selection"
        label={strings.enterEdit}
        pressed={false}
        variant="default"
        busy={isClosing}
        disabled={editToolbarDisabled}
        hint={editToolbarHint}
        onClick={onEnterEdit}
      />
    </div>
  ) : (
    // Edit mode: the spread editing toolbar. Redo is a visible button
    // here (out of the menu); the menu opener lives at the end.
    <div className="recorder-toolbar edit grid items-center px-[16px]">
      <Control
        // The audition (#284) — the SAME glyph pair the record bar
        // uses, play/pause, because it is the same act: a non-reader
        // recognises the control by its shape, and a second play
        // glyph would be a second thing to learn. The name is what
        // differs, and it names the target (`playSource`, which the
        // sheet derives from the audition plan) so what a screen
        // reader speaks is what sounds.
        icon={playingBuffer ? "pause" : "play"}
        label={
          playingBuffer
            ? strings.stopPlayback
            : playSource === "selection"
              ? strings.auditionSelection
              : playSource === "line"
                ? strings.auditionFromLine
                : strings.playRecording
        }
        variant="quiet"
        size={24}
        // Inert when there is nothing to hear — no audio, or a span
        // dragged shut — exactly as Cut is on the same span. While it
        // sounds it is the stop, so it stays live. `idleEditable`
        // carries the close window, where the sheet is committing;
        // `heldByDrag` carries the #317 finger (George R2 P1),
        // which cannot co-occur with `playingBuffer` because the
        // touch stops playback before the drag begins.
        disabled={heldByDrag(
          dragging,
          !playingBuffer && (!idleEditable || playSource === null)
        )}
        onClick={onAuditionButton}
      />
      <Control
        // The magnifier carries the ACTION (+ widens, − narrows) and
        // `pressed` carries the STATE — quarter view is the non-
        // default one, so that is the "on". Splitting the two is the
        // #91 fix: the old facing-arrow pair asked one glyph to do
        // both, and the first external tester read it the other way
        // round and asked whether the icons were reversed.
        //
        // These read `zoom` directly. They used to read a
        // `displayedZoom` that substituted the whole-clip level
        // while `render === "whole"` (#284, George R7), because
        // that render drew clip fractions 0..1 whatever `zoom`
        // said. #417 had already narrowed it to the paused-take
        // preview alone (a sounding buffer scrolls at the real
        // zoom — that is #417's whole point), and #614 retires the
        // preview, so `render` can no longer be `"whole"` at all
        // and the substitution has no state left to correct for.
        icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
        label={
          zoom === ZOOM_WHOLE ? strings.zoomAtWhole : strings.zoomAtQuarter
        }
        pressed={zoom === ZOOM_QUARTER}
        variant="quiet"
        size={24}
        // A window control: it rebuilds the window under a line that
        // is already travelling. `recorder-stage.ts` carries the class.
        // `!idleEditable` also gates #396's slack window: a leftover
        // preview during `isClosing` shows whole-view chrome over the
        // REAL zoom handler, and a tap there silently flips the stored
        // zoom with no visible change — see the comment above.
        disabled={windowControlsInert || !idleEditable}
        onClick={onToggleZoom}
      />
      <Control
        icon="undo"
        label={strings.undo}
        variant="quiet"
        size={24}
        // The gate arrives already derived (#91): `undoReason` in the sheet
        // reproduces `heldByDrag(dragging, !idleEditable || !canUndo)` — the
        // history half of the #317 stage lock, since Undo rematerialises
        // `working` and a lift still owing a resume would sound a sample
        // index measured in a buffer that no longer exists. What the reason
        // adds is the grey's CAUSE, so the arrow can say why it is grey.
        disabled={undoBlocked !== null}
        hint={editControlHint(undoBlocked)}
        onClick={onUndo}
      />
      <Control
        icon="redo"
        label={strings.redo}
        variant="quiet"
        size={24}
        // Same guard the menu Redo had (George R4), now derived the way
        // Undo's is: a Redo mid-take would rematerialise the working buffer
        // under the locked insertion offset — but `idleEditable` forbids
        // that, and edit mode is idle-only regardless. `redoReason`'s
        // `dragging` term is the #317 finger, for the reason Undo carries
        // it. Redo is grey for longer than Undo, never having anything to
        // redo until something is undone, so it is the stronger half of
        // #91's case here.
        disabled={redoBlocked !== null}
        hint={editControlHint(redoBlocked)}
        onClick={onRedo}
      />
      <Control
        icon="menu"
        label={strings.recorderMenuOpen}
        variant="quiet"
        size={24}
        disabled={!hasView || isClosing}
        onClick={openMenu}
      />
      <Control
        key="edit-toggle"
        icon="selection"
        label={strings.enterEdit}
        pressed={true}
        // Not deletable, although it reads that way. Both arms pass `hint` so
        // the edit toggle keeps ONE prop shape across the mode flip — the
        // record arm passes `editToolbarHint`, which may itself be null. This
        // is the node React reuses through the shared `key`, so changing the
        // props it is reconciled with is how the focus guarantee in the module
        // docblock gets lost. The comment moved here with the JSX (George R1).
        hint={null}
        variant="default"
        disabled={!idleEditable || dragging}
        onClick={onExitEdit}
      />
    </div>
  );
}
