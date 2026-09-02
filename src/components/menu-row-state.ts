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

/** A disabled row's cue: the spoken reason, and a glyph when one earns it. */
export interface RowHint {
  /** A small badge glyph on the row — only where it points at the way out. */
  readonly icon?: IconName;
  /** Appended to the row's accessible name while disabled. */
  readonly label: string;
}

/**
 * Which reasons get a cue. An uncommitted take shows the Back glyph — the row
 * is grey BECAUSE Back has not been tapped, and that glyph is already the sheet's
 * own commit control, so it points at the way out without a word. An empty
 * segment speaks its reason to a screen reader but shows no glyph: a grey Edit
 * over nothing is legible on its own, and a mark there would add weight for no
 * information. `denied` and `no-segment` carry nothing because the menu opener is
 * itself disabled in both states (`recorder.tsx`, `disabled={!view || isClosing
 * || denied}`), so no row is ever seen under them.
 */
export function rowHint(reason: RowReason | null): RowHint | null {
  switch (reason) {
    case "uncommitted-take":
      return { icon: "back", label: strings.blockedByTake };
    case "no-audio":
      return { label: strings.nothingRecorded };
    case "no-clip":
      return { label: strings.nothingStored };
    case "denied":
    case "no-segment":
    case null:
      return null;
  }
}
