/**
 * Which words the save-failure recovery screen shows — the rules, not the
 * sentences.
 *
 * Pulled out of `save-failed.tsx` for the reason this repo lifts copy and state
 * decisions into a tested, DOM-free module (see `lib/takes/pending-take.ts` and
 * `hooks/save-failure.ts`, lifted for exactly this): the choices here are
 * load-bearing, and this project has no renderer to test the component with.
 *
 * Why they are load-bearing (#38): since the commit write became ONE
 * transaction, a FAILED save leaves nothing on disk — the recording is held only
 * in the RAM slot `useSaveTake` keeps — whatever the cause (a quota rejection
 * rolls the whole transaction back; a merge throw or an IndexedDB `AbortError`
 * keeps the samples in the slot just the same). Any line that sends the
 * translator out of the app to act (the old "Free some space on the phone, then
 * try again") is therefore an instruction to risk the OS discarding the PWA and
 * taking the only copy with it. The lines chosen below never do that: they name
 * the condition and that this screen holds the only copy, and leave the acting
 * to the Retry/Discard controls.
 *
 * The sentences themselves live in `strings.ts` (#169), with the wording
 * rationale beside each. This module decides which of them a given failure
 * gets, and when to say nothing at all — a locale changes the table, not this
 * file.
 */

import { strings } from "./strings";
import type { SaveFailureKind } from "@/hooks/save-failure";
import type { RestartSubject } from "./strings";

/**
 * The headline. `quota` is the same either way — the phone is full whether the
 * held work is a recording or an edit — but the other lines name what could not
 * be saved, so the two paths read honestly.
 */
export function recoveryTitle(
  kind: SaveFailureKind,
  editOnly: boolean
): string {
  if (kind === "quota") return strings.recoveryTitleQuota;
  if (kind === "downgrade") return strings.recoveryTitleDowngrade(editOnly);
  if (kind === "stale") return strings.recoveryTitleStale(editOnly);
  return strings.recoveryTitleUnknown(editOnly);
}

/**
 * The safety line shown under Retry on EVERY failed save — never an instruction
 * to leave the app.
 *
 * NOT gated on `quota`: a failed save is RAM-only whatever the cause. A
 * `mergeTake` throw or an IndexedDB `AbortError` classifies as `unknown`, and
 * `failSave` keeps the samples in the slot exactly as a quota failure does, so
 * the don't-close warning applies to all of them. `kind` was added only for the
 * two cases where staying in the app cannot help at all, and defaults to `null`
 * so every other caller keeps the unconditional warning.
 */
export function recoverySafetyLine(
  editOnly: boolean,
  kind: SaveFailureKind | null = null
): string {
  if (kind === "downgrade") return strings.recoverySafetyDowngrade(editOnly);
  if (kind === "stale") return strings.recoverySafetyStale(editOnly);
  return strings.recoverySafetyHeld(editOnly);
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
 * One function rather than two so the two surfaces cannot drift into arming on
 * different terms.
 *
 * What a screen should say about that loss BEFORE the control is armed — and
 * whether anything could rescue the audio first — is the product question on
 * #441; this is the minimum that keeps the tap honest.
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
  return strings.restartArmedLabel(subject, alsoCutAudio);
}

/**
 * A faint attempt count, or `null`. Only for an `unknown` failure that has
 * failed more than once: a quota failure's cause is already named by the title,
 * and a single blip needs no count. Never stands in for the safety line above —
 * it is an extra line beside it.
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
  return attempts > 1 ? strings.recoveryAttemptsLine(attempts) : null;
}
