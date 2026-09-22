/**
 * Every translator-facing sentence produced BELOW the component layer.
 *
 * `components/strings.ts` is the table for copy the UI writes itself. It cannot
 * be the whole surface: the onion forbids `hooks/` and `lib/` from importing
 * upward, so a sentence a hook returns — a mic refusal, a failed decode, a
 * failed stop — had nowhere to live but inline in the hook. `use-recorder.ts`
 * said so in a comment ("`hooks/` cannot reach the components' string table"),
 * and the result was a set of sentences scattered across two hooks, several of
 * them written out at more than one call site. This module is the other half of
 * the table, at the layer both sides can reach.
 *
 * Nothing here is locale-aware yet, and this module does not make it so — #169
 * still owns `strings[locale]`, the plural helper, `lang`/`dir`, and the
 * English book names persisted in IndexedDB. What it buys is that the sentences
 * are enumerable from two modules rather than from a grep, and that
 * `tests/strings-centralised.test.ts` can hold them there.
 *
 * DOM-free and dependency-free on purpose, so `typecheck:lib` covers it and a
 * Worker could read it.
 */

import type { MicRefusal } from "./audio/mic-refusal";
import type { StopDecodeError } from "./audio/stop-decode";

export const messages = {
  // ── Starting a recording ──────────────────────────────────────────────────
  /** No `MediaRecorder`, or no codec this build can use. */
  recordUnsupported: "This device cannot record audio.",

  // ── Microphone refusals (#203) ────────────────────────────────────────────
  // One honest sentence per `classifyMicRefusal` class. The classifier stays
  // UI-free in `lib/audio/mic-refusal.ts`; the words are here.
  micNoDevice: "No microphone was found on this device.",
  micSiteBlocked:
    "Recording is blocked for this app. Allow the microphone in your browser's site settings, then try again.",
  micOsBlocked:
    "Your device is not letting the app use the microphone. Check microphone access in your device settings, then try again.",
  micPrompt:
    "Microphone access is needed to record. Allow it when asked — or if you already allowed it, check your device settings.",
  micOther: "Could not start recording.",

  // ── Finishing a recording ─────────────────────────────────────────────────
  /**
   * The capture held no audio. Also the retry path's answer when a re-decode
   * yields zero samples (#165) — ambiguous there rather than proven silence,
   * which is why the caller keeps the bytes; the sentence is the same.
   */
  recordSilent: "No sound was recorded. Try again.",
  /** The bytes exist but this device's decoder refused them (#165). */
  recordUndecodable: "Recording could not be decoded on this device.",
  /**
   * The engine failed, rather than the translator being silent: a native
   * `stop()` that threw inside the flush and sealed nothing (#485), and
   * `stopRecording`'s own backstop (#480). Chosen over `recordSilent` at both,
   * deliberately — see `lib/takes/close-plan.ts` and the facilitator runbook.
   */
  recordStopFailed: "Could not finish this recording.",

  // ── Playing a recording back ──────────────────────────────────────────────
  /**
   * Every playback failure the translator sees, from all three sites in
   * `use-audio-session.ts`: a clip the database cannot resolve, a `playTake`
   * rejection, and a `playBuffer` rejection. One sentence, because from where
   * they sit the three are the same event — they tapped play and heard nothing.
   */
  playbackFailed: "Could not play this recording.",
} as const;

/** The sentence for each `classifyStopDecode` class, or null when there is none. */
export function stopDecodeMessage(error: StopDecodeError): string | null {
  switch (error) {
    case "silence":
      return messages.recordSilent;
    case "undecodable":
      return messages.recordUndecodable;
    case null:
      return null;
  }
}

/** The sentence for each `classifyMicRefusal` class (#203). */
export function micRefusalMessage(refusal: MicRefusal): string {
  switch (refusal) {
    case "no-device":
      return messages.micNoDevice;
    case "site-blocked":
      return messages.micSiteBlocked;
    case "os-blocked":
      return messages.micOsBlocked;
    case "prompt":
      return messages.micPrompt;
    case "other":
      return messages.micOther;
  }
}
