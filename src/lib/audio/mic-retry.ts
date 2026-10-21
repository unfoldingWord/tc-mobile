import { strings } from "@/lib/strings";

/**
 * Where the permission panel's Retry is, for the phone-settings steps (#1569).
 * The steps belong to a SECOND refusal, so the panel has to know that a retry
 * attempt was made AND has come back refused, not merely that Retry was tapped.
 *
 * - `none`: no retry in play (the first refusal, or a take has since started).
 * - `tapped`: Retry was tapped; the recorder has not yet reported it requesting.
 * - `inflight`: the recorder was seen requesting the microphone.
 * - `refused`: the attempt settled back at idle with a recorder error.
 */
export type MicRetryPhase = "none" | "tapped" | "inflight" | "refused";

/** The recorder's own states, restated so `lib/` does not import `hooks/`. */
export type MicRetryRecorderState =
  "idle" | "requesting" | "recording" | "processing";

/** The Retry tap. Always restarts the sequence at `tapped`. */
export const MIC_RETRY_TAPPED: MicRetryPhase = "tapped";

/**
 * One step of the sequence, a pure function of what the recorder reports. A
 * take recording ends it from any phase, so a later, unrelated refusal starts
 * over at the first-refusal panel.
 */
export function nextMicRetryPhase(
  phase: MicRetryPhase,
  recorderState: MicRetryRecorderState,
  hasRecorderError: boolean
): MicRetryPhase {
  if (recorderState === "recording") return "none";
  switch (phase) {
    case "none":
    case "refused":
      return phase;
    case "tapped":
      return recorderState === "requesting" ? "inflight" : phase;
    case "inflight":
      return recorderState === "idle" && hasRecorderError ? "refused" : phase;
  }
}

/**
 * True only when a retry attempt has settled AND the failure now on screen is
 * a permission refusal. The recorder's error is a sentence, so a permission
 * refusal is one of the three sentences `classifyMicRefusal` words as one; a
 * missing device, an unsupported browser or a failed start is not, and the
 * settings steps would not help it.
 */
export function showMicSettingsSteps(
  phase: MicRetryPhase,
  recorderError: string | null
): boolean {
  if (phase !== "refused" || recorderError === null) return false;
  return (
    recorderError === strings.micSiteBlocked ||
    recorderError === strings.micOsBlocked ||
    recorderError === strings.micPrompt
  );
}
