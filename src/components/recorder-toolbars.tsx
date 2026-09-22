import { Control } from "./control";
import {
  recordDisabled,
  heldByDrag,
  ZOOM_QUARTER,
  ZOOM_WHOLE,
} from "./recorder-stage";
import { strings } from "./strings";
import type { RowHint } from "./menu-row-state";

/**
 * The recorder sheet's bottom bar, in both its modes (#160, L-1) — ~210 lines
 * of JSX lifted out of a 4000-line component.
 *
 * ONE component holding the `mode === "record" ? … : …`, not two exported
 * side by side, and that is a correction rather than a preference. The first
 * attempt exported `RecordToolbar` and `EditToolbar` and let the sheet pick;
 * `e2e/recorder-selection.spec.ts` caught it. The mode toggle carries
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
 * from primitives by a pure function that is already tested (`recordDisabled`,
 * `heldByDrag` in `recorder-stage.ts`); nothing reaches into the audio
 * session, the editor or the viewport. `playSource` is the narrow slice of the
 * play plan the labels need — WHAT a tap will sound, so what a screen reader
 * speaks is what happens — and both modes read it, so the same act is named
 * the same way in both.
 */

/** What a Play tap will sound, or null when there is nothing to sound. */
export type PlaySource = "whole" | "line" | "selection" | null;

export interface RecorderToolbarProps {
  mode: "record" | "edit";
  recording: boolean;
  paused: boolean;
  busy: boolean;
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
  canUndo: boolean;
  canRedo: boolean;
  /** The zoom as DRAWN — a swapped whole-clip view overrides the stored one. */
  displayedZoom: number;
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
}

export function RecorderToolbar({
  mode,
  recording,
  paused,
  busy,
  isClosing,
  hasView,
  playingBuffer,
  dragging,
  idleEditable,
  playSource,
  playDisabled,
  editToolbarDisabled,
  editToolbarHint,
  canUndo,
  canRedo,
  displayedZoom,
  windowControlsInert,
  onRecordButton,
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
        icon={recording ? "pause" : "record"}
        label={
          recording ? strings.pause : paused ? strings.resume : strings.record
        }
        variant="record"
        // This is a gate on the INSERTION OFFSET, not button
        // chrome, so the rule is enumerated in `recordDisabled`
        // and tested in both directions rather than inlined here
        // (George R1 P2 #3). Two states it must catch, and the one
        // it must not:
        //
        // - a buffer sounding at idle — under the scrolling view
        //   (#415) the drawn line marks the SOUNDING sample while
        //   `panState` is still the pre-play value, and under a
        //   whole-clip preview it marks nothing in the working
        //   buffer at all. Either way a take would splice where the
        //   translator cannot see. (This used to be explained as a
        //   swapped whole-clip view lying about the line; since
        //   #415 the line is honest during playback and it is the
        //   stored pan that is stale. The gate is the same either
        //   way — do not "correct" it into an enable.)
        // - a finger mid-pan (#317): the touch that pauses playback
        //   lifts the sounding term while the drag is still moving
        //   the pan, so a second finger here would lock the offset
        //   to a position that then slides away from it.
        // - PAUSED is the exception: this button is Resume, its
        //   offset was locked at the original Record tap (F9), and
        //   resuming stops a sounding preview and continues the
        //   take, so it must stay live (George R3 #4).
        disabled={recordDisabled({
          busy,
          isClosing,
          hasView,
          playingBuffer,
          paused,
          dragging,
        })}
        onClick={onRecordButton}
      />
      <Control
        icon={playingBuffer ? "pause" : "play"}
        // The name comes from `playPlan.source`, the same map the
        // edit toolbar uses, because since #317 this control plays
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
        // differs, and it names the target (`auditionPlan`'s
        // `source`) so what a screen reader speaks is what sounds.
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
        // Both read `displayedZoom`, not `zoom` (#284, George R7),
        // and what that buys has NARROWED since #417 (George R4
        // P3). `wholeView` is `render === "whole"`, which
        // `stageView` now answers for a prepared preview only — a
        // sounding buffer scrolls at the real zoom, which is #417's
        // whole point, so during playback `displayedZoom` IS
        // `zoom`. The one window that claim was false in was the
        // CLOSE window (#396): a leftover paused-take preview can
        // outlive the edit gate while `close()` is committing, put
        // `wholeView` up with a SILENT buffer (so `windowControls-
        // Inert` is false), and stand this control up drawing the
        // whole chrome over a handler that flips the real `zoom`.
        // `!idleEditable` on `disabled` below is what kills that
        // — in the windows the control can fire, `wholeView` is
        // false, so the two values the chrome could name are the
        // two that are equal.
        icon={displayedZoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
        label={
          displayedZoom === ZOOM_WHOLE
            ? strings.zoomAtWhole
            : strings.zoomAtQuarter
        }
        pressed={displayedZoom === ZOOM_QUARTER}
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
        // `heldByDrag` is the history half of the #317 stage lock
        // (George R2 P1): Undo rematerialises `working`, and a lift
        // still owing a resume would sound a sample index measured
        // in the buffer that no longer exists.
        disabled={heldByDrag(dragging, !idleEditable || !canUndo)}
        onClick={onUndo}
      />
      <Control
        icon="redo"
        label={strings.redo}
        variant="quiet"
        size={24}
        // Same guard the menu Redo had (George R4): a Redo mid-take
        // would rematerialise the working buffer under the locked
        // insertion offset — but `idleEditable` forbids that, and edit
        // mode is idle-only regardless. `heldByDrag` is the #317
        // finger, for the same reason Undo carries it.
        disabled={heldByDrag(dragging, !idleEditable || !canRedo)}
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
        hint={null}
        variant="default"
        disabled={!idleEditable || dragging}
        onClick={onExitEdit}
      />
    </div>
  );
}
