/**
 * Why a grey edit-toolbar history control is grey — derived, never
 * hand-maintained (#91, by #135's rule for the ≡-menu rows).
 *
 * #91 names select, cut, paste and zoom as the least self-evident affordances
 * in the app for a translator who may not read: abstract, icon-only, and used
 * far less often than record and play. Undo and Redo are the same class and
 * were not on that list. They are also the ones that sit grey the LONGEST —
 * an edit session opens with no history at all, so both arrows are inert from
 * the moment edit mode is entered until the first cut or paste. Neither is
 * inert only then: Undo greys again whenever the cursor is undone back to the
 * start, and Redo at every tip of the stack. (That is the MOTIVATION for the cue;
 * it is not what the cue asserts — see {@link editControlHint}.) An icon-only
 * control that is grey for
 * a reason nobody states is the finding #135 already recorded once, in the ≡
 * menu: "a grey row with no reason read as a broken control to the
 * requirements owner" (2026-09-02, staging v0.1.10).
 *
 * AGENTS.md's bar is state-in-place — the control itself shows the condition —
 * and `menu-row-state.ts` is the shape that bar already took here. This module
 * is the same shape for the toolbar, and the rule it inherits is the one that
 * matters: the cue must come from the SAME predicate that disables the
 * control, or the two drift and the control lies. So each control's `disabled`
 * becomes `reason !== null`, and the cue is a function of that reason. There
 * is no second switch to fall out of step.
 *
 * Pure and renderer-free on purpose — `tests/edit-control-state.test.ts` pins
 * the gates these reproduce, in plain Node, against `heldByDrag` itself.
 */

import type { IconName } from "./icon";
import { strings } from "./strings";

/**
 * The reasons, most actionable first.
 *
 * `"held-by-drag"` and `"sheet-busy"` outrank the history reasons because they
 * outrank them in the shipped gate: `heldByDrag(dragging, !idleEditable ||
 * !canUndo)` is a disjunction, and a control blocked by a finger on the stage
 * is blocked whatever the history says. Ordering them this way is what lets
 * `reason !== null` reproduce that disjunction exactly.
 *
 * The two history ids name a POSITION IN THE STACK, not a fact about the
 * session, because that is all their predicates know. Round 1 called them
 * `no-edits` and `nothing-undone`, which George round 1 caught as teaching the
 * next caller the same conflation the copy had made — see {@link editControlHint}.
 */
export type EditControlReason =
  "held-by-drag" | "sheet-busy" | "nothing-to-undo" | "nothing-to-redo";

interface HistoryControlInputs {
  /**
   * A pointer is mid-pan on the stage — the #317 lock both history controls
   * carry (George R2 P1 on Undo, George R4 on Redo). Undo and Redo
   * rematerialise `working`, and a lift still owing a resume would sound a
   * sample index measured in the buffer that no longer exists.
   */
  readonly dragging: boolean;
  /**
   * `recorder.tsx`'s `idleEditable` — a segment is loaded, the recorder is at
   * idle, and no commit is in flight.
   */
  readonly idleEditable: boolean;
}

/**
 * The edit toolbar's Undo. Null when enabled. Reproduces
 * `heldByDrag(dragging, !idleEditable || !editor.canUndo)`.
 */
export function undoReason(
  i: HistoryControlInputs & { readonly canUndo: boolean }
): EditControlReason | null {
  if (i.dragging) return "held-by-drag";
  if (!i.idleEditable) return "sheet-busy";
  if (!i.canUndo) return "nothing-to-undo";
  return null;
}

/**
 * The edit toolbar's Redo. Null when enabled. Reproduces
 * `heldByDrag(dragging, !idleEditable || !editor.canRedo)`.
 */
export function redoReason(
  i: HistoryControlInputs & { readonly canRedo: boolean }
): EditControlReason | null {
  if (i.dragging) return "held-by-drag";
  if (!i.idleEditable) return "sheet-busy";
  if (!i.canRedo) return "nothing-to-redo";
  return null;
}

/** A disabled control's cue: a visible state mark, and the reason in words. */
export interface EditControlHint {
  /**
   * A small badge on the control. `"alert"` — a STATE mark meaning "blocked,
   * look here" — never a glyph that names a control, for the reason
   * `menu-row-state.ts`'s `rowHint` records at length: a control glyph in a
   * cue points somewhere, and the place it points is not always reachable.
   */
  readonly icon?: IconName;
  /** Appended to the control's accessible name while disabled. */
  readonly label: string;
}

/**
 * Which reasons get a cue, what it shows, and what it says.
 *
 * **The words describe the CURRENT END OF THE STACK, never the session's
 * past**, because that is the only thing `canUndo`/`canRedo` know: they are
 * `cursor > 0` and `cursor < ops.length` (`lib/audio/edit-log.ts`). Round 1 of
 * this module shipped "No edits to undo yet." and "Nothing has been undone.",
 * and George round 1 showed both are false in reachable states — undo once and
 * Undo greys while saying no edit was ever made; redo back to the tip and Redo
 * greys while saying nothing was ever undone. A sentence that reads precise and
 * is false is the defect class this repo tracks hardest, and the cue is worse
 * than no cue when it is wrong. `tests/edit-control-state.test.ts` now bans the
 * tense that made the claim, so the wording cannot drift back.
 *
 * **Only the two history reasons get a cue**, and the two that do not are left
 * out on different grounds:
 *
 * - `"held-by-drag"` lasts exactly as long as the translator's own finger is
 *   on the stage, and the control is live again on lift. A badge that appears
 *   and clears on every pan is not state-in-place, it is flicker — and it
 *   would fire on the gesture least likely to be a reach for Undo.
 *
 *   **A pan therefore REMOVES an explanation that was already on screen, and
 *   that is accepted** (George round 3 asked for this sentence by name). On a
 *   fresh edit session both arrows read "Nothing to undo." / "Nothing to redo.";
 *   the first scrub clears both cues until pointer-up, then restores them.
 *   Scrubbing is the gesture edit mode exists for, so the blink is frequent.
 *
 *   **Do not repair it by attaching a hint while `dragging` is true.** A
 *   non-null hint moves `Control` from the native `disabled` attribute onto
 *   `aria-disabled` (`control.tsx`), and the #317 finger lock has to stay a
 *   HARD disable — `tests/control-render.test.ts` pins that cell precisely so
 *   this cannot be softened by accident. The cue is worth less than the lock.
 *   If the blink is ever judged worth fixing, the fix is to teach `Control` to
 *   paint a badge on a natively disabled button, which is `Control`'s contract
 *   and not this module's.
 * - `"sheet-busy"` is, in edit mode, `isClosing` and essentially nothing else:
 *   `idleEditable` is `view !== null && state === "idle" && !isClosing`, a
 *   null `view` puts `LoadErrorPanel` over the body so no toolbar is rendered,
 *   and edit mode is idle-only regardless (the note the Redo control has
 *   carried since George R4). So the one reachable case is a sheet already
 *   committing and going away, where a cue explains a control the translator
 *   is about to lose. Same shape of argument as `rowHint`'s `no-segment`: it
 *   exists to make the function total, not because it is seen.
 *
 * **The words are pure statements of state — they name no control and no
 * gesture.** Both ways out are already implied by the state itself, so there is
 * nothing to point at, and pointing is where this
 * repo's cue copy has gone wrong twice: round 1 of #135 badged a row with the
 * glyph of a control the overlay made untappable, and #648 round 1 caught the
 * words repeating that mistake. `strings.blockedByTake` has to name controls
 * because its way out is two taps the translator would not guess; these two do
 * not, so they do not.
 */
export function editControlHint(
  reason: EditControlReason | null
): EditControlHint | null {
  switch (reason) {
    case "nothing-to-undo":
      return { icon: "alert", label: strings.nothingToUndo };
    case "nothing-to-redo":
      return { icon: "alert", label: strings.nothingToRedo };
    case "held-by-drag":
    case "sheet-busy":
    case null:
      return null;
  }
}
