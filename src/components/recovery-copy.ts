/**
 * The words the save-failure recovery screen shows, as pure functions.
 *
 * Pulled out of `save-failed.tsx` for the reason this repo lifts copy and state
 * decisions into a tested, DOM-free module (see `lib/takes/pending-take.ts` and
 * `hooks/save-failure.ts`, lifted for exactly this): the wording here is
 * load-bearing, and this project has no renderer to test the component with.
 *
 * Why it is load-bearing (#38): since the commit write became ONE transaction, a
 * FAILED save leaves nothing on disk — the recording is held only in the RAM slot
 * `useSaveTake` keeps — whatever the cause (a quota rejection rolls the whole
 * transaction back; a merge throw or an IndexedDB `AbortError` keeps the samples
 * in the slot just the same). Any line that sends the translator out of the app
 * to act (the old "Free some space on the phone, then try again") is therefore an
 * instruction to risk the OS discarding the PWA and taking the only copy with it.
 * The lines below never do that: they name the condition and that this screen
 * holds the only copy, and leave the acting to the Retry/Discard controls.
 */

import type { SaveFailureKind } from "@/hooks/save-failure";

/**
 * The headline. `quota` is the same either way — the phone is full whether the
 * held work is a recording or an edit — but the `unknown` line names what could
 * not be saved so the two paths read honestly.
 */
export function recoveryTitle(
  kind: SaveFailureKind,
  editOnly: boolean
): string {
  if (kind === "quota") return "No room left on this phone.";
  return editOnly
    ? "Your changes could not be saved."
    : "This recording could not be saved.";
}

/**
 * The safety line shown under Retry on EVERY failed save — never an instruction
 * to leave the app.
 *
 * NOT gated on `quota`: a failed save is RAM-only whatever the cause. A
 * `mergeTake` throw or an IndexedDB `AbortError` classifies as `unknown`, and
 * `failSave` keeps the samples in the slot exactly as a quota failure does, so
 * the don't-close warning applies to all of them — hence no `kind` parameter.
 *
 * Worded for what is actually RAM-only. On the record path `saveTake` rolls back
 * on failure, so the prior take (if any) survives on disk — but what does not is
 * more than the new fragment: under Model A the working buffer being saved also
 * carries any in-session cut/paste edits, and `discardSave` drops the whole
 * recipe. "your unsaved work" covers both the new recording and those edits
 * (George G5), where "what you just recorded" was silent about the cuts. The edit
 * path's subject is the edited buffer, whose prior stored take likewise survives.
 */
export function recoverySafetyLine(editOnly: boolean): string {
  return editOnly
    ? "This screen has the only copy of your changes. Don't close the app."
    : "This screen has the only copy of your unsaved work. Don't close the app.";
}

/**
 * A faint attempt count, or `null`. Only for an `unknown` failure that has failed
 * more than once: a quota failure's cause is already named by the title, and a
 * single blip needs no count. Never stands in for the safety line above — it is
 * an extra line beside it.
 */
export function recoveryAttempts(
  kind: SaveFailureKind | null,
  attempts: number
): string | null {
  return kind !== "quota" && attempts > 1 ? `Attempts: ${attempts}` : null;
}
