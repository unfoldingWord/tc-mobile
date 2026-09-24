/**
 * Why a recorder ≡-menu row is disabled — derived, never hand-maintained (#135).
 *
 * The Edit and Erase rows are gated on recorder state, and a grey row with no
 * reason read as a broken control to the requirements owner (2026-09-02,
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
 * The reasons, most actionable first. `"uncommitted-take"` marks a take in
 * flight, and closing the recorder is what lifts it. Edit shared Erase and
 * Mark's narrower scope once (#134: only the commit window blocked Edit, so a
 * live take could commit-then-edit in one tap) — #857 puts Edit back in step
 * with Erase: a LIVE take now blocks Edit too, the same as the commit window
 * does, because #614 gave every take a Stop that ends and commits it without
 * Edit's help, so the one-tap "stop and edit" #134 bought is no longer the
 * only way to reach Stop, then Edit. It outranks the state reasons because it
 * is the one the translator can act on from here. Nothing in this product is
 * named "Back"; see {@link rowHint}.
 */
export type RowReason =
  | "uncommitted-take"
  | "starting"
  | "denied"
  | "no-segment"
  | "no-audio"
  | "no-clip";

interface EditRowInputs {
  /** A segment is loaded (`view !== null`). */
  readonly hasView: boolean;
  /**
   * A take is being COMMITTED right now: the close window (Back tapped, the
   * stop→decode→save still in flight), or a #59 interruption's `processing`
   * freeze. Editing waits for that commit to settle.
   *
   * For a window, #134 narrowed this off the old "any non-idle state": a live
   * take no longer blocked Edit, because entering Edit COMMITS that take first
   * (stop → decode → save → reopen at idle) and then edits it — the
   * record-then-edit-in-one-sitting flow the requirements owner confirmed
   * required (2026-09-04). #857 reverses that half: `hasTake` now blocks
   * alongside `committing`, below, once a tester found a live take's selection
   * still openable mid-recording on a Moto G. Mirrors `markRowReason`'s
   * `takeCommitting`, which never adopted the #134 carve-out Edit is now
   * dropping.
   */
  readonly committing: boolean;
  /**
   * A live take exists (recorder `state === "recording"`). Blocks Edit the
   * same as `committing` does (#857) — `editRowReason` treats the two as one
   * reason, `"uncommitted-take"`, since #614 gave every take a Stop that ends
   * and commits it without Edit's help, so the #134 commit-then-edit shortcut
   * this field used to grant is no longer the only way to reach Stop, then
   * Edit. `RecorderState` (`hooks/use-recorder.ts`) is `"idle" | "requesting" |
   * "recording" | "processing"` — there is no separate "paused" state to fold
   * in here.
   */
  readonly hasTake: boolean;
  /**
   * The mic is being REQUESTED — `getUserMedia` has not resolved, so no take
   * exists to commit yet. Split from `committing` because the uncommitted-take
   * words ("…to save the recording") promise a save that cannot happen here.
   */
  readonly starting: boolean;
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
 * The record-menu "Edit recording" row, and (via `recorder.tsx`'s shared
 * `editReason`) the bottom-bar `[ ]` selection toggle. Null when enabled.
 *
 * Enabled when there is something to edit — stored audio or a full clipboard —
 * and no take is in flight. Blocked by: the mic still starting, a live take
 * (`hasTake`) or a commit already running (`committing`) — the two collapse to
 * one reason, `"uncommitted-take"`, since #857 — no segment, a denied mic, or
 * an empty segment with an empty clipboard and no stored audio. #134 once let
 * `hasTake` alone through so entering Edit would commit-then-edit a live take
 * in one tap; #857 (Moto G, tester report) closes that gap — `[ ]` read as
 * openable mid-recording — now that #614's Stop ends and commits a take
 * without Edit's help, so the two-tap Stop-then-Edit path #857 leaves behind
 * is no longer the only way to reach Edit from a live take.
 */
export function editRowReason(i: EditRowInputs): RowReason | null {
  if (i.starting) return "starting";
  if (i.committing || i.hasTake) return "uncommitted-take";
  if (!i.hasView) return "no-segment";
  if (i.denied) return "denied";
  if (!i.hasAudio && !i.canPaste) return "no-audio";
  return null;
}

interface EraseRowInputs {
  readonly hasView: boolean;
  readonly takeActive: boolean;
  /** The mic is being requested — see `EditRowInputs.starting`. */
  readonly starting: boolean;
  /** A stored clip exists — a first, uncommitted recording has nothing on disk. */
  readonly hasClip: boolean;
}

/**
 * The "Erase recording" row (both menus). Null when enabled. Reproduces
 * `!idleEditable || !view?.hasClip`. Erasing the stored take out from under a
 * live capture is nonsensical (George R-B6), so the take wins here too.
 */
export function eraseRowReason(i: EraseRowInputs): RowReason | null {
  if (i.starting) return "starting";
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
 * meaning the sheet's own commit control — which cannot be tapped, because at
 * the time the ≡ menu inerted the whole sheet while it was open, leaving the
 * menu's own Close as the one live back-chevron. The badge therefore marked the
 * DISMISS control as the way out. Round 2 then found that dropping the glyph
 * entirely left the cue in the accessible name only: invisible to the sighted
 * tester who reported #135, and skipped by Tab because the row was natively
 * `disabled`.
 *
 * (#368 narrowed the inert scope so a live take's transport is reachable
 * mid-take, but the header — and so header Back — stays inert under any
 * overlay regardless of `takeActive` (George R2 P2). So the premise above still
 * holds in both states: header Back is never a reachable control while this row
 * is visible, only the menu's own Close is, and the badge names no control for
 * the same reason it always has.)
 *
 * So the badge is back, as a STATE mark rather than a direction: `alert` says
 * "blocked, look here" and names no control, which is the one thing a glyph in
 * this overlay can honestly do. The words carry the way out, using the controls'
 * real accessible names. `Control` renders the badge and makes hinted rows
 * `aria-disabled` (focusable, announced, inert to activation) rather than natively
 * disabled, which is what puts the reason in reach of keyboard and switch users.
 *
 * `"starting"` is split from `"uncommitted-take"` because the words differ, not
 * the gate: while `getUserMedia` is still resolving there is no audio yet, so
 * "…to save the recording" would promise a save that cannot happen — and `close()`
 * does not treat `requesting` as an attempted capture, so a translator who
 * followed it would abandon the in-flight start (George, round 3). Reachable as a
 * short race: tap Record, then ≡ before the mic resolves.
 *
 * `denied` and `no-segment` carry no cue, on two DIFFERENT grounds — the earlier
 * "the opener is disabled, so no row is ever seen" covered both and was false for
 * `denied`, because a disabled opener only blocks OPENING and `denied` can turn on
 * while the menu is already up (George, round 4):
 *
 * - `denied` — the ≡ menu is now DISMISSED the moment `denied` turns on
 *   (`recorder.tsx`'s `menuShown`), so these rows genuinely cannot be seen under
 *   it. The permission panel is the reason, stated in full where the translator
 *   is looking; a badge on a hidden row would be a second, weaker copy of it.
 * - `no-segment` — `view` starts set when the sheet mounts, and the one thing that
 *   returns it to null while open is a failed `reload()` (`use-recorder-segment`'s
 *   `setView(null)`, the commit-then-edit reload miss #134 added). In THAT state the
 *   LoadErrorPanel owns the body and no menu row is rendered, so the hint is still
 *   never SEEN — dismissed by the panel, not merely unreachable. It exists to make
 *   the function total. (Corrected George R4 P3: the old "never returns to null"
 *   claim was false once reload gained a failure path.)
 */
export function rowHint(reason: RowReason | null): RowHint | null {
  switch (reason) {
    case "uncommitted-take":
      return { icon: "alert", label: strings.blockedByTake };
    case "starting":
      return { icon: "alert", label: strings.micStarting };
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

/**
 * The same reason, worn by a control on the record BAR rather than in the ≡
 * menu — the toolbar Edit (#315) and the bin (#592).
 *
 * Two differences from {@link rowHint}, both because the bar is not the menu:
 *
 * - No badge. The bar's controls sit in the translator's hand all session, and
 *   an `alert` mark on an empty segment's Edit or bin would read as something
 *   gone wrong on the first screen of every new segment. The reason stays in
 *   the accessible name, and the control goes `aria-disabled`, so keyboard and
 *   switch users still reach it.
 * - No words for `"uncommitted-take"`. `blockedByTake` sends the translator to
 *   "Close menu", then "Close recorder" — a menu the bar is not in, and during
 *   a take the bar's own Stop, beside it, is the way out. The control is
 *   plainly off instead: natively disabled while the take runs, but not while
 *   it commits. The toolbar Edit is also `busy={isClosing}` (recorder.tsx),
 *   and `Control` never natively disables a busy control, so through the
 *   commit it stays focusable and `aria-busy`, and swallows the click.
 */
export function barHint(reason: RowReason | null): { label: string } | null {
  if (reason === "uncommitted-take") return null;
  const hint = rowHint(reason);
  return hint === null ? null : { label: hint.label };
}

/**
 * Is the held-take recovery panel mid-operation, so its take must not be
 * dropped? (George R5 P1.)
 *
 * The panel holds the ONLY copy of a take whose decode failed (#165), and
 * Discard is the one control that destroys it. Two operations must hold it off:
 * a re-decode (`retrying`), and now a share (`sharing`) — because on the native
 * route a share is no longer "the OS sheet opens in this gesture". The chunked
 * cache write runs first, for seconds on a long take, and every chunk returns to
 * the event loop with the panel mounted and clickable. Two taps in that window
 * used to delete the recording out from under a share that had not yet reached
 * the chooser.
 *
 * One predicate, used by BOTH the control's `disabled` and the exit guard, for
 * the reason at the top of this file: a second switch elsewhere is a switch that
 * falls out of step. `closing` is deliberately NOT an input — it is the exit's
 * own re-entry latch, not a state the panel can see or show.
 */
export function heldTakeIsBusy(i: {
  readonly retrying: boolean;
  readonly sharing: boolean;
}): boolean {
  return i.retrying || i.sharing;
}

interface MarkRowInputs {
  readonly hasView: boolean;
  /**
   * The take is COMMITTING — the close window or a requesting/processing state.
   * Deliberately narrower than the Erase row's `takeActive` (the Edit row no
   * longer uses `takeActive` — since #134 it reaches Edit on a live/paused take
   * and splits that input into `committing`/`hasTake`): Mark finished stays live
   * while recording or paused, because the mark rides the take through `addTake`
   * (the record-and-mark-done-in-one-sheet flow, G8/G10).
   */
  readonly takeCommitting: boolean;
  /** The mic is being requested — see `EditRowInputs.starting`. */
  readonly starting: boolean;
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
  if (i.starting) return "starting";
  if (i.takeCommitting) return "uncommitted-take";
  if (!i.hasView || !i.canFinish) return "no-audio";
  return null;
}
