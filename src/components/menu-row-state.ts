/**
 * Why a recorder ≡-menu row is disabled — derived, never hand-maintained (#135).
 *
 * The Edit and Erase rows are gated on recorder state, and a grey row with no
 * reason read as a broken control to the requirements owner (Tim, 2026-09-02,
 * staging v0.1.10). AGENTS.md's bar is state-in-place: the control itself shows
 * the condition. For that cue to be trustworthy it must come from the SAME
 * predicates that disable the row, so each row's `disabled` is now
 * `reason !== null` and the cue is a function of that reason. There is no second
 * switch to fall out of step.
 *
 * Pure and renderer-free on purpose — `tests/menu-row-state.test.ts` pins the
 * gates these reproduce, in plain Node.
 */

import type { IconName } from "./icon";
import { strings } from "./strings";

/**
 * The reasons, most actionable first. `"uncommitted-take"` is the #134 case — a
 * take is live, paused or committing, and Back is what lifts it — and outranks
 * every other reason because it is the one the translator can act on from here.
 */
export type RowReason =
  "uncommitted-take" | "denied" | "no-segment" | "no-audio" | "no-clip";

interface EditRowInputs {
  /** A segment is loaded (`view !== null`). */
  readonly hasView: boolean;
  /**
   * A take is being made or committed: any non-idle recorder state, OR the
   * close window (Back tapped, the stop→decode→save still in flight). Editing
   * is strictly idle (Model A: edits, then a record commits on close).
   */
  readonly takeActive: boolean;
  /** The permission panel owns the body — entering edit there strands the toolbar. */
  readonly denied: boolean;
  /** The working buffer has samples to edit. */
  readonly hasAudio: boolean;
  /**
   * The chapter-wide clipboard is full: an empty segment must still open edit to
   * receive a paste (George #89 R2).
   */
  readonly canPaste: boolean;
}

/**
 * The record-menu "Edit recording" row. Null when enabled. Reproduces exactly
 * the gate the row shipped with:
 * `!idleEditable || denied || (!hasAudio && !canPaste)`, where
 * `idleEditable = hasView && !takeActive`.
 */
export function editRowReason(i: EditRowInputs): RowReason | null {
  if (i.takeActive) return "uncommitted-take";
  if (!i.hasView) return "no-segment";
  if (i.denied) return "denied";
  if (!i.hasAudio && !i.canPaste) return "no-audio";
  return null;
}

interface EraseRowInputs {
  readonly hasView: boolean;
  readonly takeActive: boolean;
  /** A stored clip exists — a first, uncommitted recording has nothing on disk. */
  readonly hasClip: boolean;
}

/**
 * The "Erase recording" row (both menus). Null when enabled. Reproduces
 * `!idleEditable || !view?.hasClip`. Erasing the stored take out from under a
 * live capture is nonsensical (George R-B6), so the take wins here too.
 */
export function eraseRowReason(i: EraseRowInputs): RowReason | null {
  if (i.takeActive) return "uncommitted-take";
  if (!i.hasView || !i.hasClip) return "no-clip";
  return null;
}

/** A disabled row's cue: a visible state mark, and the reason in words. */
export interface RowHint {
  /**
   * A small badge on the row. `"alert"` — a STATE mark meaning "blocked, look
   * here" — never a glyph that names a control (see {@link rowHint}).
   */
  readonly icon?: IconName;
  /** Appended to the row's accessible name while disabled. */
  readonly label: string;
}

/**
 * Which reasons get a cue, what it shows, and what it says.
 *
 * **The glyph is `alert`, and the reason it is not a control glyph is the whole
 * history of this cue.** Round 1 badged the uncommitted-take row with `back`,
 * meaning the sheet's own commit control — which cannot be tapped, because the ≡
 * menu inerts the sheet while it is open, leaving the menu's own Close as the one
 * live back-chevron. The badge therefore marked the DISMISS control as the way
 * out. Round 2 then found that dropping the glyph entirely left the cue in the
 * accessible name only: invisible to the sighted tester who reported #135, and
 * skipped by Tab because the row was natively `disabled`.
 *
 * So the badge is back, as a STATE mark rather than a direction: `alert` says
 * "blocked, look here" and names no control, which is the one thing a glyph in
 * this overlay can honestly do. The words carry the way out, using the controls'
 * real accessible names. `Control` renders the badge and makes hinted rows
 * `aria-disabled` (focusable, announced, inert to activation) rather than natively
 * disabled, which is what puts the reason in reach of keyboard and switch users.
 *
 * `denied` and `no-segment` carry nothing because the menu opener is itself
 * disabled in both states (`recorder.tsx`, `disabled={!view || isClosing ||
 * denied}`), so no row is ever seen under them.
 */
export function rowHint(reason: RowReason | null): RowHint | null {
  switch (reason) {
    case "uncommitted-take":
      return { icon: "alert", label: strings.blockedByTake };
    case "no-audio":
      return { icon: "alert", label: strings.nothingRecorded };
    case "no-clip":
      return { icon: "alert", label: strings.nothingStored };
    case "denied":
    case "no-segment":
    case null:
      return null;
  }
}

interface MarkRowInputs {
  readonly hasView: boolean;
  /**
   * The take is COMMITTING — the close window or a requesting/processing state.
   * Deliberately narrower than the Edit/Erase rows' `takeActive`: Mark finished
   * stays live while recording or paused, because the mark rides the take through
   * `addTake` (the record-and-mark-done-in-one-sheet flow, G8/G10).
   */
  readonly takeCommitting: boolean;
  /** A finished mark can stick — false on a segment that has never been recorded. */
  readonly canFinish: boolean;
}

/**
 * The "Mark finished" row. Null when enabled. Reproduces
 * `finishedState === "disabled" || isClosing || busy`, with `canFinish` the
 * negation of that first term.
 *
 * Added in round 3: this row was the third boolean in the same menu, and it greyed
 * with no reason while Edit and Erase beside it explained themselves — so the
 * "one derivation" #135 claimed did not actually cover the menu (George, round 2).
 */
export function markRowReason(i: MarkRowInputs): RowReason | null {
  if (i.takeCommitting) return "uncommitted-take";
  if (!i.hasView || !i.canFinish) return "no-audio";
  return null;
}
