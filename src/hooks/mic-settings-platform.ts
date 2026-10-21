import { readSharePlatform, type SharePlatform } from "./share-target";

/**
 * Which native shell's settings walk-through the mic panel shows after a
 * second refusal (#1569). Only the two Capacitor shells have one; every
 * browser, installed web app included, gets `null` and keeps the panel as it
 * was (browser walk-throughs are #1589).
 */
export type MicSettingsPlatform = "android-app" | "ios-app";

/**
 * The decision as a pure function over Capacitor's platform id, so a test can
 * drive every row. A browser reads as `"web"` however it identifies itself.
 */
export function micSettingsPlatformFrom(
  share: SharePlatform
): MicSettingsPlatform | null {
  if (share === "android") return "android-app";
  if (share === "ios") return "ios-app";
  return null;
}

/** Read the running build. */
export function readMicSettingsPlatform(): MicSettingsPlatform | null {
  return micSettingsPlatformFrom(readSharePlatform());
}
