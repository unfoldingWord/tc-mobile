/**
 * The words the save-failure recovery screen shows, as pure functions.
 *
 * Pulled out of `save-failed.tsx` for the reason the repo pulls copy decisions
 * into a tested module (see `notice-tone.ts`, `menu-row-state.ts`): the wording
 * here is load-bearing, and this project has no renderer to test the component
 * with.
 *
 * Why it is load-bearing (#38): since the commit write became ONE transaction,
 * a FAILED save leaves nothing on disk — the clip write rolls back with the take
 * — so the recording exists only in the RAM slot `useSaveTake` holds. Any line
 * that sends the translator out of the app to act (the old "Free some space on
 * the phone, then try again") is therefore an instruction to risk the OS
 * discarding the PWA and taking the only copy with it. The guidance below never
 * does that: it names the condition and that this screen holds the only copy,
 * and leaves the acting to the Retry/Discard controls the screen already shows.
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
 * The line under Retry, or `null` for none. NEVER an instruction to leave the
 * app.
 *
 * `quota`: the recording is held only on this screen and the phone is full, so
 * the honest, safe message is that closing the app loses it — not "go free
 * space" (#38: that trip is exactly what discards the RAM-only take, and the
 * screen offers no in-app way to free space anyway). Shown from the FIRST
 * failure, because the loss risk is there from the first failure. Worded for the
 * held subject: a fresh recording, or the edited buffer of one (the prior take
 * survives on disk, so an edit-save's only-copy claim is about the changes).
 *
 * `unknown`: a transient failure Retry is likely to clear; the attempt count is
 * shown only once it has failed more than once, so a one-off blip carries no
 * extra copy.
 */
export function recoveryHint(args: {
  kind: SaveFailureKind | null;
  editOnly: boolean;
  attempts: number;
}): string | null {
  const { kind, editOnly, attempts } = args;
  if (kind === "quota") {
    return editOnly
      ? "This screen has the only copy of your changes. Don't close the app."
      : "This screen has the only copy of this recording. Don't close the app.";
  }
  return attempts > 1 ? `Attempts: ${attempts}` : null;
}
