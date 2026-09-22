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

import { strings } from "./strings";
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
  // Named as the condition it is, not as a failure that might go the other way
  // next time: another copy of the app has moved the data past this build, so
  // every further attempt from here fails the same way. The line says what is
  // needed rather than what went wrong, because that is the only thing left
  // that is true (George R1 P2-1).
  if (kind === "downgrade") {
    return editOnly
      ? "Your changes need the new version of the app."
      : "This recording needs the new version of the app.";
  }
  if (kind === "stale") {
    return editOnly
      ? "This book is gone. Your changes cannot be saved."
      : "This book is gone. This recording cannot be saved.";
  }
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
 * the don't-close warning applies to all of them. `kind` was added only for the
 * single case where staying in the app cannot help at all, and defaults to
 * `null` so every other caller keeps the unconditional warning.
 *
 * Worded for what is actually RAM-only. On the record path `saveTake` rolls back
 * on failure, so the prior take (if any) survives on disk — but what does not is
 * more than the new fragment: under Model A the working buffer being saved also
 * carries any in-session cut/paste edits, and `discardSave` drops the whole
 * recipe. "your unsaved work" covers both the new recording and those edits
 * (George G5), where "what you just recorded" was silent about the cuts. The edit
 * path's subject is the edited buffer, whose prior stored take likewise survives.
 */
export function recoverySafetyLine(
  editOnly: boolean,
  kind: SaveFailureKind | null = null
): string {
  // The ONE exception to "never send them out of the app", and it exists because
  // the rule's premise fails here: staying is what keeps the work unsaveable.
  // This build cannot open the store at all — a newer copy has moved the data
  // past it — so "Don't close the app" forbids the only thing that can help,
  // while the title above asks for exactly that (George R2 P2-1).
  //
  // What this line does NOT say is what becomes of the held recording across
  // that restart. It is RAM-only and does not survive, and whether this screen
  // should say so — and whether anything can be done to rescue it first — is a
  // product question tracked on #441, not one to settle in a copy string.
  if (kind === "downgrade") {
    return editOnly
      ? "This copy of the app cannot save them. Restart to get the new version."
      : "This copy of the app cannot save it. Restart to get the new version.";
  }
  if (kind === "stale") {
    return editOnly
      ? "This book was deleted in another copy of the app. Discard is the only exit."
      : "This book was deleted in another copy of the app. Delete this recording to leave.";
  }
  return editOnly
    ? "This screen has the only copy of your changes. Don't close the app."
    : "This screen has the only copy of your unsaved work. Don't close the app.";
}

/**
 * The label on a restart control that would destroy audio held only in memory,
 * in each of its two taps.
 *
 * Two taps, like the Discard beside it on this screen, because it is the same
 * kind of action: the held audio is RAM-only, and reloading the document
 * destroys it. A one-tap control that throws away the only copy of a recording
 * is the exact loss these screens exist to prevent (Frank R4 P1).
 *
 * Shared with `DatabasePanel`, which grew the same two taps for the same reason
 * (George R4 P1): once the panel is allowed to show over a full clipboard, its
 * restart is the one control on screen and the cut phrase does not survive it.
 * One function rather than two so the two surfaces cannot drift into saying
 * different things about the same loss.
 *
 * The armed label names the loss rather than only the action. It is the last
 * thing the translator reads before the audio is gone, so it does not say
 * "restart" and leave them to work the rest out. What a screen should say about
 * that loss BEFORE the control is armed — and whether anything could rescue the
 * audio first — is the product question on #441; this is the minimum that keeps
 * the tap honest.
 *
 * `alsoCutAudio` is the second thing one tap can destroy at once, and it is why
 * this is composed rather than enumerated (George R5 P2). `SaveFailed` outranks
 * `DatabasePanel` while a take is held, so on the terminal `downgrade` screen the
 * restart is reached with a cut phrase in the clipboard that the reload drops
 * too — and the panel that would have named it cannot mount. Enumerating that
 * would have taken a three-value `subject` to six cases and made the next axis
 * twelve; the loss phrase is built instead, so a third thing to lose costs one
 * clause rather than doubling the table. The full strings live in
 * `tests/recovery-copy.test.ts`, which is where to grep for them.
 */
export function restartLabel(
  subject: RestartSubject,
  armed: boolean,
  alsoCutAudio = false
): string {
  // The unarmed label is the SAME control the crash screen and the database
  // panel offer, so it reads from their key rather than repeating it here
  // (#169). A screen reader speaks the label and nothing else; two copies of it
  // would mean one surface could start saying something different from the
  // others after a wording edit, with nothing to notice.
  if (!armed) return strings.appReload;
  return `Tap again to restart and lose ${lossPhrase(subject, alsoCutAudio)}`;
}

/**
 * The line under an ARMED restart, saying what the next tap costs.
 *
 * Both surfaces had this inline and identical in shape; it is here for the same
 * reason the label is — it makes the same claim, and the two must not drift.
 * Shorter than the label on purpose: the label is the thing being tapped, this
 * is the confirmation beside it.
 */
export function restartConsequence(
  subject: RestartSubject,
  alsoCutAudio = false
): string {
  const phrase = lossPhrase(subject, alsoCutAudio);
  const plural =
    subject === "changes" || carriesCutAudio(subject, alsoCutAudio);
  return `Tap again and ${phrase} ${plural ? "are" : "is"} gone.`;
}

/** What the restart destroys, named. */
type RestartSubject = "recording" | "changes" | "cutAudio";

/**
 * Whether the cut phrase has to be named ON TOP of the subject.
 *
 * `cutAudio` already IS the cut phrase — `DatabasePanel` passes it with nothing
 * else in hand — so adding the clause there would say the same thing twice.
 */
function carriesCutAudio(
  subject: RestartSubject,
  alsoCutAudio: boolean
): boolean {
  return alsoCutAudio && subject !== "cutAudio";
}

function lossPhrase(subject: RestartSubject, alsoCutAudio: boolean): string {
  const base =
    subject === "changes"
      ? "these changes"
      : subject === "cutAudio"
        ? "the audio you cut"
        : "this recording";
  return carriesCutAudio(subject, alsoCutAudio)
    ? `${base} and the audio you cut`
    : base;
}

/**
 * A faint attempt count, or `null`. Only for an `unknown` failure that has failed
 * more than once: a quota failure's cause is already named by the title, and a
 * single blip needs no count. Never stands in for the safety line above — it is
 * an extra line beside it.
 *
 * Suppressed for `downgrade` and `stale` for a stronger reason than for
 * `quota`. A count is a nudge to try once more, and here once more cannot work
 * however many times it is tried — the title already says what is actually
 * needed.
 */
export function recoveryAttempts(
  kind: SaveFailureKind | null,
  attempts: number
): string | null {
  if (kind === "quota" || kind === "downgrade" || kind === "stale") return null;
  return attempts > 1 ? `Attempts: ${attempts}` : null;
}
