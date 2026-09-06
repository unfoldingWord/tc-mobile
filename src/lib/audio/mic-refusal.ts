/**
 * Classify why the microphone was refused, so the recorder can say something
 * true rather than the one sentence it said for every case (#203).
 *
 * `getUserMedia` reports a refusal as a single `NotAllowedError` whether the
 * translator tapped "no", the site is blocked for this origin, or the operating
 * system denies the browser the microphone entirely — three situations with
 * three different remedies, of which the old copy named only the first. The
 * Permissions API separates them where it is supported; iOS Safari does not
 * implement it, so `"unknown"` is a real, common input, not an error.
 *
 * This is the pure decision, extracted from the browser boundary
 * (`navigator.mediaDevices` / `navigator.permissions`, both in `hooks/`) so it
 * can be tested in Node. The rule that earns its keep: a refusal seen while the
 * permission reads `granted` or `prompt` is the operating-system case — the
 * remedy is device settings, NOT the site prompt the app used to send everyone
 * to, which cannot help there (the #195 hour lost with a debugger).
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
  /** The browser has (or can request) the mic, yet capture was refused — the
   *  operating system denies the browser the microphone. The fix is device
   *  settings; nothing inside the browser can grant it. */
  | "os-blocked"
  /** Indeterminate — a refusal on a platform that hides the permission state
   *  (iOS). Ask to allow it, and point at settings for the already-allowed case,
   *  without over-claiming which it is. */
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
    case "prompt":
      // The site is not the thing saying no — the layer beneath it is (#195).
      return "os-blocked";
    case "unknown":
      // iOS Safari and anything else without the Permissions API.
      return "prompt";
  }
}
