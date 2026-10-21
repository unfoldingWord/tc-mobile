import { readSharePlatform, type SharePlatform } from "./share-target";

/**
 * Which phone's settings walk-through the mic panel shows after a second
 * refusal (#1569). The four builds the app runs on where a person can turn
 * the microphone back on; `null` is anything else (a desktop browser), which
 * keeps the panel as it was.
 */
export type MicSettingsPlatform =
  "android-app" | "android-chrome" | "ios-app" | "ios-safari";

/**
 * The decision as a pure function over what the browser reported, so a test
 * can drive every row. The native shells are named by Capacitor's id and win
 * over the user agent; otherwise Android is read from the user agent, and iOS
 * from it too, plus the iPad that reports itself as a Mac with a touch screen.
 *
 * `standalone` is true when the page runs as an installed PWA, not in a
 * browser tab; the native shells are named before it is read.
 *
 * Browsers other than Chrome on Android and Safari on iOS get no steps: the
 * wording is not known to match their menus.
 */
export function micSettingsPlatformFrom(
  share: SharePlatform,
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
  standalone: boolean
): MicSettingsPlatform | null {
  if (share === "android") return "android-app";
  if (share === "ios") return "ios-app";
  // An installed PWA has no address bar or browser menu, so the two browser
  // walk-throughs would point at controls that are not there. No steps for it
  // until its own wording is checked on a device.
  if (standalone) return null;
  if (/Android/.test(userAgent)) {
    const chrome =
      /Chrome\//.test(userAgent) &&
      !/(EdgA|OPR|SamsungBrowser)\//.test(userAgent);
    return chrome ? "android-chrome" : null;
  }
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  if (!ios) return null;
  // Chrome, Firefox, Edge and Opera on iOS carry their own markers; they do
  // not have Safari's address-bar menu.
  if (/(CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent)) return null;
  // Safari announces itself with both markers; a bare WebView has neither and
  // does not have Safari's aA menu.
  return /Version\//.test(userAgent) && /Safari\//.test(userAgent)
    ? "ios-safari"
    : null;
}

/** True when the page runs as an installed PWA rather than in a browser tab. */
function readStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayMode =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || displayMode;
}

/** Read the running build. Browser globals, so this is the hooks layer's. */
export function readMicSettingsPlatform(): MicSettingsPlatform | null {
  if (typeof navigator === "undefined") return null;
  return micSettingsPlatformFrom(
    readSharePlatform(),
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
    readStandalone()
  );
}
