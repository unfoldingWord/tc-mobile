/**
 * Classify why the microphone was refused, so the recorder can say something
 * true rather than the one sentence it said for every case (#203).
 *
 * `getUserMedia` reports a refusal as a single `NotAllowedError` whether the
 * translator tapped "no", the site is blocked for this origin, or the operating
 * system denies the browser the microphone entirely — situations the old copy
 * collapsed into one "you denied it" sentence (#203). What actually differs is
 * the REMEDY, and for a `NotAllowedError` the Permissions API separates two that
 * matter: state `denied` → the browser's per-site settings; state `granted` →
 * the OS/device settings (the #195 case — the site has the mic, the layer
 * beneath refuses it). Tapped-"no" folds into `denied` on purpose: once the tap
 * has flipped the stored state, the platform cannot tell it from a site block
 * and the fix is the same. iOS Safari has no Permissions API, so `"unknown"` is
 * a real, common input, not an error.
 *
 * `prompt` is deliberately NOT the OS case. A dismissed prompt (X, tap-outside,
 * Esc) leaves the state at `prompt` and throws `NotAllowedError`, and there the
 * remedy is to tap Record again and Allow — Retry re-issues `getUserMedia` and
 * re-prompts. Reading `prompt` as an OS block would send that translator to the
 * one place that cannot help, the exact inverse of #203 (Frank + George R1 P2).
 * So `prompt` gets the indeterminate copy, and `os-blocked` is reserved for
 * `granted`.
 *
 * This is the pure decision, extracted from the browser boundary
 * (`navigator.mediaDevices` / `navigator.permissions`, both in `hooks/`) so it
 * can be tested in Node.
 */

/** What `navigator.permissions.query({name:"microphone"})` can report — plus
 *  `"unknown"` for the platforms (iOS Safari) that do not implement it. */
export type MicPermissionState = "granted" | "denied" | "prompt" | "unknown";

export type MicRefusal =
  /** No microphone on the device — `NotFoundError`. */
  | "no-device"
  /** Blocked for this origin (the state reads `denied`): the site prompt will
   *  not reappear; the fix is the browser's per-site settings. Covers a "no" tap
   *  that has already flipped the stored permission to denied. */
  | "site-blocked"
  /** The site HAS the mic (state `granted`) yet capture was refused — the
   *  operating system denies the browser the microphone. The fix is device
   *  settings; nothing inside the browser can grant it (#195). */
  | "os-blocked"
  /** Indeterminate — a refusal while the state reads `prompt` (a dismissed
   *  prompt) or is hidden entirely (iOS). Ask to allow it (Retry re-prompts),
   *  and point at settings for the already-allowed case, without over-claiming
   *  which it is. */
  | "prompt"
  /** Not a permission refusal at all. */
  | "other";

export function classifyMicRefusal(
  errorName: string | undefined,
  permission: MicPermissionState
): MicRefusal {
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "no-device";
  }
  if (errorName !== "NotAllowedError") return "other";
  switch (permission) {
    case "denied":
      // A stored refusal for this origin (an earlier "no", or a site block).
      return "site-blocked";
    case "granted":
      // The site is not the thing saying no — the layer beneath it is (#195).
      return "os-blocked";
    case "prompt":
    case "unknown":
      // Indeterminate: a dismissed prompt, or a platform (iOS) that hides the
      // state. Retry can still re-prompt, so never send them to device settings
      // as if it were the OS case (Frank + George R1 P2).
      return "prompt";
  }
}
